#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { existsSync } from "node:fs";
import {
  normalizeStructuredModels,
  validateModels,
  writeAntigravityUsage,
  splitNameTier,
  clampPercent,
  statusFor,
  slugify,
} from "./update-antigravity-usage.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const appName = "Antigravity";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, true);
  }
}

function usage() {
  return [
    "Usage:",
    "  node scripts/update-antigravity-usage-auto.mjs",
    "  node scripts/update-antigravity-usage-auto.mjs --dry-run",
    "  node scripts/update-antigravity-usage-auto.mjs --commit --push",
    "",
    "Runs only when Antigravity is already open. The script may focus Antigravity,",
    "open Settings > Models, read visible model quota text, screenshot the window,",
    "and derive remainingPercent from the five quota bars.",
  ].join("\n");
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  return result;
}

function runJxa(source) {
  const result = run("osascript", ["-l", "JavaScript", "-e", source], { timeout: 15000 });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`macOS UI automation failed: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function readJxaJson(source) {
  const stdout = runJxa(source);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`macOS UI automation returned invalid JSON: ${String(error)} | ${stdout.slice(0, 500)}`);
  }
}

function runAppleScript(source) {
  const result = run("osascript", ["-e", source], { timeout: 15000 });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`macOS UI automation failed: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function isAntigravityRunning() {
  const result = run("osascript", [
    "-e",
    `tell application "System Events" to exists application process ${JSON.stringify(appName)}`,
  ]);
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    if (/-600|nao esta sendo executado|não está sendo executado|not running/i.test(detail)) return false;
    throw new Error(`Failed to check whether Antigravity is running: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout.trim() === "true";
}

function parseWindowInfo(stdout) {
  const [title, rectLine] = stdout.split(/\r?\n/);
  const [x, y, width, height] = String(rectLine || "").split(",").map(Number);
  if (![x, y, width, height].every(Number.isFinite)) {
    throw new Error(`Antigravity Settings window bounds were not readable: ${stdout}`);
  }

  return { title, rect: { x, y, width, height } };
}

function findExistingModelsWindow() {
  const result = run("/usr/bin/swift", [resolve(root, "scripts/find-antigravity-models-window.swift")], { timeout: 15000 });
  if (result.status !== 0) return null;

  try {
    const window = JSON.parse(result.stdout);
    if (!window?.id || !window?.title) return null;
    return {
      id: Number(window.id),
      title: String(window.title),
      rect: {
        x: Number(window.x),
        y: Number(window.y),
        width: Number(window.width),
        height: Number(window.height),
      },
    };
  } catch {
    return null;
  }
}

function focusModelsWindow() {
  const stdout = runAppleScript(`
tell application "System Events"
  tell application process "Antigravity"
    set frontmost to true
  end tell
  delay 0.25
  tell application process "Antigravity"
    try
      click menu item "Settings..." of menu 1 of menu bar item "Antigravity" of menu bar 1
    on error
      try
        click menu item "Settings" of menu 1 of menu bar item "Antigravity" of menu bar 1
      end try
    end try
  end tell
  delay 0.9
  tell application process "Antigravity"
    set frontmost to true
    set w to front window
    set p to position of w
    set s to size of w
    click at {(item 1 of p) + 88, (item 2 of p) + 225}
    delay 0.6
    set w to front window
    set windowTitle to name of w
    set p to position of w
    set s to size of w
    click at {(item 1 of p) + (item 1 of s) - 80, (item 2 of p) + 82}
    delay 1.2
  end tell
  return windowTitle & linefeed & ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)
end tell
`);
  return parseWindowInfo(stdout);
}

function runOcr(imagePath) {
  const result = run("/usr/bin/swift", [resolve(root, "scripts/ocr-image.swift"), imagePath], { timeout: 30000 });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Failed to OCR Antigravity screenshot: ${detail || `exit ${result.status}`}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`OCR returned invalid JSON: ${String(error)} | ${result.stdout.slice(0, 500)}`);
  }
}

function extractRowsFromOcr(observations) {
  const items = Array.isArray(observations)
    ? observations
        .map((item) => ({
          text: String(item.text || "").replace(/\s+/g, " ").trim(),
          x: Number(item.x),
          y: Number(item.y),
          width: Number(item.width),
          height: Number(item.height),
        }))
        .filter((item) => item.text && [item.x, item.y, item.width, item.height].every(Number.isFinite))
    : [];

  const models = items
    .filter((item) => /^(Gemini|Claude|GPT-OSS)\b/i.test(item.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const refreshes = items
    .filter((item) => /refresh(?:es)?\s+in\s+\d+\s+days?,?\s*(?:\d+\s+)?\d+\s+hours?/i.test(item.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows = [];
  for (const model of models) {
    const modelCenterY = model.y + model.height / 2;
    const refresh = refreshes
      .map((candidate) => ({
        ...candidate,
        distance: Math.abs((candidate.y + candidate.height / 2) - modelCenterY),
      }))
      .filter((candidate) => candidate.distance <= 26)
      .sort((a, b) => a.distance - b.distance || b.x - a.x)[0];

    if (!refresh) continue;
    rows.push({
      name: model.text.replace(/\s*[△⚠].*$/, "").replace(/^(Gemini\s+3\s+Flash)\s+A$/i, "$1").trim(),
      refreshText: refresh.text.replace(/Refresh(?:es)? in/i, "Refreshes in"),
      y: model.y,
    });
  }

  const unique = new Map();
  for (const row of rows) {
    const key = `${row.name}|${row.refreshText}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return Array.from(unique.values()).sort((a, b) => a.y - b.y);
}

async function screenshotWindow(window, outputPath) {
  if (Number.isFinite(window.id)) {
    const result = run("screencapture", ["-x", "-l", String(window.id), outputPath]);
    if (result.status === 0) return;
  }

  const rect = window.rect;
  const region = [
    Math.max(0, Math.round(rect.x)),
    Math.max(0, Math.round(rect.y)),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join(",");

  const result = run("screencapture", ["-x", "-R", region, outputPath]);
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Failed to capture Antigravity window screenshot: ${detail || `exit ${result.status}`}`);
  }
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("Screenshot is not a PNG file.");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null;
  if (!channels) throw new Error(`Unsupported PNG color type: ${colorType}`);

  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[prevRowStart + x - channels] : 0;

      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
      else throw new Error(`Unsupported PNG filter: ${filter}`);

      pixels[rowStart + x] = value & 0xff;
    }

    inputOffset += stride;
  }

  return { width, height, channels, pixels };
}

function brightnessAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return 0;
  const offset = (y * png.width + x) * png.channels;
  if (png.channels === 1) return png.pixels[offset];
  return (png.pixels[offset] + png.pixels[offset + 1] + png.pixels[offset + 2]) / 3;
}

function countBrightRunsFromRow(row, threshold = 135, minRunLength = 30) {
  let runs = 0;
  let current = 0;

  for (const value of row) {
    if (value >= threshold) {
      current += 1;
      continue;
    }

    if (current >= minRunLength) runs += 1;
    current = 0;
  }

  if (current >= minRunLength) runs += 1;
  return Math.max(0, Math.min(5, runs));
}

function countRunsFromRow(row, threshold = 42, minRunLength = 30) {
  let runs = 0;
  let current = 0;

  for (const value of row) {
    if (value >= threshold) {
      current += 1;
      continue;
    }

    if (current >= minRunLength) runs += 1;
    current = 0;
  }

  if (current >= minRunLength) runs += 1;
  return runs;
}

function rowBrightnessValues(png, y, xStart, xEnd) {
  const values = [];
  for (let x = xStart; x <= xEnd; x += 1) {
    values.push(brightnessAt(png, x, y));
  }
  return values;
}

function detectQuotaBarPercents(png, expectedRows) {
  const xStart = Math.max(0, Math.round(png.width * 0.34));
  const xEnd = Math.min(png.width - 1, Math.round(png.width - 18));
  const yStart = Math.max(0, Math.round(png.height * 0.16));
  const yEnd = Math.min(png.height - 1, Math.round(png.height * 0.76));
  const candidates = [];

  for (let y = yStart; y <= yEnd; y += 1) {
    const values = rowBrightnessValues(png, y, xStart, xEnd);
    const trackRuns = countRunsFromRow(values, 42, 28);
    if (trackRuns < 5) continue;

    const brightRuns = countBrightRunsFromRow(values, 135, 28);
    const litPixels = values.filter((value) => value >= 135).length;
    const trackPixels = values.filter((value) => value >= 42).length;
    candidates.push({ y, trackRuns, brightRuns, litPixels, trackPixels });
  }

  const groups = [];
  for (const candidate of candidates) {
    const last = groups.at(-1);
    if (last && candidate.y - last.at(-1).y <= 3) {
      last.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  const rows = groups
    .map((group) => group.sort((a, b) => b.trackPixels - a.trackPixels || b.litPixels - a.litPixels)[0])
    .filter((row) => row.trackRuns >= 5)
    .sort((a, b) => a.y - b.y);

  if (rows.length < expectedRows) {
    throw new Error(`Expected ${expectedRows} visible Antigravity quota bar rows, found ${rows.length}.`);
  }

  return rows.slice(0, expectedRows).map((row) => row.brightRuns * 20);
}

async function buildModelsFromCapture(screenshotPath) {
  const rows = extractRowsFromOcr(runOcr(screenshotPath));
  const minModels = Number(args.get("min-models") || 6);
  if (rows.length < minModels) {
    throw new Error(`Expected at least ${minModels} OCR Antigravity model rows, found ${rows.length}.`);
  }

  const png = decodePng(await readFile(screenshotPath));
  const percents = detectQuotaBarPercents(png, minModels);
  const structured = rows.slice(0, minModels).map((row, index) => ({
    name: row.name,
    remainingPercent: percents[index],
    refreshText: row.refreshText,
  }));

  const models = normalizeStructuredModels(structured, new Date());
  validateModels(models);
  return models;
}

async function captureAntigravityModels() {
  const window = findExistingModelsWindow() || focusModelsWindow();

  const tempDir = await mkdtemp(join(tmpdir(), "antigravity-usage-"));
  const screenshotPath = join(tempDir, "settings-models.png");

  try {
    await screenshotWindow(window, screenshotPath);
    const models = await buildModelsFromCapture(screenshotPath);
    return {
      source: "desktop-ui-automation",
      lastUpdated: new Date().toISOString(),
      models,
      details: {
        windowTitle: window.title,
        screenshotPath: args.has("keep-screenshot") ? screenshotPath : null,
      },
    };
  } finally {
    if (!args.has("keep-screenshot")) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function resolveCliPath() {
  const home = process.env.HOME || "/Users/leosaquetto";
  const paths = [
    join(home, ".npm-global/bin/antigravity-usage"),
    "/usr/local/bin/antigravity-usage",
    "antigravity-usage"
  ];
  for (const p of paths) {
    if (p.startsWith("/") && existsSync(p)) return p;
  }
  return "antigravity-usage";
}

function parseCliOutput(cliJson) {
  const accounts = [];
  let activeModels = [];

  for (const acc of cliJson) {
    if (!acc.email || !acc.snapshot) continue;
    
    const rawModels = acc.snapshot.models || [];
    const models = rawModels.map((model) => {
      const { name, tier } = splitNameTier(model.label || model.modelId);
      const remainingPercent = clampPercent(model.remainingPercentage);
      
      const refreshAt = model.resetTime || null;
      let refreshText = "";
      if (model.timeUntilResetMs && model.timeUntilResetMs > 0) {
        const hours = Math.round(model.timeUntilResetMs / 3600000);
        if (hours >= 24) {
          const days = Math.floor(hours / 24);
          const remHours = hours % 24;
          refreshText = `Refreshes in ${days} ${days === 1 ? "day" : "days"}${remHours > 0 ? `, ${remHours} ${remHours === 1 ? "hour" : "hours"}` : ""}`;
        } else {
          refreshText = `Refreshes in ${hours} ${hours === 1 ? "hour" : "hours"}`;
        }
      } else if (refreshAt) {
        const diffMs = new Date(refreshAt).getTime() - Date.now();
        if (diffMs > 0) {
          const hours = Math.round(diffMs / 3600000);
          if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            refreshText = `Refreshes in ${days} ${days === 1 ? "day" : "days"}${remHours > 0 ? `, ${remHours} ${remHours === 1 ? "hour" : "hours"}` : ""}`;
          } else {
            refreshText = `Refreshes in ${hours} ${hours === 1 ? "hour" : "hours"}`;
          }
        }
      }

      return {
        id: model.modelId || slugify([name, tier].filter(Boolean).join(" ")),
        name,
        tier,
        remainingPercent,
        status: statusFor(remainingPercent),
        refreshText: refreshText || "Refreshes soon",
        refreshAt
      };
    }).filter((model) => /^Gemini\b/i.test(model.name));

    accounts.push({
      email: acc.email,
      isActive: Boolean(acc.isActive),
      status: acc.status || "success",
      lastUpdated: acc.snapshot.timestamp || new Date().toISOString(),
      models
    });

    if (acc.isActive) {
      activeModels = models;
    }
  }

  if (activeModels.length === 0 && accounts.length > 0) {
    activeModels = accounts[0].models;
  }

  return {
    source: "antigravity-cli",
    lastUpdated: new Date().toISOString(),
    accounts,
    models: activeModels
  };
}

async function tryCliPayload() {
  const cliPath = resolveCliPath();
  const result = spawnSync(cliPath, ["quota", "--all", "--json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 90000,
  });

  if (result.status !== 0) {
    throw new Error(`CLI returned status ${result.status}: ${result.stderr || result.stdout}`);
  }

  const data = JSON.parse(result.stdout);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("CLI returned empty or invalid accounts array.");
  }

  return parseCliOutput(data);
}

async function main() {
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  let payload;
  let cliSuccess = false;
  let details = {};

  try {
    console.log("Checking Antigravity quotas via CLI...");
    payload = await tryCliPayload();
    cliSuccess = true;
    details = { method: "cli" };
  } catch (error) {
    console.warn(`CLI check failed: ${error.message}. Falling back to OCR...`);
  }

  if (!cliSuccess) {
    if (!isAntigravityRunning()) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: "antigravity-not-running" }, null, 2));
      return;
    }

    const capture = await captureAntigravityModels();
    payload = {
      source: capture.source,
      lastUpdated: capture.lastUpdated,
      models: capture.models,
    };
    details = capture.details;
  }

  if (args.has("dry-run")) {
    console.log(JSON.stringify({ ok: true, dryRun: true, saved: payload, details }, null, 2));
    return;
  }

  const result = await writeAntigravityUsage(payload, {
    commit: args.has("commit"),
    push: args.has("push"),
  });

  console.log(JSON.stringify({
    ok: true,
    committed: result.committed,
    pushed: result.pushed,
    saved: result.payload,
    details,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  countBrightRunsFromRow,
  decodePng,
  detectQuotaBarPercents,
  extractRowsFromOcr,
  parseCliOutput,
};

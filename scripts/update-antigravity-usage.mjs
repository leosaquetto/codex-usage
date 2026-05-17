#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const outputPath = resolve(root, "antigravity_usage.json");
const summaryPath = resolve(root, "usage_summary.json");
const webappOutputPath = resolve(root, "webapp/antigravity_usage.json");
const webappSummaryPath = resolve(root, "webapp/usage_summary.json");

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      i += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

const args = parseArgs();

function hasFlag(name) {
  return args.has(name);
}

function getArg(name) {
  return args.get(name);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/update-antigravity-usage.mjs --text antigravity-ocr.txt",
    "  pbpaste | node scripts/update-antigravity-usage.mjs --stdin",
    "  node scripts/update-antigravity-usage.mjs --json antigravity-structured.json",
    "",
    "Plain text input should be OCR/plain text from Antigravity Settings > Models.",
    "JSON input should include a top-level models array with name, optional tier, remainingPercent, and refreshText.",
    "After writing antigravity_usage.json, the script rebuilds usage_summary.json.",
  ].join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function inputText() {
  if (hasFlag("help")) {
    console.log(usage());
    process.exit(0);
  }

  if (hasFlag("text")) {
    return readFile(resolve(process.cwd(), getArg("text")), "utf8");
  }

  if (hasFlag("stdin")) {
    return readStdin();
  }

  const pasted = spawnSync("pbpaste", { encoding: "utf8" });
  if (pasted.status === 0 && pasted.stdout.trim()) {
    return pasted.stdout;
  }

  throw new Error(`${usage()}\n\nNo OCR text was provided.`);
}

function parseRefresh(line, now = new Date()) {
  const match = String(line).match(/refresh(?:es)?\s+in\s+(\d+)\s+days?,\s*(\d+)\s+hours?/i);
  if (!match) {
    return { refreshText: line.trim(), refreshAt: null };
  }

  const days = Number(match[1]);
  const hours = Number(match[2]);
  const refreshAt = new Date(now.getTime() + ((days * 24 + hours) * 60 * 60 * 1000));

  return {
    refreshText: match[0].replace(/^refresh/i, "Refresh"),
    refreshAt: refreshAt.toISOString(),
  };
}

function splitNameTier(rawName) {
  const cleaned = rawName
    .replace(/\b\d{1,3}\s*%/g, "")
    .replace(/\s*[△⚠].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^(.*?)\s+\((.*?)\)$/);
  if (!match) return { name: cleaned, tier: "" };
  return { name: match[1].trim(), tier: match[2].trim() };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferPercent(line, index, lines) {
  const sameLine = String(line).match(/(\d{1,3})\s*%/);
  if (sameLine) return clampPercent(Number(sameLine[1]));

  let bar = "";
  for (const nearbyLine of lines.slice(index + 1, index + 6)) {
    if (/refresh(?:es)?\s+in\s+\d+\s+days?,\s*\d+\s+hours?/i.test(nearbyLine)) break;
    const match = nearbyLine.match(/[▁▂▃▄▅▆▇█|_=-]{4,}/);
    if (match) {
      bar = match[0];
      break;
    }
  }

  if (!bar) return null;
  const filled = (bar.match(/[▃▄▅▆▇█|=]/g) || []).length;
  const total = bar.length;
  if (total === 0) return null;
  return clampPercent(Math.round((filled / total) * 100));
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function statusFor(percent) {
  if (!Number.isFinite(percent)) return "unknown";
  if (percent <= 0) return "empty";
  if (percent < 20) return "low";
  return "ok";
}

function parseModels(text, now = new Date()) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const refreshIndexes = [];
  lines.forEach((line, index) => {
    if (/refresh(?:es)?\s+in\s+\d+\s+days?,\s*\d+\s+hours?/i.test(line)) {
      refreshIndexes.push(index);
    }
  });

  const models = [];
  for (const refreshIndex of refreshIndexes) {
    let nameIndex = refreshIndex - 1;
    while (
      nameIndex >= 0 &&
      (/^[-_=|▁▂▃▄▅▆▇█\s]+$/.test(lines[nameIndex]) || /^model quota$/i.test(lines[nameIndex]))
    ) {
      nameIndex -= 1;
    }

    if (nameIndex < 0) continue;
    const rawName = lines[nameIndex].replace(/\s*[△⚠].*$/, "").trim();
    if (!rawName || /refresh/i.test(rawName)) continue;

    const { name, tier } = splitNameTier(rawName);
    const remainingPercent = inferPercent(lines[nameIndex], nameIndex, lines);
    const refresh = parseRefresh(lines[refreshIndex], now);

    models.push({
      id: slugify([name, tier].filter(Boolean).join(" ")),
      name,
      tier,
      remainingPercent,
      status: statusFor(remainingPercent),
      refreshText: refresh.refreshText,
      refreshAt: refresh.refreshAt,
    });
  }

  return models;
}

function normalizeStructuredModels(models, now = new Date()) {
  if (!Array.isArray(models)) return [];

  return models
    .map((model) => {
      const rawName = String(model?.name || "").replace(/\s*[△⚠].*$/, "").trim();
      if (!rawName) return null;

      const split = splitNameTier(rawName);
      const name = split.name;
      const tier = String(model.tier ?? split.tier ?? "").trim();
      const remainingPercent = clampPercent(model.remainingPercent);
      const refresh = parseRefresh(model.refreshText || model.refresh || "", now);

      return {
        id: slugify([name, tier].filter(Boolean).join(" ")),
        name,
        tier,
        remainingPercent,
        status: statusFor(remainingPercent),
        refreshText: refresh.refreshText,
        refreshAt: model.refreshAt || refresh.refreshAt,
      };
    })
    .filter(Boolean);
}

function validateModels(models) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("No Antigravity model quota lines were parsed from the input.");
  }

  for (const model of models) {
    if (!model.name) throw new Error("Antigravity model is missing name.");
    if (!model.id) throw new Error(`Antigravity model "${model.name}" is missing id.`);
    if (!Number.isFinite(model.remainingPercent)) {
      throw new Error(`Antigravity model "${model.name}" is missing remainingPercent.`);
    }
    if (!model.refreshText) {
      throw new Error(`Antigravity model "${model.name}" is missing refreshText.`);
    }
  }
}

async function syncWebappArtifacts() {
  await mkdir(dirname(webappOutputPath), { recursive: true });
  await copyFile(outputPath, webappOutputPath);
  await copyFile(summaryPath, webappSummaryPath);
}

function runSummaryBuilder() {
  const summary = spawnSync(process.execPath, [resolve(root, "scripts/build-usage-summary.mjs")], {
    cwd: root,
    stdio: "inherit",
  });

  if (summary.status !== 0) {
    throw new Error("Failed to rebuild usage_summary.json.");
  }
}

function maybeCommit(enabled) {
  if (!enabled) return false;
  const add = spawnSync("git", ["add", "antigravity_usage.json", "usage_summary.json", "webapp/antigravity_usage.json", "webapp/usage_summary.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (add.status !== 0) throw new Error("Failed to git add Antigravity usage files.");

  const diff = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: root,
    stdio: "inherit",
  });
  if (diff.status === 0) return false;
  if (diff.status !== 1) throw new Error("Failed to inspect staged Antigravity diff.");

  const commit = spawnSync("git", ["commit", "-m", "Update Antigravity usage"], {
    cwd: root,
    stdio: "inherit",
  });
  if (commit.status !== 0) throw new Error("Failed to commit Antigravity usage files.");

  return true;
}

function maybePush(enabled, committed) {
  if (!enabled) return false;
  if (!committed) return false;

  const push = spawnSync("git", ["push"], {
    cwd: root,
    stdio: "inherit",
  });
  if (push.status !== 0) throw new Error("Failed to push Antigravity usage commit.");

  return true;
}

async function readStructuredInput(now = new Date()) {
  const source = hasFlag("json")
    ? await readFile(resolve(process.cwd(), getArg("json")), "utf8")
    : await readStdin();
  const payload = JSON.parse(source);
  return normalizeStructuredModels(payload.models || payload, now);
}

async function buildPayloadFromArgs(now = new Date()) {
  const models = hasFlag("json") || hasFlag("structured-stdin")
    ? await readStructuredInput(now)
    : parseModels(await inputText(), now);

  validateModels(models);

  return {
    source: "desktop-automation",
    lastUpdated: now.toISOString(),
    models,
  };
}

async function writeAntigravityUsage(payload, options = {}) {
  validateModels(payload.models);

  const next = {
    source: payload.source || "desktop-automation",
    lastUpdated: payload.lastUpdated || new Date().toISOString(),
    models: payload.models,
  };

  await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${outputPath} with ${next.models.length} model(s).`);

  runSummaryBuilder();
  await syncWebappArtifacts();

  const committed = maybeCommit(Boolean(options.commit));
  const pushed = maybePush(Boolean(options.push), committed);

  return { payload: next, committed, pushed };
}

async function main() {
  if (hasFlag("help")) {
    console.log(usage());
    return;
  }

  const payload = await buildPayloadFromArgs(new Date());
  const result = await writeAntigravityUsage(payload, {
    commit: hasFlag("commit"),
    push: hasFlag("push"),
  });

  console.log(JSON.stringify({ ok: true, committed: result.committed, pushed: result.pushed, saved: result.payload }, null, 2));
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
  clampPercent,
  normalizeStructuredModels,
  parseModels,
  parseRefresh,
  slugify,
  splitNameTier,
  statusFor,
  validateModels,
  writeAntigravityUsage,
};

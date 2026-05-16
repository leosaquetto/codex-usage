#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outputPath = resolve(root, "antigravity_usage.json");

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
    "  node scripts/update-antigravity-usage.mjs --text antigravity-ocr.txt",
    "  pbpaste | node scripts/update-antigravity-usage.mjs --stdin",
    "",
    "The input should be OCR/plain text from Antigravity Settings > Models.",
    "After writing antigravity_usage.json, the script rebuilds usage_summary.json.",
  ].join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function inputText() {
  if (args.has("help")) {
    console.log(usage());
    process.exit(0);
  }

  if (args.has("text")) {
    return readFile(resolve(process.cwd(), args.get("text")), "utf8");
  }

  if (args.has("stdin")) {
    return readStdin();
  }

  const pasted = spawnSync("pbpaste", { encoding: "utf8" });
  if (pasted.status === 0 && pasted.stdout.trim()) {
    return pasted.stdout;
  }

  throw new Error(`${usage()}\n\nNo OCR text was provided.`);
}

function parseRefresh(line, now) {
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

  const nearby = lines.slice(index + 1, index + 5).join(" ");
  const bars = nearby.match(/[▁▂▃▄▅▆▇█|_=-]{4,}/g) || [];
  if (bars.length === 0) return null;

  const bar = bars.join("");
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

const text = await inputText();
const now = new Date();
const models = parseModels(text, now);

if (models.length === 0) {
  throw new Error("No Antigravity model quota lines were parsed from the input text.");
}

const payload = {
  source: "desktop-automation",
  lastUpdated: now.toISOString(),
  models,
};

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${outputPath} with ${models.length} model(s).`);

const summary = spawnSync(process.execPath, [resolve(root, "scripts/build-usage-summary.mjs")], {
  stdio: "inherit",
});

if (summary.status !== 0) {
  process.exit(summary.status || 1);
}

if (args.has("commit")) {
  const add = spawnSync("git", ["add", "antigravity_usage.json", "usage_summary.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (add.status !== 0) process.exit(add.status || 1);

  const commit = spawnSync("git", ["commit", "-m", "Update Antigravity usage"], {
    cwd: root,
    stdio: "inherit",
  });
  if (commit.status !== 0) process.exit(commit.status || 1);
}

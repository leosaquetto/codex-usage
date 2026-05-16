#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const codexPath = resolve(root, "codex_usage.json");
const antigravityPath = resolve(root, "antigravity_usage.json");
const summaryPath = resolve(root, "usage_summary.json");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function latestIso(...values) {
  const times = values
    .map((value) => {
      const date = value ? new Date(value) : null;
      return date && Number.isFinite(date.getTime()) ? date.getTime() : null;
    })
    .filter((value) => value !== null);

  if (times.length === 0) return new Date().toISOString();
  return new Date(Math.max(...times)).toISOString();
}

const codex = await readJson(codexPath, {
  fiveHourPercent: null,
  fiveHourReset: null,
  weeklyPercent: null,
  weeklyReset: null,
  lastUpdated: null,
});

const antigravity = await readJson(antigravityPath, {
  source: "desktop-automation",
  lastUpdated: null,
  models: [],
});

const summary = {
  lastUpdated: latestIso(codex.lastUpdated, antigravity.lastUpdated),
  codex,
  antigravity,
};

await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${summaryPath}`);

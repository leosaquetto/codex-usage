#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeHistory } from "./codex-usage-history.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const codexPath = resolve(root, "codex_usage.json");
const codexHistoryPath = resolve(root, "codex_usage_history.json");
const antigravityPath = resolve(root, "antigravity_usage.json");
const summaryPath = resolve(root, "usage_summary.json");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function validDateMs(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function latestIso(...values) {
  const times = values
    .map(validDateMs)
    .filter((value) => value !== null);

  if (times.length === 0) return new Date().toISOString();
  return new Date(Math.max(...times)).toISOString();
}

function validateSummary(summary, codexPayload) {
  const codexLastUpdated = summary.codex?.lastUpdated || null;
  const summaryLastUpdated = summary.lastUpdated || null;
  const codexTime = validDateMs(codexLastUpdated);
  const summaryTime = validDateMs(summaryLastUpdated);

  if (!codexTime) {
    throw new Error("usage_summary.json inválido: codex.lastUpdated ausente ou inválido.");
  }

  if (summary.codex?.lastUpdated !== codexPayload.lastUpdated) {
    throw new Error(
      `usage_summary.json desatualizado: codex.lastUpdated=${summary.codex?.lastUpdated || "<ausente>"} ` +
        `diferente de codex_usage.lastUpdated=${codexPayload.lastUpdated || "<ausente>"}.`,
    );
  }

  if (!summaryTime || summaryTime < codexTime) {
    throw new Error(
      `usage_summary.json desatualizado: lastUpdated=${summaryLastUpdated || "<ausente>"} ` +
        `mais antigo que codex_usage.lastUpdated=${codexLastUpdated}.`,
    );
  }
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

const codexHistory = normalizeHistory(await readJson(codexHistoryPath, {
  version: 1,
  lastUpdated: null,
  samples: [],
}));

const summary = {
  lastUpdated: latestIso(codex.lastUpdated, codexHistory.lastUpdated, antigravity.lastUpdated),
  codex,
  codexHistory,
  antigravity,
};

validateSummary(summary, codex);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${summaryPath}`);

#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { normalizeHistory } from "./codex-usage-history.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const codexPath = resolve(root, "codex_usage.json");
const codexHistoryPath = resolve(root, "codex_usage_history.json");
const antigravityPath = resolve(root, "antigravity_usage.json");
const summaryPath = resolve(root, "usage_summary.json");

function parseArgs(argv = process.argv.slice(2)) {
  return new Set(argv.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2)));
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-usage-summary.mjs",
    "  node scripts/build-usage-summary.mjs --verify-only",
    "",
    "The verify-only mode validates usage_summary.json without writing files.",
  ].join("\n");
}

async function readJson(path, fallback, required = false) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (required) {
      throw new Error(`Falha ao ler ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
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

function buildSummary(codex, codexHistory, antigravity) {
  return {
    lastUpdated: latestIso(codex.lastUpdated, codexHistory.lastUpdated, antigravity.lastUpdated),
    codex,
    codexHistory: normalizeHistory(codexHistory),
    antigravity,
  };
}

function validateSummary(summary, expected) {
  const codexLastUpdated = summary.codex?.lastUpdated || null;
  const summaryLastUpdated = summary.lastUpdated || null;
  const codexTime = validDateMs(codexLastUpdated);
  const summaryTime = validDateMs(summaryLastUpdated);

  if (!codexTime) {
    throw new Error("usage_summary.json inválido: codex.lastUpdated ausente ou inválido.");
  }

  if (summary.codex?.lastUpdated !== expected.codex.lastUpdated) {
    throw new Error(
      `usage_summary.json desatualizado: codex.lastUpdated=${summary.codex?.lastUpdated || "<ausente>"} ` +
        `diferente de codex_usage.lastUpdated=${expected.codex.lastUpdated || "<ausente>"}.`,
    );
  }

  if (!summaryTime || summaryTime < codexTime) {
    throw new Error(
      `usage_summary.json desatualizado: lastUpdated=${summaryLastUpdated || "<ausente>"} ` +
        `mais antigo que codex_usage.lastUpdated=${codexLastUpdated}.`,
    );
  }

  if (!isDeepStrictEqual(summary.codex, expected.codex)) {
    throw new Error("usage_summary.json desatualizado: bloco codex difere de codex_usage.json.");
  }
  if (!isDeepStrictEqual(summary.codexHistory, expected.codexHistory)) {
    throw new Error("usage_summary.json desatualizado: bloco codexHistory difere de codex_usage_history.json.");
  }
  if (!isDeepStrictEqual(summary.antigravity, expected.antigravity)) {
    throw new Error("usage_summary.json desatualizado: bloco antigravity difere de antigravity_usage.json.");
  }
  if (summary.lastUpdated !== expected.lastUpdated) {
    throw new Error(
      `usage_summary.json desatualizado: lastUpdated=${summary.lastUpdated || "<ausente>"} ` +
        `diferente do esperado=${expected.lastUpdated || "<ausente>"}.`,
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.has("help")) {
    console.log(usage());
    return;
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
  const codexHistory = await readJson(codexHistoryPath, {
    version: 1,
    lastUpdated: null,
    samples: [],
  });
  const expected = buildSummary(codex, codexHistory, antigravity);

  if (args.has("verify-only")) {
    const existing = await readJson(summaryPath, null, true);
    validateSummary(existing, expected);
    console.log(`Verified ${summaryPath} without writing`);
    return;
  }

  validateSummary(expected, expected);
  await writeFile(summaryPath, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`Wrote ${summaryPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export {
  buildSummary,
  latestIso,
  main,
  validDateMs,
  validateSummary,
};

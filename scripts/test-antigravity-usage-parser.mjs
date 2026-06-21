#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countBrightRunsFromRow, extractRowsFromOcr, parseCliOutput } from "./update-antigravity-usage-auto.mjs";
import {
  normalizeStructuredModels,
  parseModels,
  validateModels,
} from "./update-antigravity-usage.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = await readFile(resolve(root, "scripts/fixtures/antigravity-usage-text.txt"), "utf8");
const now = new Date("2026-05-17T12:00:00.000Z");

const parsed = parseModels(fixture, now);
assert.equal(parsed.length, 3);
assert.equal(parsed[0].name, "Gemini 3.1 Pro");
assert.equal(parsed[0].tier, "High");
assert.equal(parsed[0].remainingPercent, 100);
assert.equal(parsed[2].name, "Gemini 3 Flash");
assert.equal(parsed[2].remainingPercent, 0);
assert.equal(parsed[2].status, "empty");
validateModels(parsed);

const structured = normalizeStructuredModels([
  {
    name: "Gemini 3.1 Pro (High)",
    remainingPercent: 80,
    refreshText: "Refreshes in 5 days, 8 hours",
  },
], now);
assert.deepEqual(structured[0], {
  id: "gemini-3-1-pro-high",
  name: "Gemini 3.1 Pro",
  tier: "High",
  remainingPercent: 80,
  status: "ok",
  refreshText: "Refreshes in 5 days, 8 hours",
  refreshAt: "2026-05-22T20:00:00.000Z",
});

const noisyStructured = normalizeStructuredModels([
  {
    name: "Gemini 3 Flash A",
    remainingPercent: 0,
    refreshText: "Refreshes in 5 days, 5 7 hours",
  },
], now);
assert.equal(noisyStructured[0].name, "Gemini 3 Flash");
assert.equal(noisyStructured[0].refreshText, "Refreshes in 5 days, 7 hours");
assert.equal(noisyStructured[0].refreshAt, "2026-05-22T19:00:00.000Z");

function rowWithRuns(runCount) {
  const values = [];
  for (let i = 0; i < runCount; i += 1) {
    values.push(...Array(45).fill(190), ...Array(8).fill(40));
  }
  for (let i = runCount; i < 5; i += 1) {
    values.push(...Array(45).fill(40), ...Array(8).fill(40));
  }
  return values;
}

for (let runs = 0; runs <= 5; runs += 1) {
  assert.equal(countBrightRunsFromRow(rowWithRuns(runs), 135, 30), runs);
}

const ocrRows = extractRowsFromOcr([
  { text: "Gemini 3.1 Pro (High)", x: 540, y: 210, width: 160, height: 18 },
  { text: "Refreshes in 5 days, 8 hours", x: 940, y: 210, width: 190, height: 18 },
  { text: "Gemini 3 Flash △", x: 540, y: 330, width: 140, height: 18 },
  { text: "Refreshes in 5 days, 6 hours", x: 940, y: 330, width: 190, height: 18 },
  { text: "Claude Sonnet 4.6 (Thinking)", x: 540, y: 450, width: 220, height: 18 },
  { text: "Refreshes in 5 days, 5 8 hours", x: 940, y: 450, width: 190, height: 18 },
]);
assert.deepEqual(ocrRows.map((row) => [row.name, row.refreshText]), [
  ["Gemini 3.1 Pro (High)", "Refreshes in 5 days, 8 hours"],
  ["Gemini 3 Flash", "Refreshes in 5 days, 6 hours"],
  ["Claude Sonnet 4.6 (Thinking)", "Refreshes in 5 days, 5 8 hours"],
]);

const mockCliOutput = [
  {
    email: "leosaquetto@gmail.com",
    isActive: true,
    status: "success",
    snapshot: {
      timestamp: "2026-06-21T02:29:36.702Z",
      method: "google",
      email: "leosaquetto@gmail.com",
      models: [
        {
          label: "Gemini 3.5 Flash (Medium)",
          modelId: "gemini-3-5-flash-medium",
          remainingPercentage: 0.8,
          isExhausted: false,
          resetTime: "2026-06-28T02:29:36Z",
          timeUntilResetMs: 604799769,
          isAutocompleteOnly: false
        }
      ]
    }
  },
  {
    email: "saquettoleo@gmail.com",
    isActive: false,
    status: "success",
    snapshot: {
      timestamp: "2026-06-21T02:29:38.231Z",
      method: "google",
      email: "saquettoleo@gmail.com",
      models: [
        {
          label: "Gemini 3 Flash",
          modelId: "gemini-3-flash",
          remainingPercentage: 1.0,
          isExhausted: false,
          resetTime: "2026-06-28T02:29:38Z",
          timeUntilResetMs: 604799769,
          isAutocompleteOnly: false
        }
      ]
    }
  }
];

const parsedCli = parseCliOutput(mockCliOutput);
assert.equal(parsedCli.source, "antigravity-cli");
assert.equal(parsedCli.accounts.length, 2);
assert.equal(parsedCli.accounts[0].email, "leosaquetto@gmail.com");
assert.equal(parsedCli.accounts[0].isActive, true);
assert.equal(parsedCli.accounts[0].models[0].name, "Gemini 3.5 Flash");
assert.equal(parsedCli.accounts[0].models[0].remainingPercent, 80);
assert.equal(parsedCli.accounts[0].models[0].status, "ok");
assert.equal(parsedCli.accounts[0].models[0].refreshText, "Refreshes in 7 days");

assert.equal(parsedCli.accounts[1].email, "saquettoleo@gmail.com");
assert.equal(parsedCli.accounts[1].isActive, false);

assert.equal(parsedCli.models.length, 1);
assert.equal(parsedCli.models[0].id, "gemini-3-5-flash-medium");

console.log("antigravity usage parser tests ok");

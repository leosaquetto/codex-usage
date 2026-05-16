#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNextData, parseCodexAnalyticsText } from "./update-codex-usage-from-chrome.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const current = {
  fiveHourPercent: 99,
  fiveHourReset: "2026-05-16T09:11:00.000Z",
  weeklyPercent: 88,
  weeklyReset: "2026-05-21T19:12:00.000Z",
  lastUpdated: "2026-05-16T04:11:25.050Z",
};
const now = new Date("2026-05-16T05:00:00.000Z");

async function parseFixture(name) {
  const text = await readFile(resolve(root, "scripts/fixtures", name), "utf8");
  return parseCodexAnalyticsText(text);
}

const pt = await parseFixture("codex-usage-pt.txt");
assert.equal(pt.fiveHourPercent, 74);
assert.equal(pt.weeklyPercent, 62);

const ptNext = buildNextData(current, pt, now);
assert.equal(ptNext.fiveHourPercent, 74);
assert.equal(ptNext.weeklyPercent, 62);
assert.equal(ptNext.weeklyReset, "2026-05-28T22:35:00.000Z");

const en = await parseFixture("codex-usage-en.txt");
assert.equal(en.fiveHourPercent, 31);
assert.equal(en.weeklyPercent, 48);

const enNext = buildNextData(current, en, now);
assert.equal(enNext.fiveHourPercent, 31);
assert.equal(enNext.weeklyPercent, 48);
assert.equal(enNext.weeklyReset, "2026-05-28T22:35:00.000Z");

const signedOut = await readFile(resolve(root, "scripts/fixtures/codex-signed-out.txt"), "utf8");
assert.throws(() => parseCodexAnalyticsText(signedOut), /sign-in|deslogado/i);

const missingPercent = parseCodexAnalyticsText("Limite de uso de 5 horas Redefinição 12:00 Limite de uso semanal Reset May 28, 2026 19:35");
assert.throws(() => buildNextData(current, missingPercent, now), /percentuais/);

const missingReset = parseCodexAnalyticsText("5-hour usage limit 44% remaining Weekly usage limit 77% remaining");
const missingResetNext = buildNextData(current, missingReset, now);
assert.equal(missingResetNext.fiveHourReset, current.fiveHourReset);
assert.equal(missingResetNext.weeklyReset, current.weeklyReset);

console.log("codex usage parser tests ok");

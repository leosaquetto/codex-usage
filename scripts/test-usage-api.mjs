#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.CODEX_USAGE_USE_LOCAL_FILES = "1";

const require = createRequire(import.meta.url);
const usageHandler = require("../webapp/api/usage.js");
const { enrichPayload } = usageHandler;

let statusCode = null;
let payload = null;
const response = {
  setHeader() {},
  status(value) {
    statusCode = value;
    return this;
  },
  json(value) {
    payload = value;
    return this;
  },
};

await usageHandler({}, response);

assert.equal(statusCode, 200);
assert.ok(payload && typeof payload === "object");
assert.ok(Array.isArray(payload.accounts));
assert.equal(typeof payload.activeAccountId === "string" || payload.activeAccountId === null, true);
assert.equal(typeof payload.isStale, "boolean");
assert.equal(typeof payload.dataAgeMinutes === "number" || payload.dataAgeMinutes === null, true);
assert.equal(payload.staleAfterMinutes, 60);
assert.ok(Array.isArray(payload.accountSamples));
assert.ok(Array.isArray(payload.weeklyResetEvents));

for (const account of payload.accounts) {
  assert.equal(typeof account.id, "string");
  assert.equal(typeof account.lastUsedAt === "string" || account.lastUsedAt === null, true);
  assert.equal(typeof account.error === "string" ? account.error.length <= 160 : account.error === null, true);
}

const synthetic = enrichPayload({
  lastUpdated: "2026-06-10T03:00:00.000Z",
  aggregate: {
    fiveHourPercent: 70,
    fiveHourReset: "2026-06-10T06:00:00.000Z",
    weeklyPercent: 60,
    weeklyReset: "2026-06-15T03:00:00.000Z",
  },
  accounts: [{
    id: "go",
    displayName: "FABINHO",
    email: "fabinhomian@gmail.com",
    planType: "go",
    fiveHourPercent: 95,
    fiveHourReset: "2026-07-10T03:00:00.000Z",
    fiveHourWindowMinutes: 30 * 24 * 60,
    weeklyPercent: 95,
    weeklyReset: "2026-07-10T03:00:00.000Z",
    weeklyWindowMinutes: 30 * 24 * 60,
  }],
}, {
  version: 2,
  samples: [],
  accountSamples: [{
    capturedAt: "2026-06-01T03:00:00.000Z",
    email: "fabinhomian@gmail.com",
    displayName: "FABINHO",
    weeklyPercent: 95,
    weeklyReset: "2026-07-10T03:00:00.000Z",
  }],
  weeklyResetEvents: [
    {
      capturedAt: "2026-06-01T03:00:00.000Z",
      email: "fabinhomian@gmail.com",
      displayName: "FABINHO",
      weeklyReset: "2026-07-10T03:00:00.000Z",
    },
    {
      capturedAt: "2026-05-31T12:30:47.930Z",
      email: "contatonatanaelrodrigs@gmail.com",
      displayName: "NATANAEL",
      weeklyReset: "2026-06-07T15:26:55.000Z",
      previousWeeklyReset: "2026-06-01T20:53:34.000Z",
      isEarlyReset: true,
      deltaMs: -105766070,
    },
    {
      capturedAt: "2026-05-31T13:00:00.000Z",
      email: "contatonatanaelrodrigs@gmail.com",
      displayName: "NATANAEL",
      weeklyReset: "2026-06-07T15:26:55.000Z",
      previousWeeklyReset: "2026-06-01T20:53:34.000Z",
      isEarlyReset: true,
      deltaMs: -105000000,
    },
  ],
});
assert.equal(synthetic.accounts[0].fiveHourPercent, null);
assert.equal(synthetic.accounts[0].fiveHourReset, null);
assert.equal(synthetic.accountSamples.length, 0);
assert.equal(synthetic.weeklyResetEvents.length, 1);
assert.equal(synthetic.weeklyResetEvents[0].capturedAt, "2026-05-31T12:30:47.930Z");

console.log("usage api smoke tests ok");

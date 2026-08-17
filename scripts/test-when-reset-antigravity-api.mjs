#!/usr/bin/env node
import assert from "node:assert/strict";
import { accountEndpointSlug, buildCompatiblePayload } from "../webapp/lib/antigravity-compatible.js";

const now = new Date("2026-08-17T21:00:00.000Z");
const payload = buildCompatiblePayload({
  source: "local-account-export",
  lastUpdated: "2026-08-17T20:55:00.000Z",
  accounts: [
    {
      id: "one",
      email: "one@example.com",
      plan: "Google AI Pro",
      windows: [
        {
          id: "gemini-weekly",
          display_name: "Weekly Limit Remaining",
          window: "weekly",
          remainingPercent: 75,
          refreshAt: "2026-08-24T21:00:00.000Z",
        },
        {
          id: "gemini-5h",
          displayName: "Five Hour Limit Remaining",
          window: "5h",
          remainingPercent: 40,
          refreshAt: "2026-08-18T02:00:00.000Z",
        },
        {
          id: "expired",
          name: "Expired",
          remainingPercent: 10,
          refreshAt: "2026-08-17T20:00:00.000Z",
        },
      ],
    },
    {
      id: "two",
      email: "two@example.com",
      models: [{
        id: "gemini-3-1-pro-high",
        name: "Gemini 3.1 Pro",
        tier: "High",
        remainingPercent: 90,
        refreshAt: "2026-08-21T21:00:00.000Z",
      }],
    },
  ],
}, now);

assert.equal(payload.source, "codex-usage-antigravity");
assert.equal(payload.accountCount, 2);
assert.equal(payload.data.windows.length, 3);
assert.deepEqual(
  payload.data.windows.map((window) => [window.kind, window.usedPercent, window.windowMinutes]),
  [["weekly", 25, 10_080], ["5h", 60, 300], ["weekly", 10, 10_080]],
);
assert.ok(payload.data.windows[0].title.includes("one@example.com"));
assert.ok(!JSON.stringify(payload).includes("access_token"));
assert.ok(!JSON.stringify(payload).includes("refresh_token"));

assert.equal(accountEndpointSlug({ id: "one", email: "one@example.com" }, 0), "one");
assert.match(payload.data.windows[0].id, /^antigravity-one-/);
const oneAccount = buildCompatiblePayload({
  lastUpdated: "2026-08-17T20:55:00.000Z",
  accounts: [
    {
      id: "one",
      email: "one@example.com",
      windows: [
        {
          id: "gemini-weekly",
          displayName: "Weekly Limit Remaining",
          remainingPercent: 75,
          refreshAt: "2026-08-24T21:00:00.000Z",
        },
      ],
    },
    {
      id: "two",
      email: "two@example.com",
      plan: "Google AI Pro",
      windows: [
        {
          id: "gemini-weekly",
          displayName: "Weekly Limit Remaining",
          remainingPercent: 50,
          refreshAt: "2026-08-24T21:00:00.000Z",
        },
      ],
    },
  ],
}, now, { accountSelector: "two", includeAccountLabel: false });
assert.equal(oneAccount.accountCount, 1);
assert.equal(oneAccount.data.windows.length, 1);
assert.equal(oneAccount.data.windows[0].usedPercent, 50);
assert.equal(oneAccount.data.windows[0].title, "Weekly Limit Remaining");
assert.equal(oneAccount.data.plan, "Google AI Pro");
assert.equal(oneAccount.data.account.email, "two@example.com");

assert.throws(
  () => buildCompatiblePayload({ lastUpdated: "2026-08-17T20:55:00.000Z", models: [{ remainingPercent: 80, refreshAt: "2026-08-17T20:00:00.000Z" }] }, now),
  /Nenhuma janela futura/,
);

console.log("When Reset Antigravity compatibility tests ok");

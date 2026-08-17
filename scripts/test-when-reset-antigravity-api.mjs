#!/usr/bin/env node
import assert from "node:assert/strict";
import { accountEndpointSlug, buildCompatiblePayload } from "../webapp/lib/antigravity-compatible.js";

const now = new Date("2026-08-17T21:00:00.000Z");

// Mirrors CompatibleAPIProvider.compatibleWindow + UsageWindow.displayTitle
// from the pinned When Reset source used by this bridge.
function parsedWhenResetTitle(window) {
  const normalized = `${window.kind || ""} ${window.title || ""}`
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
  const minutes = Number.isInteger(window.windowMinutes) ? window.windowMinutes : null;
  if (minutes === 300 || normalized.includes("5h") || normalized.includes("five hour")) {
    return "5h limit";
  }
  if (minutes === 10_080 || normalized.includes("weekly") || normalized.includes("7d")) {
    return "Weekly limit";
  }
  return window.title;
}

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
  [["additional", 25, undefined], ["additional", 60, undefined], ["additional", 10, undefined]],
);
assert.ok(payload.data.windows[0].title.includes("one@example.com"));
assert.ok(payload.data.windows[0].title.includes("7-day Limit Remaining"));
assert.ok(payload.data.windows[1].title.includes("5-hour Limit Remaining"));
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
assert.equal(oneAccount.data.windows[0].title, "7-day Limit Remaining");
assert.equal(oneAccount.data.windows[0].kind, "additional");
assert.equal(Object.hasOwn(oneAccount.data.windows[0], "windowMinutes"), false);
assert.equal(oneAccount.data.plan, "Google AI Pro");
assert.equal(oneAccount.data.account.email, "two@example.com");

const groupedAccount = buildCompatiblePayload({
  lastUpdated: "2026-08-17T20:55:00.000Z",
  accounts: [{
    id: "grouped",
    email: "grouped@example.com",
    windows: [
      {
        id: "gemini-5h",
        title: "Gemini Models · 5-hour limit",
        kind: "5h",
        windowMinutes: 300,
        remainingPercent: 99,
        refreshAt: "2026-08-18T02:00:00.000Z",
      },
      {
        id: "gemini-weekly",
        title: "Gemini Models · Weekly limit",
        kind: "weekly",
        windowMinutes: 10_080,
        remainingPercent: 98,
        refreshAt: "2026-08-24T21:00:00.000Z",
      },
      {
        id: "3p-5h",
        title: "Claude and GPT models · 5-hour limit",
        kind: "5h",
        windowMinutes: 300,
        remainingPercent: 97,
        refreshAt: "2026-08-18T03:00:00.000Z",
      },
      {
        id: "3p-weekly",
        title: "Claude and GPT models · Weekly limit",
        kind: "weekly",
        windowMinutes: 10_080,
        remainingPercent: 96,
        refreshAt: "2026-08-24T22:00:00.000Z",
      },
    ],
  }],
}, now, { accountSelector: "grouped", includeAccountLabel: false });

assert.deepEqual(
  groupedAccount.data.windows.map((window) => window.title),
  [
    "Gemini Models · 5-hour limit",
    "Gemini Models · 7-day limit",
    "Claude and GPT models · 5-hour limit",
    "Claude and GPT models · 7-day limit",
  ],
);
assert.ok(groupedAccount.data.windows.every((window) => window.kind === "additional"));
assert.ok(groupedAccount.data.windows.every((window) => !Object.hasOwn(window, "windowMinutes")));
assert.deepEqual(
  groupedAccount.data.windows.map(parsedWhenResetTitle),
  groupedAccount.data.windows.map((window) => window.title),
);

assert.throws(
  () => buildCompatiblePayload({ lastUpdated: "2026-08-17T20:55:00.000Z", models: [{ remainingPercent: 80, refreshAt: "2026-08-17T20:00:00.000Z" }] }, now),
  /Nenhuma janela futura/,
);

console.log("When Reset Antigravity compatibility tests ok");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendCodexUsageSample, normalizeHistory } from "./codex-usage-history.mjs";

const legacy = {
  version: 1,
  samples: [
    {
      capturedAt: "2026-05-25T20:00:00.000Z",
      fiveHourPercent: 80,
      fiveHourReset: "2026-05-25T22:00:00.000Z",
      weeklyPercent: 50,
      weeklyReset: "2026-06-01T20:00:00.000Z",
    },
  ],
};

const migrated = normalizeHistory(legacy);
assert.equal(migrated.version, 2);
assert.equal(migrated.samples.length, 1);
assert.ok(migrated.accountSamples.some((sample) => sample.email === "jv5pdcwnxp@privaterelay.appleid.com"));
assert.ok(migrated.accountSamples.some((sample) => sample.email === "leoaraujo1949@gmail.com"));
assert.equal(migrated.accountSamples.some((sample) => sample.displayName === "FREE #1"), false);
assert.equal(migrated.accountSamples.some((sample) => sample.email === "fabinhomian@gmail.com"), false);

const CASE_EMAIL = "case@example.com";
function weeklyEventsFor(samples) {
  return normalizeHistory({
    version: 2,
    samples: [],
    accountSamples: samples.map((sample) => ({
      email: CASE_EMAIL,
      displayName: "CASE",
      ...sample,
    })),
  }).weeklyResetEvents;
}

const firstOnlyEvents = weeklyEventsFor([{
  capturedAt: "2026-06-01T10:00:00.000Z",
  weeklyPercent: 100,
  weeklyReset: "2026-06-08T10:00:00.000Z",
}]);
assert.equal(firstOnlyEvents.length, 1);
assert.equal(firstOnlyEvents[0].isEarlyReset, false);

const earlyWithoutRecovery = weeklyEventsFor([
  {
    capturedAt: "2026-06-01T10:00:00.000Z",
    weeklyPercent: 44,
    weeklyReset: "2026-06-08T10:00:00.000Z",
  },
  {
    capturedAt: "2026-06-07T10:00:00.000Z",
    weeklyPercent: 44,
    weeklyReset: "2026-06-14T10:00:00.000Z",
  },
]);
assert.equal(earlyWithoutRecovery.at(-1).deltaMs < 0, true);
assert.equal(earlyWithoutRecovery.at(-1).weeklyPercentDelta, 0);
assert.equal(earlyWithoutRecovery.at(-1).isEarlyReset, false);

const earlyWithPartialRecovery = weeklyEventsFor([
  {
    capturedAt: "2026-06-01T10:00:00.000Z",
    weeklyPercent: 21,
    weeklyReset: "2026-06-08T10:00:00.000Z",
  },
  {
    capturedAt: "2026-06-07T10:00:00.000Z",
    weeklyPercent: 44,
    weeklyReset: "2026-06-14T10:00:00.000Z",
  },
]);
assert.equal(earlyWithPartialRecovery.at(-1).weeklyPercentDelta, 23);
assert.equal(earlyWithPartialRecovery.at(-1).earlyReason, "percent-increase");
assert.equal(earlyWithPartialRecovery.at(-1).isEarlyReset, true);
assert.equal(earlyWithPartialRecovery.at(-1).isNotifiableEarlyReset, false);
assert.equal(earlyWithPartialRecovery.at(-1).cycleDurationMs, 6 * 24 * 60 * 60 * 1000);

const earlyWithFullRecovery = weeklyEventsFor([
  {
    capturedAt: "2026-06-01T10:00:00.000Z",
    weeklyPercent: 21,
    weeklyReset: "2026-06-08T10:00:00.000Z",
  },
  {
    capturedAt: "2026-06-07T10:00:00.000Z",
    weeklyPercent: 99,
    weeklyReset: "2026-06-14T10:00:00.000Z",
  },
]);
assert.equal(earlyWithFullRecovery.at(-1).earlyReason, "full-renewal");
assert.equal(earlyWithFullRecovery.at(-1).isEarlyReset, true);
assert.equal(earlyWithFullRecovery.at(-1).isNotifiableEarlyReset, true);

const afterDeadlineWithRecovery = weeklyEventsFor([
  {
    capturedAt: "2026-06-01T10:00:00.000Z",
    weeklyPercent: 21,
    weeklyReset: "2026-06-08T10:00:00.000Z",
  },
  {
    capturedAt: "2026-06-08T10:05:00.000Z",
    weeklyPercent: 44,
    weeklyReset: "2026-06-15T10:00:00.000Z",
  },
]);
assert.equal(afterDeadlineWithRecovery.at(-1).deltaMs > 0, true);
assert.equal(afterDeadlineWithRecovery.at(-1).weeklyPercentDelta, 23);
assert.equal(afterDeadlineWithRecovery.at(-1).isEarlyReset, false);
assert.equal(afterDeadlineWithRecovery.at(-1).isNotifiableEarlyReset, false);

const basePayload = {
  lastUpdated: "2026-06-01T10:00:00.000Z",
  fiveHourPercent: 70,
  fiveHourReset: "2026-06-01T12:00:00.000Z",
  weeklyPercent: 90,
  weeklyReset: "2026-06-08T10:00:00.000Z",
  accounts: [
    {
      id: "old-id",
      displayName: "LEO I",
      email: "jv5pdcwnxp@privaterelay.appleid.com",
      weeklyPercent: 90,
      weeklyReset: "2026-06-08T10:00:00.000Z",
    },
  ],
};

const first = appendCodexUsageSample({ version: 2, samples: [], accountSamples: [] }, basePayload);
assert.equal(first.weeklyResetEvents.length, 1);
assert.equal(first.weeklyResetEvents[0].isEarlyReset, false);

const duplicate = appendCodexUsageSample(first, {
  ...basePayload,
  lastUpdated: "2026-06-01T10:05:00.000Z",
});
assert.equal(duplicate.weeklyResetEvents.length, 1);
assert.equal(duplicate.weeklyResetEvents[0].capturedAt, "2026-06-01T10:00:00.000Z");

const later = appendCodexUsageSample(duplicate, {
  ...basePayload,
  lastUpdated: "2026-06-08T10:05:00.000Z",
  weeklyReset: "2026-06-09T10:00:00.000Z",
  accounts: [{
    ...basePayload.accounts[0],
    weeklyReset: "2026-06-09T10:00:00.000Z",
  }],
});
assert.equal(later.weeklyResetEvents.length, 2);
assert.equal(later.weeklyResetEvents.at(-1).isEarlyReset, false);
assert.ok(later.weeklyResetEvents.at(-1).deltaMs > 0);

const early = appendCodexUsageSample(later, {
  ...basePayload,
  lastUpdated: "2026-06-08T10:10:00.000Z",
  weeklyReset: "2026-06-15T10:00:00.000Z",
  accounts: [{
    id: "new-id-after-reinsert",
    displayName: "LEO I NOVO",
    email: "jv5pdcwnxp@privaterelay.appleid.com",
    weeklyPercent: 100,
    weeklyReset: "2026-06-15T10:00:00.000Z",
  }],
});
assert.equal(early.weeklyResetEvents.length, 3);
assert.equal(early.weeklyResetEvents.at(-1).isEarlyReset, true);
assert.equal(early.weeklyResetEvents.at(-1).isNotifiableEarlyReset, true);
assert.ok(early.weeklyResetEvents.at(-1).deltaMs < 0);
assert.equal(new Set(early.accountSamples.map((sample) => sample.email)).size, 1);

const jitter = appendCodexUsageSample(early, {
  ...basePayload,
  lastUpdated: "2026-06-08T10:30:00.000Z",
  weeklyReset: "2026-06-09T10:00:00.000Z",
  accounts: [{
    ...basePayload.accounts[0],
    id: "another-id-same-email",
    weeklyReset: "2026-06-09T10:00:00.000Z",
  }],
});
assert.equal(jitter.weeklyResetEvents.length, 3);
assert.equal(
  jitter.weeklyResetEvents.find((event) => event.weeklyReset === "2026-06-09T10:00:00.000Z")?.capturedAt,
  "2026-06-08T10:05:00.000Z",
);

const withThirtyDayAccount = appendCodexUsageSample(early, {
  ...basePayload,
  lastUpdated: "2026-06-08T11:00:00.000Z",
  accounts: [{
    id: "fabinho-go",
    displayName: "FABINHO",
    email: "fabinhomian@gmail.com",
    planType: "go",
    weeklyPercent: 95,
    weeklyReset: "2026-07-10T10:00:00.000Z",
    weeklyWindowMinutes: 30 * 24 * 60,
  }],
});
assert.equal(withThirtyDayAccount.accountSamples.some((sample) => sample.email === "fabinhomian@gmail.com"), false);
assert.equal(withThirtyDayAccount.weeklyResetEvents.some((event) => event.email === "fabinhomian@gmail.com"), false);

console.log("codex usage history tests ok");

#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  evaluateNotificationSignals,
  markNotificationSignalSent,
} from "../webapp/notification-engine.mjs";

const nowMs = new Date("2026-06-03T18:00:00.000Z").getTime();
const baseAccount = {
  id: "account-a",
  name: "Conta A",
  fiveHourPercent: 80,
  fiveHourReset: "2026-06-03T20:00:00.000Z",
  weeklyPercent: 70,
  weeklyReset: "2026-06-08T20:00:00.000Z",
};
const freshUsage = {
  lastUpdated: "2026-06-03T17:50:00.000Z",
  accounts: [baseAccount],
};

const firstSeen = evaluateNotificationSignals({ usage: freshUsage, nowMs });
assert.deepEqual(firstSeen.signals, []);
assert.equal(firstSeen.nextState.byAccount["account-a"].seen, true);

const weeklyLow = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{ ...baseAccount, weeklyPercent: 20 }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(weeklyLow.signals.map((signal) => signal.ruleId), ["weeklyLow"]);
markNotificationSignalSent(weeklyLow.nextState, weeklyLow.signals[0], new Date(nowMs).toISOString());

const weeklyLowRepeat = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{ ...baseAccount, weeklyPercent: 19 }],
  },
  state: weeklyLow.nextState,
  nowMs: nowMs + 60_000,
});
assert.deepEqual(weeklyLowRepeat.signals, []);

const fiveHourLow = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{ ...baseAccount, fiveHourPercent: 15 }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(fiveHourLow.signals.map((signal) => signal.ruleId), ["fiveHourLow"]);

const fiveHourRefill = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      fiveHourPercent: 99,
      fiveHourReset: "2026-06-04T01:00:00.000Z",
    }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(fiveHourRefill.signals.map((signal) => signal.ruleId), ["fiveHourRefill"]);
assert.match(fiveHourRefill.signals[0].body, /5h foi de 80% para 99%/);

const fiveHourRefillFullCarryover = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      fiveHourPercent: 100,
      fiveHourReset: "2026-06-04T01:00:00.000Z",
    }],
  },
  state: {
    ...firstSeen.nextState,
    byAccount: {
      "account-a": {
        ...firstSeen.nextState.byAccount["account-a"],
        fiveHourPercent: 99,
      },
    },
  },
  nowMs,
});
assert.deepEqual(fiveHourRefillFullCarryover.signals, []);

const fiveHourRefillNoWeeklyAvailable = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      fiveHourPercent: 99,
      fiveHourReset: "2026-06-04T01:00:00.000Z",
      weeklyPercent: 0,
    }],
  },
  state: {
    ...firstSeen.nextState,
    byAccount: {
      "account-a": {
        ...firstSeen.nextState.byAccount["account-a"],
        weeklyPercent: 0,
      },
    },
  },
  nowMs,
});
assert.deepEqual(fiveHourRefillNoWeeklyAvailable.signals, []);

const refill = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      weeklyPercent: 100,
      weeklyReset: "2026-06-07T20:00:00.000Z",
    }],
  },
  state: weeklyLow.nextState,
  nowMs,
});
assert.deepEqual(refill.signals.map((signal) => signal.ruleId), ["weeklyRefill"]);
assert.match(refill.signals[0].body, /semanal foi de 20% para 100%/);

const partialEarlyReset = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      weeklyPercent: 95,
      weeklyReset: "2026-06-07T20:00:00.000Z",
    }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(partialEarlyReset.signals, []);

const carryoverFullReset = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      weeklyPercent: 99,
      weeklyReset: "2026-06-07T20:00:00.000Z",
    }],
  },
  state: {
    ...firstSeen.nextState,
    byAccount: {
      "account-a": {
        ...firstSeen.nextState.byAccount["account-a"],
        weeklyPercent: 100,
      },
    },
  },
  nowMs,
});
assert.deepEqual(carryoverFullReset.signals, []);

const fullButOnTimeReset = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    lastUpdated: "2026-06-08T20:05:00.000Z",
    accounts: [{
      ...baseAccount,
      weeklyPercent: 99,
      weeklyReset: "2026-06-15T20:00:00.000Z",
    }],
  },
  state: firstSeen.nextState,
  nowMs: new Date("2026-06-08T20:05:00.000Z").getTime(),
});
assert.deepEqual(fullButOnTimeReset.signals.map((signal) => signal.ruleId), ["weeklyRefill"]);
assert.match(fullButOnTimeReset.signals[0].body, /semanal foi de 70% para 99%/);

const weeklyRefillAboveThresholdNoAlert = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    lastUpdated: "2026-06-08T20:05:00.000Z",
    accounts: [{
      ...baseAccount,
      weeklyPercent: 99,
      weeklyReset: "2026-06-15T20:00:00.000Z",
    }],
  },
  state: {
    ...firstSeen.nextState,
    byAccount: {
      "account-a": {
        ...firstSeen.nextState.byAccount["account-a"],
        weeklyPercent: 90,
      },
    },
  },
  nowMs: new Date("2026-06-08T20:05:00.000Z").getTime(),
});
assert.deepEqual(weeklyRefillAboveThresholdNoAlert.signals, []);

const highNearReset = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      weeklyPercent: 31,
      weeklyReset: "2026-06-04T12:00:00.000Z",
    }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(highNearReset.signals.map((signal) => signal.ruleId), ["weeklyHighNearReset"]);

const lowNearResetNoAlert = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      weeklyPercent: 30,
      weeklyReset: "2026-06-04T12:00:00.000Z",
    }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(lowNearResetNoAlert.signals, []);

const farNearResetNoAlert = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      weeklyPercent: 31,
      weeklyReset: "2026-06-05T20:00:00.000Z",
    }],
  },
  state: firstSeen.nextState,
  nowMs,
});
assert.deepEqual(farNearResetNoAlert.signals, []);

const stale = evaluateNotificationSignals({
  usage: {
    lastUpdated: "2026-06-03T15:00:00.000Z",
    accounts: [],
  },
  nowMs,
});
assert.equal(stale.isStale, true);
assert.deepEqual(stale.signals.map((signal) => signal.ruleId), ["dataStale"]);

const loadError = evaluateNotificationSignals({
  usage: freshUsage,
  hasLoadError: true,
  nowMs,
});
assert.deepEqual(loadError.signals.map((signal) => signal.ruleId), ["dataStale"]);

const emailIdentityFirst = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{ ...baseAccount, id: "old-id", email: "conta@example.com" }],
  },
  nowMs,
});
const emailIdentityReinserted = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      id: "new-id",
      email: "conta@example.com",
      weeklyPercent: 20,
    }],
  },
  state: emailIdentityFirst.nextState,
  nowMs,
});
assert.deepEqual(emailIdentityReinserted.signals.map((signal) => signal.ruleId), ["weeklyLow"]);
assert.equal(emailIdentityReinserted.nextState.byAccount["conta@example.com"].seen, true);

const goFirst = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      id: "go-account",
      email: "go@example.com",
      planType: "go",
      fiveHourWindowMinutes: 30 * 24 * 60,
      weeklyWindowMinutes: 30 * 24 * 60,
    }],
  },
  nowMs,
});
const goChanged = evaluateNotificationSignals({
  usage: {
    ...freshUsage,
    accounts: [{
      ...baseAccount,
      id: "go-account-new-id",
      email: "go@example.com",
      planType: "go",
      fiveHourPercent: 10,
      weeklyPercent: 20,
      weeklyReset: "2026-07-08T20:00:00.000Z",
      fiveHourWindowMinutes: 30 * 24 * 60,
      weeklyWindowMinutes: 30 * 24 * 60,
    }],
  },
  state: goFirst.nextState,
  nowMs,
});
assert.deepEqual(goChanged.signals, []);

console.log("notification engine tests ok");

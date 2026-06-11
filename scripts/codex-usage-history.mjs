import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildWeeklyResetEvents } = require("../webapp/weekly-reset-events.cjs");

const DEFAULT_HISTORY_LIMIT = 2000;
const DEFAULT_ACCOUNT_SAMPLE_LIMIT = 12000;

const LEGACY_ACCOUNT_EMAILS = [
  { displayName: "LEO I", aliases: ["LEO I", "LEO", "LEO 1"], email: "jv5pdcwnxp@privaterelay.appleid.com" },
  { displayName: "LEO II", aliases: ["LEO II", "LEO 2", "LEO (TRIAL)", "GOOGLE"], email: "leoaraujo1949@gmail.com" },
  { displayName: "AMANDA", aliases: ["DINHA", "AMANADA", "AMANDA"], email: "dzplaybacks@gmail.com" },
  { displayName: "NATANAEL", aliases: ["NATANAEL", "NATAN", "NATE"], email: "contatonatanaelrodrigs@gmail.com" },
  { displayName: "FABINHO", aliases: ["FABINHO", "FABINH", "FABIO"], email: "fabinhomian@gmail.com", weeklyHistory: false },
  { displayName: "DOUGLAS", aliases: ["DOUGLAS"], email: "douglaschatgpt.am@gmail.com" },
];

const LEGACY_EMAIL_BY_ALIAS = new Map(
  LEGACY_ACCOUNT_EMAILS.flatMap((account) => account.aliases.map((alias) => [normalizeLabel(alias), account.email])),
);
const NON_WEEKLY_HISTORY_EMAILS = new Set(
  LEGACY_ACCOUNT_EMAILS.filter((account) => account.weeklyHistory === false).map((account) => account.email),
);

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function validIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeLabel(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function emailForAccount(raw) {
  return normalizeEmail(raw?.email)
    || LEGACY_EMAIL_BY_ALIAS.get(normalizeLabel(raw?.displayName))
    || LEGACY_EMAIL_BY_ALIAS.get(normalizeLabel(raw?.name))
    || null;
}

function isWeeklyHistoryAccount(raw) {
  const email = emailForAccount(raw);
  const plan = String(raw?.planType || raw?.plan_type || "").trim().toUpperCase();
  const weeklyWindowMinutes = Number(raw?.weeklyWindowMinutes || raw?.weekly_window_minutes);
  const fiveHourWindowMinutes = Number(raw?.fiveHourWindowMinutes || raw?.five_hour_window_minutes);
  const longWindowMinutes = 20 * 24 * 60;
  return Boolean(email)
    && !NON_WEEKLY_HISTORY_EMAILS.has(email)
    && plan !== "FREE"
    && plan !== "GO"
    && !(Number.isFinite(weeklyWindowMinutes) && weeklyWindowMinutes >= longWindowMinutes)
    && !(Number.isFinite(fiveHourWindowMinutes) && fiveHourWindowMinutes >= longWindowMinutes);
}

function normalizeSample(raw) {
  const capturedAt = validIso(raw?.capturedAt || raw?.lastUpdated);
  const fiveHourPercent = clampPercent(raw?.fiveHourPercent, null);
  const weeklyPercent = clampPercent(raw?.weeklyPercent, null);
  const weeklyReset = validIso(raw?.weeklyReset);

  if (!capturedAt || fiveHourPercent === null || weeklyPercent === null || !weeklyReset) {
    return null;
  }

  return {
    capturedAt,
    fiveHourPercent,
    fiveHourReset: validIso(raw?.fiveHourReset),
    weeklyPercent,
    weeklyReset,
  };
}

function normalizeAccountSample(raw) {
  const capturedAt = validIso(raw?.capturedAt || raw?.lastUpdated);
  const email = normalizeEmail(raw?.email);
  const weeklyPercent = clampPercent(raw?.weeklyPercent, null);
  const weeklyReset = validIso(raw?.weeklyReset);

  if (!capturedAt || !email || weeklyPercent === null || !weeklyReset) return null;

  return {
    capturedAt,
    email,
    displayName: String(raw?.displayName || raw?.name || email).trim(),
    weeklyPercent,
    weeklyReset,
  };
}

function sampleSort(a, b) {
  return new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
}

function dedupeByKey(items, keyFn) {
  const deduped = new Map();
  for (const item of items) {
    deduped.set(keyFn(item), item);
  }
  return [...deduped.values()];
}

function dedupeByFirstKey(items, keyFn) {
  const deduped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!deduped.has(key)) deduped.set(key, item);
  }
  return [...deduped.values()];
}

function normalizeAggregateSamples(raw) {
  const samples = Array.isArray(raw?.samples)
    ? raw.samples.map(normalizeSample).filter(Boolean)
    : [];

  return dedupeByKey(samples, (sample) => sample.capturedAt)
    .sort(sampleSort)
    .slice(-DEFAULT_HISTORY_LIMIT);
}

function legacyAccountSamplesFromAggregate(samples) {
  const accountSamples = [];

  for (const sample of samples) {
    for (const account of LEGACY_ACCOUNT_EMAILS.filter((item) => item.weeklyHistory !== false)) {
      accountSamples.push({
        capturedAt: sample.capturedAt,
        email: account.email,
        displayName: account.displayName,
        weeklyPercent: sample.weeklyPercent,
        weeklyReset: sample.weeklyReset,
      });
    }
  }

  return accountSamples;
}

function normalizeAccountSamples(raw, aggregateSamples) {
  const explicitSamples = Array.isArray(raw?.accountSamples)
    ? raw.accountSamples.map(normalizeAccountSample).filter(Boolean)
    : [];
  const samples = (explicitSamples.length ? explicitSamples : legacyAccountSamplesFromAggregate(aggregateSamples))
    .filter((sample) => !NON_WEEKLY_HISTORY_EMAILS.has(sample.email));

  return dedupeByKey(samples, (sample) => `${sample.email}|${sample.capturedAt}|${sample.weeklyReset}`)
    .sort((a, b) => sampleSort(a, b) || a.email.localeCompare(b.email))
    .slice(-DEFAULT_ACCOUNT_SAMPLE_LIMIT);
}

function normalizeHistory(raw) {
  const samples = normalizeAggregateSamples(raw);
  const accountSamples = normalizeAccountSamples(raw, samples);
  const weeklyResetEvents = buildWeeklyResetEvents(accountSamples);
  const lastUpdated = [
    samples.at(-1)?.capturedAt,
    accountSamples.at(-1)?.capturedAt,
  ].filter(Boolean).sort().at(-1) || null;

  return {
    version: 2,
    lastUpdated,
    samples,
    accountSamples,
    weeklyResetEvents,
  };
}

function appendCodexUsageSample(history, payload, limit = DEFAULT_HISTORY_LIMIT) {
  const normalized = normalizeHistory(history);
  const nextSample = normalizeSample({
    capturedAt: payload?.lastUpdated,
    fiveHourPercent: payload?.fiveHourPercent,
    fiveHourReset: payload?.fiveHourReset,
    weeklyPercent: payload?.weeklyPercent,
    weeklyReset: payload?.weeklyReset,
  });

  if (!nextSample) {
    throw new Error("Histórico inválido: payload Codex não gerou uma amostra válida.");
  }

  const nextAccountSamples = (Array.isArray(payload?.accounts) ? payload.accounts : [])
    .filter(isWeeklyHistoryAccount)
    .map((account) => normalizeAccountSample({
      capturedAt: payload?.lastUpdated,
      email: emailForAccount(account),
      displayName: account?.displayName || account?.name,
      weeklyPercent: account?.weeklyPercent,
      weeklyReset: account?.weeklyReset,
    }))
    .filter(Boolean);

  const samples = dedupeByKey([...normalized.samples, nextSample], (sample) => sample.capturedAt)
    .sort(sampleSort)
    .slice(-limit);
  const accountSamples = dedupeByKey(
    [...normalized.accountSamples, ...nextAccountSamples],
    (sample) => `${sample.email}|${sample.capturedAt}|${sample.weeklyReset}`,
  )
    .sort((a, b) => sampleSort(a, b) || a.email.localeCompare(b.email))
    .slice(-DEFAULT_ACCOUNT_SAMPLE_LIMIT);

  return {
    version: 2,
    lastUpdated: [samples.at(-1)?.capturedAt, accountSamples.at(-1)?.capturedAt].filter(Boolean).sort().at(-1) || nextSample.capturedAt,
    samples,
    accountSamples,
    weeklyResetEvents: buildWeeklyResetEvents(accountSamples),
  };
}

export {
  appendCodexUsageSample,
  emailForAccount,
  isWeeklyHistoryAccount,
  normalizeAccountSample,
  normalizeEmail,
  normalizeHistory,
  normalizeSample,
};

const DEFAULT_HISTORY_LIMIT = 2000;

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

function normalizeHistory(raw) {
  const samples = Array.isArray(raw?.samples)
    ? raw.samples.map(normalizeSample).filter(Boolean)
    : [];
  const deduped = new Map();

  for (const sample of samples) {
    deduped.set(sample.capturedAt, sample);
  }

  const sortedSamples = [...deduped.values()].sort(
    (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );

  return {
    version: 1,
    lastUpdated: sortedSamples.at(-1)?.capturedAt || null,
    samples: sortedSamples,
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

  const byCapturedAt = new Map(normalized.samples.map((sample) => [sample.capturedAt, sample]));
  byCapturedAt.set(nextSample.capturedAt, nextSample);

  const samples = [...byCapturedAt.values()]
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .slice(-limit);

  return {
    version: 1,
    lastUpdated: samples.at(-1)?.capturedAt || nextSample.capturedAt,
    samples,
  };
}

export {
  appendCodexUsageSample,
  normalizeHistory,
  normalizeSample,
};

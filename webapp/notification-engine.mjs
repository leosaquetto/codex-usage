const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
const DATA_STALE_COOLDOWN_MS = 30 * 60 * 1000;
const WEEKLY_LOW_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const FIVE_HOUR_LOW_COOLDOWN_MS = 3 * 60 * 60 * 1000;

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function dateIso(value) {
  return parseDate(value)?.toISOString() || null;
}

function resetPatternKey(value) {
  const date = parseDate(value);
  if (!date) return null;
  return `${date.getDay()}-${date.getHours()}-${date.getMinutes()}`;
}

function isCoolingDown(previousAt, cooldownMs, nowMs) {
  const previousDate = parseDate(previousAt);
  return Boolean(previousDate && nowMs - previousDate.getTime() < cooldownMs);
}

function accountKey(account) {
  return account?.id || account?.name || null;
}

function percentText(value) {
  const percent = clampPercent(value, null);
  return percent === null ? "--" : `${Math.round(percent)}%`;
}

function formatDateTimePtBr(value) {
  const date = parseDate(value);
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function cloneState(state = {}) {
  const byAccount = state.byAccount && typeof state.byAccount === "object"
    ? Object.fromEntries(Object.entries(state.byAccount).map(([key, value]) => [key, { ...(value || {}) }]))
    : {};
  return {
    ...state,
    byAccount,
    recent: Array.isArray(state.recent) ? [...state.recent] : [],
  };
}

function buildSignal(ruleId, account, title, body, tag, cooldownField = null) {
  return {
    ruleId,
    accountKey: account ? accountKey(account) : null,
    type: account ? "account" : "global",
    title,
    body,
    tag,
    cooldownField,
  };
}

function evaluateNotificationSignals({
  usage,
  state = {},
  hasLoadError = false,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const nextState = cloneState(state);
  const signals = [];
  const usageUpdatedAt = parseDate(usage?.lastUpdatedDate || usage?.lastUpdated);
  const isStale = hasLoadError || !usageUpdatedAt || nowMs - usageUpdatedAt.getTime() > staleAfterMs;

  if (isStale && !isCoolingDown(state.lastDataStaleAt, DATA_STALE_COOLDOWN_MS, nowMs)) {
    const lastUpdatedText = usageUpdatedAt
      ? `Ultima atualizacao: ${formatDateTimePtBr(usageUpdatedAt)}.`
      : "Sem data de atualizacao valida.";
    signals.push(buildSignal(
      "dataStale",
      null,
      "Dados do Codex atrasados",
      lastUpdatedText,
      `codex-data-stale-${usageUpdatedAt?.toISOString() || "unknown"}`,
      "lastDataStaleAt",
    ));
  }

  for (const account of usage?.accounts || []) {
    const key = accountKey(account);
    if (!key) continue;

    const currentReset = dateIso(account.weeklyResetDate || account.weeklyReset);
    const currentResetPattern = resetPatternKey(currentReset);
    const currentPercent = clampPercent(account.weeklyPercent, null);
    const currentFiveHourPercent = clampPercent(account.fiveHourPercent, null);
    const previous = nextState.byAccount[key] || {};
    const previousReset = typeof previous.weeklyReset === "string" ? previous.weeklyReset : null;
    const previousResetPattern = typeof previous.weeklyResetPattern === "string" ? previous.weeklyResetPattern : null;
    const previousPercent = clampPercent(previous.weeklyPercent, null);
    const previousFiveHourPercent = clampPercent(previous.fiveHourPercent, null);
    const firstSeen = !previous.seen;
    const refilled = previousPercent !== null && previousPercent < 95 && currentPercent !== null && currentPercent >= 95;
    const resetPatternChanged = Boolean(previousResetPattern && currentResetPattern && previousResetPattern !== currentResetPattern);
    const resetChanged = Boolean(previousReset && currentReset && previousReset !== currentReset);
    const displayName = account.name || "Conta";

    if (!firstSeen && resetPatternChanged) {
      signals.push(buildSignal(
        "weeklyResetShift",
        account,
        "Reset semanal mudou",
        `${displayName}: novo reset em ${formatDateTimePtBr(currentReset)}.`,
        `weekly-reset-shift-${key}-${currentReset || "unknown"}`,
      ));
    } else if (!firstSeen && (refilled || (resetChanged && currentPercent !== null && currentPercent >= 95))) {
      signals.push(buildSignal(
        "weeklyRefill",
        account,
        "Semanal recarregado",
        `${displayName} voltou para ${percentText(currentPercent)}.`,
        `weekly-refill-${key}-${currentReset || "full"}`,
      ));
    }

    if (
      !firstSeen
      && currentPercent !== null
      && currentPercent <= 20
      && previousPercent !== null
      && previousPercent > 20
      && !isCoolingDown(previous.lastWeeklyLowAt, WEEKLY_LOW_COOLDOWN_MS, nowMs)
    ) {
      signals.push(buildSignal(
        "weeklyLow",
        account,
        "Semanal baixo",
        `${displayName}: ${percentText(currentPercent)} restante no semanal.`,
        `weekly-low-${key}-${currentReset || "unknown"}`,
        "lastWeeklyLowAt",
      ));
    }

    if (
      !firstSeen
      && currentFiveHourPercent !== null
      && currentFiveHourPercent <= 15
      && previousFiveHourPercent !== null
      && previousFiveHourPercent > 15
      && !isCoolingDown(previous.lastFiveHourLowAt, FIVE_HOUR_LOW_COOLDOWN_MS, nowMs)
    ) {
      const fiveHourReset = dateIso(account.fiveHourResetDate || account.fiveHourReset);
      signals.push(buildSignal(
        "fiveHourLow",
        account,
        "5h baixo",
        `${displayName}: ${percentText(currentFiveHourPercent)} restante na janela de 5h.`,
        `five-hour-low-${key}-${fiveHourReset || "unknown"}`,
        "lastFiveHourLowAt",
      ));
    }

    nextState.byAccount[key] = {
      ...previous,
      seen: true,
      weeklyReset: currentReset,
      weeklyResetPattern: currentResetPattern,
      weeklyPercent: currentPercent,
      fiveHourPercent: currentFiveHourPercent,
    };
  }

  nextState.lastSeenUpdatedAt = usageUpdatedAt?.toISOString() || null;
  return { signals, nextState, isStale };
}

function markNotificationSignalSent(state, signal, sentAt = new Date().toISOString()) {
  if (!signal?.cooldownField) return state;
  if (!signal.accountKey) {
    state[signal.cooldownField] = sentAt;
    return state;
  }
  state.byAccount ||= {};
  state.byAccount[signal.accountKey] ||= {};
  state.byAccount[signal.accountKey][signal.cooldownField] = sentAt;
  return state;
}

export {
  DEFAULT_STALE_AFTER_MS,
  evaluateNotificationSignals,
  markNotificationSignalSent,
  resetPatternKey,
};

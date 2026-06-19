const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
const DATA_STALE_COOLDOWN_MS = 30 * 60 * 1000;
const WEEKLY_LOW_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const FIVE_HOUR_LOW_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const WEEKLY_HIGH_NEAR_RESET_COOLDOWN_MS = 18 * 60 * 60 * 1000;

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
  return account?.email || account?.id || account?.name || null;
}

function isThirtyDayAccount(account) {
  const plan = String(account?.planType || "").trim().toUpperCase();
  const weeklyWindowMinutes = Number(account?.weeklyWindowMinutes);
  const fiveHourWindowMinutes = Number(account?.fiveHourWindowMinutes);
  const longWindowMinutes = 20 * 24 * 60;
  return plan === "FREE"
    || plan === "GO"
    || (Number.isFinite(weeklyWindowMinutes) && weeklyWindowMinutes >= longWindowMinutes)
    || (Number.isFinite(fiveHourWindowMinutes) && fiveHourWindowMinutes >= longWindowMinutes);
}

function percentText(value) {
  const percent = clampPercent(value, null);
  return percent === null ? "--" : `${Math.round(percent)}%`;
}

function hoursUntil(target, nowMs) {
  const date = parseDate(target);
  if (!date) return null;
  return (date.getTime() - nowMs) / 3600000;
}

function isCarryoverFullReset(previousPercent, currentPercent) {
  return previousPercent !== null
    && currentPercent !== null
    && previousPercent >= 99
    && currentPercent >= 99;
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

function refillBody(displayName, limitLabel, previousPercent, currentPercent, contextText) {
  const context = contextText ? ` ${contextText}` : "";
  return `${displayName}: ${limitLabel} foi de ${percentText(previousPercent)} para ${percentText(currentPercent)}${context}.`;
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
    const currentFiveHourReset = dateIso(account.fiveHourResetDate || account.fiveHourReset);
    const currentPercent = clampPercent(account.weeklyPercent, null);
    const currentFiveHourPercent = clampPercent(account.fiveHourPercent, null);
    const previous = nextState.byAccount[key] || {};
    const previousReset = typeof previous.weeklyReset === "string" ? previous.weeklyReset : null;
    const previousFiveHourReset = typeof previous.fiveHourReset === "string" ? previous.fiveHourReset : null;
    const previousPercent = clampPercent(previous.weeklyPercent, null);
    const previousFiveHourPercent = clampPercent(previous.fiveHourPercent, null);
    const firstSeen = !previous.seen;
    const previousResetDate = parseDate(previousReset);
    const carryoverFullReset = isCarryoverFullReset(previousPercent, currentPercent);
    const detectedBeforePreviousDeadline = Boolean(
      previousReset
      && usageUpdatedAt
      && previousResetDate
      && usageUpdatedAt.getTime() < previousResetDate.getTime(),
    );
    const resetChanged = Boolean(previousReset && currentReset && previousReset !== currentReset);
    const displayName = account.name || "Conta";
    const thirtyDayAccount = isThirtyDayAccount(account);
    const weeklyHoursUntilReset = hoursUntil(currentReset, nowMs);
    const isHighNearReset = currentPercent !== null
      && currentPercent > 30
      && weeklyHoursUntilReset !== null
      && weeklyHoursUntilReset >= 0
      && weeklyHoursUntilReset <= 24;
    const fiveHourResetChanged = Boolean(
      previousFiveHourReset
      && currentFiveHourReset
      && previousFiveHourReset !== currentFiveHourReset,
    );

    if (
      !thirtyDayAccount
      && !firstSeen
      && resetChanged
      && !carryoverFullReset
      && previousPercent !== null
      && previousPercent < 90
      && currentPercent !== null
      && currentPercent >= 99
    ) {
      signals.push(buildSignal(
        "weeklyRefill",
        account,
        "Semanal recarregado",
        refillBody(
          displayName,
          "semanal",
          previousPercent,
          currentPercent,
          detectedBeforePreviousDeadline ? "antes do prazo" : "apos reset",
        ),
        `weekly-refill-${key}-${currentReset || "full"}`,
      ));
    }

    if (
      !thirtyDayAccount
      && !firstSeen
      && fiveHourResetChanged
      && previousFiveHourPercent !== null
      && previousFiveHourPercent < 90
      && currentFiveHourPercent !== null
      && currentFiveHourPercent >= 99
      && currentPercent !== null
      && currentPercent > 0
    ) {
      signals.push(buildSignal(
        "fiveHourRefill",
        account,
        "5h recarregado",
        refillBody(displayName, "5h", previousFiveHourPercent, currentFiveHourPercent, "apos reset"),
        `five-hour-refill-${key}-${currentFiveHourReset || "full"}`,
      ));
    }

    if (
      !thirtyDayAccount
      && !firstSeen
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
      !thirtyDayAccount
      && !firstSeen
      && isHighNearReset
      && !isCoolingDown(previous.lastWeeklyHighNearResetAt, WEEKLY_HIGH_NEAR_RESET_COOLDOWN_MS, nowMs)
    ) {
      signals.push(buildSignal(
        "weeklyHighNearReset",
        account,
        "Semanal alto perto do reset",
        `${displayName}: ${percentText(currentPercent)} restante com reset em ${formatDateTimePtBr(currentReset)}.`,
        `weekly-high-near-reset-${key}-${currentReset || "unknown"}`,
        "lastWeeklyHighNearResetAt",
      ));
    }

    if (
      !thirtyDayAccount
      && !firstSeen
      && currentFiveHourPercent !== null
      && currentFiveHourPercent <= 15
      && previousFiveHourPercent !== null
      && previousFiveHourPercent > 15
      && !isCoolingDown(previous.lastFiveHourLowAt, FIVE_HOUR_LOW_COOLDOWN_MS, nowMs)
    ) {
      signals.push(buildSignal(
        "fiveHourLow",
        account,
        "5h baixo",
        `${displayName}: ${percentText(currentFiveHourPercent)} restante na janela de 5h.`,
        `five-hour-low-${key}-${currentFiveHourReset || "unknown"}`,
        "lastFiveHourLowAt",
      ));
    }

    nextState.byAccount[key] = {
      ...previous,
      seen: true,
      weeklyReset: currentReset,
      fiveHourReset: currentFiveHourReset,
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

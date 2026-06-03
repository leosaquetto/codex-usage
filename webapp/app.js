const SAFE_FALLBACK = {
  fiveHourPercent: 100,
  fiveHourReset: null,
  weeklyPercent: 100,
  weeklyReset: null,
  lastUpdated: null,
};

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_HOURS = 7 * 24;
const WEEK_FIVE_HOUR_WINDOWS = WEEK_HOURS / 5;
const ACTIVE_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
const THEME_COLOR_KEY = "codex-theme-color";
const LAST_VALID_USAGE_KEY = "codex-last-valid-usage-payload";
const NOTIFICATION_PREFERENCES_KEY = "codex-notification-preferences-v1";
const NOTIFICATION_STATE_KEY = "codex-notification-state-v4";
const DEFAULT_THEME_COLOR = "#3b82f6";

let viewportRafId = null;
let activeUsageController = null;
let lastUsageSignature = "";
let lastSuspendedAt = 0;
let activeChart = "weekly";
let activeAccountSort = "renewFirst";
let hideExhaustedAccounts = false;
let hideFreeGoAccounts = false;

/* =========================================
   Theme and Viewport
========================================= */
function setThemeColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
  document.documentElement.style.setProperty("--primary", color);
  localStorage.setItem(THEME_COLOR_KEY, color);
  const input = document.getElementById("themeColorInput");
  if (input) input.value = color;
}

function initTheme() {
  document.documentElement.setAttribute("data-theme", "light");
  setThemeColor(localStorage.getItem(THEME_COLOR_KEY) || DEFAULT_THEME_COLOR);
}

function adjustViewportHeight() {
  document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
}

function scheduleViewportAdjust() {
  if (viewportRafId !== null) cancelAnimationFrame(viewportRafId);
  viewportRafId = requestAnimationFrame(() => {
    viewportRafId = null;
    adjustViewportHeight();
  });
}

window.addEventListener("resize", scheduleViewportAdjust);
window.addEventListener("orientationchange", scheduleViewportAdjust);
window.addEventListener("pagehide", () => {
  lastSuspendedAt = Date.now();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    lastSuspendedAt = Date.now();
    return;
  }
  scheduleViewportAdjust();
  if (lastSuspendedAt && Date.now() - lastSuspendedAt > 60_000) {
    location.reload();
  }
});

/* =========================================
   Normalization
========================================= */
function clampPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function parseDate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeHistorySamples(rawSamples) {
  if (!Array.isArray(rawSamples)) return [];
  const byCapturedAt = new Map();

  for (const raw of rawSamples) {
    const capturedAtDate = parseDate(raw?.capturedAt || raw?.lastUpdated);
    const weeklyResetDate = parseDate(raw?.weeklyReset);
    const fiveHourPercent = clampPercent(raw?.fiveHourPercent, null);
    const weeklyPercent = clampPercent(raw?.weeklyPercent, null);

    if (!capturedAtDate || !weeklyResetDate || fiveHourPercent === null || weeklyPercent === null) {
      continue;
    }

    byCapturedAt.set(capturedAtDate.toISOString(), {
      capturedAtDate,
      fiveHourPercent,
      fiveHourResetDate: parseDate(raw?.fiveHourReset),
      weeklyPercent,
      weeklyResetDate,
    });
  }

  return [...byCapturedAt.values()].sort((a, b) => a.capturedAtDate.getTime() - b.capturedAtDate.getTime());
}

function normalizeUsage(raw) {
  const json = raw && typeof raw === "object" ? raw : {};
  const aggregate = json.aggregate && typeof json.aggregate === "object" ? json.aggregate : json;
  const fiveHourResetIsNull = json.fiveHourReset === null;

  return {
    source: typeof json.source === "string" ? json.source : null,
    activeAccountId: typeof json.activeAccountId === "string" ? json.activeAccountId : null,
    accountCount: Number.isFinite(Number(json.accountCount)) ? Number(json.accountCount) : 0,
    okCount: Number.isFinite(Number(json.okCount)) ? Number(json.okCount) : 0,
    accounts: normalizeAccounts(json.accounts),
    fiveHourPercent: clampPercent(aggregate.fiveHourPercent, SAFE_FALLBACK.fiveHourPercent),
    fiveHourResetIsNull,
    fiveHourResetDate: fiveHourResetIsNull ? null : parseDate(aggregate.fiveHourReset),
    weeklyPercent: clampPercent(aggregate.weeklyPercent, SAFE_FALLBACK.weeklyPercent),
    weeklyResetDate: parseDate(aggregate.weeklyReset),
    lastUpdatedDate: parseDate(json.lastUpdated),
    historySamples: normalizeHistorySamples(json.historySamples),
  };
}

function normalizeAccounts(rawAccounts) {
  if (!Array.isArray(rawAccounts)) return [];
  return rawAccounts.map((account) => ({
    id: String(account?.id || account?.name || crypto.randomUUID?.() || Math.random()),
    name: String(account?.name || account?.displayName || "Conta"),
    email: typeof account?.email === "string" ? account.email : "",
    planType: typeof account?.planType === "string" ? account.planType : "",
    subscriptionExpiresAtDate: parseDate(account?.subscriptionExpiresAt),
    isActive: Boolean(account?.isActive),
    lastUsedAtDate: parseDate(account?.lastUsedAt),
    fiveHourPercent: clampPercent(account?.fiveHourPercent, null),
    fiveHourResetDate: parseDate(account?.fiveHourReset),
    weeklyPercent: clampPercent(account?.weeklyPercent, null),
    weeklyResetDate: parseDate(account?.weeklyReset),
    status: account?.status === "error" ? "error" : "ok",
    error: typeof account?.error === "string" ? account.error : "",
  })).filter((account) => account.name);
}

async function loadUsage() {
  if (activeUsageController) activeUsageController.abort();
  activeUsageController = new AbortController();

  try {
    const response = await fetch(`./api/usage?t=${Date.now()}`, {
      cache: "no-store",
      signal: activeUsageController.signal,
    });
    if (!response.ok) throw new Error(`Falha ao carregar /api/usage: HTTP ${response.status}`);
    const json = await response.json();
    return { usage: normalizeUsage(json), hasLoadError: false };
  } catch {
    const cachedRaw = localStorage.getItem(LAST_VALID_USAGE_KEY);
    if (cachedRaw) {
      try {
        return { usage: normalizeUsage(JSON.parse(cachedRaw)), hasLoadError: true };
      } catch {
        localStorage.removeItem(LAST_VALID_USAGE_KEY);
      }
    }
    return { usage: normalizeUsage(SAFE_FALLBACK), hasLoadError: true };
  } finally {
    activeUsageController = null;
  }
}

function saveLastValidPayload(usage) {
  const payload = {
    activeAccountId: usage.activeAccountId || null,
    fiveHourPercent: usage.fiveHourPercent,
    fiveHourReset: usage.fiveHourResetDate?.toISOString() || null,
    weeklyPercent: usage.weeklyPercent,
    weeklyReset: usage.weeklyResetDate?.toISOString() || null,
    lastUpdated: usage.lastUpdatedDate?.toISOString() || null,
    historySamples: usage.historySamples?.map((sample) => ({
      capturedAt: sample.capturedAtDate.toISOString(),
      fiveHourPercent: sample.fiveHourPercent,
      fiveHourReset: sample.fiveHourResetDate?.toISOString() || null,
      weeklyPercent: sample.weeklyPercent,
      weeklyReset: sample.weeklyResetDate.toISOString(),
    })) || [],
    accounts: usage.accounts?.map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      planType: account.planType,
      subscriptionExpiresAt: account.subscriptionExpiresAtDate?.toISOString() || null,
      isActive: account.isActive,
      lastUsedAt: account.lastUsedAtDate?.toISOString() || null,
      fiveHourPercent: account.fiveHourPercent,
      fiveHourReset: account.fiveHourResetDate?.toISOString() || null,
      weeklyPercent: account.weeklyPercent,
      weeklyReset: account.weeklyResetDate?.toISOString() || null,
      status: account.status,
      error: account.error,
    })) || [],
  };
  const signature = JSON.stringify(payload);
  if (signature === lastUsageSignature) return;
  lastUsageSignature = signature;
  localStorage.setItem(LAST_VALID_USAGE_KEY, signature);
}

/* =========================================
   Formatting
========================================= */
function formatDateTimePtBr(date) {
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "Agora";
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}min`);
  return parts.length > 0 ? parts.join(" ") : "Agora";
}

function formatAgo(date) {
  if (!date) return "--";
  const elapsedMs = Date.now() - date.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "agora";
  if (elapsedMs < 60_000) return "agora";
  if (elapsedMs < 3_600_000) {
    const minutes = Math.max(1, Math.round(elapsedMs / 60_000));
    return `${minutes}min atrás`;
  }
  if (elapsedMs < 86_400_000) {
    const hours = Math.max(1, Math.round(elapsedMs / 3_600_000));
    return `${hours}h atrás`;
  }
  const days = Math.max(1, Math.round(elapsedMs / 86_400_000));
  return `${days}d atrás`;
}

function formatDatePartPtBr(date) {
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTimePartPtBr(date) {
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDatePtBr(date) {
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatDateAndTimeParts(date) {
  return {
    date: formatShortDatePtBr(date),
    time: formatTimePartPtBr(date),
  };
}

function formatCountdownMs(ms, options = {}) {
  const includeDays = options.includeDays !== false;
  if (!Number.isFinite(ms) || ms <= 0) return includeDays ? "0d 0h 0m 0s" : "0h 0m 0s";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (!includeDays) {
    const totalHours = Math.floor(totalSeconds / 3600);
    return `${totalHours}h ${minutes}m ${seconds}s`;
  }
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function formatRatePerHour(value) {
  if (!Number.isFinite(value)) return "--/h";
  return `${value.toFixed(1)}%/h`;
}

function formatRatePerDay(value) {
  if (!Number.isFinite(value)) return "--/d";
  return `${value.toFixed(1)}%/d`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}%`;
}

function formatWindowCount(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const rounded = Math.max(1, Math.ceil(value));
  return `${rounded} ${rounded === 1 ? "janela" : "janelas"}`;
}

function formatUseWindowCount(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const rounded = Math.max(1, Math.ceil(value));
  return `${rounded} ${rounded === 1 ? "uso" : "usos"} de 5h`;
}

function formatCompactUseWindowCount(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `${Math.max(1, Math.ceil(value))}x de 5h`;
}

function formatCompareWidth(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return "4%";
  return `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
}

function formatAccountPercent(value) {
  const n = clampPercent(value, null);
  return n === null ? "--%" : `${Math.round(n)}%`;
}

function capitalizeFirst(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

function formatUsed(remainingPercent) {
  const remaining = clampPercent(remainingPercent, null);
  if (remaining === null) return "--";
  return `${Math.round(100 - remaining)}% de 100%`;
}

function percentOrDash(value) {
  const n = clampPercent(value, null);
  return n === null ? "--" : `${Math.round(n)}%`;
}

function formatProjectedBalance(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 0) return `Sobra ${value.toFixed(1)}% no reset`;
  return "Não chega no ritmo atual";
}

function formatZeroInDays(days) {
  if (!Number.isFinite(days) || days <= 0) return "Agora";
  return formatDurationMs(days * 86400000);
}

function formatZeroInHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "Agora";
  return formatDurationMs(hours * 3600000);
}

/* =========================================
   Live Metrics
========================================= */
function usageLevel(remainingPercent) {
  const remaining = clampPercent(remainingPercent, null);
  if (remaining === null) return "warn";
  if (remaining >= 95) return "safe";
  if (remaining >= 75) return "ok";
  if (remaining >= 50) return "warn";
  if (remaining >= 25) return "caution";
  return "danger";
}

function usageBand(currentRate, idealRate) {
  if (!Number.isFinite(currentRate) || !Number.isFinite(idealRate) || idealRate <= 0) {
    return { label: "Sem dado", state: "warn" };
  }
  if (currentRate > idealRate * 1.15) return { label: "Acima", state: "danger" };
  if (currentRate < idealRate * 0.7) return { label: "Abaixo", state: "safe" };
  return { label: "Na faixa", state: "ok" };
}

function sameIsoDate(a, b) {
  if (!a || !b) return false;
  return a.toISOString() === b.toISOString();
}

function usageWithCurrentSample(usage) {
  const samples = [...(usage.historySamples || [])];
  if (usage.lastUpdatedDate && usage.weeklyResetDate) {
    samples.push({
      capturedAtDate: usage.lastUpdatedDate,
      fiveHourPercent: usage.fiveHourPercent,
      fiveHourResetDate: usage.fiveHourResetDate,
      weeklyPercent: usage.weeklyPercent,
      weeklyResetDate: usage.weeklyResetDate,
    });
  }

  const byCapturedAt = new Map(samples.map((sample) => [sample.capturedAtDate.toISOString(), sample]));
  return [...byCapturedAt.values()].sort((a, b) => a.capturedAtDate.getTime() - b.capturedAtDate.getTime());
}

function consumptionRate(samples, key) {
  if (samples.length < 2) return NaN;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedHours = (last.capturedAtDate.getTime() - first.capturedAtDate.getTime()) / 3600000;
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return NaN;
  const consumed = Number(first[key]) - Number(last[key]);
  if (!Number.isFinite(consumed) || consumed <= 0) return 0;
  return consumed / elapsedHours;
}

function averageAccountPercent(accounts, key, fallback = 100) {
  const values = accounts
    .map((account) => clampPercent(account[key], null))
    .filter((value) => value !== null);
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function billableAccounts(accounts) {
  return (accounts || []).filter((account) => !isFreeGoAccount(account));
}

function scopeUsageToBillableAccounts(usage) {
  const accounts = billableAccounts(usage.accounts);
  if (!accounts.length) return { ...usage, accounts: [] };
  return {
    ...usage,
    accounts,
    fiveHourPercent: averageAccountPercent(accounts, "fiveHourPercent", usage.fiveHourPercent),
    weeklyPercent: averageAccountPercent(accounts, "weeklyPercent", usage.weeklyPercent),
  };
}

function buildLiveMetrics(usage, now = Date.now()) {
  const fiveHourRemaining = usage.fiveHourResetIsNull ? 100 : clampPercent(usage.fiveHourPercent, 100);
  const weeklyRemaining = clampPercent(usage.weeklyPercent, 100);
  const fiveHourUsed = clampPercent(100 - fiveHourRemaining);
  const weeklyUsed = clampPercent(100 - weeklyRemaining);

  const fiveHourMs = usage.fiveHourResetDate ? usage.fiveHourResetDate.getTime() - now : NaN;
  const weeklyMs = usage.weeklyResetDate ? usage.weeklyResetDate.getTime() - now : NaN;
  const weeklyDaysRemaining = Number.isFinite(weeklyMs) ? Math.max(0, weeklyMs / 86400000) : NaN;

  const weeklyCycleStart = usage.weeklyResetDate ? usage.weeklyResetDate.getTime() - WEEK_WINDOW_MS : NaN;
  const elapsedMs = Number.isFinite(weeklyCycleStart)
    ? Math.max(0, Math.min(WEEK_WINDOW_MS, now - weeklyCycleStart))
    : NaN;
  const elapsedDays = Number.isFinite(elapsedMs) ? Math.max(1 / 24, elapsedMs / 86400000) : NaN;
  const elapsedWindows = Number.isFinite(elapsedMs) ? Math.max(1 / 12, elapsedMs / FIVE_HOUR_WINDOW_MS) : NaN;
  const windowsRemaining = Number.isFinite(weeklyMs) ? Math.max(1, Math.ceil(weeklyMs / FIVE_HOUR_WINDOW_MS)) : NaN;

  const fiveHourCycleStart = usage.fiveHourResetDate ? usage.fiveHourResetDate.getTime() - FIVE_HOUR_WINDOW_MS : NaN;
  const fiveHourElapsedMs = Number.isFinite(fiveHourCycleStart)
    ? Math.max(0, Math.min(FIVE_HOUR_WINDOW_MS, now - fiveHourCycleStart))
    : NaN;
  const fiveHourElapsedHours = Number.isFinite(fiveHourElapsedMs) ? Math.max(1 / 60, fiveHourElapsedMs / 3600000) : NaN;
  const fiveHourRate = Number.isFinite(fiveHourElapsedHours) ? fiveHourUsed / fiveHourElapsedHours : NaN;
  const fiveHourZeroHours = Number.isFinite(fiveHourRate) && fiveHourRate > 0 ? fiveHourRemaining / fiveHourRate : NaN;

  const weeklyRatePerWindow = weeklyUsed / WEEK_FIVE_HOUR_WINDOWS;
  const fiveHourAverageUsed = Number.isFinite(fiveHourElapsedHours) ? fiveHourUsed / fiveHourElapsedHours : NaN;
  const weeklyAverageUsedPerWindow = weeklyUsed / WEEK_FIVE_HOUR_WINDOWS;
  const idealPerWindow = weeklyRemaining / WEEK_FIVE_HOUR_WINDOWS;
  const projectedRemaining = Number.isFinite(weeklyRatePerWindow) && Number.isFinite(windowsRemaining)
    ? weeklyRemaining - weeklyRatePerWindow * windowsRemaining
    : NaN;
  const zeroInWindows = Number.isFinite(weeklyRatePerWindow) && weeklyRatePerWindow > 0
    ? weeklyRemaining / weeklyRatePerWindow
    : NaN;
  const zeroInDays = Number.isFinite(zeroInWindows) ? (zeroInWindows * 5) / 24 : NaN;
  const realDailyRate = weeklyUsed / 7;
  const safeDailyRate = Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining > 0
    ? weeklyRemaining / weeklyDaysRemaining
    : NaN;
  const historySamples = usageWithCurrentSample(usage);
  const fiveHourCycleSamples = historySamples.filter((sample) => {
    if (usage.fiveHourResetIsNull) return false;
    return sameIsoDate(sample.fiveHourResetDate, usage.fiveHourResetDate);
  });
  const weeklyCycleSamples = historySamples.filter((sample) => sameIsoDate(sample.weeklyResetDate, usage.weeklyResetDate));
  const historicalFiveHourRate = consumptionRate(fiveHourCycleSamples, "fiveHourPercent");
  const historicalWeeklyHourlyRate = NaN;
  const effectiveFiveHourRate = Number.isFinite(historicalFiveHourRate) ? historicalFiveHourRate : fiveHourRate;
  const effectiveWeeklyRatePerWindow = Number.isFinite(historicalWeeklyHourlyRate)
    ? historicalWeeklyHourlyRate * 5
    : weeklyRatePerWindow;
  const effectiveProjectedRemaining = Number.isFinite(effectiveWeeklyRatePerWindow) && Number.isFinite(windowsRemaining)
    ? weeklyRemaining - effectiveWeeklyRatePerWindow * windowsRemaining
    : projectedRemaining;
  const effectiveZeroInHours = Number.isFinite(effectiveWeeklyRatePerWindow) && effectiveWeeklyRatePerWindow > 0
    ? (weeklyRemaining / effectiveWeeklyRatePerWindow) * 5
    : NaN;
  const weeklyZeroInWindows = Number.isFinite(effectiveZeroInHours) && effectiveZeroInHours > 0
    ? effectiveZeroInHours / 5
    : NaN;

  return {
    fiveHourRemaining,
    weeklyRemaining,
    fiveHourUsed,
    weeklyUsed,
    fiveHourMs,
    weeklyMs,
    weeklyDaysRemaining,
    windowsRemaining,
    fiveHourRate,
    fiveHourAverageUsed,
    weeklyAverageUsedPerWindow,
    effectiveFiveHourRate,
    fiveHourZeroHours,
    weeklyRatePerWindow,
    effectiveWeeklyRatePerWindow,
    idealPerWindow,
    projectedRemaining,
    effectiveProjectedRemaining,
    zeroInDays,
    effectiveZeroInDays: Number.isFinite(effectiveZeroInHours) ? effectiveZeroInHours / 24 : NaN,
    effectiveZeroInHours,
    weeklyZeroInWindows,
    realDailyRate,
    safeDailyRate,
    historySamples,
    fiveHourCycleSamples,
    weeklyCycleSamples,
    usageBandState: usageBand(effectiveWeeklyRatePerWindow, idealPerWindow),
  };
}

/* =========================================
   View Models
========================================= */
function buildFiveHourDecision(usage, metrics) {
  if (usage.fiveHourResetIsNull && metrics.fiveHourRemaining === 100) {
    return {
      question: "Pode usar com folga",
      advice: "A janela de 5 horas está cheia e sem ciclo ativo.",
      zeroAt: "--",
      rhythm: "0%/h",
    };
  }
  if (metrics.fiveHourRemaining <= 0) {
    return {
      question: "Pausar agora",
      advice: "A janela de 5 horas esgotou. Espere renovar antes de concentrar trabalho pesado.",
      zeroAt: "Agora",
      rhythm: formatRatePerHour(metrics.effectiveFiveHourRate),
    };
  }
  if (metrics.fiveHourRemaining <= 15) {
    return {
      question: "Use só o essencial",
      advice: "Pouco saldo nesta janela. Guarde tarefas longas para depois da renovação.",
      zeroAt: formatZeroInHours(metrics.fiveHourRemaining / metrics.effectiveFiveHourRate),
      rhythm: formatRatePerHour(metrics.effectiveFiveHourRate),
    };
  }
  if (metrics.fiveHourRemaining <= 35) {
    return {
      question: "Use com cuidado",
      advice: "Ainda dá para trabalhar, mas evite gastar a janela em uma sequência longa.",
      zeroAt: formatZeroInHours(metrics.fiveHourRemaining / metrics.effectiveFiveHourRate),
      rhythm: formatRatePerHour(metrics.effectiveFiveHourRate),
    };
  }
  return {
    question: "Pode usar agora",
    advice: "A janela atual ainda sustenta trabalho normal.",
    zeroAt: Number.isFinite(metrics.fiveHourZeroHours) && Number.isFinite(metrics.fiveHourMs) && metrics.fiveHourZeroHours > metrics.fiveHourMs / 3600000
      ? "Após renovar"
      : formatZeroInHours(metrics.fiveHourRemaining / metrics.effectiveFiveHourRate),
    rhythm: formatRatePerHour(metrics.effectiveFiveHourRate),
  };
}

function buildWeeklyAdvice(metrics) {
  if (metrics.weeklyRemaining <= 0) return "O limite semanal esgotou. Espere a renovação.";
  if (metrics.effectiveProjectedRemaining < -30 && Number.isFinite(metrics.idealPerWindow)) {
    return `Use até ${formatPercent(metrics.idealPerWindow)} por janela de 5h para chegar ao reset.`;
  }
  if (metrics.usageBandState.state === "danger" && Number.isFinite(metrics.idealPerWindow)) {
    return `Use até ${formatPercent(metrics.idealPerWindow)} por janela de 5h.`;
  }
  if (metrics.weeklyRemaining <= 20) return "Use só o essencial até o próximo reset.";
  if (metrics.usageBandState.state === "safe") return "Há folga; distribua melhor o saldo restante.";
  if (metrics.effectiveProjectedRemaining > 15 && metrics.weeklyDaysRemaining <= 2) {
    return "Aproveite mais por janela para não desperdiçar saldo.";
  }
  return "Mantenha o ritmo atual.";
}

function buildHarvestAdvice(metrics) {
  if (!Number.isFinite(metrics.weeklyDaysRemaining) || !Number.isFinite(metrics.idealPerWindow)) return "--";
  if (metrics.weeklyDaysRemaining <= 2 && metrics.weeklyRemaining > 20) {
    return `Use até ${formatPercent(metrics.idealPerWindow)} por janela`;
  }
  if (metrics.usageBandState.state === "safe" && metrics.effectiveProjectedRemaining > 10) {
    return `Folga de ${formatPercent(metrics.effectiveProjectedRemaining)}`;
  }
  return "Sem risco de desperdício";
}

function buildWeeklyQuestion(metrics) {
  if (metrics.weeklyRemaining <= 0) return "Não chega sem renovar";
  if (metrics.effectiveProjectedRemaining < 0) return "No ritmo atual, não chega";
  if (metrics.usageBandState.state === "danger") return "Ritmo acima do ideal";
  if (metrics.usageBandState.state === "safe") return "Chega com folga";
  return "Chega se mantiver o ritmo";
}

function buildUsageBandTitle(metrics) {
  if (metrics.usageBandState.state === "danger") return "Ritmo acima do ideal";
  if (metrics.usageBandState.state === "safe") return "Abaixo do ideal";
  if (metrics.usageBandState.state === "ok") return "Na faixa ideal";
  return "Sem leitura suficiente";
}

function buildLimitViewModel(usage, hasLoadError = false) {
  const billableUsage = scopeUsageToBillableAccounts(usage);
  const metrics = buildLiveMetrics(billableUsage);
  const recommendation = buildAccountRecommendation(billableUsage.accounts || []);
  const accountCards = buildAccountCards(usage.accounts || [], recommendation?.account?.id || null);
  const fiveHour = buildFiveHourDecision(billableUsage, metrics);
  const weeklyQuestion = buildWeeklyQuestion(metrics);
  const weeklyAdvice = buildWeeklyAdvice(metrics);
  const weeklyZeroAt = Number.isFinite(metrics.effectiveZeroInDays) && metrics.effectiveZeroInDays > 0
    ? (metrics.effectiveZeroInDays > 7 ? "Mais de 7 dias" : formatZeroInDays(metrics.effectiveZeroInDays))
    : "--";
  const safeWindows = Number.isFinite(metrics.windowsRemaining) ? metrics.windowsRemaining : 0;
  const safePerWindowText = Number.isFinite(metrics.idealPerWindow)
    ? `${metrics.idealPerWindow.toFixed(1)}% por janela`
    : "--";
  const fiveHourPlan = Number.isFinite(metrics.effectiveFiveHourRate) && Number.isFinite(metrics.fiveHourMs)
    ? `Renova em ${formatDurationMs(metrics.fiveHourMs)}`
    : "Sem média suficiente";
  const weeklyPlan = safeWindows > 0
    ? `${safePerWindowText} nas ${safeWindows} próximas`
    : "Sem janela calculada";
  const weeklyWindowZero = Number.isFinite(metrics.weeklyZeroInWindows)
    ? `${formatZeroInHours(metrics.effectiveZeroInHours)} · cerca de ${formatWindowCount(metrics.weeklyZeroInWindows)}`
    : "--";
  const compareMax = Number.isFinite(metrics.idealPerWindow) && metrics.idealPerWindow > 0
    ? metrics.idealPerWindow * 2
    : Math.max(metrics.effectiveWeeklyRatePerWindow || 0, 1);

  return {
    status: resolveStatus(metrics, hasLoadError),
    tones: {
      fiveHour: usageLevel(metrics.fiveHourRemaining),
      weekly: usageLevel(metrics.weeklyRemaining),
      usage: metrics.usageBandState.state,
    },
    updatedAt: usage.lastUpdatedDate ? formatDateTimePtBr(usage.lastUpdatedDate) : "--",
    updatedDate: usage.lastUpdatedDate ? formatDatePartPtBr(usage.lastUpdatedDate) : "--",
    updatedTime: usage.lastUpdatedDate ? formatTimePartPtBr(usage.lastUpdatedDate) : "--",
    fiveHour: {
      remaining: Math.round(metrics.fiveHourRemaining),
      used: formatUsed(metrics.fiveHourRemaining),
      usedInline: `${Math.round(metrics.fiveHourUsed)}%`,
      idealRate: Number.isFinite(metrics.fiveHourMs) && metrics.fiveHourMs > 0
        ? formatRatePerHour(metrics.fiveHourRemaining / (metrics.fiveHourMs / 3600000))
        : "--/h",
      renewal: billableUsage.fiveHourResetDate ? formatCountdownMs(metrics.fiveHourMs, { includeDays: false }) : "--",
      countdown: billableUsage.fiveHourResetDate ? formatCountdownMs(metrics.fiveHourMs, { includeDays: false }) : "--",
      question: fiveHour.question,
      advice: fiveHour.advice,
      zeroAt: fiveHour.zeroAt,
      rhythm: fiveHour.rhythm,
      average: formatRatePerHour(Number.isFinite(metrics.effectiveFiveHourRate) ? metrics.effectiveFiveHourRate : metrics.fiveHourAverageUsed),
      usePlan: fiveHourPlan,
    },
    weekly: {
      remaining: Math.round(metrics.weeklyRemaining),
      used: formatUsed(metrics.weeklyRemaining),
      usedInline: `${Math.round(metrics.weeklyUsed)}%`,
      renewal: "--",
      remainingTime: "--",
      countdown: "--",
      question: weeklyQuestion,
      advice: weeklyAdvice,
      projection: formatProjectedBalance(metrics.effectiveProjectedRemaining),
      zeroAt: weeklyZeroAt,
      windowBadge: Number.isFinite(metrics.weeklyZeroInWindows) ? formatCompactUseWindowCount(metrics.weeklyZeroInWindows) : "--",
      zeroWindowText: weeklyWindowZero,
      windowPlan: Number.isFinite(metrics.weeklyZeroInWindows) ? formatWindowCount(metrics.weeklyZeroInWindows) : "--",
      average: formatPercent(Number.isFinite(metrics.effectiveWeeklyRatePerWindow) ? metrics.effectiveWeeklyRatePerWindow : metrics.weeklyAverageUsedPerWindow),
      averageHourly: formatRatePerHour(metrics.weeklyUsed / WEEK_HOURS),
      dailyAverage: formatRatePerDay(metrics.realDailyRate),
      sideBadge: formatRatePerDay(metrics.realDailyRate),
      ideal: formatPercent(metrics.idealPerWindow),
      band: metrics.usageBandState.label,
      usePlan: weeklyPlan,
      harvest: buildHarvestAdvice(metrics),
    },
    totalAvailability: {
      weeklyPercent: Math.round(metrics.weeklyRemaining),
      weeklyText: percentOrDash(metrics.weeklyRemaining),
      meta: buildPoolAvailabilityText(billableUsage.accounts || [], metrics.weeklyRemaining),
    },
    activeAccount: buildActiveAccountView(usage),
    recommendation: recommendation ? {
      accountName: recommendation.account.name,
      meta: recommendation.reason,
    } : {
      accountName: "--",
      meta: "Nenhuma conta com 5h e semanal disponíveis agora.",
    },
    suggestion: {
      title: safePerWindowText,
      meta: Number.isFinite(metrics.idealPerWindow)
        ? "Base fixa: 7 dias, somente contas pagas."
        : weeklyQuestion,
    },
    compare: {
      band: buildUsageBandTitle(metrics),
      meta: Number.isFinite(metrics.effectiveWeeklyRatePerWindow) && Number.isFinite(metrics.idealPerWindow)
        ? "Atual = uso semanal/33,6 janelas. Ideal = saldo semanal/33,6 janelas."
        : "Aguardando histórico suficiente.",
      actualText: `Ritmo atual ${formatPercent(metrics.effectiveWeeklyRatePerWindow)}`,
      idealText: `Ideal ${formatPercent(metrics.idealPerWindow)}`,
      actualValue: formatPercent(metrics.effectiveWeeklyRatePerWindow),
      idealValue: formatPercent(metrics.idealPerWindow),
      actualWidth: formatCompareWidth(metrics.effectiveWeeklyRatePerWindow, compareMax),
      idealWidth: formatCompareWidth(metrics.idealPerWindow, compareMax),
    },
    charts: {
      fiveHour: metrics.fiveHourCycleSamples.map((sample) => ({
        x: sample.capturedAtDate.getTime(),
        y: clampPercent(100 - sample.fiveHourPercent),
      })),
      weekly: metrics.weeklyCycleSamples.map((sample) => ({
        x: sample.capturedAtDate.getTime(),
        y: clampPercent(100 - sample.weeklyPercent),
      })),
    },
    accounts: accountCards,
    metrics,
  };
}

function buildPoolAvailabilityText(accounts, fallbackPercent) {
  const weeklyValues = accounts
    .map((account) => clampPercent(account.weeklyPercent, null))
    .filter((value) => value !== null);
  if (!weeklyValues.length) return "Soma normalizada do semanal das contas pagas.";

  const available = weeklyValues.reduce((sum, value) => sum + value, 0);
  const capacity = weeklyValues.length * 100;
  const normalized = Number.isFinite(fallbackPercent)
    ? Math.round(fallbackPercent)
    : Math.round((available / capacity) * 100);
  return `${Math.round(available)} pontos disponíveis de ${capacity} no pool semanal pago (${normalized}%).`;
}

function hoursUntil(date) {
  if (!date) return Number.POSITIVE_INFINITY;
  return (date.getTime() - Date.now()) / 3600000;
}

function scoreAccountForNow(account) {
  if (account.status === "error") return null;
  const five = clampPercent(account.fiveHourPercent, null);
  const weekly = clampPercent(account.weeklyPercent, null);
  if (five === null || weekly === null) return null;

  const limiting = Math.min(five, weekly);
  const weeklyHours = hoursUntil(account.weeklyResetDate);
  const fiveHours = hoursUntil(account.fiveHourResetDate);
  const soonWeeklyResetBoost = weekly > 25 && weeklyHours > 0 && weeklyHours <= 30
    ? Math.max(0, 10 - weeklyHours / 3)
    : 0;
  const soonFiveResetNudge = five < 25 && fiveHours > 0 && fiveHours <= 1 ? 3 : 0;
  const lowFivePenalty = five < 15 ? 22 : five < 30 ? 8 : 0;
  const lowWeeklyPenalty = weekly < 15 ? 28 : weekly < 30 ? 10 : 0;

  return (five * 0.42) + (weekly * 0.42) + (limiting * 0.16) + soonWeeklyResetBoost + soonFiveResetNudge - lowFivePenalty - lowWeeklyPenalty;
}

function buildAccountRecommendation(accounts) {
  const ranked = accounts
    .map((account) => ({ account, score: scoreAccountForNow(account) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const five = formatAccountPercent(best.account.fiveHourPercent);
  const weekly = formatAccountPercent(best.account.weeklyPercent);
  const fiveReset = best.account.fiveHourResetDate ? formatDurationMs(best.account.fiveHourResetDate.getTime() - Date.now()) : "--";
  const weeklyReset = best.account.weeklyResetDate ? formatDurationMs(best.account.weeklyResetDate.getTime() - Date.now()) : "--";

  return {
    account: best.account,
    score: best.score,
    reason: `${five} em 5h, ${weekly} semanal. 5h renova em ${fiveReset}; semanal em ${weeklyReset}.`,
  };
}

function accountRenewalTime(account) {
  return account.weeklyResetDate?.getTime() || Number.POSITIVE_INFINITY;
}

function accountSortPercent(account) {
  const values = [account.fiveHourPercent, account.weeklyPercent].filter((value) => value !== null);
  if (values.length === 0) return -1;
  return Math.min(...values);
}

function sortedAccounts(accounts) {
  const list = [...accounts];
  const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");

  if (activeAccountSort === "renewLast") {
    return list.sort((a, b) => accountRenewalTime(b) - accountRenewalTime(a) || byName(a, b));
  }
  if (activeAccountSort === "highestPercent") {
    return list.sort((a, b) => accountSortPercent(b) - accountSortPercent(a) || byName(a, b));
  }
  if (activeAccountSort === "lowestPercent") {
    return list.sort((a, b) => accountSortPercent(a) - accountSortPercent(b) || byName(a, b));
  }
  if (activeAccountSort === "expiry") {
    return list.sort((a, b) => {
      const aTime = a.subscriptionExpiresAtDate?.getTime() || Number.POSITIVE_INFINITY;
      const bTime = b.subscriptionExpiresAtDate?.getTime() || Number.POSITIVE_INFINITY;
      return aTime - bTime || byName(a, b);
    });
  }
  return list.sort((a, b) => accountRenewalTime(a) - accountRenewalTime(b) || byName(a, b));
}

function isAccountExhausted(account) {
  const five = clampPercent(account.fiveHourPercent, null);
  const weekly = clampPercent(account.weeklyPercent, null);
  if (five === null || weekly === null) return false;
  return five <= 0 || weekly <= 0;
}

function isFreeGoAccount(account) {
  const plan = String(account.planType || "").trim().toUpperCase();
  return plan === "FREE" || plan === "GO";
}

function buildAccountCards(accounts, recommendedAccountId = null) {
  const visibleAccounts = accounts.filter((account) => {
    if (hideExhaustedAccounts && isAccountExhausted(account)) return false;
    if (hideFreeGoAccounts && isFreeGoAccount(account)) return false;
    return true;
  });

  return sortedAccounts(visibleAccounts).sort((a, b) => {
    if (a.id === recommendedAccountId) return -1;
    if (b.id === recommendedAccountId) return 1;
    return 0;
  }).map((account) => {
    const weeklyResetDate = account.weeklyResetDate || null;
    const fiveParts = formatDateAndTimeParts(account.fiveHourResetDate);
    const weeklyParts = formatDateAndTimeParts(account.weeklyResetDate);
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      planType: account.planType ? account.planType.toUpperCase() : "--",
      isActive: account.isActive,
      status: account.status,
      error: account.error,
      isRecommended: account.id === recommendedAccountId,
      fiveHourPercent: account.fiveHourPercent,
      weeklyPercent: account.weeklyPercent,
      fiveHourDate: fiveParts.date,
      fiveHourTime: fiveParts.time,
      weeklyDate: weeklyParts.date,
      weeklyTime: weeklyParts.time,
      expiresAt: account.subscriptionExpiresAtDate ? formatShortDatePtBr(account.subscriptionExpiresAtDate) : "--",
      nextResetText: weeklyResetDate ? `${formatDurationMs(weeklyResetDate.getTime() - Date.now())}` : "--",
      hideFiveHourPercent: clampPercent(account.weeklyPercent, 100) < 5,
      tone: usageLevel(Math.min(
        clampPercent(account.fiveHourPercent, 100),
        clampPercent(account.weeklyPercent, 100),
      )),
    };
  });
}

function accountHasAnyLimit(account) {
  return clampPercent(account?.fiveHourPercent, null) !== null
    || clampPercent(account?.weeklyPercent, null) !== null;
}

function selectFocusedAccount(usage) {
  const accounts = usage.accounts || [];
  const activeAccount = accounts.find((account) => account.isActive || account.id === usage.activeAccountId);
  if (activeAccount) {
    return { account: activeAccount, source: "active" };
  }

  const now = Date.now();
  const recentAccount = accounts
    .filter((account) => account.lastUsedAtDate && accountHasAnyLimit(account))
    .filter((account) => now - account.lastUsedAtDate.getTime() <= ACTIVE_ACCOUNT_WINDOW_MS)
    .sort((a, b) => b.lastUsedAtDate.getTime() - a.lastUsedAtDate.getTime())[0];

  return recentAccount ? { account: recentAccount, source: "recent" } : null;
}

function buildActiveLimitView(account, key, resetKey) {
  const percent = clampPercent(account?.[key], null);
  const resetDate = account?.[resetKey] || null;
  return {
    percent,
    text: percentOrDash(percent),
    tone: usageLevel(percent),
    resetText: resetDate ? `Renova em ${formatDurationMs(resetDate.getTime() - Date.now())}` : "Reset não publicado",
  };
}

function buildActiveAccountView(usage) {
  const focused = selectFocusedAccount(usage);
  if (!focused) {
    return {
      empty: true,
      state: "empty",
      name: "Nenhuma conta recente",
      meta: "Aguardando conta ativa ou uso na última 1h.",
      badge: "sem foco",
      fiveHour: { percent: null, text: "--", tone: "warn", resetText: "--" },
      weekly: { percent: null, text: "--", tone: "warn", resetText: "--" },
    };
  }

  const { account, source } = focused;
  const fiveHour = buildActiveLimitView(account, "fiveHourPercent", "fiveHourResetDate");
  const weekly = buildActiveLimitView(account, "weeklyPercent", "weeklyResetDate");
  const tone = usageLevel(Math.min(
    clampPercent(fiveHour.percent, 100),
    clampPercent(weekly.percent, 100),
  ));
  const usageMeta = account.lastUsedAtDate ? `Usada ${formatAgo(account.lastUsedAtDate)}` : "Sem registro de uso recente";
  const sourceMeta = source === "active" ? "Ativa no Switcher" : "Última usada na última 1h";

  return {
    empty: false,
    state: tone,
    name: account.name,
    meta: `${sourceMeta} · ${usageMeta}`,
    badge: source === "active" ? "ativa" : "última 1h",
    fiveHour,
    weekly,
  };
}

function resolveStatus(metrics, hasLoadError) {
  if (hasLoadError) {
    return {
      text: "Dados em cache",
      meta: "Não foi possível atualizar agora; mostrando o último estado salvo.",
      state: "error",
    };
  }
  if (metrics.fiveHourRemaining <= 0 || metrics.weeklyRemaining <= 0) {
    return {
      text: "Limite esgotado",
      meta: "Evite iniciar tarefas longas até a próxima renovação.",
      state: "danger",
    };
  }
  if (metrics.usageBandState.state === "danger" || metrics.fiveHourRemaining <= 20 || metrics.weeklyRemaining <= 20) {
    return {
      text: "Ritmo alto",
      meta: "O consumo atual pede contenção para chegar até a renovação.",
      state: "danger",
    };
  }
  if (metrics.fiveHourRemaining <= 40 || metrics.weeklyRemaining <= 40) {
    return {
      text: "Atenção ao consumo",
      meta: "Ainda há saldo, mas vale trabalhar em ciclos menores.",
      state: "warn",
    };
  }
  return {
    text: "Na faixa segura",
    meta: "O saldo atual sustenta o ritmo de uso.",
    state: "ok",
  };
}

/* =========================================
   Rendering
========================================= */
function getElements() {
  return {
    themeColorInput: document.getElementById("themeColorInput"),
    refreshButton: document.getElementById("refreshButton"),
    notificationMenu: document.getElementById("notificationMenu"),
    notificationButton: document.getElementById("notificationButton"),
    notificationPermissionButton: document.getElementById("notificationPermissionButton"),
    notificationPermissionText: document.getElementById("notificationPermissionText"),
    notificationViewAllButton: document.getElementById("notificationViewAllButton"),
    notificationViewAccountsButton: document.getElementById("notificationViewAccountsButton"),
    notificationAllPanel: document.getElementById("notificationAllPanel"),
    notificationAccountsPanel: document.getElementById("notificationAccountsPanel"),
    notificationRulesList: document.getElementById("notificationRulesList"),
    notificationAccountsList: document.getElementById("notificationAccountsList"),
    notificationRecentEvents: document.getElementById("notificationRecentEvents"),
    accountSortSelect: document.getElementById("accountSortSelect"),
    hideExhaustedButton: document.getElementById("hideExhaustedButton"),
    hideFreeGoButton: document.getElementById("hideFreeGoButton"),
    accountsGrid: document.getElementById("accountsGrid"),
    totalWeeklyAvailableText: document.getElementById("totalWeeklyAvailableText"),
    totalWeeklyAvailableBar: document.getElementById("totalWeeklyAvailableBar"),
    totalWeeklyAvailableMeta: document.getElementById("totalWeeklyAvailableMeta"),
    activeAccountPanel: document.getElementById("activeAccountPanel"),
    activeAccountName: document.getElementById("activeAccountName"),
    activeAccountMeta: document.getElementById("activeAccountMeta"),
    activeAccountBadge: document.getElementById("activeAccountBadge"),
    activeFiveHourText: document.getElementById("activeFiveHourText"),
    activeFiveHourBar: document.getElementById("activeFiveHourBar"),
    activeFiveHourMeta: document.getElementById("activeFiveHourMeta"),
    activeWeeklyText: document.getElementById("activeWeeklyText"),
    activeWeeklyBar: document.getElementById("activeWeeklyBar"),
    activeWeeklyMeta: document.getElementById("activeWeeklyMeta"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    statusMeta: document.getElementById("statusMeta"),
    updatedAtText: document.getElementById("updatedAtText"),
    updatedDateText: document.getElementById("updatedDateText"),
    updatedTimeText: document.getElementById("updatedTimeText"),
    fiveHourPercent: document.getElementById("fiveHourPercent"),
    fiveHourBar: document.getElementById("fiveHourBar"),
    fiveHourQuestion: document.getElementById("fiveHourQuestion"),
    fiveHourZeroAt: document.getElementById("fiveHourZeroAt"),
    fiveHourRhythm: document.getElementById("fiveHourRhythm"),
    fiveHourAverage: document.getElementById("fiveHourAverage"),
    fiveHourUsedInline: document.getElementById("fiveHourUsedInline"),
    fiveHourIdealRate: document.getElementById("fiveHourIdealRate"),
    fiveHourUsePlan: document.getElementById("fiveHourUsePlan"),
    fiveHourUsed: document.getElementById("fiveHourUsed"),
    fiveHourRenewal: document.getElementById("fiveHourRenewal"),
    weeklyPercent: document.getElementById("weeklyPercent"),
    weeklyBar: document.getElementById("weeklyBar"),
    weeklyProjection: document.getElementById("weeklyProjection"),
    weeklyZeroAt: document.getElementById("weeklyZeroAt"),
    weeklyUsed: document.getElementById("weeklyUsed"),
    weeklyRemainingDays: document.getElementById("weeklyRemainingDays"),
    weeklyAverage: document.getElementById("weeklyAverage"),
    weeklyDailyAverage: document.getElementById("weeklyDailyAverage"),
    weeklyUsedInline: document.getElementById("weeklyUsedInline"),
    weeklySideBadge: document.getElementById("weeklySideBadge"),
    weeklyIdeal: document.getElementById("weeklyIdeal"),
    weeklyBand: document.getElementById("weeklyBand"),
    weeklyRenewal: document.getElementById("weeklyRenewal"),
    weeklyUsePlan: document.getElementById("weeklyUsePlan"),
    fiveHourCountdown: document.getElementById("fiveHourCountdown"),
    weeklyCountdown: document.getElementById("weeklyCountdown"),
    weeklyWindowZero: document.getElementById("weeklyWindowZero"),
    weeklyWindowPlan: document.getElementById("weeklyWindowPlan"),
    weeklyWindowBadge: document.getElementById("weeklyWindowBadge"),
    harvestSuggestion: document.getElementById("harvestSuggestion"),
    usageBandValue: document.getElementById("usageBandValue"),
    usageBandMeta: document.getElementById("usageBandMeta"),
    compareActualText: document.getElementById("compareActualText"),
    compareIdealText: document.getElementById("compareIdealText"),
    compareActualValue: document.getElementById("compareActualValue"),
    compareIdealValue: document.getElementById("compareIdealValue"),
    compareActualBar: document.getElementById("compareActualBar"),
    compareIdealBar: document.getElementById("compareIdealBar"),
    chartTitle: document.getElementById("chartTitle"),
    chartWeeklyButton: document.getElementById("chartWeeklyButton"),
    chartFiveHourButton: document.getElementById("chartFiveHourButton"),
    usageSuggestion: document.getElementById("usageSuggestion"),
    usageSuggestionMeta: document.getElementById("usageSuggestionMeta"),
    usageSparkline: document.getElementById("usageSparkline"),
  };
}

function setStatusState(dot, state) {
  dot?.classList.remove("ok", "warn", "danger", "error");
  if (state) dot?.classList.add(state);
}

function setProgress(bar, percent) {
  const value = clampPercent(percent);
  if (!bar) return;
  bar.style.width = `${value}%`;
  bar.dataset.tone = usageLevel(value);
  bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
}

function setActiveProgress(bar, percent, tone) {
  if (!bar) return;
  const value = clampPercent(percent, 0);
  bar.style.width = `${value}%`;
  bar.dataset.tone = tone || usageLevel(percent);
  bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
}

function renderActiveAccountPanel(els, activeAccount) {
  if (!els.activeAccountPanel || !activeAccount) return;
  els.activeAccountPanel.dataset.state = activeAccount.state;
  els.activeAccountPanel.classList.toggle("is-empty", Boolean(activeAccount.empty));
  if (els.activeAccountName) els.activeAccountName.textContent = activeAccount.name;
  if (els.activeAccountMeta) els.activeAccountMeta.textContent = activeAccount.meta;
  if (els.activeAccountBadge) els.activeAccountBadge.textContent = activeAccount.badge;
  if (els.activeFiveHourText) els.activeFiveHourText.textContent = activeAccount.fiveHour.text;
  if (els.activeFiveHourMeta) els.activeFiveHourMeta.textContent = activeAccount.fiveHour.resetText;
  if (els.activeWeeklyText) els.activeWeeklyText.textContent = activeAccount.weekly.text;
  if (els.activeWeeklyMeta) els.activeWeeklyMeta.textContent = activeAccount.weekly.resetText;
  setActiveProgress(els.activeFiveHourBar, activeAccount.fiveHour.percent, activeAccount.fiveHour.tone);
  setActiveProgress(els.activeWeeklyBar, activeAccount.weekly.percent, activeAccount.weekly.tone);
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function renderSparkline(svg, points) {
  if (!svg) return;
  svg.replaceChildren();

  const width = 320;
  const height = 96;
  const pad = 8;
  svg.append(
    svgEl("line", { class: "grid-line", x1: pad, y1: pad, x2: width - pad, y2: pad }),
    svgEl("line", { class: "grid-line", x1: pad, y1: height / 2, x2: width - pad, y2: height / 2 }),
    svgEl("line", { class: "grid-line", x1: pad, y1: height - pad, x2: width - pad, y2: height - pad }),
  );

  if (!Array.isArray(points) || points.length < 2) {
    const label = svgEl("text", {
      class: "empty-label",
      x: width / 2,
      y: height / 2 + 5,
      "text-anchor": "middle",
    });
    label.textContent = "Histórico após próximas capturas";
    svg.append(label);
    return;
  }

  const recent = points.slice(-36);
  const minX = Math.min(...recent.map((point) => point.x));
  const maxX = Math.max(...recent.map((point) => point.x));
  const scaleX = (value) => {
    if (maxX === minX) return width / 2;
    return pad + ((value - minX) / (maxX - minX)) * (width - pad * 2);
  };
  const scaleY = (value) => height - pad - (clampPercent(value) / 100) * (height - pad * 2);
  const coords = recent.map((point) => `${scaleX(point.x).toFixed(1)},${scaleY(point.y).toFixed(1)}`);
  const areaPath = `M ${coords[0]} L ${coords.slice(1).join(" L ")} L ${scaleX(recent.at(-1).x).toFixed(1)},${height - pad} L ${scaleX(recent[0].x).toFixed(1)},${height - pad} Z`;

  svg.append(
    svgEl("path", { class: "area", d: areaPath }),
    svgEl("polyline", { class: "line", points: coords.join(" ") }),
  );

  const last = recent.at(-1);
  svg.append(svgEl("circle", {
    class: "point",
    cx: scaleX(last.x).toFixed(1),
    cy: scaleY(last.y).toFixed(1),
    r: 4,
  }));
}

function renderAccountsGrid(container, accounts) {
  if (!container) return;
  container.replaceChildren();

  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "accounts-empty";
    empty.textContent = "Nenhuma conta do Codex Switcher publicada ainda.";
    container.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account-card";
    card.dataset.tone = account.tone;
    if (account.isRecommended) card.dataset.recommended = "true";

    const top = document.createElement("div");
    top.className = "account-top";

    const logo = document.createElement("img");
    logo.className = "account-logo";
    logo.src = "/assets/codex-color.png";
    logo.alt = "";
    logo.loading = "lazy";

    const titleWrap = document.createElement("div");
    titleWrap.className = "account-title";
    const title = document.createElement("h3");
    title.textContent = account.name;
    const meta = document.createElement("p");
    meta.textContent = account.isActive ? "Ativa no Switcher" : "Codex Switcher";
    titleWrap.append(title, meta);

    const pill = document.createElement("span");
    pill.className = "account-pill";
    pill.textContent = account.planType;
    pill.dataset.plan = account.planType.toLowerCase();

    top.append(logo, titleWrap, pill);

    const meters = document.createElement("div");
    meters.className = "account-meters";
    meters.append(
      buildAccountCircle("5h", account.fiveHourPercent, account.fiveHourDate, account.fiveHourTime, {
        hidePercent: account.hideFiveHourPercent,
      }),
      buildAccountCircle("Semanal", account.weeklyPercent, account.weeklyDate, account.weeklyTime),
    );

    const footer = document.createElement("div");
    footer.className = "account-footer";
    const next = document.createElement("span");
    next.textContent = `Semanal: ${account.nextResetText}`;
    const expires = document.createElement("span");
    expires.textContent = `Expira: ${account.expiresAt}`;
    footer.append(next, expires);

    if (account.status === "error") {
      const error = document.createElement("p");
      error.className = "account-error";
      error.textContent = account.error || "Falha ao atualizar.";
      card.append(top, error, footer);
    } else {
      card.append(top, meters, footer);
    }
    fragment.append(card);
  }

  container.append(fragment);
}

function buildAccountCircle(label, percent, date, time, options = {}) {
  const visiblePercent = options.hidePercent ? null : percent;
  const wrap = document.createElement("div");
  wrap.className = "account-circle-meter";

  const circle = document.createElement("div");
  circle.className = "account-circle";
  circle.dataset.tone = usageLevel(visiblePercent);
  circle.style.setProperty("--circle-value", `${clampPercent(visiblePercent, 0) * 3.6}deg`);
  const percentEl = document.createElement("strong");
  percentEl.textContent = percentOrDash(visiblePercent);
  circle.append(percentEl);

  const meta = document.createElement("div");
  meta.className = "account-circle-meta";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const reset = document.createElement("div");
  reset.className = "account-reset";
  const dateEl = document.createElement("span");
  dateEl.textContent = date;
  const timeEl = document.createElement("span");
  timeEl.textContent = time;
  reset.append(dateEl, timeEl);
  meta.append(labelEl, reset);

  wrap.append(circle, meta);
  return wrap;
}

function setChartButtons(els) {
  const isWeekly = activeChart === "weekly";
  els.chartTitle.textContent = isWeekly ? "Uso semanal" : "Uso da janela de 5h";
  els.chartWeeklyButton?.setAttribute("aria-pressed", String(isWeekly));
  els.chartFiveHourButton?.setAttribute("aria-pressed", String(!isWeekly));
}

function renderDashboard(els, viewModel) {
  document.documentElement.dataset.fiveHourTone = viewModel.tones.fiveHour;
  document.documentElement.dataset.weeklyTone = viewModel.tones.weekly;
  document.documentElement.dataset.usageTone = viewModel.tones.usage;

  setStatusState(els.statusDot, viewModel.status.state);
  els.statusText.textContent = viewModel.status.text;
  els.statusMeta.textContent = viewModel.status.meta;
  if (els.updatedAtText) els.updatedAtText.textContent = viewModel.updatedAt;
  if (els.updatedDateText) els.updatedDateText.textContent = viewModel.updatedDate;
  if (els.updatedTimeText) els.updatedTimeText.textContent = viewModel.updatedTime;

  els.fiveHourPercent.textContent = viewModel.fiveHour.remaining;
  els.fiveHourQuestion.textContent = viewModel.fiveHour.question;
  els.fiveHourZeroAt.textContent = viewModel.fiveHour.zeroAt;
  if (els.fiveHourRhythm) els.fiveHourRhythm.textContent = viewModel.fiveHour.rhythm;
  els.fiveHourAverage.textContent = viewModel.fiveHour.average;
  if (els.fiveHourUsedInline) els.fiveHourUsedInline.textContent = viewModel.fiveHour.usedInline;
  if (els.fiveHourIdealRate) els.fiveHourIdealRate.textContent = viewModel.fiveHour.idealRate;
  if (els.fiveHourUsePlan) els.fiveHourUsePlan.textContent = viewModel.fiveHour.usePlan;
  if (els.fiveHourUsed) els.fiveHourUsed.textContent = viewModel.fiveHour.used;
  if (els.fiveHourRenewal) els.fiveHourRenewal.textContent = viewModel.fiveHour.renewal;
  if (els.fiveHourCountdown) els.fiveHourCountdown.textContent = viewModel.fiveHour.countdown;
  setProgress(els.fiveHourBar, viewModel.fiveHour.remaining);

  els.weeklyPercent.textContent = viewModel.weekly.remaining;
  if (els.weeklyProjection) els.weeklyProjection.textContent = viewModel.weekly.projection;
  els.weeklyZeroAt.textContent = viewModel.weekly.zeroAt;
  if (els.weeklyWindowBadge) els.weeklyWindowBadge.textContent = viewModel.weekly.windowBadge;
  if (els.weeklyUsed) els.weeklyUsed.textContent = viewModel.weekly.used;
  if (els.weeklyRemainingDays) els.weeklyRemainingDays.textContent = viewModel.weekly.remainingTime;
  if (els.weeklyAverage) els.weeklyAverage.textContent = viewModel.weekly.averageHourly;
  if (els.weeklyDailyAverage) els.weeklyDailyAverage.textContent = viewModel.weekly.dailyAverage;
  if (els.weeklyUsedInline) els.weeklyUsedInline.textContent = viewModel.weekly.usedInline;
  if (els.weeklySideBadge) els.weeklySideBadge.textContent = viewModel.weekly.sideBadge;
  if (els.weeklyIdeal) els.weeklyIdeal.textContent = viewModel.weekly.ideal;
  els.weeklyBand.textContent = viewModel.weekly.band;
  if (els.weeklyRenewal) els.weeklyRenewal.textContent = viewModel.weekly.renewal;
  if (els.weeklyUsePlan) els.weeklyUsePlan.textContent = viewModel.weekly.usePlan;
  if (els.weeklyCountdown) els.weeklyCountdown.textContent = viewModel.weekly.countdown;
  if (els.weeklyWindowZero) els.weeklyWindowZero.textContent = viewModel.weekly.zeroWindowText;
  if (els.weeklyWindowPlan) els.weeklyWindowPlan.textContent = viewModel.weekly.windowPlan;
  if (els.harvestSuggestion) els.harvestSuggestion.textContent = viewModel.weekly.harvest;
  setProgress(els.weeklyBar, viewModel.weekly.remaining);
  if (els.totalWeeklyAvailableText) els.totalWeeklyAvailableText.textContent = viewModel.totalAvailability.weeklyText;
  setProgress(els.totalWeeklyAvailableBar, viewModel.totalAvailability.weeklyPercent);
  if (els.totalWeeklyAvailableMeta) els.totalWeeklyAvailableMeta.textContent = viewModel.totalAvailability.meta;
  renderActiveAccountPanel(els, viewModel.activeAccount);
  els.usageSuggestion.textContent = capitalizeFirst(viewModel.suggestion.title);
  els.usageSuggestionMeta.textContent = viewModel.suggestion.meta;
  if (els.usageBandValue) els.usageBandValue.textContent = viewModel.compare.band;
  if (els.usageBandMeta) els.usageBandMeta.textContent = viewModel.compare.meta;
  if (els.compareActualText) els.compareActualText.textContent = viewModel.compare.actualText;
  if (els.compareIdealText) els.compareIdealText.textContent = viewModel.compare.idealText;
  if (els.compareActualValue) els.compareActualValue.textContent = viewModel.compare.actualValue;
  if (els.compareIdealValue) els.compareIdealValue.textContent = viewModel.compare.idealValue;
  if (els.compareActualBar) els.compareActualBar.style.left = viewModel.compare.actualWidth;
  if (els.compareIdealBar) els.compareIdealBar.style.left = viewModel.compare.idealWidth;
  renderAccountsGrid(els.accountsGrid, viewModel.accounts);
  setChartButtons(els);
  renderSparkline(els.usageSparkline, activeChart === "weekly" ? viewModel.charts.weekly : viewModel.charts.fiveHour);
}

/* =========================================
   Notifications
========================================= */
function triggerHaptic(duration = 10) {
  if (window.navigator?.vibrate) window.navigator.vibrate(duration);
}

const NOTIFICATION_RULES = [
  {
    id: "weeklyResetShift",
    title: "Reset semanal mudou",
    description: "Avisa quando o dia/horário semanal de uma conta muda fora do padrão.",
    defaultEnabled: true,
    accountScoped: true,
  },
  {
    id: "weeklyRefill",
    title: "Semanal recarregado",
    description: "Avisa quando a conta volta para 95% ou mais.",
    defaultEnabled: true,
    accountScoped: true,
  },
  {
    id: "weeklyLow",
    title: "Semanal baixo",
    description: "Avisa quando uma conta cai para 20% ou menos.",
    defaultEnabled: true,
    accountScoped: true,
  },
  {
    id: "dataStale",
    title: "Dados atrasados",
    description: "Avisa quando a captura passa de 1h sem atualizar ou falha.",
    defaultEnabled: true,
    accountScoped: false,
  },
  {
    id: "fiveHourLow",
    title: "5h baixo",
    description: "Avisa quando a janela de 5h cai para 15% ou menos.",
    defaultEnabled: false,
    accountScoped: true,
  },
];

let activeNotificationView = "all";

function defaultNotificationRules() {
  return Object.fromEntries(NOTIFICATION_RULES.map((rule) => [rule.id, rule.defaultEnabled]));
}

function normalizeNotificationPreferences(raw = {}) {
  const legacyEnabled = localStorage.getItem("notificationsEnabled") === "true";
  const rules = { ...defaultNotificationRules(), ...(raw.rules && typeof raw.rules === "object" ? raw.rules : {}) };
  const accountRules = raw.accountRules && typeof raw.accountRules === "object" ? raw.accountRules : {};
  return {
    globalEnabled: Boolean(raw.globalEnabled ?? legacyEnabled),
    rules,
    accountRules,
  };
}

function readNotificationPreferences() {
  try {
    return normalizeNotificationPreferences(JSON.parse(localStorage.getItem(NOTIFICATION_PREFERENCES_KEY) || "{}"));
  } catch {
    return normalizeNotificationPreferences();
  }
}

function writeNotificationPreferences(next) {
  const preferences = normalizeNotificationPreferences(next);
  localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences));
  localStorage.setItem("notificationsEnabled", String(preferences.globalEnabled));
}

function readNotificationState() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATION_STATE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeNotificationState(next) {
  localStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify(next));
}

function notificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function accountNotificationKey(account) {
  return account?.id || account?.name || "account";
}

function isNotificationRuleEnabled(ruleId, preferences = readNotificationPreferences(), accountKey = null) {
  if (!preferences.globalEnabled) return false;
  if (preferences.rules?.[ruleId] !== true) return false;
  if (!accountKey) return true;
  const accountRules = preferences.accountRules?.[accountKey];
  if (!accountRules || !(ruleId in accountRules)) return true;
  return accountRules[ruleId] !== false;
}

function resetPatternKey(value) {
  const date = parseDate(value);
  if (!date) return null;
  return `${date.getDay()}-${date.getHours()}-${date.getMinutes()}`;
}

function shouldCooldown(previousAt, cooldownMs) {
  const previousDate = parseDate(previousAt);
  return Boolean(previousDate && Date.now() - previousDate.getTime() < cooldownMs);
}

function recordNotificationEvent(state, event) {
  const recent = Array.isArray(state.recent) ? state.recent : [];
  recent.unshift({
    at: new Date().toISOString(),
    ...event,
  });
  state.recent = recent.slice(0, 8);
}

async function sendNotification(title, body, tag) {
  try {
    if (navigator.serviceWorker?.ready) {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 700)),
      ]);
      if (registration?.showNotification) {
        await registration.showNotification(title, {
          body,
          icon: "/assets/logo_background.png",
          badge: "/assets/codex-color.png",
          tag,
          requireInteraction: false,
          silent: false,
          timestamp: Date.now(),
        });
        return true;
      }
    }
    const notification = new Notification(title, {
      body,
      icon: "/assets/logo_background.png",
      badge: "/assets/codex-color.png",
      tag,
      requireInteraction: false,
      silent: false,
      timestamp: Date.now(),
    });
    setTimeout(() => notification.close(), 10000);
    return true;
  } catch {
    return false;
  }
}

async function maybeNotify(ruleId, preferences, accountKey, title, body, tag, state, event) {
  if (!isNotificationRuleEnabled(ruleId, preferences, accountKey) || notificationPermission() !== "granted") return false;
  const sent = await sendNotification(title, body, tag);
  if (sent) {
    recordNotificationEvent(state, {
      ruleId,
      accountKey,
      title,
      meta: body,
      ...event,
    });
  }
  return sent;
}

async function syncNotifications(usage, hasLoadError = false) {
  const preferences = readNotificationPreferences();
  if (!preferences.globalEnabled) {
    updateNotificationButton(document.getElementById("notificationButton"));
    return;
  }

  const state = readNotificationState();
  const byAccount = state.byAccount && typeof state.byAccount === "object"
    ? state.byAccount
    : {};

  const isStale = hasLoadError
    || !usage.lastUpdatedDate
    || Date.now() - usage.lastUpdatedDate.getTime() > ACTIVE_ACCOUNT_WINDOW_MS;
  if (isStale && !shouldCooldown(state.lastDataStaleAt, 30 * 60 * 1000)) {
    const lastUpdatedText = usage.lastUpdatedDate ? `Última atualização: ${formatDateTimePtBr(usage.lastUpdatedDate)}.` : "Sem data de atualização válida.";
    const sent = await maybeNotify(
      "dataStale",
      preferences,
      null,
      "Dados do Codex atrasados",
      lastUpdatedText,
      `codex-data-stale-${usage.lastUpdatedDate?.toISOString() || "unknown"}`,
      state,
      { type: "global" },
    );
    if (sent) state.lastDataStaleAt = new Date().toISOString();
  }

  for (const account of usage.accounts || []) {
    const accountKey = accountNotificationKey(account);
    if (!accountKey) continue;

    const currentReset = account.weeklyResetDate?.toISOString() || null;
    const currentResetPattern = resetPatternKey(currentReset);
    const currentPercent = clampPercent(account.weeklyPercent, null);
    const currentFiveHourPercent = clampPercent(account.fiveHourPercent, null);
    const previous = byAccount[accountKey] || {};
    const previousReset = typeof previous.weeklyReset === "string" ? previous.weeklyReset : null;
    const previousResetPattern = typeof previous.weeklyResetPattern === "string" ? previous.weeklyResetPattern : null;
    const previousPercent = clampPercent(previous.weeklyPercent, null);
    const previousFiveHourPercent = clampPercent(previous.fiveHourPercent, null);
    const firstSeen = !previous.seen;
    const refilled = previousPercent !== null && previousPercent < 95 && currentPercent !== null && currentPercent >= 95;
    const resetPatternChanged = Boolean(previousResetPattern && currentResetPattern && previousResetPattern !== currentResetPattern);
    const resetChanged = Boolean(previousReset && currentReset && previousReset !== currentReset);

    if (!firstSeen && resetPatternChanged) {
      await maybeNotify(
        "weeklyResetShift",
        preferences,
        accountKey,
        "Reset semanal mudou",
        `${account.name}: novo reset em ${formatDateTimePtBr(account.weeklyResetDate)}.`,
        `weekly-reset-shift-${accountKey}-${currentReset || "unknown"}`,
        state,
        { type: "account" },
      );
    } else if (!firstSeen && (refilled || (resetChanged && currentPercent !== null && currentPercent >= 95))) {
      await maybeNotify(
        "weeklyRefill",
        preferences,
        accountKey,
        "Semanal recarregado",
        `${account.name} voltou para ${percentOrDash(currentPercent)}.`,
        `weekly-refill-${accountKey}-${currentReset || "full"}`,
        state,
        { type: "account" },
      );
    }

    if (
      !firstSeen
      && currentPercent !== null
      && currentPercent <= 20
      && previousPercent !== null
      && previousPercent > 20
      && !shouldCooldown(previous.lastWeeklyLowAt, 12 * 60 * 60 * 1000)
    ) {
      const sent = await maybeNotify(
        "weeklyLow",
        preferences,
        accountKey,
        "Semanal baixo",
        `${account.name}: ${percentOrDash(currentPercent)} restante no semanal.`,
        `weekly-low-${accountKey}-${currentReset || "unknown"}`,
        state,
        { type: "account" },
      );
      if (sent) previous.lastWeeklyLowAt = new Date().toISOString();
    }

    if (
      !firstSeen
      && currentFiveHourPercent !== null
      && currentFiveHourPercent <= 15
      && previousFiveHourPercent !== null
      && previousFiveHourPercent > 15
      && !shouldCooldown(previous.lastFiveHourLowAt, 3 * 60 * 60 * 1000)
    ) {
      const sent = await maybeNotify(
        "fiveHourLow",
        preferences,
        accountKey,
        "5h baixo",
        `${account.name}: ${percentOrDash(currentFiveHourPercent)} restante na janela de 5h.`,
        `five-hour-low-${accountKey}-${account.fiveHourResetDate?.toISOString() || "unknown"}`,
        state,
        { type: "account" },
      );
      if (sent) previous.lastFiveHourLowAt = new Date().toISOString();
    }

    byAccount[accountKey] = {
      ...previous,
      seen: true,
      weeklyReset: currentReset,
      weeklyResetPattern: currentResetPattern,
      weeklyPercent: currentPercent,
      fiveHourPercent: currentFiveHourPercent,
    };
  }

  state.byAccount = byAccount;
  state.lastSeenUpdatedAt = usage.lastUpdatedDate?.toISOString() || null;
  writeNotificationState(state);
  updateNotificationButton(document.getElementById("notificationButton"));
}

function updateNotificationButton(button) {
  if (!button) return;
  const preferences = readNotificationPreferences();
  const enabled = preferences.globalEnabled;
  const permission = notificationPermission();
  const active = enabled && permission === "granted";

  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("is-enabled", active);
  button.classList.toggle("has-warning", enabled && permission !== "granted");
  if (permission === "denied") {
    button.title = "Notificações bloqueadas pelo navegador";
  } else if (permission === "unsupported") {
    button.title = "Notificações indisponíveis neste navegador";
  } else if (active) {
    button.title = "Notificações ativadas";
  } else {
    button.title = "Abrir notificações";
  }
}

function buildNotificationSwitch({ title, description, checked, disabled = false, onChange }) {
  const label = document.createElement("label");
  label.className = "notification-toggle-row";
  if (disabled) label.classList.add("is-disabled");

  const text = document.createElement("span");
  text.className = "notification-toggle-copy";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = description;
  text.append(strong, small);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.disabled = Boolean(disabled);
  input.addEventListener("change", () => onChange?.(input.checked));

  const control = document.createElement("span");
  control.className = "switch-control";
  control.setAttribute("aria-hidden", "true");

  label.append(text, input, control);
  return label;
}

function updateNotificationPreference(mutator) {
  const preferences = readNotificationPreferences();
  mutator(preferences);
  writeNotificationPreferences(preferences);
  updateNotificationButton(document.getElementById("notificationButton"));
}

function setNotificationView(els, view) {
  activeNotificationView = view === "accounts" ? "accounts" : "all";
  const showAccounts = activeNotificationView === "accounts";
  if (els.notificationAllPanel) els.notificationAllPanel.hidden = showAccounts;
  if (els.notificationAccountsPanel) els.notificationAccountsPanel.hidden = !showAccounts;
  els.notificationViewAllButton?.setAttribute("aria-pressed", String(!showAccounts));
  els.notificationViewAccountsButton?.setAttribute("aria-pressed", String(showAccounts));
}

function renderNotificationRecent(target) {
  if (!target) return;
  const state = readNotificationState();
  const recent = Array.isArray(state.recent) ? state.recent.slice(0, 3) : [];
  if (!recent.length) {
    target.textContent = "Aguardando novos sinais.";
    return;
  }
  target.textContent = recent
    .map((event) => `${event.title} · ${formatAgo(parseDate(event.at))}`)
    .join(" / ");
}

function renderNotificationRulesList(els, usage, preferences) {
  const container = els.notificationRulesList;
  if (!container) return;
  container.replaceChildren();
  const permission = notificationPermission();
  const unsupported = permission === "unsupported";

  container.append(buildNotificationSwitch({
    title: "Notificações ativas",
    description: unsupported ? "Este navegador não suporta notificações." : "Liga ou desliga todos os alertas do painel.",
    checked: preferences.globalEnabled,
    disabled: unsupported,
    onChange: (checked) => {
      updateNotificationPreference((next) => {
        next.globalEnabled = checked;
      });
      renderNotificationPanel(els, usage);
      if (checked) void syncNotifications(usage);
    },
  }));

  for (const rule of NOTIFICATION_RULES) {
    container.append(buildNotificationSwitch({
      title: rule.title,
      description: rule.description,
      checked: preferences.rules?.[rule.id] === true,
      disabled: unsupported,
      onChange: (checked) => {
        updateNotificationPreference((next) => {
          next.rules[rule.id] = checked;
        });
        renderNotificationPanel(els, usage);
      },
    }));
  }
}

function renderNotificationAccountsList(els, usage, preferences) {
  const container = els.notificationAccountsList;
  if (!container) return;
  container.replaceChildren();

  const accounts = usage.accounts || [];
  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "notification-empty";
    empty.textContent = "Nenhuma conta publicada ainda.";
    container.append(empty);
    return;
  }

  for (const account of accounts) {
    const accountKey = accountNotificationKey(account);
    const card = document.createElement("section");
    card.className = "notification-account-row";

    const top = document.createElement("div");
    top.className = "notification-account-top";
    const title = document.createElement("strong");
    title.textContent = account.name;
    const meta = document.createElement("span");
    meta.textContent = account.lastUsedAtDate ? `Usada ${formatAgo(account.lastUsedAtDate)}` : (account.isActive ? "Ativa no Switcher" : "Sem uso recente");
    top.append(title, meta);
    card.append(top);

    const list = document.createElement("div");
    list.className = "notification-account-switches";
    for (const rule of NOTIFICATION_RULES.filter((item) => item.accountScoped)) {
      const accountRule = preferences.accountRules?.[accountKey]?.[rule.id];
      list.append(buildNotificationSwitch({
        title: rule.title,
        description: accountRule === false ? "Desligado só para esta conta." : "Segue o alerta desta conta.",
        checked: accountRule !== false,
        disabled: false,
        onChange: (checked) => {
          updateNotificationPreference((next) => {
            next.accountRules[accountKey] = {
              ...(next.accountRules[accountKey] || {}),
              [rule.id]: checked,
            };
          });
          renderNotificationPanel(els, usage);
        },
      }));
    }
    card.append(list);
    container.append(card);
  }
}

function renderNotificationPanel(els, usage) {
  const preferences = readNotificationPreferences();
  const permission = notificationPermission();
  const permissionText = {
    unsupported: "Este navegador não suporta notificações.",
    denied: "Bloqueadas pelo navegador. Libere nas configurações para receber alertas.",
    granted: preferences.globalEnabled ? "Ativas e prontas para alertar por conta." : "Permissão concedida; alertas gerais desligados.",
    default: "Permissão pendente. Ative para liberar os alertas.",
  }[permission] || "Permissão pendente. Ative para liberar os alertas.";

  if (els.notificationPermissionText) els.notificationPermissionText.textContent = permissionText;
  if (els.notificationPermissionButton) {
    els.notificationPermissionButton.disabled = permission === "unsupported" || permission === "denied";
    els.notificationPermissionButton.textContent = permission === "granted"
      ? (preferences.globalEnabled ? "Desativar" : "Ativar")
      : permission === "denied"
        ? "Bloqueado"
        : "Permitir";
  }

  renderNotificationRulesList(els, usage, preferences);
  renderNotificationAccountsList(els, usage, preferences);
  renderNotificationRecent(els.notificationRecentEvents);
  setNotificationView(els, activeNotificationView);
  updateNotificationButton(els.notificationButton);
}

/* =========================================
   Events and Boot
========================================= */
function bindEvents(els, usage, render) {
  els.accountSortSelect?.addEventListener("change", (event) => {
    const value = event?.target?.value;
    if (["renewFirst", "renewLast", "highestPercent", "lowestPercent", "expiry"].includes(value)) {
      activeAccountSort = value;
      triggerHaptic(8);
      render();
    }
  });

  els.hideExhaustedButton?.addEventListener("click", () => {
    hideExhaustedAccounts = !hideExhaustedAccounts;
    els.hideExhaustedButton.setAttribute("aria-pressed", String(hideExhaustedAccounts));
    els.hideExhaustedButton.textContent = hideExhaustedAccounts ? "Mostrar esgotadas" : "Ocultar esgotadas";
    triggerHaptic(8);
    render();
  });

  els.hideFreeGoButton?.addEventListener("click", () => {
    hideFreeGoAccounts = !hideFreeGoAccounts;
    els.hideFreeGoButton.setAttribute("aria-pressed", String(hideFreeGoAccounts));
    els.hideFreeGoButton.textContent = hideFreeGoAccounts ? "Mostrar FREE/GO" : "Ocultar FREE/GO";
    triggerHaptic(8);
    render();
  });

  els.themeColorInput?.addEventListener("input", (event) => {
    const value = event?.target?.value;
    if (typeof value === "string") setThemeColor(value);
  });

  els.notificationPermissionButton?.addEventListener("click", () => {
    triggerHaptic(10);
    if (!("Notification" in window)) {
      renderNotificationPanel(els, usage);
      return;
    }
    if (Notification.permission === "denied") {
      renderNotificationPanel(els, usage);
      return;
    }
    if (Notification.permission === "granted") {
      const preferences = readNotificationPreferences();
      preferences.globalEnabled = !preferences.globalEnabled;
      writeNotificationPreferences(preferences);
      updateNotificationButton(els.notificationButton);
      renderNotificationPanel(els, usage);
      if (preferences.globalEnabled) void syncNotifications(usage);
      return;
    }
    Notification.requestPermission().then((permission) => {
      const preferences = readNotificationPreferences();
      preferences.globalEnabled = permission === "granted";
      writeNotificationPreferences(preferences);
      updateNotificationButton(els.notificationButton);
      renderNotificationPanel(els, usage);
      if (permission === "granted") {
        void syncNotifications(usage);
      }
    });
  });

  els.notificationViewAllButton?.addEventListener("click", () => {
    triggerHaptic(8);
    setNotificationView(els, "all");
  });

  els.notificationViewAccountsButton?.addEventListener("click", () => {
    triggerHaptic(8);
    setNotificationView(els, "accounts");
  });

  els.refreshButton?.addEventListener("click", () => {
    triggerHaptic(20);
    els.refreshButton.classList.remove("spinning");
    void els.refreshButton.offsetWidth;
    els.refreshButton.classList.add("spinning");
    setTimeout(() => location.reload(), 160);
  });

  for (const button of [els.chartWeeklyButton, els.chartFiveHourButton]) {
    button?.addEventListener("click", () => {
      const nextChart = button.dataset.chart;
      if (nextChart !== "weekly" && nextChart !== "fiveHour") return;
      activeChart = nextChart;
      triggerHaptic(8);
      render();
    });
  }
}

async function init() {
  initTheme();
  adjustViewportHeight();

  const els = getElements();
  const { usage, hasLoadError } = await loadUsage();
  document.body.classList.remove("is-loading");

  function render() {
    renderDashboard(els, buildLimitViewModel(usage, hasLoadError));
    renderNotificationPanel(els, usage);
  }

  render();
  if (!hasLoadError) saveLastValidPayload(usage);
  updateNotificationButton(els.notificationButton);
  bindEvents(els, usage, render);
  void syncNotifications(usage, hasLoadError);
  setInterval(render, 1000);
  setInterval(() => void syncNotifications(usage, hasLoadError), 5 * 60 * 1000);
}

if ("serviceWorker" in navigator) {
  const isSecureContext = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

init().catch((error) => {
  console.error("Falha ao inicializar Codex Usage:", error);
});

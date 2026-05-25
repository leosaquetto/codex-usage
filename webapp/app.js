const SAFE_FALLBACK = {
  fiveHourPercent: 100,
  fiveHourReset: null,
  weeklyPercent: 100,
  weeklyReset: null,
  lastUpdated: null,
};

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const THEME_COLOR_KEY = "codex-theme-color";
const LAST_VALID_USAGE_KEY = "codex-last-valid-usage-payload";
const DEFAULT_THEME_COLOR = "#3b82f6";

let viewportRafId = null;
let activeUsageController = null;
let lastUsageSignature = "";
let lastSuspendedAt = 0;
let activeChart = "weekly";

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
  const fiveHourResetIsNull = json.fiveHourReset === null;

  return {
    fiveHourPercent: clampPercent(json.fiveHourPercent, SAFE_FALLBACK.fiveHourPercent),
    fiveHourResetIsNull,
    fiveHourResetDate: fiveHourResetIsNull ? null : parseDate(json.fiveHourReset),
    weeklyPercent: clampPercent(json.weeklyPercent, SAFE_FALLBACK.weeklyPercent),
    weeklyResetDate: parseDate(json.weeklyReset),
    lastUpdatedDate: parseDate(json.lastUpdated),
    historySamples: normalizeHistorySamples(json.historySamples),
  };
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

function formatCompareWidth(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return "4%";
  return `${Math.min(100, Math.max(4, (value / max) * 100))}%`;
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
  if (remaining >= 70) return "ok";
  if (remaining >= 40) return "warn";
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

  const weeklyRatePerWindow = Number.isFinite(elapsedWindows) ? weeklyUsed / elapsedWindows : NaN;
  const fiveHourAverageUsed = Number.isFinite(fiveHourElapsedHours) ? fiveHourUsed / fiveHourElapsedHours : NaN;
  const weeklyAverageUsedPerWindow = Number.isFinite(elapsedWindows) ? weeklyUsed / elapsedWindows : NaN;
  const idealPerWindow = Number.isFinite(windowsRemaining) ? weeklyRemaining / windowsRemaining : NaN;
  const projectedRemaining = Number.isFinite(weeklyRatePerWindow) && Number.isFinite(windowsRemaining)
    ? weeklyRemaining - weeklyRatePerWindow * windowsRemaining
    : NaN;
  const zeroInWindows = Number.isFinite(weeklyRatePerWindow) && weeklyRatePerWindow > 0
    ? weeklyRemaining / weeklyRatePerWindow
    : NaN;
  const zeroInDays = Number.isFinite(zeroInWindows) ? (zeroInWindows * 5) / 24 : NaN;
  const realDailyRate = Number.isFinite(elapsedDays) ? weeklyUsed / elapsedDays : NaN;
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
  const historicalWeeklyHourlyRate = consumptionRate(weeklyCycleSamples, "weeklyPercent");
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
    return `Reduza para até ${formatPercent(metrics.idealPerWindow)} por janela de 5h.`;
  }
  if (metrics.usageBandState.state === "danger" && Number.isFinite(metrics.idealPerWindow)) {
    return `Desacelere para perto de ${formatPercent(metrics.idealPerWindow)} por janela.`;
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

function buildLimitViewModel(usage, hasLoadError = false) {
  const metrics = buildLiveMetrics(usage);
  const fiveHour = buildFiveHourDecision(usage, metrics);
  const weeklyQuestion = buildWeeklyQuestion(metrics);
  const weeklyAdvice = buildWeeklyAdvice(metrics);
  const weeklyZeroAt = Number.isFinite(metrics.effectiveZeroInDays) && metrics.effectiveZeroInDays > 0
    ? (metrics.effectiveZeroInDays > metrics.weeklyDaysRemaining ? "Após renovar" : formatZeroInDays(metrics.effectiveZeroInDays))
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
  const compareMax = Math.max(metrics.effectiveWeeklyRatePerWindow || 0, metrics.idealPerWindow || 0, 1);

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
      renewal: usage.fiveHourResetDate ? formatCountdownMs(metrics.fiveHourMs, { includeDays: false }) : "--",
      countdown: usage.fiveHourResetDate ? formatCountdownMs(metrics.fiveHourMs, { includeDays: false }) : "--",
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
      renewal: usage.weeklyResetDate ? `${formatDurationMs(metrics.weeklyMs)} · ${formatDateTimePtBr(usage.weeklyResetDate)}` : "--",
      remainingTime: usage.weeklyResetDate ? formatCountdownMs(metrics.weeklyMs) : "--",
      countdown: usage.weeklyResetDate ? formatCountdownMs(metrics.weeklyMs) : "--",
      question: weeklyQuestion,
      advice: weeklyAdvice,
      projection: formatProjectedBalance(metrics.effectiveProjectedRemaining),
      zeroAt: Number.isFinite(metrics.weeklyZeroInWindows) ? `${weeklyZeroAt} · cerca de ${formatUseWindowCount(metrics.weeklyZeroInWindows)}` : weeklyZeroAt,
      zeroWindowText: weeklyWindowZero,
      windowPlan: Number.isFinite(metrics.weeklyZeroInWindows) ? formatWindowCount(metrics.weeklyZeroInWindows) : "--",
      average: formatPercent(Number.isFinite(metrics.effectiveWeeklyRatePerWindow) ? metrics.effectiveWeeklyRatePerWindow : metrics.weeklyAverageUsedPerWindow),
      averageHourly: formatRatePerHour(Number.isFinite(metrics.effectiveWeeklyRatePerWindow) ? metrics.effectiveWeeklyRatePerWindow / 5 : metrics.weeklyAverageUsedPerWindow / 5),
      dailyAverage: formatRatePerDay(metrics.realDailyRate),
      ideal: formatPercent(metrics.idealPerWindow),
      band: metrics.usageBandState.label,
      usePlan: weeklyPlan,
      harvest: buildHarvestAdvice(metrics),
    },
    suggestion: {
      title: weeklyAdvice,
      meta: weeklyQuestion,
    },
    compare: {
      band: metrics.usageBandState.label,
      meta: Number.isFinite(metrics.effectiveWeeklyRatePerWindow) && Number.isFinite(metrics.idealPerWindow)
        ? `Atual ${formatPercent(metrics.effectiveWeeklyRatePerWindow)} por janela · ideal ${formatPercent(metrics.idealPerWindow)}`
        : "Aguardando histórico suficiente.",
      actualText: `Ritmo atual ${formatPercent(metrics.effectiveWeeklyRatePerWindow)}`,
      idealText: `Ideal ${formatPercent(metrics.idealPerWindow)}`,
      actualWidth: formatCompareWidth(metrics.effectiveWeeklyRatePerWindow, compareMax),
      idealWidth: formatCompareWidth(metrics.idealPerWindow, compareMax),
    },
    charts: {
      fiveHour: metrics.fiveHourCycleSamples.map((sample) => ({
        x: sample.capturedAtDate.getTime(),
        y: sample.fiveHourPercent,
      })),
      weekly: metrics.weeklyCycleSamples.map((sample) => ({
        x: sample.capturedAtDate.getTime(),
        y: sample.weeklyPercent,
      })),
    },
    metrics,
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
    notificationButton: document.getElementById("notificationButton"),
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
    weeklyIdeal: document.getElementById("weeklyIdeal"),
    weeklyBand: document.getElementById("weeklyBand"),
    weeklyRenewal: document.getElementById("weeklyRenewal"),
    weeklyUsePlan: document.getElementById("weeklyUsePlan"),
    fiveHourCountdown: document.getElementById("fiveHourCountdown"),
    weeklyCountdown: document.getElementById("weeklyCountdown"),
    weeklyWindowZero: document.getElementById("weeklyWindowZero"),
    weeklyWindowPlan: document.getElementById("weeklyWindowPlan"),
    harvestSuggestion: document.getElementById("harvestSuggestion"),
    usageBandValue: document.getElementById("usageBandValue"),
    usageBandMeta: document.getElementById("usageBandMeta"),
    compareActualText: document.getElementById("compareActualText"),
    compareIdealText: document.getElementById("compareIdealText"),
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
  bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
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

function setChartButtons(els) {
  const isWeekly = activeChart === "weekly";
  els.chartTitle.textContent = isWeekly ? "Saldo semanal" : "Saldo da janela de 5h";
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
  if (els.fiveHourUsePlan) els.fiveHourUsePlan.textContent = viewModel.fiveHour.usePlan;
  if (els.fiveHourUsed) els.fiveHourUsed.textContent = viewModel.fiveHour.used;
  if (els.fiveHourRenewal) els.fiveHourRenewal.textContent = viewModel.fiveHour.renewal;
  if (els.fiveHourCountdown) els.fiveHourCountdown.textContent = viewModel.fiveHour.countdown;
  setProgress(els.fiveHourBar, viewModel.fiveHour.remaining);

  els.weeklyPercent.textContent = viewModel.weekly.remaining;
  els.weeklyProjection.textContent = viewModel.weekly.projection;
  els.weeklyZeroAt.textContent = viewModel.weekly.zeroAt;
  if (els.weeklyUsed) els.weeklyUsed.textContent = viewModel.weekly.used;
  if (els.weeklyRemainingDays) els.weeklyRemainingDays.textContent = viewModel.weekly.remainingTime;
  if (els.weeklyAverage) els.weeklyAverage.textContent = viewModel.weekly.averageHourly;
  if (els.weeklyDailyAverage) els.weeklyDailyAverage.textContent = viewModel.weekly.dailyAverage;
  if (els.weeklyIdeal) els.weeklyIdeal.textContent = viewModel.weekly.ideal;
  els.weeklyBand.textContent = viewModel.weekly.band;
  if (els.weeklyRenewal) els.weeklyRenewal.textContent = viewModel.weekly.renewal;
  if (els.weeklyUsePlan) els.weeklyUsePlan.textContent = viewModel.weekly.usePlan;
  if (els.weeklyCountdown) els.weeklyCountdown.textContent = viewModel.weekly.countdown;
  if (els.weeklyWindowZero) els.weeklyWindowZero.textContent = viewModel.weekly.zeroWindowText;
  if (els.weeklyWindowPlan) els.weeklyWindowPlan.textContent = viewModel.weekly.windowPlan;
  if (els.harvestSuggestion) els.harvestSuggestion.textContent = viewModel.weekly.harvest;
  setProgress(els.weeklyBar, viewModel.weekly.remaining);
  els.usageSuggestion.textContent = capitalizeFirst(viewModel.suggestion.title);
  els.usageSuggestionMeta.textContent = viewModel.suggestion.meta;
  if (els.usageBandValue) els.usageBandValue.textContent = viewModel.compare.band;
  if (els.usageBandMeta) els.usageBandMeta.textContent = viewModel.compare.meta;
  if (els.compareActualText) els.compareActualText.textContent = viewModel.compare.actualText;
  if (els.compareIdealText) els.compareIdealText.textContent = viewModel.compare.idealText;
  if (els.compareActualBar) els.compareActualBar.style.width = viewModel.compare.actualWidth;
  if (els.compareIdealBar) els.compareIdealBar.style.width = viewModel.compare.idealWidth;
  setChartButtons(els);
  renderSparkline(els.usageSparkline, activeChart === "weekly" ? viewModel.charts.weekly : viewModel.charts.fiveHour);
}

/* =========================================
   Notifications
========================================= */
function triggerHaptic(duration = 10) {
  if (window.navigator?.vibrate) window.navigator.vibrate(duration);
}

function notificationStateKey() {
  return "codex-notification-state-v2";
}

function readNotificationState() {
  try {
    return JSON.parse(localStorage.getItem(notificationStateKey()) || "{}") || {};
  } catch {
    return {};
  }
}

function writeNotificationState(next) {
  localStorage.setItem(notificationStateKey(), JSON.stringify(next));
}

function canNotify() {
  return localStorage.getItem("notificationsEnabled") === "true" && "Notification" in window && Notification.permission === "granted";
}

function sendNotification(title, body, tag) {
  try {
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

function getNotificationThresholds(remaining, kind) {
  const value = clampPercent(remaining, null);
  if (value === null) return [];
  const thresholds = kind === "fiveHour" ? [50, 20] : [80, 60, 40, 20];
  return thresholds.filter((threshold) => value <= threshold);
}

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function maybeNotifyThresholds(usage, state) {
  for (const threshold of getNotificationThresholds(usage.weeklyPercent, "weekly")) {
    const key = `weekly-threshold-${threshold}`;
    if (!state[key] && sendNotification("Codex semanal", `Limite semanal em ${usage.weeklyPercent}%.`, key)) {
      state[key] = true;
    }
  }

  for (const threshold of getNotificationThresholds(usage.fiveHourPercent, "fiveHour")) {
    const key = `fiveHour-threshold-${threshold}`;
    if (!state[key] && sendNotification("Codex 5 horas", `Janela de 5 horas em ${usage.fiveHourPercent}%.`, key)) {
      state[key] = true;
    }
  }
}

function maybeNotifyRenewals(usage, state, previous) {
  const fiveHour = clampPercent(usage.fiveHourPercent, null);
  const weekly = clampPercent(usage.weeklyPercent, null);
  const currentFiveReset = usage.fiveHourResetDate?.toISOString() || null;
  const currentWeeklyReset = usage.weeklyResetDate?.toISOString() || null;

  if (previous.fiveHourReset && currentFiveReset && previous.fiveHourReset !== currentFiveReset && fiveHour !== null && fiveHour < 100) {
    sendNotification("Codex 5 horas", `Renovação ajustada para ${formatDateTimePtBr(usage.fiveHourResetDate)}.`, "five-hour-reset-changed");
  }
  if (previous.weeklyReset && currentWeeklyReset && previous.weeklyReset !== currentWeeklyReset && weekly !== null && weekly < 100) {
    sendNotification("Codex semanal", `Renovação ajustada para ${formatDateTimePtBr(usage.weeklyResetDate)}.`, "weekly-reset-changed");
  }
  if (previous.fiveHourPercent !== null && previous.fiveHourPercent < 100 && fiveHour === 100) {
    sendNotification("Codex 5 horas", "Janela de 5 horas renovada.", "five-hour-renewed");
  }
  if (previous.weeklyPercent !== null && previous.weeklyPercent < 100 && weekly === 100) {
    sendNotification("Codex semanal", "Limite semanal renovado.", "weekly-renewed");
  }
}

function maybeNotifyDailySummary(usage, state) {
  const now = new Date();
  if (now.getHours() !== 9) return;
  const todayKey = localDateKey(now);
  if (state.dailySummaryDate === todayKey) return;

  const body = [
    `5h: ${formatUsed(usage.fiveHourPercent)} · renova ${formatDateTimePtBr(usage.fiveHourResetDate)}`,
    `Semanal: ${formatUsed(usage.weeklyPercent)} · renova ${formatDateTimePtBr(usage.weeklyResetDate)}`,
  ].join(" | ");

  if (sendNotification("Resumo diário Codex", body, `daily-summary-${todayKey}`)) {
    state.dailySummaryDate = todayKey;
  }
}

function syncNotifications(usage) {
  if (!canNotify()) return;

  const state = readNotificationState();
  const previous = {
    fiveHourPercent: clampPercent(state.lastFiveHourPercent, null),
    weeklyPercent: clampPercent(state.lastWeeklyPercent, null),
    fiveHourReset: typeof state.lastFiveReset === "string" ? state.lastFiveReset : null,
    weeklyReset: typeof state.lastWeeklyReset === "string" ? state.lastWeeklyReset : null,
  };

  maybeNotifyRenewals(usage, state, previous);
  maybeNotifyThresholds(usage, state);
  maybeNotifyDailySummary(usage, state);

  state.lastFiveHourPercent = clampPercent(usage.fiveHourPercent, null);
  state.lastWeeklyPercent = clampPercent(usage.weeklyPercent, null);
  state.lastFiveReset = usage.fiveHourResetDate?.toISOString() || null;
  state.lastWeeklyReset = usage.weeklyResetDate?.toISOString() || null;
  state.lastSeenUpdatedAt = usage.lastUpdatedDate?.toISOString() || null;
  writeNotificationState(state);
}

function resetNotificationFlags() {
  localStorage.removeItem(notificationStateKey());
}

function updateNotificationButton(button) {
  if (!button) return;
  const enabled = localStorage.getItem("notificationsEnabled") === "true";
  const permission = "Notification" in window ? Notification.permission : "denied";
  const active = enabled && permission === "granted";

  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("is-enabled", active);
  if (permission === "denied") {
    button.title = "Notificações bloqueadas pelo navegador";
  } else if (active) {
    button.title = "Notificações ativadas";
  } else {
    button.title = "Ativar notificações";
  }
}

/* =========================================
   Events and Boot
========================================= */
function bindEvents(els, usage, render) {
  els.themeColorInput?.addEventListener("input", (event) => {
    const value = event?.target?.value;
    if (typeof value === "string") setThemeColor(value);
  });

  els.notificationButton?.addEventListener("click", () => {
    triggerHaptic(10);
    if (!("Notification" in window)) {
      alert("Notificações não são suportadas neste navegador.");
      return;
    }
    if (Notification.permission === "denied") {
      alert("Notificações foram bloqueadas. Ative nas configurações do navegador.");
      return;
    }
    if (Notification.permission === "granted") {
      const enabled = localStorage.getItem("notificationsEnabled") === "true";
      localStorage.setItem("notificationsEnabled", String(!enabled));
      updateNotificationButton(els.notificationButton);
      return;
    }
    Notification.requestPermission().then((permission) => {
      localStorage.setItem("notificationsEnabled", String(permission === "granted"));
      updateNotificationButton(els.notificationButton);
      if (permission === "granted") {
        sendNotification("Notificações ativadas", "Você será alertado sobre limites e renovações.", "notification-test");
        syncNotifications(usage);
      }
    });
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

  function render() {
    renderDashboard(els, buildLimitViewModel(usage, hasLoadError));
  }

  render();
  if (!hasLoadError) saveLastValidPayload(usage);
  if (usage.fiveHourPercent > 50 && usage.weeklyPercent > 50) resetNotificationFlags();
  updateNotificationButton(els.notificationButton);
  bindEvents(els, usage, render);
  syncNotifications(usage);
  setInterval(render, 1000);
  setInterval(() => syncNotifications(usage), 5 * 60 * 1000);
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

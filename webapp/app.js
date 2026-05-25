const SAFE_FALLBACK = {
  fiveHourPercent: 100,
  fiveHourReset: null,
  weeklyPercent: 100,
  weeklyReset: null,
  lastUpdated: null,
};

const ANTIGRAVITY_FALLBACK = {
  source: "desktop-automation",
  lastUpdated: null,
  models: [],
};

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const THEME_KEY = "codex-theme";
const THEME_COLOR_KEY = "codex-theme-color";
const LAST_VALID_USAGE_KEY = "codex-last-valid-usage-payload";
const DEFAULT_THEME_COLOR = "#3b82f6";
let viewportRafId = null;
let activeUsageController = null;
let lastUsageSignature = "";
let lastSuspendedAt = 0;

// Funções de validação de contraste WCAG
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(color1, color2) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return 0;

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

function validateColorContrast(color) {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const bgColor = currentTheme === "light" ? "#eef2f7" : "#0f172a";
  const contrastRatio = getContrastRatio(color, bgColor);

  // WCAG AA requer contraste mínimo de 3:1 para elementos grandes (UI)
  const MIN_CONTRAST_RATIO = 3.0;

  return {
    isValid: contrastRatio >= MIN_CONTRAST_RATIO,
    ratio: contrastRatio.toFixed(2),
    minRequired: MIN_CONTRAST_RATIO
  };
}

function setThemeColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;

  const contrastCheck = validateColorContrast(color);
  if (!contrastCheck.isValid) {
    console.warn(
      `⚠️ Cor com contraste insuficiente: ${contrastCheck.ratio}:1 (mínimo: ${contrastCheck.minRequired}:1)`
    );
    // Ainda permite a cor, mas avisa o usuário
  }

  document.documentElement.style.setProperty("--primary", color);
  localStorage.setItem(THEME_COLOR_KEY, color);
  const input = document.getElementById("themeColorInput");
  if (input) input.value = color;
}

function initThemeColor() {
  const saved = localStorage.getItem(THEME_COLOR_KEY) || DEFAULT_THEME_COLOR;
  setThemeColor(saved);
}


function applyTheme(theme) {
  const safeTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);
  localStorage.setItem(THEME_KEY, safeTheme);
  const btn = document.getElementById("themeToggleButton");
  const icon = document.getElementById("themeToggleIcon");
  if (btn) btn.setAttribute("aria-pressed", String(safeTheme === "light"));
  if (icon) icon.textContent = safeTheme === "light" ? "☀" : "☾";
}

function initTheme() {
  applyTheme("light");
}

initTheme();
initThemeColor();


/* ===== Viewport Height Fix para iOS ===== */
function adjustViewportHeight() {
  const vh = window.innerHeight * 0.01;
  const svh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
  document.documentElement.style.setProperty('--svh', `${svh}px`);
}

function scheduleViewportAdjust() {
  if (viewportRafId !== null) cancelAnimationFrame(viewportRafId);
  viewportRafId = requestAnimationFrame(() => {
    viewportRafId = null;
    adjustViewportHeight();
  });
}

window.addEventListener('resize', scheduleViewportAdjust);
window.addEventListener('orientationchange', scheduleViewportAdjust);
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
adjustViewportHeight();

/* ===== Utility Functions ===== */
function clampPercent(value, fallback = 0) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function parseDate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimePtBr(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRemainingTime(date) {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "agora";

  const totalMinutes = Math.ceil(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);

  return parts.length > 0 ? `em ${parts.join(" ")}` : "agora";
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "agora";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function formatRatePerDay(value) {
  if (!Number.isFinite(value)) return "--/d";
  return `${value.toFixed(1)}%/d`;
}

function formatRatePerHour(value) {
  if (!Number.isFinite(value)) return "--/h";
  return `${value.toFixed(1)}%/h`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--%";
  return `${value.toFixed(1)}%`;
}

function formatProjectedBalance(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 0) return `sobra ${value.toFixed(1)}%`;
  return `falta ${Math.abs(value).toFixed(1)}%`;
}

function formatDifference(value) {
  if (!Number.isFinite(value)) return "--/d";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%/d`;
}

function formatDays(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}d`;
}

function formatZeroIn(days) {
  if (!Number.isFinite(days) || days <= 0) return "agora";
  const totalHours = Math.floor(days * 24);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

function formatZeroInHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "agora";
  const totalMinutes = Math.floor(hours * 60);
  const days = Math.floor(totalMinutes / 1440);
  const remMinutes = totalMinutes % 1440;
  const remHours = Math.floor(remMinutes / 60);
  const minutes = remMinutes % 60;
  if (days > 0) return `${days}d ${remHours}h`;
  if (remHours > 0) return `${remHours}h ${minutes}min`;
  return `${minutes}min`;
}

function normalizeUsage(raw) {
  const json = raw && typeof raw === "object" ? raw : {};

  return {
    fiveHourPercent: clampPercent(json.fiveHourPercent, SAFE_FALLBACK.fiveHourPercent),
    fiveHourResetIsNull: json.fiveHourReset === null,
    fiveHourResetDate: json.fiveHourReset === null ? null : parseDate(json.fiveHourReset),
    weeklyPercent: clampPercent(json.weeklyPercent, SAFE_FALLBACK.weeklyPercent),
    weeklyResetDate: parseDate(json.weeklyReset),
    lastUpdatedDate: parseDate(json.lastUpdated),
    statusLabel: typeof json.statusLabel === "string" ? json.statusLabel : "",
    fiveHourSafeRate: typeof json.fiveHourSafeRate === "string" ? json.fiveHourSafeRate : "--/h",
    weeklyRemaining: typeof json.weeklyRemaining === "string" ? json.weeklyRemaining : "--",
    realDailyRate: typeof json.realDailyRate === "string" ? json.realDailyRate : "--/d",
    safeDailyRate: typeof json.safeDailyRate === "string" ? json.safeDailyRate : "--/d",
    dailyDiff: typeof json.dailyDiff === "string" ? json.dailyDiff : "--/d",
    weeklyProjection: typeof json.weeklyProjection === "string" ? json.weeklyProjection : "--%",
    zeroIn: typeof json.zeroIn === "string" ? json.zeroIn : "--",
  };
}

function setProgress(barId, textId, percent) {
  const safePercent = clampPercent(percent);
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  const progress = bar ? bar.parentElement : null;

  if (bar) {
    bar.style.width = `${safePercent}%`;
    bar.style.setProperty('--progress-width', `${safePercent}%`);
  }
  if (text) text.textContent = `${safePercent}`;
  if (progress) progress.setAttribute("aria-valuenow", String(safePercent));
}

function applyStatusState(state, statusText, statusDot) {
  const allowed = ["ok", "warn", "danger", "error"];
  for (const name of allowed) {
    statusText?.classList.remove(name);
    statusDot?.classList.remove(name);
  }
  if (allowed.includes(state)) {
    statusText?.classList.add(state);
    statusDot?.classList.add(state);
  }
}

function resolveStatus({ hasLoadError, fiveHourRemaining, weeklyRemaining, realDailyRate, safeDailyRate }) {
  if (hasLoadError) return { text: "Erro ao atualizar", state: "error" };
  if (fiveHourRemaining <= 0 || weeklyRemaining <= 0) return { text: "Limite esgotado", state: "danger" };
  if (realDailyRate > safeDailyRate) return { text: "Ritmo alto", state: "danger" };
  if (fiveHourRemaining < 20 || weeklyRemaining < 20) return { text: "Atenção ao consumo", state: "warn" };
  return { text: "Na faixa segura", state: "ok" };
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
  } catch (error) {
    const cachedRaw = localStorage.getItem(LAST_VALID_USAGE_KEY);
    if (cachedRaw) {
      try {
        const cachedUsage = normalizeUsage(JSON.parse(cachedRaw));
        return { usage: cachedUsage, hasLoadError: true };
      } catch {
        // cache inválido, segue fallback seguro
      }
    }
    if (error?.name === "AbortError") {
      return { usage: normalizeUsage(SAFE_FALLBACK), hasLoadError: true };
    }
    return { usage: normalizeUsage(SAFE_FALLBACK), hasLoadError: true };
  } finally {
    activeUsageController = null;
  }
}

function saveLastValidPayload(usage) {
  const signature = [
    usage.fiveHourPercent,
    usage.fiveHourResetDate?.toISOString() || "null",
    usage.weeklyPercent,
    usage.weeklyResetDate?.toISOString() || "null",
    usage.lastUpdatedDate?.toISOString() || "null",
  ].join("|");
  if (signature === lastUsageSignature) return;
  lastUsageSignature = signature;
  localStorage.setItem("codex-last-valid-usage-signature", signature);
  localStorage.setItem(
    LAST_VALID_USAGE_KEY,
    JSON.stringify({
      fiveHourPercent: usage.fiveHourPercent,
      fiveHourReset: usage.fiveHourResetDate?.toISOString() || null,
      weeklyPercent: usage.weeklyPercent,
      weeklyReset: usage.weeklyResetDate?.toISOString() || null,
      lastUpdated: usage.lastUpdatedDate?.toISOString() || null,
    }),
  );
}

function resetTextFromDate(date) {
  if (!date) return "--";
  return `${formatDateTimePtBr(date)} (${formatRemainingTime(date)})`;
}

function formatUsagePercent(remainingPercent) {
  const remaining = clampPercent(remainingPercent, null);
  if (remaining === null) return "--% de --%";
  const used = Math.max(0, Math.min(100, Math.round(100 - remaining)));
  return `${used}% de 100%`;
}

function usageLevel(remainingPercent) {
  const remaining = clampPercent(remainingPercent, null);
  if (remaining === null) return "warn";
  if (remaining >= 95) return "safe";
  if (remaining >= 70) return "ok";
  if (remaining >= 40) return "warn";
  return "danger";
}

function usageTone(remainingPercent) {
  const remaining = clampPercent(remainingPercent, null);
  if (remaining === null) return { label: "sem dado", state: "warn" };
  if (remaining <= 10) return { label: "crítico", state: "danger" };
  if (remaining <= 20) return { label: "muito alto", state: "danger" };
  if (remaining <= 40) return { label: "alto", state: "warn" };
  if (remaining <= 70) return { label: "moderado", state: "ok" };
  return { label: "seguro", state: "safe" };
}

function usageBand(realDailyRate, safeDailyRate) {
  if (!Number.isFinite(realDailyRate) || !Number.isFinite(safeDailyRate) || safeDailyRate <= 0) {
    return { label: "sem dado", state: "warn" };
  }
  if (realDailyRate > safeDailyRate * 1.15) return { label: "acima", state: "danger" };
  if (realDailyRate < safeDailyRate * 0.7) return { label: "abaixo", state: "safe" };
  return { label: "na faixa", state: "ok" };
}

function buildUsageAdvice({
  weeklyRemaining,
  weeklyDaysRemaining,
  fiveHourRemaining,
  realDailyRate,
  safeDailyRate,
  safePerWindow,
  windowsRemaining,
  projectedRemaining,
}) {
  const weekly = clampPercent(weeklyRemaining, null);
  const fiveHour = clampPercent(fiveHourRemaining, null);
  if (weekly === null || fiveHour === null) return "aguarde os dados";
  if (Number.isFinite(realDailyRate) && Number.isFinite(safeDailyRate) && realDailyRate > safeDailyRate * 1.15) {
    return "desacelere para chegar ate a renovacao";
  }
  if (weekly <= 15 || fiveHour <= 15) return "use so o essencial agora";
  if (Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining <= 2 && Number.isFinite(safePerWindow) && Number.isFinite(windowsRemaining) && weekly > 0) {
    return `use ate ${safePerWindow.toFixed(1)}% por janela nas ${windowsRemaining} janelas restantes`;
  }
  if (weekly <= 25 && fiveHour <= 40) return "espere a janela de 5h renovar";
  if (Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining <= 1) {
    return weekly > 30 ? "gaste em blocos curtos hoje" : "deve sobrar pouco ate o reset";
  }
  if (Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining <= 2) {
    return weekly > 45 ? "segure hoje para nao estourar cedo" : "aproveite em ciclos curtos";
  }
  if (Number.isFinite(projectedRemaining) && projectedRemaining > 15) {
    return `ha folga; ${safePerWindow.toFixed(1)}% por janela aproveita melhor o saldo`;
  }
  if (weekly > 70) return "pode usar com folga";
  if (weekly > 40 && fiveHour > 45) return "mantenha o ritmo atual";
  return "segure o uso para durar ate o fim";
}

function buildZeroMessage(weeklyRemaining, realDailyRate, weeklyDaysRemaining) {
  const remaining = clampPercent(weeklyRemaining, null);
  if (remaining === null || !Number.isFinite(realDailyRate) || realDailyRate <= 0) return "--";
  const daysToZero = remaining / realDailyRate;
  if (Number.isFinite(weeklyDaysRemaining) && daysToZero > weeklyDaysRemaining) {
    return "nao zera antes do reset";
  }
  return formatZeroIn(daysToZero);
}

function buildLiveSummary(usage) {
  const now = Date.now();
  const fiveHourRemaining = usage.fiveHourResetIsNull ? 100 : clampPercent(usage.fiveHourPercent, 100);
  const fiveHourUsed = clampPercent(100 - fiveHourRemaining);
  const weeklyRemaining = clampPercent(usage.weeklyPercent, 100);
  const weeklyUsed = clampPercent(100 - weeklyRemaining);

  const fiveHourMs = usage.fiveHourResetDate ? usage.fiveHourResetDate.getTime() - now : NaN;
  const weeklyMs = usage.weeklyResetDate ? usage.weeklyResetDate.getTime() - now : NaN;
  const weeklyDaysRemaining = Number.isFinite(weeklyMs) ? Math.max(0, weeklyMs / 86400000) : NaN;
  const weeklyCycleStart = usage.weeklyResetDate ? new Date(usage.weeklyResetDate.getTime() - WEEK_WINDOW_MS) : null;
  const elapsedMs = weeklyCycleStart ? Math.max(0, Math.min(WEEK_WINDOW_MS, now - weeklyCycleStart.getTime())) : NaN;
  const elapsedDays = Number.isFinite(elapsedMs) ? Math.max(1 / 24, elapsedMs / 86400000) : NaN;
  const fiveHourCycleStart = usage.fiveHourResetDate ? new Date(usage.fiveHourResetDate.getTime() - FIVE_HOUR_WINDOW_MS) : null;
  const fiveHourElapsedMs = fiveHourCycleStart ? Math.max(0, Math.min(FIVE_HOUR_WINDOW_MS, now - fiveHourCycleStart.getTime())) : NaN;
  const fiveHourElapsedHours = Number.isFinite(fiveHourElapsedMs) ? Math.max(1 / 60, fiveHourElapsedMs / 3600000) : NaN;
  const weeklyWindowsElapsed = Number.isFinite(elapsedMs) ? Math.max(1 / 12, elapsedMs / FIVE_HOUR_WINDOW_MS) : NaN;
  const weeklyWindowsRemaining = Number.isFinite(weeklyMs) ? Math.max(1, Math.ceil(weeklyMs / FIVE_HOUR_WINDOW_MS)) : NaN;
  const realDailyRate = Number.isFinite(elapsedDays) ? weeklyUsed / elapsedDays : NaN;
  const safeDailyRate = Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining > 0 ? weeklyRemaining / weeklyDaysRemaining : 0;
  const weeklyRatePerWindow = Number.isFinite(weeklyWindowsElapsed) ? weeklyUsed / weeklyWindowsElapsed : NaN;
  const safePerWindow = Number.isFinite(weeklyWindowsRemaining) ? weeklyRemaining / weeklyWindowsRemaining : NaN;
  const projectedRemaining = Number.isFinite(weeklyRatePerWindow) && Number.isFinite(weeklyWindowsRemaining)
    ? weeklyRemaining - (weeklyRatePerWindow * weeklyWindowsRemaining)
    : NaN;
  const zeroInWindows = Number.isFinite(weeklyRatePerWindow) && weeklyRatePerWindow > 0 ? weeklyRemaining / weeklyRatePerWindow : NaN;
  const zeroInDays = Number.isFinite(zeroInWindows) ? (zeroInWindows * 5) / 24 : NaN;
  const fiveHourHourlyRate = Number.isFinite(fiveHourElapsedHours) ? fiveHourUsed / fiveHourElapsedHours : NaN;
  const fiveHourZeroHours = Number.isFinite(fiveHourHourlyRate) && fiveHourHourlyRate > 0 ? fiveHourRemaining / fiveHourHourlyRate : NaN;
  const usageBandState = usageBand(weeklyRatePerWindow, safePerWindow);

  return {
    now,
    fiveHourRemaining,
    fiveHourUsed,
    weeklyRemaining,
    weeklyUsed,
    fiveHourMs,
    weeklyMs,
    weeklyDaysRemaining,
    weeklyWindowsRemaining,
    realDailyRate,
    safeDailyRate,
    weeklyRatePerWindow,
    safePerWindow,
    projectedRemaining,
    zeroInDays,
    fiveHourHourlyRate,
    fiveHourZeroHours,
    usageBandState,
  };
}

/* ===== Haptic Feedback ===== */
function triggerHaptic(duration = 10) {
  if (window.navigator && window.navigator.vibrate) {
    window.navigator.vibrate(duration);
  }
}

/* ===== Mobile Interaction Enhancement ===== */
function enhanceMobileInteraction() {
  const interactiveElements = document.querySelectorAll('.icon-button, .button');
  
  interactiveElements.forEach(el => {
    el.addEventListener('touchstart', function(e) {
      triggerHaptic(10);
      this.style.transform = 'scale(0.95)';
    }, { passive: true });
    
    el.addEventListener('touchend', function() {
      this.style.transform = '';
    }, { passive: true });
  });
}

/* ===== Notification Support ===== */
function requestNotificationPermission() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    localStorage.setItem('notificationsEnabled', 'true');
    return;
  }

  // Não solicitar se já foi negado
  if (Notification.permission === 'denied') {
    localStorage.setItem('notificationsEnabled', 'false');
    return;
  }

  // Solicitar permissão de forma contextual (não intrusiva)
  // Apenas quando o usuário já está interagindo com a página
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        localStorage.setItem('notificationsEnabled', 'true');
        console.log('✅ Notificações ativadas');
      } else {
        localStorage.setItem('notificationsEnabled', 'false');
      }
    }).catch(() => {
      localStorage.setItem('notificationsEnabled', 'false');
    });
  }
}

function getNotificationThresholds(remaining, kind) {
  const value = clampPercent(remaining, null);
  if (value === null) return [];

  const thresholds = kind === "fiveHour" ? [50, 20] : [80, 60, 40, 20];
  return thresholds.filter((threshold) => value <= threshold);
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
  } catch (error) {
    console.warn("⚠️ Falha ao enviar notificação:", error);
    return false;
  }
}

function daysUntil(date) {
  if (!date) return NaN;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentUsageSnapshot(usage) {
  return {
    fiveHourPercent: clampPercent(usage.fiveHourPercent, null),
    weeklyPercent: clampPercent(usage.weeklyPercent, null),
    fiveHourReset: usage.fiveHourResetDate?.toISOString() || null,
    weeklyReset: usage.weeklyResetDate?.toISOString() || null,
    lastUpdated: usage.lastUpdatedDate?.toISOString() || null,
  };
}

function maybeNotifyThresholds(usage, state) {
  const fiveHour = clampPercent(usage.fiveHourPercent, null);
  const weekly = clampPercent(usage.weeklyPercent, null);
  if (fiveHour === null || weekly === null) return;

  for (const threshold of getNotificationThresholds(weekly, "weekly")) {
    const key = `weekly-threshold-${threshold}`;
    if (state[key]) continue;
    if (sendNotification("Codex semanal", `Limite semanal em ${weekly}%.`, key)) state[key] = true;
  }

  for (const threshold of getNotificationThresholds(fiveHour, "fiveHour")) {
    const key = `fiveHour-threshold-${threshold}`;
    if (state[key]) continue;
    if (sendNotification("Codex 5 horas", `Limite de 5 horas em ${fiveHour}%.`, key)) state[key] = true;
  }
}

function maybeNotifyRenewals(usage, state, previous) {
  const fiveHour = clampPercent(usage.fiveHourPercent, null);
  const weekly = clampPercent(usage.weeklyPercent, null);
  const currentFiveReset = usage.fiveHourResetDate?.toISOString() || null;
  const currentWeeklyReset = usage.weeklyResetDate?.toISOString() || null;

  if (previous.fiveHourReset && currentFiveReset && previous.fiveHourReset !== currentFiveReset && fiveHour !== null && fiveHour < 100) {
    state.lastFiveReset = currentFiveReset;
    sendNotification("Codex 5 horas", `Data de renovação alterada para ${formatDateTimePtBr(usage.fiveHourResetDate)}.`, "five-hour-reset-changed");
  }
  if (previous.weeklyReset && currentWeeklyReset && previous.weeklyReset !== currentWeeklyReset && weekly !== null && weekly < 100) {
    state.lastWeeklyReset = currentWeeklyReset;
    sendNotification("Codex semanal", `Data de renovação alterada para ${formatDateTimePtBr(usage.weeklyResetDate)}.`, "weekly-reset-changed");
  }

  if (previous.fiveHourPercent !== null && previous.fiveHourPercent < 100 && fiveHour === 100) {
    sendNotification("Codex 5 horas", "Limite de 5 horas renovado.", "five-hour-renewed");
    state.lastFiveHourRenewal = Date.now();
  }

  if (previous.weeklyPercent !== null && previous.weeklyPercent < 100 && weekly === 100) {
    sendNotification("Codex semanal", "Limite semanal renovado.", "weekly-renewed");
    state.lastWeeklyRenewal = Date.now();
  }
}

function maybeNotifyDailySummary(usage, state) {
  const now = new Date();
  if (now.getHours() !== 9) return;
  const todayKey = localDateKey(now);
  if (state.dailySummaryDate === todayKey) return;

  const fiveHourDays = daysUntil(usage.fiveHourResetDate);
  const weeklyDays = daysUntil(usage.weeklyResetDate);
  const weekly = clampPercent(usage.weeklyPercent, null);
  const fiveHour = clampPercent(usage.fiveHourPercent, null);

  const lines = [
    `5h: ${formatUsagePercent(usage.fiveHourPercent)} · renova ${resetTextFromDate(usage.fiveHourResetDate)}`,
    `Semanal: ${formatUsagePercent(usage.weeklyPercent)} · renova ${resetTextFromDate(usage.weeklyResetDate)}`,
  ];

  const dayAlerts = [];
  const weeklyRules = [
    { days: 0, limit: 15 },
    { days: 1, limit: 30 },
    { days: 2, limit: 45 },
    { days: 3, limit: 60 },
    { days: 4, limit: 75 },
    { days: 5, limit: 90 },
  ];

  for (const rule of weeklyRules) {
    if (weeklyDays === rule.days && weekly !== null && weekly > rule.limit) {
      dayAlerts.push(`Semanal perto da renovação: uso em ${weekly}%, limite de alerta ${rule.limit}% com ${rule.days}d.`);
    }
  }

  const fiveHourRules = [
    { days: 0, limit: 15 },
    { days: 1, limit: 30 },
    { days: 2, limit: 45 },
    { days: 3, limit: 60 },
    { days: 4, limit: 75 },
    { days: 5, limit: 90 },
  ];
  for (const rule of fiveHourRules) {
    if (fiveHourDays === rule.days && fiveHour !== null && fiveHour > rule.limit) {
      dayAlerts.push(`5h perto da renovação: uso em ${fiveHour}%, limite de alerta ${rule.limit}% com ${rule.days}d.`);
    }
  }

  const body = [...lines, ...dayAlerts].join(" | ");
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


let chartInstance = null;

function renderUsageChart(weeklyUsed, weeklyRemaining) {
  const canvas = document.getElementById("usageChart");
  if (!canvas) return;

  // Fallback textual se Chart.js não carregar
  if (typeof window.Chart === "undefined") {
    const fallback = document.createElement("div");
    fallback.className = "chart-fallback";
    fallback.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
        <p style="font-size: 1.125rem; margin-bottom: 1rem;">📊 Gráfico indisponível</p>
        <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
          <div>
            <div style="font-size: 2rem; font-weight: 700; color: #ef4444;">${Math.round(weeklyUsed)}%</div>
            <div style="font-size: 0.875rem;">Usado</div>
          </div>
          <div>
            <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">${Math.round(weeklyRemaining)}%</div>
            <div style="font-size: 0.875rem;">Restante</div>
          </div>
        </div>
      </div>
    `;
    canvas.parentElement.replaceChild(fallback, canvas);
    return;
  }

  // Destruir instância anterior para evitar duplicação
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const data = [
    Math.max(0, Math.min(100, weeklyUsed)),
    Math.max(0, Math.min(100, weeklyRemaining))
  ];

  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#3b82f6";
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || (isDark ? "#cbd5e1" : "#64748b");

  chartInstance = new window.Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Usado", "Restante"],
      datasets: [{
        data,
        backgroundColor: ["#ef4444", primaryColor],
        borderWidth: 4,
        borderColor: isDark ? "#0b1120" : "#eef2f7",
        hoverOffset: 12,
        hoverBorderWidth: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: textColor,
            font: {
              size: 13,
              weight: "600",
              family: "'Inter', -apple-system, sans-serif",
            },
            padding: 16,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        tooltip: {
          backgroundColor: isDark ? "rgba(30, 41, 59, 0.95)" : "rgba(255, 255, 255, 0.95)",
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: isDark ? "#334155" : "#e2e8f0",
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          bodyFont: {
            size: 14,
            weight: "600",
          },
          callbacks: {
            label: function(context) {
              const label = context.label || "";
              const value = context.parsed || 0;
              return `${label}: ${value.toFixed(1)}%`;
            }
          }
        },
      },
    },
  });
}

function renderAntigravity(antigravity, hasLoadError, els) {
  const models = antigravity.models.slice(0, 8);
  const criticalCount = models.filter((model) => ["empty", "low"].includes(model.status)).length;

  els.antigravityUpdatedAt.textContent = antigravity.lastUpdatedDate
    ? `Atualizado ${formatDateTimePtBr(antigravity.lastUpdatedDate)}`
    : "Sem atualização";

  if (hasLoadError) {
    els.antigravitySummary.textContent = "Sem dados locais do Antigravity. Rode a automação desktop para publicar o JSON.";
  } else if (models.length === 0) {
    els.antigravitySummary.textContent = "Nenhum modelo publicado ainda.";
  } else if (criticalCount > 0) {
    els.antigravitySummary.textContent = `${criticalCount} modelo(s) pedem atenção.`;
  } else {
    els.antigravitySummary.textContent = `${models.length} modelo(s) dentro da margem segura.`;
  }

  els.antigravityModels.replaceChildren();
  if (models.length === 0) {
    const empty = document.createElement("p");
    empty.className = "antigravity-empty";
    empty.textContent = "O arquivo antigravity_usage.json existe para receber a primeira captura.";
    els.antigravityModels.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const model of models) {
    const item = document.createElement("div");
    item.className = `antigravity-model is-${model.status}`;

    const header = document.createElement("div");
    header.className = "antigravity-model-header";

    // Adicionar logo do modelo
    const logo = document.createElement("img");
    logo.className = "antigravity-model-logo";
    logo.alt = model.name;
    logo.loading = "lazy";

    // Mapear logos baseado no nome do modelo
    if (model.name.toLowerCase().includes("gemini")) {
      logo.src = "https://i.imgur.com/5YrjiRD.png";
    } else if (model.name.toLowerCase().includes("claude")) {
      logo.src = "https://i.imgur.com/WKSOEc8.png";
    } else if (model.name.toLowerCase().includes("gpt") || model.name.toLowerCase().includes("codex")) {
      logo.src = "https://i.imgur.com/qBlxQ5P.png";
    } else {
      logo.src = "https://i.imgur.com/qBlxQ5P.png";
    }

    // Fallback para imagem quebrada
    logo.onerror = () => {
      logo.src = "https://i.imgur.com/qBlxQ5P.png";
    };

    const name = document.createElement("span");
    name.className = "antigravity-model-name";
    name.textContent = model.name;

    const percent = document.createElement("span");
    percent.className = "antigravity-percent";
    percent.textContent = Number.isFinite(model.remainingPercent) ? `${Math.round(model.remainingPercent)}%` : "--";

    header.append(logo, name, percent);

    const meta = document.createElement("div");
    meta.className = "antigravity-model-meta";
    const refreshLabel = model.refreshDate ? resetTextFromDate(model.refreshDate) : model.refreshText || "Refresh não informado";
    meta.textContent = [model.tier, refreshLabel].filter(Boolean).join(" · ");

    const bar = document.createElement("div");
    bar.className = "antigravity-progress";
    const fill = document.createElement("div");
    fill.className = "antigravity-progress-fill";
    fill.style.width = `${Number.isFinite(model.remainingPercent) ? clampPercent(model.remainingPercent) : 0}%`;
    bar.append(fill);

    item.append(header, meta, bar);
    fragment.append(item);
  }

  els.antigravityModels.append(fragment);
}

/* ===== Main Init Function ===== */
(async function init() {
  document.querySelectorAll(".rhythm-value, .insight-value").forEach((el) => el.classList.add("is-loading"));
  const { usage, hasLoadError } = await loadUsage();

  const els = {
    themeColorInput: document.getElementById("themeColorInput"),
    refreshButton: document.getElementById("refreshButton"),
    statusText: document.getElementById("statusText"),
    statusDot: document.getElementById("statusDot"),
    updatedAtText: document.getElementById("updatedAtText"),
    fiveHourPercent: document.getElementById("fiveHourPercent"),
    fiveHourBar: document.getElementById("fiveHourBar"),
    fiveHourLine: document.getElementById("fiveHourLine"),
    fiveHourUsed: document.getElementById("fiveHourUsed"),
    fiveHourAverage: document.getElementById("fiveHourAverage"),
    fiveHourZeroAt: document.getElementById("fiveHourZeroAt"),
    fiveHourSafeRate: document.getElementById("fiveHourSafeRate"),
    weeklyPercent: document.getElementById("weeklyPercent"),
    weeklyBar: document.getElementById("weeklyBar"),
    weeklyLine: document.getElementById("weeklyLine"),
    weeklyUsed: document.getElementById("weeklyUsed"),
    weeklyRemainingDays: document.getElementById("weeklyRemainingDays"),
    weeklyAverage: document.getElementById("weeklyAverage"),
    weeklySafeRate: document.getElementById("weeklySafeRate"),
    weeklyProjection: document.getElementById("weeklyProjection"),
    weeklyZeroAt: document.getElementById("weeklyZeroAt"),
    usageTrend: document.getElementById("usageTrend"),
    usageAdvice: document.getElementById("usageAdvice"),
  };

  const initialSummary = buildLiveSummary(usage);
  let {
    fiveHourRemaining,
    weeklyRemaining,
    realDailyRate,
    safeDailyRate,
    usageBandState,
  } = initialSummary;
  document.documentElement.dataset.usageTone = usageBandState.state;
  document.documentElement.dataset.fiveHourTone = usageLevel(fiveHourRemaining);
  document.documentElement.dataset.weeklyTone = usageLevel(weeklyRemaining);

  const renderLiveSummary = () => {
    const summary = buildLiveSummary(usage);
    ({
      fiveHourRemaining,
      weeklyRemaining,
      realDailyRate,
      safeDailyRate,
      usageBandState,
    } = summary);
    document.documentElement.dataset.usageTone = usageBandState.state;
    document.documentElement.dataset.fiveHourTone = usageLevel(fiveHourRemaining);
    document.documentElement.dataset.weeklyTone = usageLevel(weeklyRemaining);

    setProgress("fiveHourBar", "fiveHourPercent", summary.fiveHourRemaining);
    setProgress("weeklyBar", "weeklyPercent", summary.weeklyRemaining);
    els.updatedAtText.textContent = usage.lastUpdatedDate ? formatDateTimePtBr(usage.lastUpdatedDate) : "--";
    els.fiveHourUsed.textContent = formatUsagePercent(summary.fiveHourRemaining);
    els.fiveHourAverage.textContent = formatRatePerHour(summary.fiveHourHourlyRate);
    els.fiveHourZeroAt.textContent = Number.isFinite(summary.fiveHourZeroHours)
      ? (Number.isFinite(summary.fiveHourMs) && summary.fiveHourZeroHours > (summary.fiveHourMs / 3600000) ? "apos redefinicao" : formatZeroInHours(summary.fiveHourZeroHours))
      : "--";
    els.weeklyUsed.textContent = formatUsagePercent(summary.weeklyRemaining);
    els.weeklyRemainingDays.textContent = formatDurationMs(summary.weeklyMs);
    els.weeklyAverage.textContent = formatPercent(summary.weeklyRatePerWindow);
    els.weeklySafeRate.textContent = formatPercent(summary.safePerWindow);
    els.weeklyProjection.textContent = formatProjectedBalance(summary.projectedRemaining);
    els.usageTrend.textContent = usageBandState.label;
    els.usageAdvice.textContent = buildUsageAdvice({
      weeklyRemaining: summary.weeklyRemaining,
      weeklyDaysRemaining: summary.weeklyDaysRemaining,
      fiveHourRemaining: summary.fiveHourRemaining,
      realDailyRate: summary.realDailyRate,
      safeDailyRate: summary.safeDailyRate,
      safePerWindow: summary.safePerWindow,
      windowsRemaining: summary.weeklyWindowsRemaining,
      projectedRemaining: summary.projectedRemaining,
    });

    els.weeklyLine.textContent = usage.weeklyResetDate
      ? `redefine em ${formatDurationMs(summary.weeklyMs)} · ${formatDateTimePtBr(usage.weeklyResetDate)}`
      : "--";

    if (usage.fiveHourResetIsNull && summary.fiveHourRemaining === 100) {
      els.fiveHourLine.textContent = "Cheio · sem ciclo ativo";
      els.fiveHourUsed.textContent = "0% de 100%";
      els.fiveHourSafeRate.textContent = "0%/h";
    } else {
      els.fiveHourLine.textContent = usage.fiveHourResetDate
        ? `redefine em ${formatDurationMs(summary.fiveHourMs)} · ${formatDateTimePtBr(usage.fiveHourResetDate)}`
        : "--";
      els.fiveHourSafeRate.textContent = formatRatePerHour(summary.fiveHourHourlyRate);
    }

    if (Number.isFinite(summary.zeroInDays) && summary.zeroInDays > 0) {
      els.weeklyZeroAt.textContent = summary.zeroInDays > summary.weeklyDaysRemaining ? "apos redefinicao" : formatZeroIn(summary.zeroInDays);
    } else {
      els.weeklyZeroAt.textContent = "--";
    }

    document.querySelectorAll(".rhythm-value, .insight-value").forEach((el) => el.classList.remove("is-loading"));
  };

  requestAnimationFrame(renderLiveSummary);

  const status = resolveStatus({
    hasLoadError,
    fiveHourRemaining,
    weeklyRemaining,
    realDailyRate,
    safeDailyRate,
  });
  els.statusText.textContent = status.text;
  applyStatusState(status.state, els.statusText, els.statusDot);
  if (!hasLoadError) saveLastValidPayload(usage);
  syncNotifications(usage);
  setInterval(renderLiveSummary, 1000);

  function updateNotificationButton() {
    const enabled = localStorage.getItem("notificationsEnabled") === "true";
    const permission = "Notification" in window ? Notification.permission : "denied";

    if (notificationButton) {
      notificationButton.setAttribute("aria-pressed", String(enabled && permission === "granted"));
      notificationButton.classList.toggle("is-enabled", enabled && permission === "granted");

      if (permission === "denied") {
        notificationButton.title = "Notificações bloqueadas pelo navegador";
      } else if (enabled && permission === "granted") {
        notificationButton.title = "Notificações ativadas";
      } else {
        notificationButton.title = "Ativar notificações";
      }
    }
  }

  const notificationButton = document.getElementById("notificationButton");
  updateNotificationButton();

  // Resetar flags de notificação se os limites voltarem a valores altos
  if (fiveHourRemaining > 50 && weeklyRemaining > 50) {
    resetNotificationFlags();
  }

  /* ===== Event Listeners ===== */
  els.themeColorInput?.addEventListener("input", (event) => {
    const value = event?.target?.value;
    if (typeof value === "string") {
      const contrastCheck = validateColorContrast(value);

      if (!contrastCheck.isValid) {
        const statusText = document.getElementById("statusText");
        const originalText = statusText?.textContent;
        if (statusText) {
          statusText.textContent = `⚠️ Contraste baixo: ${contrastCheck.ratio}:1 (mín: ${contrastCheck.minRequired}:1)`;
          setTimeout(() => {
            if (statusText.textContent.includes("Contraste baixo")) {
              statusText.textContent = originalText || "Online";
            }
          }, 3000);
        }
      }

      setThemeColor(value);
    }
  });

  notificationButton?.addEventListener("click", () => {
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
      updateNotificationButton();
    } else {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          localStorage.setItem("notificationsEnabled", "true");
          updateNotificationButton();
          sendNotification("Notificações ativadas", "Você será alertado sobre limites, renovações e mudanças de ciclo.", "notification-test");
        } else {
          localStorage.setItem("notificationsEnabled", "false");
          updateNotificationButton();
        }
      });
    }
  });

  els.refreshButton?.addEventListener("click", () => {
    triggerHaptic(20);
    els.refreshButton.classList.remove("spinning");
    void els.refreshButton.offsetWidth;
    els.refreshButton.classList.add("spinning");
    setTimeout(() => {
      location.reload();
    }, 160);
  });

  enhanceMobileInteraction();
  requestNotificationPermission();
  setInterval(() => syncNotifications(usage), 5 * 60 * 1000);
})();

/* ===== Service Worker Registration ===== */
if ('serviceWorker' in navigator) {
  const isSecureContext = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker falhou, não quebra a app
    });
  }
}

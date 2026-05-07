const SAFE_FALLBACK = {
  fiveHourPercent: 100,
  fiveHourReset: null,
  weeklyPercent: 100,
  weeklyReset: null,
  lastUpdated: null,
};

const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;


const LAST_VALID_PAYLOAD_KEY = "codex_usage_last_valid_v1";

function saveLastValidPayload(raw) {
  try {
    localStorage.setItem(LAST_VALID_PAYLOAD_KEY, JSON.stringify(raw));
  } catch {}
}

function loadLastValidPayload() {
  try {
    const raw = localStorage.getItem(LAST_VALID_PAYLOAD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const THEME_KEY = "codex-theme";
const THEME_COLOR_KEY = "codex-theme-color";
const DEFAULT_THEME_COLOR = "#3b82f6";

function setThemeColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
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
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "light" ? "light" : "dark");
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

window.addEventListener('resize', adjustViewportHeight);
window.addEventListener('orientationchange', adjustViewportHeight);
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

function normalizeUsage(raw) {
  const json = raw && typeof raw === "object" ? raw : {};

  return {
    fiveHourPercent: clampPercent(json.fiveHourPercent, SAFE_FALLBACK.fiveHourPercent),
    fiveHourResetIsNull: json.fiveHourReset === null,
    fiveHourResetDate: json.fiveHourReset === null ? null : parseDate(json.fiveHourReset),
    weeklyPercent: clampPercent(json.weeklyPercent, SAFE_FALLBACK.weeklyPercent),
    weeklyResetDate: parseDate(json.weeklyReset),
    lastUpdatedDate: parseDate(json.lastUpdated),
  };
}

function resolveProgressGradient(percent) {
  const p = clampPercent(percent);

  if (p <= 25) return "linear-gradient(90deg, #ef4444 0%, #dc2626 100%)";
  if (p <= 50) return "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)";

  const blueCap = Math.max(8, Math.min(18, 100 - p + 8));
  const split = Math.max(0, 100 - blueCap);
  return `linear-gradient(90deg, #22c55e 0%, #22c55e ${split}%, #60a5fa 100%)`;
}

function setProgress(barId, textId, percent) {
  const safePercent = clampPercent(percent);
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  const progress = bar ? bar.parentElement : null;

  if (bar) {
    bar.style.width = `${safePercent}%`;
    bar.style.setProperty('--progress-width', `${safePercent}%`);
    bar.style.background = resolveProgressGradient(safePercent);
  }
  if (text) text.textContent = `${safePercent}%`;
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
  if (hasLoadError) return { text: "erro ao atualizar", state: "error" };
  if (fiveHourRemaining <= 0 || weeklyRemaining <= 0) return { text: "limite esgotado", state: "danger" };
  if (realDailyRate > safeDailyRate) return { text: "ritmo alto", state: "danger" };
  if (fiveHourRemaining < 20 || weeklyRemaining < 20) return { text: "atenção ao consumo", state: "warn" };
  return { text: "dentro do seguro", state: "ok" };
}

async function loadUsage() {
  const sources = [
    `/api/usage?t=${Date.now()}`,
    `./codex_usage.json?t=${Date.now()}`,
  ];

  for (const url of sources) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;

      const json = await response.json();
      saveLastValidPayload(json);
      return { usage: normalizeUsage(json), hasLoadError: false, source: "live" };
    } catch {
      // tenta a próxima fonte
    }
  }

  const cached = loadLastValidPayload();
  if (cached) return { usage: normalizeUsage(cached), hasLoadError: true, source: "cache" };
  return { usage: normalizeUsage(SAFE_FALLBACK), hasLoadError: true, source: "fallback" };
}

function resetTextFromDate(date) {
  if (!date) return "--";
  return `${formatDateTimePtBr(date)} (${formatRemainingTime(date)})`;
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
    return;
  }
  
  if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        localStorage.setItem('notificationsEnabled', 'true');
      }
    }).catch(() => {
      // Notificações não suportadas
    });
  }
}

function getNotificationThreshold(remaining) {
  if (remaining <= 5) return 5;
  if (remaining <= 10) return 10;
  if (remaining <= 20) return 20;
  return null;
}

function checkAndNotify(status, fiveHourRemaining, weeklyRemaining) {
  if (localStorage.getItem('notificationsEnabled') !== 'true') return;

  const threshold = Math.min(
    getNotificationThreshold(fiveHourRemaining) ?? 100,
    getNotificationThreshold(weeklyRemaining) ?? 100,
  );

  if (threshold === 100) return;

  const key = `codex-notified-threshold-${threshold}`;
  if (localStorage.getItem(key) === 'true') return;

  try {
    new Notification('⚠️ Limite baixo', {
      body: `Seu limite atingiu ${threshold}% ou menos.`,
      icon: '/webapp/assets/logo.png',
      tag: `codex-threshold-${threshold}`,
    });
    localStorage.setItem(key, 'true');
  } catch (e) {
    // Notificações falharam
  }
}


function renderUsageChart(weeklyUsed, weeklyRemaining) {
  const canvas = document.getElementById("usageChart");
  if (!canvas || typeof window.Chart === "undefined") return;

  const data = [Math.max(0, Math.min(100, weeklyUsed)), Math.max(0, Math.min(100, weeklyRemaining))];
  new window.Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Usado", "Restante"],
      datasets: [{
        data,
        backgroundColor: ["#ef4444", getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#3b82f6"],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || "#cbd5e1",
          },
        },
      },
    },
  });
}

/* ===== Main Init Function ===== */
(async function init() {
  const { usage, hasLoadError, source } = await loadUsage();
  const els = {
    themeToggleButton: document.getElementById("themeToggleButton"),
    themeColorButton: document.getElementById("themeColorButton"),
    themeColorInput: document.getElementById("themeColorInput"),
    refreshButton: document.getElementById("refreshButton"),
    shareButton: document.getElementById("shareButton"),
    closeButton: document.getElementById("closeButton"),
    statusText: document.getElementById("statusText"),
    statusDot: document.getElementById("statusDot"),
    updatedAtText: document.getElementById("updatedAtText"),
    fiveHourPercent: document.getElementById("fiveHourPercent"),
    fiveHourBar: document.getElementById("fiveHourBar"),
    fiveHourLine: document.getElementById("fiveHourLine"),
    fiveHourUsed: document.getElementById("fiveHourUsed"),
    fiveHourSafeRate: document.getElementById("fiveHourSafeRate"),
    weeklyPercent: document.getElementById("weeklyPercent"),
    weeklyBar: document.getElementById("weeklyBar"),
    weeklyLine: document.getElementById("weeklyLine"),
    weeklyUsed: document.getElementById("weeklyUsed"),
    weeklyRemainingDays: document.getElementById("weeklyRemainingDays"),
    weeklyAverage: document.getElementById("weeklyAverage"),
    weeklySafeRate: document.getElementById("weeklySafeRate"),
    weeklyDifference: document.getElementById("weeklyDifference"),
    weeklyDifferenceTrend: document.getElementById("weeklyDifferenceTrend"),
    weeklyDeltaSinceLast: document.getElementById("weeklyDeltaSinceLast"),
    confidenceHint: document.getElementById("confidenceHint"),
    weeklyProjection: document.getElementById("weeklyProjection"),
    weeklyZeroAt: document.getElementById("weeklyZeroAt"),
    weeklyCycleStart: document.getElementById("weeklyCycleStart"),
  };

  const now = Date.now();
  const fiveHourRemaining = usage.fiveHourResetIsNull ? 100 : clampPercent(usage.fiveHourPercent, 100);
  const fiveHourUsed = clampPercent(100 - fiveHourRemaining);
  const weeklyRemaining = clampPercent(usage.weeklyPercent, 100);
  const weeklyUsed = clampPercent(100 - weeklyRemaining);

  const fiveHourMs = usage.fiveHourResetDate ? usage.fiveHourResetDate.getTime() - now : NaN;
  const weeklyMs = usage.weeklyResetDate ? usage.weeklyResetDate.getTime() - now : NaN;
  const weeklyDaysRemaining = Number.isFinite(weeklyMs) ? Math.max(0, weeklyMs / (24 * 60 * 60 * 1000)) : NaN;
  const weeklyCycleStart = usage.weeklyResetDate ? new Date(usage.weeklyResetDate.getTime() - WEEK_WINDOW_MS) : null;
  const elapsedMs = weeklyCycleStart ? Math.max(0, Math.min(WEEK_WINDOW_MS, now - weeklyCycleStart.getTime())) : NaN;
  const elapsedDays = Number.isFinite(elapsedMs) ? Math.max(1 / 24, elapsedMs / (24 * 60 * 60 * 1000)) : NaN;
  const realDailyRate = Number.isFinite(elapsedDays) ? weeklyUsed / elapsedDays : NaN;
  const safeDailyRate = Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining > 0 ? weeklyRemaining / weeklyDaysRemaining : 0;
  const dailyDiff = Number.isFinite(realDailyRate) && Number.isFinite(safeDailyRate) ? realDailyRate - safeDailyRate : NaN;
  const projectedRemaining = Number.isFinite(realDailyRate) && Number.isFinite(weeklyDaysRemaining)
    ? weeklyRemaining - (realDailyRate * weeklyDaysRemaining)
    : NaN;
  const zeroInDays = Number.isFinite(realDailyRate) && realDailyRate > 0 ? weeklyRemaining / realDailyRate : NaN;
  const fiveHourSafeRate = Number.isFinite(fiveHourMs) && fiveHourMs > 0 ? fiveHourRemaining / (fiveHourMs / (60 * 60 * 1000)) : 0;

  setProgress("fiveHourBar", "fiveHourPercent", fiveHourRemaining);
  setProgress("weeklyBar", "weeklyPercent", weeklyRemaining);

  els.updatedAtText.textContent = usage.lastUpdatedDate ? formatDateTimePtBr(usage.lastUpdatedDate) : "--";
  els.fiveHourUsed.textContent = `${Math.round(fiveHourUsed)}%`;
  els.weeklyUsed.textContent = `${Math.round(weeklyUsed)}%`;
  renderUsageChart(weeklyUsed, weeklyRemaining);
  els.weeklyRemainingDays.textContent = formatDays(weeklyDaysRemaining);
  els.weeklyAverage.textContent = formatRatePerDay(realDailyRate);
  els.weeklySafeRate.textContent = formatRatePerDay(safeDailyRate);
  els.weeklyDifference.textContent = formatDifference(dailyDiff);
  if (els.weeklyDifferenceTrend) els.weeklyDifferenceTrend.textContent = Number.isFinite(dailyDiff) ? (dailyDiff > 0 ? "↑" : dailyDiff < 0 ? "↓" : "→") : "•";
  if (els.weeklyDeltaSinceLast) {
    const deltaText = usage.lastUpdatedDate
      ? `${formatDifference(0)} desde ${usage.lastUpdatedDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      : "--";
    els.weeklyDeltaSinceLast.textContent = deltaText;
  }
  els.weeklyProjection.textContent = formatPercent(projectedRemaining);
  els.weeklyCycleStart.textContent = weeklyCycleStart ? formatDateTimePtBr(weeklyCycleStart) : "--";

  els.weeklyLine.textContent = usage.weeklyResetDate
    ? `Renova ${resetTextFromDate(usage.weeklyResetDate)}`
    : "--";

  if (usage.fiveHourResetIsNull && fiveHourRemaining === 100) {
    els.fiveHourLine.textContent = "Cheio · Sem ciclo ativo";
    els.fiveHourUsed.textContent = "0%";
    els.fiveHourSafeRate.textContent = "0%/h";
  } else {
    els.fiveHourLine.textContent = usage.fiveHourResetDate
      ? `Renova em ${formatDurationMs(fiveHourMs)} · ${formatDateTimePtBr(usage.fiveHourResetDate)}`
      : "--";
    els.fiveHourSafeRate.textContent = formatRatePerHour(fiveHourSafeRate);
  }

  if (Number.isFinite(zeroInDays) && zeroInDays > 0) {
    const zeroAtDate = new Date(now + (zeroInDays * 24 * 60 * 60 * 1000));
    els.weeklyZeroAt.textContent = `${formatZeroIn(zeroInDays)} · ${formatDateTimePtBr(zeroAtDate)}`;
  } else {
    els.weeklyZeroAt.textContent = "--";
  }

  const status = resolveStatus({
    hasLoadError,
    fiveHourRemaining,
    weeklyRemaining,
    realDailyRate,
    safeDailyRate,
  });
  els.statusText.textContent = status.text;
  if (els.confidenceHint) {
    if (usage.fiveHourResetIsNull) {
      els.confidenceHint.textContent = "Confiança: parcial (reset 5h nulo).";
    } else if (source === "cache") {
      els.confidenceHint.textContent = "Confiança: média (cache local por falha na API).";
    } else if (source === "fallback") {
      els.confidenceHint.textContent = "Confiança: baixa (fallback estático).";
    } else {
      els.confidenceHint.textContent = "Confiança: alta (dados ao vivo).";
    }
  }
  applyStatusState(status.state, els.statusText, els.statusDot);

  // Verificar e notificar
  checkAndNotify(status, fiveHourRemaining, weeklyRemaining);

  /* ===== Event Listeners ===== */
  els.themeToggleButton?.addEventListener("click", () => {
    triggerHaptic(10);
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(current === "light" ? "dark" : "light");
  });

  els.themeColorButton?.addEventListener("click", () => {
    triggerHaptic(10);
    els.themeColorInput?.click();
  });

  els.themeColorInput?.addEventListener("input", (event) => {
    const value = event?.target?.value;
    if (typeof value === "string") setThemeColor(value);
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

  els.shareButton?.addEventListener("click", async () => {
    triggerHaptic(15);
    const data = {
      title: "Analítica do Codex",
      text: "Dashboard local da Analítica do Codex",
      url: window.location.href,
    };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      // Feedback visual de cópia
      const originalText = els.shareButton.textContent;
      els.shareButton.textContent = "✓";
      setTimeout(() => {
        els.shareButton.textContent = originalText;
      }, 1500);
    } catch {}
  });

  els.closeButton?.addEventListener("click", () => {
    triggerHaptic(10);
    window.close();
    setTimeout(() => {
      if (history.length > 1) {
        history.back();
      } else {
        location.href = "about:blank";
      }
    }, 120);
  });

  // Melhorar interações em mobile
  enhanceMobileInteraction();

  // Solicitar permissão de notificações
  requestNotificationPermission();
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

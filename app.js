const SAFE_FALLBACK = {
  fiveHourPercent: 100,
  fiveHourReset: null,
  weeklyPercent: 100,
  weeklyReset: null,
  lastUpdated: null,
};

const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

function setProgress(barId, textId, percent) {
  const safePercent = clampPercent(percent);
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  const progress = bar ? bar.closest(".progress") : null;

  if (bar) bar.style.width = `${safePercent}%`;
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
  try {
    const response = await fetch(`./codex_usage.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Falha ao carregar JSON");

    const json = await response.json();
    return { usage: normalizeUsage(json), hasLoadError: false };
  } catch {
    return { usage: normalizeUsage(SAFE_FALLBACK), hasLoadError: true };
  }
}

function resetTextFromDate(date) {
  if (!date) return "--";
  return `${formatDateTimePtBr(date)} (${formatRemainingTime(date)})`;
}

(async function init() {
  const { usage, hasLoadError } = await loadUsage();
  const els = {
    refreshButton: document.getElementById("refreshButton"),
    shareButton: document.getElementById("shareButton"),
    closeButton: document.getElementById("closeButton"),
    statusText: document.getElementById("statusText"),
    statusDot: document.querySelector(".status-pill .dot"),
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
  els.weeklyRemainingDays.textContent = formatDays(weeklyDaysRemaining);
  els.weeklyAverage.textContent = formatRatePerDay(realDailyRate);
  els.weeklySafeRate.textContent = formatRatePerDay(safeDailyRate);
  els.weeklyDifference.textContent = formatDifference(dailyDiff);
  els.weeklyProjection.textContent = formatPercent(projectedRemaining);
  els.weeklyCycleStart.textContent = weeklyCycleStart ? formatDateTimePtBr(weeklyCycleStart) : "--";

  els.weeklyLine.textContent = usage.weeklyResetDate
    ? `renova ${resetTextFromDate(usage.weeklyResetDate)}`
    : "--";

  if (usage.fiveHourResetIsNull && fiveHourRemaining === 100) {
    els.fiveHourLine.textContent = "cheio · sem ciclo ativo";
    els.fiveHourUsed.textContent = "0%";
    els.fiveHourSafeRate.textContent = "0%/h";
  } else {
    els.fiveHourLine.textContent = usage.fiveHourResetDate
      ? `renova em ${formatDurationMs(fiveHourMs)} · ${formatDateTimePtBr(usage.fiveHourResetDate)}`
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
  applyStatusState(status.state, els.statusText, els.statusDot);

  els.refreshButton.addEventListener("click", () => {
    els.refreshButton.classList.remove("spinning");
    void els.refreshButton.offsetWidth;
    els.refreshButton.classList.add("spinning");
    setTimeout(() => {
      location.reload();
    }, 160);
  });

  els.shareButton.addEventListener("click", async () => {
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
    } catch {}
  });

  els.closeButton.addEventListener("click", () => {
    window.close();
    setTimeout(() => {
      if (history.length > 1) {
        history.back();
      } else {
        location.href = "about:blank";
      }
    }, 120);
  });
})();

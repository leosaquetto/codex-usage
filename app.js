const SAFE_FALLBACK = {
  fiveHourPercent: 0,
  fiveHourReset: null,
  weeklyPercent: 0,
  weeklyReset: null,
  lastUpdated: null,
};

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

function setProgress(sectionLabelId, barId, textId, percent) {
  const safePercent = clampPercent(percent);
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  const section = document.querySelector(`[aria-labelledby="${sectionLabelId}"]`);

  if (bar) bar.style.width = `${safePercent}%`;
  if (text) text.textContent = `${safePercent}%`;
  if (section) section.setAttribute("aria-valuenow", String(safePercent));
}

function updateStatus(fiveHour, weekly, hasLoadError) {
  const statusEl = document.getElementById("overallStatus");
  if (!statusEl) return;

  if (hasLoadError) {
    statusEl.textContent = "Erro ao atualizar dados. Exibindo valores seguros.";
    return;
  }

  if (fiveHour <= 0 || weekly <= 0) {
    statusEl.textContent = "Limite esgotado";
    return;
  }

  if (fiveHour < 20 || weekly < 20) {
    statusEl.textContent = "Atenção ao consumo";
    return;
  }

  statusEl.textContent = "Dentro do limite";
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

  const fiveHourPercent = usage.fiveHourResetIsNull ? 100 : usage.fiveHourPercent;
  const weeklyPercent = usage.weeklyPercent;

  setProgress("limite-5h-label", "fiveHourBar", "fiveHourPercent", fiveHourPercent);
  setProgress("limite-semanal-label", "weeklyBar", "weeklyPercent", weeklyPercent);

  const fiveHourReset = document.getElementById("fiveHourReset");
  const weeklyReset = document.getElementById("weeklyReset");
  const lastUpdated = document.getElementById("lastUpdated");

  if (fiveHourReset) {
    fiveHourReset.textContent = usage.fiveHourResetIsNull ? "--" : resetTextFromDate(usage.fiveHourResetDate);
  }

  if (weeklyReset) {
    weeklyReset.textContent = resetTextFromDate(usage.weeklyResetDate);
  }

  if (lastUpdated) {
    lastUpdated.textContent = usage.lastUpdatedDate ? formatDateTimePtBr(usage.lastUpdatedDate) : "--";
  }

  updateStatus(fiveHourPercent, weeklyPercent, hasLoadError);
})();

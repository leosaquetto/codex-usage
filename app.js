const SAFE_FALLBACK = {
  fiveHourPercent: 0,
  fiveHourReset: "--",
  weeklyPercent: 0,
  weeklyReset: "--",
  lastUpdated: "--",
};

function clampPercent(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
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

function updateStatus(fiveHour, weekly) {
  const statusEl = document.getElementById("overallStatus");
  if (!statusEl) return;

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
    const response = await fetch("./codex_usage.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Falha ao carregar JSON");
    const json = await response.json();
    return { ...SAFE_FALLBACK, ...json };
  } catch {
    return SAFE_FALLBACK;
  }
}

(async function init() {
  const usage = await loadUsage();

  const fiveHourPercent = clampPercent(usage.fiveHourPercent);
  const weeklyPercent = clampPercent(usage.weeklyPercent);

  setProgress("limite-5h-label", "fiveHourBar", "fiveHourPercent", fiveHourPercent);
  setProgress("limite-semanal-label", "weeklyBar", "weeklyPercent", weeklyPercent);

  const fiveHourReset = document.getElementById("fiveHourReset");
  const weeklyReset = document.getElementById("weeklyReset");
  const lastUpdated = document.getElementById("lastUpdated");

  if (fiveHourReset) fiveHourReset.textContent = usage.fiveHourReset || SAFE_FALLBACK.fiveHourReset;
  if (weeklyReset) weeklyReset.textContent = usage.weeklyReset || SAFE_FALLBACK.weeklyReset;
  if (lastUpdated) lastUpdated.textContent = usage.lastUpdated || SAFE_FALLBACK.lastUpdated;

  updateStatus(fiveHourPercent, weeklyPercent);
})();

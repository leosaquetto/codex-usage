// Codex Analytics — API Reader (substitui captura WebView)
// Fonte única: API do deploy informado.
// Este script NÃO lê página do Codex, NÃO escreve arquivo local e NÃO publica no GitHub.

const REMOTE_USAGE_URL = "https://codex-usage-nine.vercel.app/api/usage"

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function validDateFromISO(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function normalizeUsage(raw = {}) {
  return {
    fiveHourPercent: clampPercent(raw.fiveHourPercent, null),
    fiveHourReset: validDateFromISO(raw.fiveHourReset)
      ? new Date(raw.fiveHourReset).toISOString()
      : null,
    weeklyPercent: clampPercent(raw.weeklyPercent, null),
    weeklyReset: validDateFromISO(raw.weeklyReset)
      ? new Date(raw.weeklyReset).toISOString()
      : null,
    lastUpdated: validDateFromISO(raw.lastUpdated)
      ? new Date(raw.lastUpdated).toISOString()
      : null,
    statusLabel: String(raw.statusLabel || "--"),
    fiveHourSafeRate: String(raw.fiveHourSafeRate || "--/h"),
    weeklyRemaining: String(raw.weeklyRemaining || "--"),
    realDailyRate: String(raw.realDailyRate || "--/d"),
    safeDailyRate: String(raw.safeDailyRate || "--/d"),
    dailyDiff: String(raw.dailyDiff || "--/d"),
    weeklyProjection: String(raw.weeklyProjection || "--%"),
    zeroIn: String(raw.zeroIn || "--"),
    history: {
      cycleStart: validDateFromISO(raw.history?.cycleStart)
        ? new Date(raw.history.cycleStart).toISOString()
        : null
    }
  }
}

async function fetchUsage() {
  const req = new Request(`${REMOTE_USAGE_URL}?t=${Date.now()}`)
  req.timeoutInterval = 10
  req.headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache"
  }

  const payload = await req.loadJSON()
  const normalized = normalizeUsage(payload)

  if (
    clampPercent(normalized.fiveHourPercent, null) === null ||
    clampPercent(normalized.weeklyPercent, null) === null
  ) {
    throw new Error("API sem percentuais válidos")
  }

  return normalized
}

async function main() {
  const data = await fetchUsage()
  Script.setShortcutOutput(JSON.stringify({
    ok: true,
    source: REMOTE_USAGE_URL,
    data
  }, null, 2))
}

await main()
Script.complete()

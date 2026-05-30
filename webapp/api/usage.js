const { readFile } = require("fs/promises")
const { resolve } = require("path")

function toPercent(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function toDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function normalizeHistory(raw) {
  const samples = Array.isArray(raw?.samples) ? raw.samples : []
  const byCapturedAt = new Map()

  for (const sample of samples) {
    const capturedAt = toDate(sample?.capturedAt || sample?.lastUpdated)
    const weeklyReset = toDate(sample?.weeklyReset)
    const fiveHourPercent = Number(sample?.fiveHourPercent)
    const weeklyPercent = Number(sample?.weeklyPercent)

    if (
      !capturedAt ||
      !weeklyReset ||
      !Number.isFinite(fiveHourPercent) ||
      !Number.isFinite(weeklyPercent)
    ) {
      continue
    }

    byCapturedAt.set(capturedAt.toISOString(), {
      capturedAt: capturedAt.toISOString(),
      fiveHourPercent: toPercent(fiveHourPercent),
      fiveHourReset: toDate(sample?.fiveHourReset)?.toISOString() || null,
      weeklyPercent: toPercent(weeklyPercent),
      weeklyReset: weeklyReset.toISOString()
    })
  }

  return [...byCapturedAt.values()]
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .slice(-500)
}

function normalizeAccounts(rawAccounts) {
  if (!Array.isArray(rawAccounts)) return []

  return rawAccounts.map((account) => ({
    id: String(account?.id || ""),
    name: String(account?.displayName || account?.name || "Conta"),
    rawName: String(account?.name || ""),
    email: account?.email || null,
    planType: account?.planType || account?.plan_type || null,
    subscriptionExpiresAt: toDate(account?.subscriptionExpiresAt || account?.subscription_expires_at)?.toISOString() || null,
    isActive: Boolean(account?.isActive),
    fiveHourPercent: Number.isFinite(Number(account?.fiveHourPercent)) ? toPercent(account.fiveHourPercent) : null,
    fiveHourUsedPercent: Number.isFinite(Number(account?.fiveHourUsedPercent)) ? toPercent(account.fiveHourUsedPercent) : null,
    fiveHourReset: toDate(account?.fiveHourReset)?.toISOString() || null,
    fiveHourWindowMinutes: Number.isFinite(Number(account?.fiveHourWindowMinutes)) ? Number(account.fiveHourWindowMinutes) : null,
    weeklyPercent: Number.isFinite(Number(account?.weeklyPercent)) ? toPercent(account.weeklyPercent) : null,
    weeklyUsedPercent: Number.isFinite(Number(account?.weeklyUsedPercent)) ? toPercent(account.weeklyUsedPercent) : null,
    weeklyReset: toDate(account?.weeklyReset)?.toISOString() || null,
    weeklyWindowMinutes: Number.isFinite(Number(account?.weeklyWindowMinutes)) ? Number(account.weeklyWindowMinutes) : null,
    lastUpdated: toDate(account?.lastUpdated)?.toISOString() || null,
    status: account?.status === "error" ? "error" : "ok",
    error: account?.error || null
  })).filter((account) => account.id || account.name)
}

function isFreeGoAccount(account) {
  const plan = String(account?.planType || "").trim().toLowerCase()
  return plan === "free" || plan === "go"
}

function averageAccountPercent(accounts, key, fallback = 0) {
  const values = accounts
    .map((account) => Number(account?.[key]))
    .filter((value) => Number.isFinite(value))
  if (!values.length) return fallback
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatRate(value, unit) {
  if (!Number.isFinite(value)) return `--/${unit}`
  return `${value.toFixed(1)}%/${unit}`
}

function formatDays(value) {
  if (!Number.isFinite(value)) return "--"
  return `${value.toFixed(1)}d`
}

function formatDiff(value) {
  if (!Number.isFinite(value)) return "--/d"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}%/d`
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--%"
  const rounded = Math.round(value * 10) / 10
  return `${rounded.toFixed(1)}%`
}

function formatZeroIn(days) {
  if (!Number.isFinite(days) || days <= 0) return "agora"
  const totalHours = Math.floor(days * 24)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return d > 0 ? `${d}d ${h}h` : `${h}h`
}

function enrichPayload(raw = {}, history = null) {
  const now = Date.now()
  const aggregate = raw.aggregate && typeof raw.aggregate === "object" ? raw.aggregate : raw
  const accounts = normalizeAccounts(raw.accounts)
  const paidAccounts = accounts.filter((account) => !isFreeGoAccount(account))

  const fiveHourPercent = toPercent(averageAccountPercent(paidAccounts, "fiveHourPercent", aggregate.fiveHourPercent))
  const weeklyPercent = toPercent(averageAccountPercent(paidAccounts, "weeklyPercent", aggregate.weeklyPercent))
  const fiveHourResetDate = toDate(aggregate.fiveHourReset)
  const weeklyResetDate = toDate(aggregate.weeklyReset)
  const lastUpdated = raw.lastUpdated || new Date().toISOString()

  const fiveHourMs = fiveHourResetDate ? fiveHourResetDate.getTime() - now : NaN
  const weeklyMs = weeklyResetDate ? weeklyResetDate.getTime() - now : NaN

  const fiveHourUsed = 100 - fiveHourPercent
  const weeklyUsed = 100 - weeklyPercent
  const weeklyDaysRemaining = Number.isFinite(weeklyMs) ? Math.max(0, weeklyMs / 86400000) : NaN

  const cycleStart = weeklyResetDate
    ? new Date(weeklyResetDate.getTime() - 7 * 24 * 60 * 60 * 1000)
    : null

  const elapsedMs = cycleStart ? Math.max(0, Math.min(7 * 24 * 60 * 60 * 1000, now - cycleStart.getTime())) : NaN
  const elapsedDays = Number.isFinite(elapsedMs) ? Math.max(1 / 24, elapsedMs / 86400000) : NaN

  const realDailyRateNumber = Number.isFinite(elapsedDays) ? weeklyUsed / elapsedDays : NaN
  const safeDailyRateNumber = Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining > 0
    ? weeklyPercent / weeklyDaysRemaining
    : NaN
  const dailyDiffNumber = Number.isFinite(realDailyRateNumber) && Number.isFinite(safeDailyRateNumber)
    ? realDailyRateNumber - safeDailyRateNumber
    : NaN

  const projectedRemainingNumber = Number.isFinite(realDailyRateNumber) && Number.isFinite(weeklyDaysRemaining)
    ? weeklyPercent - (realDailyRateNumber * weeklyDaysRemaining)
    : NaN

  const zeroInDays = Number.isFinite(realDailyRateNumber) && realDailyRateNumber > 0
    ? weeklyPercent / realDailyRateNumber
    : NaN

  const fiveHourSafeRateNumber = Number.isFinite(fiveHourMs) && fiveHourMs > 0
    ? fiveHourPercent / (fiveHourMs / 3600000)
    : NaN

  const statusLabel = raw.statusLabel
    || (fiveHourPercent <= 0 || weeklyPercent <= 0
      ? "limite esgotado"
      : Number.isFinite(dailyDiffNumber) && dailyDiffNumber > 0
        ? "acima do seguro"
        : fiveHourPercent < 20 || weeklyPercent < 20
          ? "atenção ao consumo"
          : "dentro do seguro")

  return {
    fiveHourPercent,
    fiveHourReset: fiveHourResetDate ? fiveHourResetDate.toISOString() : null,
    weeklyPercent,
    weeklyReset: weeklyResetDate ? weeklyResetDate.toISOString() : null,
    lastUpdated,
    source: raw.source || null,
    accountCount: paidAccounts.length,
    okCount: paidAccounts.filter((account) => account.status === "ok").length,
    accounts,
    statusLabel,
    // Métricas derivadas sempre recalculadas para refletir o estado real atual.
    fiveHourSafeRate: formatRate(fiveHourSafeRateNumber, "h"),
    weeklyRemaining: formatDays(weeklyDaysRemaining),
    realDailyRate: formatRate(realDailyRateNumber, "d"),
    safeDailyRate: formatRate(safeDailyRateNumber, "d"),
    dailyDiff: formatDiff(dailyDiffNumber),
    weeklyProjection: formatPercent(projectedRemainingNumber),
    zeroIn: formatZeroIn(zeroInDays),
    history: {
      cycleStart: raw.history?.cycleStart || (cycleStart ? cycleStart.toISOString() : null)
    },
    historySamples: normalizeHistory(history)
  }
}

const GITHUB_OWNER = "leosaquetto"
const GITHUB_REPO = "codex-usage"
const GITHUB_BRANCH = "main"
const REMOTE_USAGE_PATH = "codex_usage.json"
const REMOTE_HISTORY_PATH = "codex_usage_history.json"
const REMOTE_USAGE_URL = "https://raw.githubusercontent.com/leosaquetto/codex-usage/main/codex_usage.json"
const REMOTE_HISTORY_URL = "https://raw.githubusercontent.com/leosaquetto/codex-usage/main/codex_usage_history.json"
const REMOTE_TIMEOUT_MS = 7000
const LOCAL_USAGE_PATH = resolve(__dirname, "../../codex_usage.json")
const LOCAL_HISTORY_PATH = resolve(__dirname, "../../codex_usage_history.json")

async function readLocalJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

function decodeBase64Json(content) {
  const jsonText = Buffer.from(String(content || "").replace(/\s/g, ""), "base64").toString("utf8")
  return JSON.parse(jsonText)
}

async function fetchRawJson(url, required = true) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS)

  try {
    const response = await fetch(`${url}?t=${Date.now()}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache"
      }
    })

    if (!response.ok) {
      if (!required) return null
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchRemoteJson(path, fallbackRawUrl, required = true) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS)
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(GITHUB_BRANCH)}`

  try {
    try {
      const response = await fetch(`${apiUrl}&t=${Date.now()}`, {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "Cache-Control": "no-cache",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      })

      if (!response.ok) {
        if (!required && response.status === 404) return null
        throw new Error(`GitHub API HTTP ${response.status}`)
      }

      const payload = await response.json()
      if (!payload?.content) throw new Error("GitHub API sem content")
      return decodeBase64Json(payload.content)
    } catch (apiError) {
      if (!fallbackRawUrl) throw apiError
      return await fetchRawJson(fallbackRawUrl, required)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function parsePayloadFromEnv() {
  const rawPayload = process.env.CODEX_USAGE_PAYLOAD
  if (!rawPayload || rawPayload === "undefined" || rawPayload === "null") return null

  return JSON.parse(rawPayload)
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store")

  try {
    if (process.env.CODEX_USAGE_USE_LOCAL_FILES === "1") {
      const localPayload = await readLocalJson(LOCAL_USAGE_PATH)
      const localHistory = await readLocalJson(LOCAL_HISTORY_PATH)
      return res.status(200).json(enrichPayload(localPayload, localHistory))
    }

    const remotePayload = await fetchRemoteJson(REMOTE_USAGE_PATH, REMOTE_USAGE_URL)
    const remoteHistory = await fetchRemoteJson(REMOTE_HISTORY_PATH, REMOTE_HISTORY_URL, false)
    return res.status(200).json(enrichPayload(remotePayload, remoteHistory))
  } catch (remoteError) {
    try {
      const envPayload = parsePayloadFromEnv()
      if (envPayload) {
        return res.status(200).json(enrichPayload(envPayload))
      }
    } catch {
      // ignora erro da env var
    }

    return res.status(503).json({
      error: "Usage payload indisponível"
    })
  }
}

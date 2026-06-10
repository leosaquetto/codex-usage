const { readFile } = require("fs/promises")
const { resolve } = require("path")

const STALE_AFTER_MS = 60 * 60 * 1000
const LONG_WINDOW_MINUTES = 20 * 24 * 60
const LEGACY_ACCOUNT_EMAILS = [
  { displayName: "LEO I", aliases: ["LEO I", "LEO", "LEO 1"], email: "jv5pdcwnxp@privaterelay.appleid.com" },
  { displayName: "LEO II", aliases: ["LEO II", "LEO 2", "LEO (TRIAL)", "GOOGLE"], email: "leoaraujo1949@gmail.com" },
  { displayName: "AMANDA", aliases: ["DINHA", "AMANADA", "AMANDA"], email: "dzplaybacks@gmail.com" },
  { displayName: "NATANAEL", aliases: ["NATANAEL", "NATAN", "NATE"], email: "contatonatanaelrodrigs@gmail.com" },
  { displayName: "FABINHO", aliases: ["FABINHO", "FABINH", "FABIO"], email: "fabinhomian@gmail.com", weeklyHistory: false },
  { displayName: "DOUGLAS", aliases: ["DOUGLAS"], email: "douglaschatgpt.am@gmail.com" }
]
const LEGACY_EMAIL_BY_ALIAS = new Map(
  LEGACY_ACCOUNT_EMAILS.flatMap((account) => account.aliases.map((alias) => [alias, account.email]))
)

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

function normalizeHistorySamples(raw) {
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

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function emailForPublicAccount(account) {
  return normalizeEmail(account?.email)
    || LEGACY_EMAIL_BY_ALIAS.get(String(account?.displayName || account?.name || "").trim().toUpperCase())
    || null
}

function legacyAccountSamplesFromAggregate(samples) {
  const accountSamples = []

  for (const sample of samples) {
    for (const account of LEGACY_ACCOUNT_EMAILS.filter((item) => item.weeklyHistory !== false)) {
      accountSamples.push({
        capturedAt: sample.capturedAt,
        email: account.email,
        displayName: account.displayName,
        weeklyPercent: sample.weeklyPercent,
        weeklyReset: sample.weeklyReset
      })
    }
  }

  return accountSamples
}

function normalizeAccountSamples(raw) {
  const samples = Array.isArray(raw?.accountSamples) && raw.accountSamples.length
    ? raw.accountSamples
    : legacyAccountSamplesFromAggregate(normalizeHistorySamples(raw))
  const byKey = new Map()

  for (const sample of samples) {
    const capturedAt = toDate(sample?.capturedAt || sample?.lastUpdated)
    const email = normalizeEmail(sample?.email)
    const weeklyReset = toDate(sample?.weeklyReset)
    const weeklyPercent = Number(sample?.weeklyPercent)

    if (
      !capturedAt
      || !email
      || email === "fabinhomian@gmail.com"
      || !weeklyReset
      || !Number.isFinite(weeklyPercent)
    ) {
      continue
    }

    byKey.set(`${email}|${capturedAt.toISOString()}|${weeklyReset.toISOString()}`, {
      capturedAt: capturedAt.toISOString(),
      email,
      displayName: String(sample?.displayName || sample?.name || email),
      weeklyPercent: toPercent(weeklyPercent),
      weeklyReset: weeklyReset.toISOString()
    })
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime() || a.email.localeCompare(b.email))
    .slice(-12000)
}

function normalizeWeeklyResetEvents(raw) {
  const events = Array.isArray(raw?.weeklyResetEvents) && raw.weeklyResetEvents.length
    ? raw.weeklyResetEvents
    : buildWeeklyResetEvents(normalizeAccountSamples(raw))
  const byKey = new Map()

  for (const event of events) {
    const email = normalizeEmail(event?.email)
    const capturedAt = toDate(event?.capturedAt || event?.lastUpdated)
    const weeklyReset = toDate(event?.weeklyReset)
    const previousWeeklyReset = toDate(event?.previousWeeklyReset)
    const deltaMs = event?.deltaMs === null || event?.deltaMs === undefined ? null : Number(event.deltaMs)

    if (!email || !capturedAt || !weeklyReset) continue

    const eventKey = `${email}|${weeklyReset.toISOString()}`
    if (byKey.has(eventKey)) continue

    byKey.set(eventKey, {
      email,
      displayName: String(event?.displayName || event?.name || email),
      capturedAt: capturedAt.toISOString(),
      weeklyReset: weeklyReset.toISOString(),
      previousWeeklyReset: previousWeeklyReset?.toISOString() || null,
      isEarlyReset: event?.isEarlyReset === true,
      deltaMs: Number.isFinite(deltaMs) ? deltaMs : null
    })
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime() || a.email.localeCompare(b.email))
}

function buildWeeklyResetEvents(accountSamples) {
  const byEmail = new Map()
  for (const sample of accountSamples) {
    if (!byEmail.has(sample.email)) byEmail.set(sample.email, [])
    byEmail.get(sample.email).push(sample)
  }

  const events = []
  for (const [email, samples] of byEmail.entries()) {
    const ordered = samples.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    let previousReset = null
    let lastEventReset = null

    for (const sample of ordered) {
      if (sample.weeklyReset === lastEventReset) continue

      const previousMs = previousReset ? new Date(previousReset).getTime() : NaN
      const capturedMs = new Date(sample.capturedAt).getTime()
      const deltaMs = Number.isFinite(previousMs) ? capturedMs - previousMs : null

      events.push({
        email,
        displayName: sample.displayName || email,
        capturedAt: sample.capturedAt,
        weeklyReset: sample.weeklyReset,
        previousWeeklyReset: previousReset,
        isEarlyReset: Number.isFinite(deltaMs) ? deltaMs < 0 : false,
        deltaMs
      })

      previousReset = sample.weeklyReset
      lastEventReset = sample.weeklyReset
    }
  }

  return events
}

function publicAccountError(value) {
  const raw = String(value || "").trim()
  if (!raw) return null
  if (/refresh token has already been used|app_session_terminated|session has ended|sign in again|login novamente/i.test(raw)) {
    return "Sessão precisa ser renovada no Codex Switcher."
  }
  if (/refresh HTTP 40[01]|HTTP 40[01]/i.test(raw)) {
    return "Não foi possível atualizar esta conta. Revise a sessão no Codex Switcher."
  }
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw
}

function normalizeAccounts(rawAccounts) {
  if (!Array.isArray(rawAccounts)) return []

  return rawAccounts.map((account) => {
    const fiveHourWindowMinutes = Number.isFinite(Number(account?.fiveHourWindowMinutes))
      ? Number(account.fiveHourWindowMinutes)
      : null
    const weeklyWindowMinutes = Number.isFinite(Number(account?.weeklyWindowMinutes))
      ? Number(account.weeklyWindowMinutes)
      : null
    const longWindowOnly = fiveHourWindowMinutes >= LONG_WINDOW_MINUTES

    return {
      id: String(account?.id || ""),
      name: String(account?.displayName || account?.name || "Conta"),
      rawName: String(account?.name || ""),
      email: emailForPublicAccount(account),
      planType: account?.planType || account?.plan_type || null,
      subscriptionExpiresAt: toDate(account?.subscriptionExpiresAt || account?.subscription_expires_at)?.toISOString() || null,
      isActive: Boolean(account?.isActive),
      lastUsedAt: toDate(account?.lastUsedAt || account?.last_used_at)?.toISOString() || null,
      fiveHourPercent: longWindowOnly || !Number.isFinite(Number(account?.fiveHourPercent))
        ? null
        : toPercent(account.fiveHourPercent),
      fiveHourUsedPercent: longWindowOnly || !Number.isFinite(Number(account?.fiveHourUsedPercent))
        ? null
        : toPercent(account.fiveHourUsedPercent),
      fiveHourReset: longWindowOnly ? null : toDate(account?.fiveHourReset)?.toISOString() || null,
      fiveHourWindowMinutes: longWindowOnly ? null : fiveHourWindowMinutes,
      weeklyPercent: Number.isFinite(Number(account?.weeklyPercent)) ? toPercent(account.weeklyPercent) : null,
      weeklyUsedPercent: Number.isFinite(Number(account?.weeklyUsedPercent)) ? toPercent(account.weeklyUsedPercent) : null,
      weeklyReset: toDate(account?.weeklyReset)?.toISOString() || null,
      weeklyWindowMinutes,
      lastUpdated: toDate(account?.lastUpdated)?.toISOString() || null,
      status: account?.status === "error" ? "error" : "ok",
      error: publicAccountError(account?.error)
    }
  }).filter((account) => account.id || account.name)
}

function isFreeGoAccount(account) {
  const plan = String(account?.planType || "").trim().toLowerCase()
  return plan === "free" || plan === "go"
}

function isThirtyDayAccount(account) {
  const weeklyWindowMinutes = Number(account?.weeklyWindowMinutes)
  const fiveHourWindowMinutes = Number(account?.fiveHourWindowMinutes)
  return isFreeGoAccount(account)
    || (Number.isFinite(weeklyWindowMinutes) && weeklyWindowMinutes >= LONG_WINDOW_MINUTES)
    || (Number.isFinite(fiveHourWindowMinutes) && fiveHourWindowMinutes >= LONG_WINDOW_MINUTES)
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
  const nonWeeklyEmails = new Set(
    accounts
      .filter(isThirtyDayAccount)
      .map((account) => normalizeEmail(account.email))
      .filter(Boolean)
  )
  nonWeeklyEmails.add("fabinhomian@gmail.com")

  const fiveHourPercent = toPercent(averageAccountPercent(paidAccounts, "fiveHourPercent", aggregate.fiveHourPercent))
  const weeklyPercent = toPercent(averageAccountPercent(paidAccounts, "weeklyPercent", aggregate.weeklyPercent))
  const fiveHourResetDate = toDate(aggregate.fiveHourReset)
  const weeklyResetDate = toDate(aggregate.weeklyReset)
  const lastUpdatedDate = toDate(raw.lastUpdated)
  const lastUpdated = lastUpdatedDate?.toISOString() || null
  const dataAgeMinutes = lastUpdatedDate
    ? Math.max(0, Math.floor((now - lastUpdatedDate.getTime()) / 60000))
    : null
  const isStale = !lastUpdatedDate || now - lastUpdatedDate.getTime() > STALE_AFTER_MS

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
    dataAgeMinutes,
    staleAfterMinutes: STALE_AFTER_MS / 60000,
    isStale,
    source: raw.source || null,
    activeAccountId: raw.activeAccountId || raw.active_account_id || null,
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
    historySamples: normalizeHistorySamples(history),
    accountSamples: normalizeAccountSamples(history).filter((sample) => !nonWeeklyEmails.has(sample.email)),
    weeklyResetEvents: normalizeWeeklyResetEvents(history).filter((event) => !nonWeeklyEmails.has(event.email))
  }
}

const GITHUB_OWNER = process.env.CODEX_USAGE_GITHUB_OWNER || "leosaquetto"
const GITHUB_REPO = process.env.CODEX_USAGE_GITHUB_REPO || "codex-usage"
const GITHUB_BRANCH = process.env.CODEX_USAGE_GITHUB_BRANCH || "usage-data"
const REMOTE_USAGE_PATH = "codex_usage.json"
const REMOTE_HISTORY_PATH = "codex_usage_history.json"
const REMOTE_USAGE_URL = process.env.CODEX_USAGE_REMOTE_USAGE_URL
  || `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/codex_usage.json`
const REMOTE_HISTORY_URL = process.env.CODEX_USAGE_REMOTE_HISTORY_URL
  || `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/codex_usage_history.json`
const HAS_CUSTOM_REMOTE_URLS = Boolean(process.env.CODEX_USAGE_REMOTE_USAGE_URL)
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

async function usageHandler(req, res) {
  res.setHeader("Cache-Control", "no-store")

  try {
    if (process.env.CODEX_USAGE_USE_LOCAL_FILES === "1") {
      const localPayload = await readLocalJson(LOCAL_USAGE_PATH)
      const localHistory = await readLocalJson(LOCAL_HISTORY_PATH)
      return res.status(200).json(enrichPayload(localPayload, localHistory))
    }

    const remotePayload = HAS_CUSTOM_REMOTE_URLS
      ? await fetchRawJson(REMOTE_USAGE_URL)
      : await fetchRemoteJson(REMOTE_USAGE_PATH, REMOTE_USAGE_URL)
    const remoteHistory = HAS_CUSTOM_REMOTE_URLS
      ? await fetchRawJson(REMOTE_HISTORY_URL, false)
      : await fetchRemoteJson(REMOTE_HISTORY_PATH, REMOTE_HISTORY_URL, false)
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

module.exports = usageHandler
module.exports.enrichPayload = enrichPayload

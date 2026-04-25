// Analítica do Codex — Scriptable Widget
// Small + Medium
// Somente leitura/renderização.
// Fonte única: https://codex-usage-nine.vercel.app/api/usage
//
// Este script NÃO lê cache local.
// Este script NÃO escreve codex_usage.json local.
// Este script NÃO captura a página do Codex.
// Este script NÃO publica no GitHub.
// Este script NÃO edita percentuais manualmente.

const REMOTE_USAGE_URL_PRODUCTION = "https://codex-usage-nine.vercel.app/api/usage"
const REMOTE_USAGE_URL_STAGING = "https://codex-usage-staging.vercel.app/api/usage"
const REMOTE_USAGE_URL = REMOTE_USAGE_URL_PRODUCTION

const SHORTCUT_URL = "shortcuts://run-shortcut?name=Atualizar%20uso%20Codex"
const LOGO_URL = "https://images.ctfassets.net/kftzwdyauwt9/YgXvGzKvVcDvpJGOFyroe/777616dd860276400c9c955688dce373/codex-app.png.png"

function emptyUsageData() {
  return {
    fiveHourPercent: null,
    fiveHourReset: null,
    weeklyPercent: null,
    weeklyReset: null,
    lastUpdated: null,
    statusLabel: "--",
    fiveHourSafeRate: "--/h",
    weeklyRemaining: "--",
    realDailyRate: "--/d",
    safeDailyRate: "--/d",
    dailyDiff: "--/d",
    weeklyProjection: "--%",
    zeroIn: "--",
    history: { cycleStart: null }
  }
}

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  const normalizedValue =
    typeof value === "string"
      ? value.replace("%", "").replace(",", ".").trim()
      : value
  const n = Number(normalizedValue)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function validDateFromISO(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function hasValidPercentPair(payload) {
  return (
    clampPercent(payload?.fiveHourPercent, null) !== null &&
    clampPercent(payload?.weeklyPercent, null) !== null
  )
}

function normalizeUsage(raw = {}) {
  const source = raw?.data && typeof raw.data === "object" ? raw.data : raw
  const fallbackFiveHourPercent = clampPercent(source.usage5hPercent ?? source.limit5hPercent, null)
  const fallbackWeeklyPercent = clampPercent(source.weekPercent ?? source.weeklyRemainingPercent, null)

  return {
    fiveHourPercent: clampPercent(source.fiveHourPercent, fallbackFiveHourPercent),
    fiveHourReset: validDateFromISO(source.fiveHourReset)
      ? new Date(source.fiveHourReset).toISOString()
      : null,
    weeklyPercent: clampPercent(source.weeklyPercent, fallbackWeeklyPercent),
    weeklyReset: validDateFromISO(source.weeklyReset)
      ? new Date(source.weeklyReset).toISOString()
      : null,
    lastUpdated: validDateFromISO(source.lastUpdated)
      ? new Date(source.lastUpdated).toISOString()
      : null,
    statusLabel: String(source.statusLabel || "--"),
    fiveHourSafeRate: String(source.fiveHourSafeRate || "--/h"),
    weeklyRemaining: String(source.weeklyRemaining || "--"),
    realDailyRate: String(source.realDailyRate || "--/d"),
    safeDailyRate: String(source.safeDailyRate || "--/d"),
    dailyDiff: String(source.dailyDiff || "--/d"),
    weeklyProjection: String(source.weeklyProjection || "--%"),
    zeroIn: String(source.zeroIn || "--"),
    history: {
      cycleStart: validDateFromISO(source.history?.cycleStart)
        ? new Date(source.history.cycleStart).toISOString()
        : null
    }
  }
}

async function fetchRemoteUsage() {
  const req = new Request(`${REMOTE_USAGE_URL}?t=${Date.now()}`)
  req.timeoutInterval = 8
  req.headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache"
  }

  const payload = await req.loadJSON()
  if (payload?.error) {
    throw new Error(String(payload.error))
  }
  const normalized = normalizeUsage(payload)

  if (!hasValidPercentPair(normalized)) {
    throw new Error("payload remoto sem percentuais válidos")
  }

  return normalized
}

let data = emptyUsageData()
let dataLoadWarning = ""

try {
  data = await fetchRemoteUsage()
} catch (error) {
  data = emptyUsageData()
  dataLoadWarning = `API indisponível. Rode o atualizador. ${String(error).slice(0, 70)}`
}

const now = new Date()

function round1(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10) / 10
}

function formatPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "--%"
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`
}

function formatClock(date) {
  if (!date) return "--"
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  })
}

function formatShortDate(date) {
  if (!date) return "--"
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}`
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "sem ciclo"
  if (ms <= 0) return "agora"

  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `em ${days}d ${hours}h`
  if (hours > 0) return `em ${hours}h ${minutes}m`
  return `em ${minutes}m`
}

function colorFor(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return new Color("#ffffff", 0.58)
  if (n <= 10) return new Color("#ff3b30")
  if (n <= 30) return new Color("#ff9500")
  return new Color("#ffffff")
}

function mutedColor(alpha = 0.78) {
  return Color.dynamic(new Color("#ffffff", alpha), new Color("#ffffff", alpha))
}

function primaryColor() {
  return Color.dynamic(Color.white(), Color.white())
}

async function loadLogo() {
  try {
    const req = new Request(LOGO_URL)
    req.timeoutInterval = 6
    return await req.loadImage()
  } catch {
    return null
  }
}

function inferWeeklyStart(weeklyResetTime) {
  if (!weeklyResetTime) return null
  const d = new Date(weeklyResetTime)
  d.setDate(d.getDate() - 7)
  return Number.isFinite(d.getTime()) ? d : null
}

function computeWeeklyMetrics() {
  const weeklyResetTime = validDateFromISO(data.weeklyReset)
  const weeklyStartTime = inferWeeklyStart(weeklyResetTime)
  const remaining = clampPercent(data.weeklyPercent, null)

  if (!weeklyResetTime || !weeklyStartTime || remaining === null) {
    return {
      weeklyResetTime,
      weeklyStartTime,
      remaining,
      used: null,
      remainingMs: NaN,
      avgUsedPerDay: null,
      safeRemainingPerDay: null,
      deltaPerDay: null
    }
  }

  const elapsedMs = Math.max(0, now.getTime() - weeklyStartTime.getTime())
  const remainingMs = Math.max(0, weeklyResetTime.getTime() - now.getTime())
  const elapsedDays = elapsedMs / 86400000
  const remainingDays = remainingMs / 86400000
  const used = 100 - remaining

  const avgUsedPerDay = elapsedDays > 0 ? used / elapsedDays : null
  const safeRemainingPerDay = remainingDays > 0 ? remaining / remainingDays : null
  const deltaPerDay =
    avgUsedPerDay !== null && safeRemainingPerDay !== null
      ? avgUsedPerDay - safeRemainingPerDay
      : null

  return {
    weeklyResetTime,
    weeklyStartTime,
    remaining,
    used,
    remainingMs,
    avgUsedPerDay,
    safeRemainingPerDay,
    deltaPerDay
  }
}

function computeFiveMetrics() {
  const fiveResetTime = validDateFromISO(data.fiveHourReset)
  const remaining = clampPercent(data.fiveHourPercent, null)
  const remainingMs = fiveResetTime ? fiveResetTime.getTime() - now.getTime() : NaN

  const safePerHour =
    Number.isFinite(remainingMs) &&
    remainingMs > 0 &&
    remaining !== null
      ? remaining / (remainingMs / 3600000)
      : null

  return {
    fiveResetTime,
    remaining,
    used: remaining === null ? null : 100 - remaining,
    remainingMs,
    safePerHour
  }
}

const fiveHourResetTime = validDateFromISO(data.fiveHourReset)
const weeklyResetTime = validDateFromISO(data.weeklyReset)

const fiveMs = fiveHourResetTime ? fiveHourResetTime.getTime() - Date.now() : NaN
const weeklyMs = weeklyResetTime ? weeklyResetTime.getTime() - Date.now() : NaN

const weeklyMetrics = computeWeeklyMetrics()
const fiveMetrics = computeFiveMetrics()
const logo = await loadLogo()

function addHeader(widget, compact = false) {
  const header = widget.addStack()
  header.centerAlignContent()

  if (logo) {
    const img = header.addImage(logo)
    img.imageSize = compact ? new Size(18, 18) : new Size(16, 16)
    img.cornerRadius = compact ? 5 : 6
    header.addSpacer(4)
  }

  const title = header.addText("Analítica do Codex")
  title.font = Font.boldSystemFont(11)
  title.textColor = primaryColor()
  title.minimumScaleFactor = 0.75
  title.lineLimit = 1

  header.addSpacer()
}

function progressWidth(percent, barWidth) {
  const n = Number(percent)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(4, barWidth * (Math.max(0, Math.min(100, n)) / 100))
}

function buildDashboardCard(parent, title, percent, msUntil, resetDisplay, barWidth, options = {}) {
  const inactive = Boolean(options.inactive)
  const secondaryText = options.secondaryText || ""
  const hasPercent = Number.isFinite(Number(percent))

  const card = parent.addStack()
  card.layoutVertically()
  card.backgroundColor = Color.dynamic(new Color("#ffffff", 0.11), new Color("#ffffff", 0.09))
  card.cornerRadius = 14
  card.setPadding(8, 10, 12, 10)
  card.borderWidth = 1
  card.borderColor = Color.dynamic(new Color("#ffffff", 0.28), new Color("#ffffff", 0.22))

  const label = card.addText(title.toUpperCase())
  label.font = Font.boldSystemFont(8)
  label.textColor = primaryColor()
  label.minimumScaleFactor = 0.75
  label.lineLimit = 1

  card.addSpacer(2)

  const percentRow = card.addStack()
  percentRow.layoutHorizontally()
  percentRow.centerAlignContent()

  const value = percentRow.addText(formatPercent(percent))
  value.font = Font.boldSystemFont(36)
  value.textColor = primaryColor()
  value.minimumScaleFactor = 0.8
  value.lineLimit = 1

  percentRow.addSpacer(4)

  const restStack = percentRow.addStack()
  restStack.layoutVertically()
  restStack.addSpacer(18)

  const rest = restStack.addText("restante")
  rest.font = Font.systemFont(9)
  rest.textColor = mutedColor()
  rest.lineLimit = 1

  card.addSpacer(2)

  const barStack = card.addStack()
  barStack.layoutHorizontally()

  const bg = barStack.addStack()
  bg.layoutHorizontally()
  bg.size = new Size(barWidth, 6)
  bg.backgroundColor = Color.dynamic(new Color("#ffffff", 0.38), new Color("#ffffff", 0.28))
  bg.cornerRadius = 7

  const fillWidth = progressWidth(percent, barWidth)
  if (fillWidth > 0) {
    const fill = bg.addStack()
    fill.size = new Size(fillWidth, 6)
    fill.backgroundColor = inactive ? new Color("#ffffff", 0.72) : colorFor(percent)
    fill.cornerRadius = 7
  }

  bg.addSpacer()
  barStack.addSpacer()

  card.addSpacer(6)

  const resetText = hasPercent ? `${formatDuration(msUntil)} • ${resetDisplay}` : "sem dados válidos"
  const reset = card.addText(resetText)
  reset.font = Font.systemFont(8)
  reset.textColor = mutedColor()
  reset.minimumScaleFactor = 0.55
  reset.lineLimit = 1

  if (secondaryText) {
    card.addSpacer(2)
    const second = card.addText(secondaryText)
    second.font = Font.systemFont(8)
    second.textColor = mutedColor()
    second.minimumScaleFactor = 0.55
    second.lineLimit = 1
  }

  return card
}

function createSmallWidget() {
  const w = new ListWidget()
  w.url = SHORTCUT_URL
  w.setPadding(14, 14, 14, 14)

  addHeader(w, true)
  w.addSpacer(12)

  const fTitle = w.addText(`5h • ${formatPercent(data.fiveHourPercent)}`)
  fTitle.font = Font.boldSystemFont(14)
  fTitle.textColor = primaryColor()
  fTitle.lineLimit = 1

  const fiveText =
    Number.isFinite(Number(data.fiveHourPercent))
      ? fiveHourResetTime
        ? `${formatDuration(fiveMs)} • ${formatClock(fiveHourResetTime)}`
        : "cheio • sem ciclo"
      : "sem dados válidos"

  const fSub = w.addText(fiveText)
  fSub.font = Font.systemFont(10)
  fSub.textColor = mutedColor()
  fSub.minimumScaleFactor = 0.75
  fSub.lineLimit = 1

  if (dataLoadWarning) {
    w.addSpacer(4)
    const warn = w.addText(dataLoadWarning)
    warn.font = Font.systemFont(8)
    warn.textColor = new Color("#ff3b30")
    warn.lineLimit = 2
  }

  w.addSpacer(10)

  const weeklySafe = round1(weeklyMetrics.safeRemainingPerDay)
  const weeklyAvg = round1(weeklyMetrics.avgUsedPerDay)

  const wTitle = w.addText(`Semanal • ${formatPercent(data.weeklyPercent)}`)
  wTitle.font = Font.boldSystemFont(14)
  wTitle.textColor = primaryColor()
  wTitle.minimumScaleFactor = 0.7
  wTitle.lineLimit = 1

  const weeklyLine =
    Number.isFinite(Number(data.weeklyPercent))
      ? `${formatDuration(weeklyMs)} • seguro ${weeklySafe ?? "—"}%/d`
      : "sem dados válidos"

  const wSub = w.addText(weeklyLine)
  wSub.font = Font.systemFont(10)
  wSub.textColor = mutedColor()
  wSub.minimumScaleFactor = 0.7
  wSub.lineLimit = 1

  const wSub2 = w.addText(`média ${weeklyAvg ?? "—"}%/d`)
  wSub2.font = Font.systemFont(9)
  wSub2.textColor = mutedColor()
  wSub2.minimumScaleFactor = 0.7
  wSub2.lineLimit = 1

  return w
}

function createMediumWidget() {
  const w = new ListWidget()
  w.url = SHORTCUT_URL
  w.setPadding(15, 14, 12, 15)

  addHeader(w, false)
  w.addSpacer(8)

  const row = w.addStack()
  row.layoutHorizontally()

  const barW = 124

  const fiveDisplay = fiveHourResetTime ? formatClock(fiveHourResetTime) : "sem ciclo"
  const fiveInactive = !fiveHourResetTime && Number(data.fiveHourPercent) >= 100

  const fiveSecondary =
    fiveMetrics.safePerHour !== null
      ? `seguro ${round1(fiveMetrics.safePerHour)}%/h`
      : Number.isFinite(Number(data.fiveHourPercent))
        ? "sem consumo ativo"
        : "rode o atualizador"

  buildDashboardCard(
    row,
    "Limite 5h",
    data.fiveHourPercent,
    fiveMs,
    fiveDisplay,
    barW,
    {
      inactive: fiveInactive,
      secondaryText: fiveSecondary
    }
  )

  row.addSpacer(10)

  const weeklySafe = round1(weeklyMetrics.safeRemainingPerDay)
  const weeklyAvg = round1(weeklyMetrics.avgUsedPerDay)
  const delta = round1(weeklyMetrics.deltaPerDay)

  let weeklySecondary = "rode o atualizador"
  if (Number.isFinite(Number(data.weeklyPercent))) {
    weeklySecondary = `seguro ${weeklySafe ?? "—"}%/d`
    if (weeklyAvg !== null) {
      weeklySecondary += ` × ${weeklyAvg}%/d`
    }
    if (delta !== null) {
      weeklySecondary += delta > 0 ? ` (+${delta})` : ` (${delta})`
    }
  }

  buildDashboardCard(
    row,
    "Limite Semanal",
    data.weeklyPercent,
    weeklyMs,
    formatShortDate(weeklyResetTime),
    barW,
    {
      inactive: false,
      secondaryText: weeklySecondary
    }
  )

  if (dataLoadWarning) {
    const warn = w.addText(dataLoadWarning)
    warn.font = Font.systemFont(8)
    warn.textColor = new Color("#ff3b30")
    warn.lineLimit = 1
  }

  w.addSpacer()
  return w
}

const widget = config.widgetFamily === "small" ? createSmallWidget() : createMediumWidget()
Script.setWidget(widget)

if (!config.runsInWidget) {
  if (config.widgetFamily === "small") {
    await widget.presentSmall()
  } else {
    await widget.presentMedium()
  }
}

Script.complete()

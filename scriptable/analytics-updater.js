// Analítica do Codex — Scriptable Widget
// Small + Medium
// Lê codex_usage.json e abre o Shortcut "Analítica do Codex" ao tocar.

const fm = FileManager.iCloud()
const folderPath = fm.joinPath(fm.documentsDirectory(), "Analítica do Codex")
if (!fm.fileExists(folderPath)) {
  fm.createDirectory(folderPath)
}
const filePath = fm.joinPath(folderPath, "codex_usage.json")

const CODEX_ANALYTICS_URL = "https://chatgpt.com/codex/cloud/settings/analytics"
const REMOTE_USAGE_URL_STAGING = "https://codex-usage-staging.vercel.app/api/usage"
// const REMOTE_USAGE_URL_PRODUCTION = "https://codex-usage.vercel.app/api/usage"
const REMOTE_USAGE_URL = REMOTE_USAGE_URL_STAGING
const SHORTCUT_URL = "shortcuts://run-shortcut?name=Anal%C3%ADtica%20do%20Codex"

const LOGO_URL = "https://images.ctfassets.net/kftzwdyauwt9/YgXvGzKvVcDvpJGOFyroe/777616dd860276400c9c955688dce373/codex-app.png.png"


function buildWeeklyResetFallback(now = new Date()) {
  const fallback = new Date(now)
  fallback.setDate(fallback.getDate() + 7)
  return Number.isFinite(fallback.getTime()) ? fallback : null
}

function weeklyResetFallbackISO(now = new Date()) {
  return buildWeeklyResetFallback(now)?.toISOString() || null
}

function defaultUsageData() {
  return {
    fiveHourPercent: 100,
    fiveHourReset: null,
    weeklyPercent: 61,
    weeklyReset: weeklyResetFallbackISO(),
    lastUpdated: new Date().toISOString(),
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

function normalizeUsage(raw = {}) {
  const base = defaultUsageData()
  return {
    ...base,
    fiveHourPercent: clampPercent(raw.fiveHourPercent),
    fiveHourReset: validDateFromISO(raw.fiveHourReset) ? new Date(raw.fiveHourReset).toISOString() : null,
    weeklyPercent: clampPercent(raw.weeklyPercent),
    weeklyReset: validDateFromISO(raw.weeklyReset) ? new Date(raw.weeklyReset).toISOString() : base.weeklyReset,
    lastUpdated: validDateFromISO(raw.lastUpdated) ? new Date(raw.lastUpdated).toISOString() : base.lastUpdated,
    statusLabel: String(raw.statusLabel || base.statusLabel),
    fiveHourSafeRate: String(raw.fiveHourSafeRate || base.fiveHourSafeRate),
    weeklyRemaining: String(raw.weeklyRemaining || base.weeklyRemaining),
    realDailyRate: String(raw.realDailyRate || base.realDailyRate),
    safeDailyRate: String(raw.safeDailyRate || base.safeDailyRate),
    dailyDiff: String(raw.dailyDiff || base.dailyDiff),
    weeklyProjection: String(raw.weeklyProjection || base.weeklyProjection),
    zeroIn: String(raw.zeroIn || base.zeroIn),
    history: {
      cycleStart: validDateFromISO(raw.history?.cycleStart) ? new Date(raw.history.cycleStart).toISOString() : null
    }
  }
}

function readLocalUsage() {
  if (!fm.fileExists(filePath)) {
    const initial = defaultUsageData()
    fm.writeString(filePath, JSON.stringify(initial, null, 2))
    return initial
  }

  try {
    return normalizeUsage(JSON.parse(fm.readString(filePath)))
  } catch {
    const fallback = defaultUsageData()
    fm.writeString(filePath, JSON.stringify(fallback, null, 2))
    return fallback
  }
}

function saveLocalUsage(payload) {
  fm.writeString(filePath, JSON.stringify(normalizeUsage(payload), null, 2))
}

async function fetchRemoteUsage() {
  const req = new Request(REMOTE_USAGE_URL)
  req.timeoutInterval = 8
  req.headers = { Accept: "application/json" }
  const payload = await req.loadJSON()
  return normalizeUsage(payload)
}

let data = readLocalUsage()
let dataLoadWarning = ""

try {
  const remote = await fetchRemoteUsage()
  data = remote
  saveLocalUsage(data)
} catch {
  data = readLocalUsage()
  dataLoadWarning = "Falha na rede. Exibindo dados locais."
}

const now = new Date()

function clampPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function round1(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10) / 10
}

function formatClock(date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  })
}

function formatDateTime(date) {
  const day = String(date.getDate()).padStart(2, "0")
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
  const month = months[date.getMonth()]
  return `${day} de ${month}. às ${formatClock(date)}`
}

function formatShortDate(date) {
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
  if (percent <= 10) return new Color("#ff3b30")
  if (percent <= 30) return new Color("#ff9500")
  return new Color("#ffffff")
}

function mutedColor(alpha = 0.78) {
  return Color.dynamic(new Color("#ffffff", alpha), new Color("#ffffff", alpha))
}

function primaryColor() {
  return Color.dynamic(Color.white(), Color.white())
}

function validDateFromISO(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

async function loadLogo() {
  try {
    const req = new Request(LOGO_URL)
    return await req.loadImage()
  } catch {
    return null
  }
}

function applyAutoResets() {
  const fiveReset = validDateFromISO(data.fiveHourReset)

  if (fiveReset && now >= fiveReset) {
    data.fiveHourPercent = 100
    data.fiveHourReset = null
  }

  const weeklyReset = validDateFromISO(data.weeklyReset)
  if (weeklyReset && now >= weeklyReset) {
    data.weeklyPercent = 100

    const nextWeekly = new Date(weeklyReset)
    while (nextWeekly <= now) {
      nextWeekly.setDate(nextWeekly.getDate() + 7)
    }

    data.weeklyReset = nextWeekly.toISOString()
  }

  data.fiveHourPercent = clampPercent(data.fiveHourPercent)
  data.weeklyPercent = clampPercent(data.weeklyPercent)

  saveLocalUsage(data)
}

function inferWeeklyStart(weeklyResetTime) {
  const d = new Date(weeklyResetTime)
  d.setDate(d.getDate() - 7)
  return d
}

function computeWeeklyMetrics() {
  const weeklyResetTime = validDateFromISO(data.weeklyReset) || buildWeeklyResetFallback(now) || now
  const weeklyStartTime = inferWeeklyStart(weeklyResetTime)

  const totalMs = weeklyResetTime.getTime() - weeklyStartTime.getTime()
  const elapsedMs = Math.max(0, now.getTime() - weeklyStartTime.getTime())
  const remainingMs = Math.max(0, weeklyResetTime.getTime() - now.getTime())

  const elapsedDays = elapsedMs / 86400000
  const remainingDays = remainingMs / 86400000

  const remaining = clampPercent(data.weeklyPercent)
  const used = 100 - remaining

  const avgUsedPerDay = elapsedDays > 0 ? used / elapsedDays : null
  const safeRemainingPerDay = remainingDays > 0 ? remaining / remainingDays : null
  const deltaPerDay =
    avgUsedPerDay !== null && safeRemainingPerDay !== null
      ? avgUsedPerDay - safeRemainingPerDay
      : null

  const projectedFinal =
    avgUsedPerDay !== null
      ? remaining - avgUsedPerDay * remainingDays
      : null

  const depletionMs =
    avgUsedPerDay && avgUsedPerDay > 0
      ? (remaining / avgUsedPerDay) * 86400000
      : null

  const depletionDate =
    depletionMs !== null
      ? new Date(now.getTime() + depletionMs)
      : null

  return {
    weeklyResetTime,
    weeklyStartTime,
    totalMs,
    elapsedMs,
    remainingMs,
    elapsedDays,
    remainingDays,
    remaining,
    used,
    avgUsedPerDay,
    safeRemainingPerDay,
    deltaPerDay,
    projectedFinal,
    depletionDate
  }
}

function computeFiveMetrics() {
  const fiveResetTime = validDateFromISO(data.fiveHourReset)
  const remaining = clampPercent(data.fiveHourPercent)
  const used = 100 - remaining
  const remainingMs = fiveResetTime ? fiveResetTime.getTime() - now.getTime() : NaN
  const safePerHour =
    Number.isFinite(remainingMs) && remainingMs > 0
      ? remaining / (remainingMs / 3600000)
      : null

  return {
    fiveResetTime,
    remaining,
    used,
    remainingMs,
    safePerHour
  }
}

applyAutoResets()

const fiveHourResetTime = validDateFromISO(data.fiveHourReset)
const weeklyResetTime = validDateFromISO(data.weeklyReset) || buildWeeklyResetFallback(now) || now

const fiveMs = fiveHourResetTime ? fiveHourResetTime.getTime() - Date.now() : NaN
const weeklyMs = weeklyResetTime.getTime() - Date.now()

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
  title.font = compact ? Font.boldSystemFont(11) : Font.boldSystemFont(11)
  title.textColor = primaryColor()
  title.minimumScaleFactor = 0.75
  title.lineLimit = 1

  header.addSpacer()
}

function buildDashboardCard(parent, title, percent, msUntil, resetDisplay, barWidth, options = {}) {
  const inactive = Boolean(options.inactive)
  const secondaryText = options.secondaryText || ""

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

  const value = percentRow.addText(`${percent}%`)
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

  if (percent > 0) {
    const fill = bg.addStack()
    fill.size = new Size(Math.max(4, barWidth * (percent / 100)), 6)
    fill.backgroundColor = inactive ? new Color("#ffffff", 0.72) : colorFor(percent)
    fill.cornerRadius = 7
  }

  bg.addSpacer()
  barStack.addSpacer()

  card.addSpacer(6)

  const resetText = `${formatDuration(msUntil)} • ${resetDisplay}`
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

  const fTitle = w.addText(`5h • ${data.fiveHourPercent}%`)
  fTitle.font = Font.boldSystemFont(14)
  fTitle.textColor = primaryColor()
  fTitle.lineLimit = 1

  const fiveText = fiveHourResetTime
    ? `${formatDuration(fiveMs)} • ${formatClock(fiveHourResetTime)}`
    : "cheio • sem ciclo"

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

  const wTitle = w.addText(`Semanal • ${data.weeklyPercent}%`)
  wTitle.font = Font.boldSystemFont(14)
  wTitle.textColor = primaryColor()
  wTitle.minimumScaleFactor = 0.7
  wTitle.lineLimit = 1

  const wSub = w.addText(`${formatDuration(weeklyMs)} • seguro ${weeklySafe ?? "—"}%/d`)
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
  const fiveInactive = !fiveHourResetTime && data.fiveHourPercent >= 100

  const fiveSecondary =
    fiveMetrics.safePerHour !== null
      ? `seguro ${round1(fiveMetrics.safePerHour)}%/h`
      : "sem consumo ativo"

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

  let weeklySecondary = `seguro ${weeklySafe ?? "—"}%/d`
  if (weeklyAvg !== null) {
    weeklySecondary += ` × ${weeklyAvg}%/d`
  }

  if (delta !== null) {
    weeklySecondary += delta > 0 ? ` (+${delta})` : ` (${delta}`
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

async function promptPercent(title, currentValue) {
  const a = new Alert()
  a.title = title
  a.message = `valor atual: ${currentValue}%`
  a.addTextField("percentual restante", String(currentValue))
  a.addAction("Salvar")
  a.addCancelAction("Cancelar")

  const r = await a.present()
  if (r === -1) return null

  return clampPercent(a.textFieldValue(0))
}

function toInputDateTime(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mi = String(date.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function parseInputDateTime(value) {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (!m) return null

  const [, y, mo, d, h, mi] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0)
  return Number.isFinite(date.getTime()) ? date : null
}

function nextDefaultFiveHourReset() {
  const d = new Date()
  d.setHours(d.getHours() + 5)
  d.setSeconds(0)
  d.setMilliseconds(0)
  return d
}

async function promptDateTime(title, message, currentDate) {
  const a = new Alert()
  a.title = title
  a.message = message
  a.addTextField("AAAA-MM-DD HH:mm", toInputDateTime(currentDate))
  a.addAction("Salvar")
  a.addCancelAction("Cancelar")

  const r = await a.present()
  if (r === -1) return null

  return parseInputDateTime(a.textFieldValue(0))
}

async function promptFiveHourResetQuick() {
  const current = fiveHourResetTime || nextDefaultFiveHourReset()

  const a = new Alert()
  a.title = "Renovação 5h"
  a.message = "escolha um atalho ou ajuste manualmente."
  a.addAction("+5h a partir de agora")
  a.addAction("Hoje em outro horário")
  a.addAction("Amanhã em outro horário")
  a.addAction("Data e hora manual")
  a.addCancelAction("Cancelar")

  const r = await a.present()
  if (r === -1) return null

  if (r === 0) return nextDefaultFiveHourReset()

  if (r === 1 || r === 2) {
    const base = new Date()
    if (r === 2) base.setDate(base.getDate() + 1)

    const h = new Alert()
    h.title = r === 1 ? "Hoje em qual horário?" : "Amanhã em qual horário?"
    h.message = "use HH:mm"
    h.addTextField("HH:mm", formatClock(current))
    h.addAction("Salvar")
    h.addCancelAction("Cancelar")

    const hr = await h.present()
    if (hr === -1) return null

    const m = h.textFieldValue(0).trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null

    base.setHours(Number(m[1]), Number(m[2]), 0, 0)
    return Number.isFinite(base.getTime()) ? base : null
  }

  if (r === 3) {
    return await promptDateTime(
      "Renovação 5h",
      "ajuste a próxima renovação do limite de 5h.",
      current
    )
  }

  return null
}

async function promptWeeklyReset() {
  return await promptDateTime(
    "Redefinição semanal",
    "mantenha ou ajuste a próxima redefinição semanal.",
    weeklyResetTime
  )
}

async function runInteractive() {
  const fiveStatus = fiveHourResetTime
    ? `${formatClock(fiveHourResetTime)} · ${formatDuration(fiveMs)}`
    : "sem ciclo ativo"

  const weeklySafe = round1(weeklyMetrics.safeRemainingPerDay)
  const weeklyAvg = round1(weeklyMetrics.avgUsedPerDay)
  const delta = round1(weeklyMetrics.deltaPerDay)

  const a = new Alert()
  a.title = "Analítica do Codex"
  a.message =
`${dataLoadWarning ? dataLoadWarning + "\n\n" : ""}5h: ${data.fiveHourPercent}% restante
renova: ${fiveStatus}

semana: ${data.weeklyPercent}% restante
renova: ${formatDateTime(weeklyResetTime)} · ${formatDuration(weeklyMs)}
seguro: ${weeklySafe ?? "—"}%/d
média atual: ${weeklyAvg ?? "—"}%/d
diferença: ${delta === null ? "—" : delta > 0 ? "+" + delta + "%/d" : delta + "%/d"}`

  a.addAction("Atualizar 5h")
  a.addAction("Definir renovação 5h")
  a.addAction("5h cheio / sem ciclo")
  a.addAction("Atualizar semanal")
  a.addAction("Abrir analítica")
  a.addCancelAction("Cancelar")

  const r = await a.present()

  if (r === 0) {
    const p = await promptPercent("Atualizar limite de 5 horas", data.fiveHourPercent)
    if (p !== null) {
      data.fiveHourPercent = p
      data.lastUpdated = new Date().toISOString()

      if (p < 100 && !validDateFromISO(data.fiveHourReset)) {
        const next = await promptFiveHourResetQuick()
        if (next) data.fiveHourReset = next.toISOString()
      }
    }
  }

  if (r === 1) {
    const next = await promptFiveHourResetQuick()
    if (next) {
      data.fiveHourReset = next.toISOString()
      data.lastUpdated = new Date().toISOString()
    }
  }

  if (r === 2) {
    data.fiveHourPercent = 100
    data.fiveHourReset = null
    data.lastUpdated = new Date().toISOString()
  }

  if (r === 3) {
    const p = await promptPercent("Atualizar limite semanal", data.weeklyPercent)
    if (p !== null) {
      data.weeklyPercent = p
      data.lastUpdated = new Date().toISOString()
    }

    const editReset = new Alert()
    editReset.title = "Reset semanal"
    editReset.message = "deseja ajustar a data/hora da próxima redefinição semanal?"
    editReset.addAction("Manter")
    editReset.addAction("Ajustar")
    const er = await editReset.present()

    if (er === 1) {
      const next = await promptWeeklyReset()
      if (next) data.weeklyReset = next.toISOString()
    }
  }

  if (r === 4) {
    Safari.open(CODEX_ANALYTICS_URL)
  }

  data.fiveHourPercent = clampPercent(data.fiveHourPercent)
  data.weeklyPercent = clampPercent(data.weeklyPercent)

  saveLocalUsage(data)
}

if (!config.runsInWidget) {
  await runInteractive()
}

const widget = config.widgetFamily === "small" ? createSmallWidget() : createMediumWidget()
Script.setWidget(widget)
Script.complete()

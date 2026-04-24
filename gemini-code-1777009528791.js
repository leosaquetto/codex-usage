// Analítica do Codex — Widget Unificado (Normalizado para iPhone 16e)
// Layout otimizado para Medium e Small com suporte a High-DPI

const fm = FileManager.iCloud()
const baseDir = fm.joinPath(fm.documentsDirectory(), "Analítica do Codex")
const assetsDir = fm.joinPath(baseDir, "assets")
const filePath = fm.joinPath(baseDir, "codex_usage.json")

if (!fm.fileExists(baseDir)) fm.createDirectory(baseDir)
if (!fm.fileExists(assetsDir)) fm.createDirectory(assetsDir)

const CODEX_ANALYTICS_URL = "https://chatgpt.com/codex/cloud/settings/analytics"
const REMOTE_USAGE_URL_STAGING = "https://codex-usage-staging.vercel.app/api/usage"
// const REMOTE_USAGE_URL_PRODUCTION = "https://codex-usage.vercel.app/api/usage"
const REMOTE_USAGE_URL = REMOTE_USAGE_URL_PRODUCTION
const DEFAULT_WEEKLY_RESET = "2026-04-28T19:35:00-03:00"
const LOCAL_LOGO_PATH = fm.joinPath(assetsDir, "codex.png")

function defaultUsageData() {
  return {
    fiveHourPercent: 100,
    fiveHourReset: null,
    weeklyPercent: 61,
    weeklyReset: DEFAULT_WEEKLY_RESET,
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

function clampPercent(value) {
  const n = Number(value)
  return Math.max(0, Math.min(100, Number.isFinite(n) ? Math.round(n) : 0))
}

function validDateFromISO(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
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
} catch (err) {
  data = readLocalUsage()
  dataLoadWarning = "Falha na rede. Exibindo dados locais."
}

function formatClock(date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "sem ciclo"
  if (ms <= 0) return "agora"
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function progressColor(percent) {
  if (percent >= 80) return new Color("#2E7D32")
  if (percent >= 50) return new Color("#F57C00")
  return new Color("#D32F2F")
}

function applyAutoResets() {
  const fiveReset = validDateFromISO(data.fiveHourReset)
  if (fiveReset && Date.now() >= fiveReset.getTime()) {
    data.fiveHourPercent = 100
    data.fiveHourReset = null
  }

  const weeklyReset = validDateFromISO(data.weeklyReset)
  if (weeklyReset && Date.now() >= weeklyReset.getTime()) {
    data.weeklyPercent = 100
    let nextWeekly = new Date(weeklyReset)
    while (nextWeekly.getTime() <= Date.now()) nextWeekly.setDate(nextWeekly.getDate() + 7)
    data.weeklyReset = nextWeekly.toISOString()
  }

  saveLocalUsage(data)
}

applyAutoResets()

const fiveResetDate = validDateFromISO(data.fiveHourReset)
const weeklyResetDate = validDateFromISO(data.weeklyReset) || new Date(DEFAULT_WEEKLY_RESET)
const fiveMs = fiveResetDate ? fiveResetDate.getTime() - Date.now() : NaN
const weeklyMs = weeklyResetDate.getTime() - Date.now()

function addHeader(w, compact) {
  const header = w.addStack()
  header.centerAlignContent()

  if (fm.fileExists(LOCAL_LOGO_PATH)) {
    const img = header.addImage(fm.readImage(LOCAL_LOGO_PATH))
    img.imageSize = new Size(compact ? 20 : 24, compact ? 20 : 24)
    img.cornerRadius = 6
    header.addSpacer(8)
  }

  const title = header.addText("Codex")
  title.font = Font.boldSystemFont(compact ? 16 : 18)
  title.textColor = Color.primary()
  header.addSpacer()

  const statusDot = header.addStack()
  statusDot.size = new Size(8, 8)
  statusDot.backgroundColor = new Color("#34C759", 0.8)
  statusDot.cornerRadius = 4
}

function addUsageBlock(parent, label, percent, resetDate, ms, compact) {
  const container = parent.addStack()
  container.layoutVertically()

  const infoRow = container.addStack()
  infoRow.bottomAlignContent()
  const lbl = infoRow.addText(label.toUpperCase())
  lbl.font = Font.blackSystemFont(10)
  lbl.textColor = new Color("#8E8E93")
  infoRow.addSpacer()
  const pct = infoRow.addText(`${percent}%`)
  pct.font = Font.boldRoundedSystemFont(compact ? 14 : 16)

  container.addSpacer(4)

  const track = container.addStack()
  track.size = new Size(0, compact ? 5 : 6)
  track.backgroundColor = new Color("#8E8E93", 0.2)
  track.cornerRadius = 3

  const fill = track.addStack()
  fill.size = new Size(Math.max(10, (percent / 100) * (compact ? 130 : 290)), compact ? 5 : 6)
  fill.backgroundColor = progressColor(percent)
  fill.cornerRadius = 3

  container.addSpacer(4)

  const footerRow = container.addStack()
  const resetLabel = resetDate ? formatClock(resetDate) : "sem ciclo"
  const footer = footerRow.addText(`Reset em ${formatDuration(ms)} • ${resetLabel}`)
  footer.font = Font.mediumSystemFont(9)
  footer.textColor = new Color("#8E8E93")
}

function addStatusLine(widget) {
  if (!dataLoadWarning) return
  widget.addSpacer(6)
  const warning = widget.addText(dataLoadWarning)
  warning.font = Font.mediumSystemFont(9)
  warning.textColor = new Color("#D32F2F")
  warning.lineLimit = 2
}

function createMediumWidget() {
  const w = new ListWidget()
  w.setPadding(16, 16, 16, 16)
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))

  addHeader(w, false)
  w.addSpacer()
  addUsageBlock(w, "Ciclo de 5 Horas", data.fiveHourPercent, fiveResetDate, fiveMs, false)
  w.addSpacer(12)
  addUsageBlock(w, "Ciclo Semanal", data.weeklyPercent, weeklyResetDate, weeklyMs, false)
  addStatusLine(w)
  w.addSpacer()

  w.url = CODEX_ANALYTICS_URL
  return w
}

function createSmallWidget() {
  const w = new ListWidget()
  w.setPadding(12, 12, 12, 12)
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))

  addHeader(w, true)
  w.addSpacer()
  addUsageBlock(w, "5 Horas", data.fiveHourPercent, fiveResetDate, fiveMs, true)
  w.addSpacer(10)
  addUsageBlock(w, "Semanal", data.weeklyPercent, weeklyResetDate, weeklyMs, true)
  addStatusLine(w)

  w.url = CODEX_ANALYTICS_URL
  return w
}

async function runInteractive() {
  const a = new Alert()
  a.title = "Analítica do Codex"
  a.message = dataLoadWarning || "Configurações de uso e monitoramento."
  a.addAction("Atualizar 5h")
  a.addAction("Atualizar Semanal")
  a.addAction("Visualizar Widget")
  a.addCancelAction("Sair")

  const r = await a.present()
  if (r === 0) {
    const val = await promptPercent("Limite 5h", data.fiveHourPercent)
    if (val !== null) data.fiveHourPercent = val
  } else if (r === 1) {
    const val = await promptPercent("Limite Semanal", data.weeklyPercent)
    if (val !== null) data.weeklyPercent = val
  } else if (r === 2) {
    const v = new Alert()
    v.addAction("Small"); v.addAction("Medium")
    const vr = await v.present()
    if (vr === 0) await createSmallWidget().presentSmall()
    else await createMediumWidget().presentMedium()
  }

  saveLocalUsage(data)
}

async function promptPercent(title, current) {
  const a = new Alert(); a.title = title
  a.addTextField("Percentual", String(current))
  a.addAction("OK"); a.addCancelAction("Cancelar")
  const r = await a.present()
  return r === 0 ? clampPercent(a.textFieldValue(0)) : null
}

if (config.runsInWidget) {
  const widget = config.widgetFamily === "small" ? createSmallWidget() : createMediumWidget()
  Script.setWidget(widget)
} else {
  await runInteractive()
}
Script.complete()

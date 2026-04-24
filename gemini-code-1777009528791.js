// Analítica do Codex — Widget Unificado (Normalizado para iPhone 16e)
// Layout otimizado para Medium e Small com suporte a High-DPI

const fm = FileManager.iCloud()
const baseDir = fm.joinPath(fm.documentsDirectory(), "Analítica do Codex")
const assetsDir = fm.joinPath(baseDir, "assets")
const filePath = fm.joinPath(baseDir, "codex_usage.json")

if (!fm.fileExists(baseDir)) fm.createDirectory(baseDir)
if (!fm.fileExists(assetsDir)) fm.createDirectory(assetsDir)

const CODEX_ANALYTICS_URL = "https://chatgpt.com/codex/cloud/settings/analytics"
const FIVE_HOUR_GRID_ANCHOR = "2026-04-24T02:36:00-03:00"
const DEFAULT_WEEKLY_RESET = "2026-04-28T19:35:00-03:00"
const LOCAL_LOGO_PATH = fm.joinPath(assetsDir, "codex.png")

// --- Inicialização de Dados ---
if (!fm.fileExists(filePath)) {
  fm.writeString(filePath, JSON.stringify({
    fiveHourPercent: 0,
    weeklyPercent: 61,
    fiveHourGridAnchor: FIVE_HOUR_GRID_ANCHOR,
    weeklyReset: DEFAULT_WEEKLY_RESET,
    lastUpdated: new Date().toISOString()
  }, null, 2))
}

let data = JSON.parse(fm.readString(filePath))

// --- Lógica de Tempo ---
function clampPercent(value) {
  const n = Number(value)
  return Math.max(0, Math.min(100, isNaN(n) ? 0 : Math.round(n)))
}

function nextFiveHourReset(anchorISO) {
  const anchor = new Date(anchorISO).getTime()
  const current = Date.now()
  const fiveHours = 5 * 60 * 60 * 1000
  const cycles = Math.floor((current - anchor) / fiveHours) + 1
  return new Date(anchor + cycles * fiveHours)
}

function previousFiveHourReset(anchorISO) {
  const anchor = new Date(anchorISO).getTime()
  const current = Date.now()
  const fiveHours = 5 * 60 * 60 * 1000
  const cycles = Math.floor((current - anchor) / fiveHours)
  return new Date(anchor + cycles * fiveHours)
}

function formatClock(date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function formatDuration(ms) {
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

// --- Processamento ---
function applyAutoResets() {
  const prev5 = previousFiveHourReset(data.fiveHourGridAnchor)
  if (data.lastFiveHourCycle !== prev5.toISOString()) {
    data.fiveHourPercent = 100
    data.lastFiveHourCycle = prev5.toISOString()
  }

  const weeklyReset = new Date(data.weeklyReset)
  if (Date.now() >= weeklyReset.getTime()) {
    data.weeklyPercent = 100
    let nextWeekly = new Date(weeklyReset)
    while (nextWeekly.getTime() <= Date.now()) nextWeekly.setDate(nextWeekly.getDate() + 7)
    data.weeklyReset = nextWeekly.toISOString()
  }
  fm.writeString(filePath, JSON.stringify(data, null, 2))
}

applyAutoResets()

const next5Reset = nextFiveHourReset(data.fiveHourGridAnchor)
const weeklyResetDate = new Date(data.weeklyReset)
const fiveMs = next5Reset.getTime() - Date.now()
const weeklyMs = weeklyResetDate.getTime() - Date.now()

// --- UI Engine ---
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
  
  // Barra de Progresso Normalizada
  const track = container.addStack()
  track.size = new Size(0, compact ? 5 : 6) // Largura 0 faz ocupar o stack pai
  track.backgroundColor = new Color("#8E8E93", 0.2)
  track.cornerRadius = 3
  
  const fill = track.addStack()
  fill.size = new Size(Math.max(10, (percent / 100) * (compact ? 130 : 290)), compact ? 5 : 6)
  fill.backgroundColor = progressColor(percent)
  fill.cornerRadius = 3
  
  container.addSpacer(4)
  
  const footerRow = container.addStack()
  const footer = footerRow.addText(`Reset em ${formatDuration(ms)} • ${formatClock(resetDate)}`)
  footer.font = Font.mediumSystemFont(9)
  footer.textColor = new Color("#8E8E93")
}

// --- Construtores de Widget ---
function createMediumWidget() {
  const w = new ListWidget()
  w.setPadding(16, 16, 16, 16)
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))
  
  addHeader(w, false)
  w.addSpacer()
  addUsageBlock(w, "Ciclo de 5 Horas", data.fiveHourPercent, next5Reset, fiveMs, false)
  w.addSpacer(12)
  addUsageBlock(w, "Ciclo Semanal", data.weeklyPercent, weeklyResetDate, weeklyMs, false)
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
  addUsageBlock(w, "5 Horas", data.fiveHourPercent, next5Reset, fiveMs, true)
  w.addSpacer(10)
  addUsageBlock(w, "Semanal", data.weeklyPercent, weeklyResetDate, weeklyMs, true)
  
  w.url = CODEX_ANALYTICS_URL
  return w
}

// --- Menu de Interação (Mantido Conforme Original) ---
async function runInteractive() {
  const a = new Alert()
  a.title = "Analítica do Codex"
  a.message = `Configurações de uso e monitoramento.`
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
  
  fm.writeString(filePath, JSON.stringify(data, null, 2))
}

async function promptPercent(title, current) {
  const a = new Alert(); a.title = title
  a.addTextField("Percentual", String(current))
  a.addAction("OK"); a.addCancelAction("Cancelar")
  const r = await a.present()
  return r === 0 ? clampPercent(a.textFieldValue(0)) : null
}

// --- Inicialização ---
if (config.runsInWidget) {
  const widget = config.widgetFamily === "small" ? createSmallWidget() : createMediumWidget()
  Script.setWidget(widget)
} else {
  await runInteractive()
}
Script.complete()
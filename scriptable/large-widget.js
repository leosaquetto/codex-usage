// Codex + Antigravity — Scriptable Large Widget
// Fonte unica: usage_summary.json servido pelo Vercel/static hosting.

const SUMMARY_URL = "https://codex-usage-nine.vercel.app/usage_summary.json"
const CACHE_FILE = "codex-antigravity-usage-summary.json"
const REFRESH_MINUTES = 20

const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE)

function emptySummary() {
  return {
    lastUpdated: null,
    codex: {
      fiveHourPercent: null,
      fiveHourReset: null,
      weeklyPercent: null,
      weeklyReset: null,
      lastUpdated: null
    },
    antigravity: {
      lastUpdated: null,
      source: "desktop-automation",
      models: []
    }
  }
}

function validDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  const n = Number(String(value).replace("%", "").replace(",", "."))
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeSummary(raw) {
  const source = raw && typeof raw === "object" ? raw : emptySummary()
  const codex = source.codex || {}
  const antigravity = source.antigravity || {}
  const models = Array.isArray(antigravity.models) ? antigravity.models : []

  return {
    lastUpdated: validDate(source.lastUpdated)?.toISOString() || null,
    codex: {
      fiveHourPercent: clampPercent(codex.fiveHourPercent),
      fiveHourReset: validDate(codex.fiveHourReset)?.toISOString() || null,
      weeklyPercent: clampPercent(codex.weeklyPercent),
      weeklyReset: validDate(codex.weeklyReset)?.toISOString() || null,
      lastUpdated: validDate(codex.lastUpdated)?.toISOString() || null
    },
    antigravity: {
      source: String(antigravity.source || "desktop-automation"),
      lastUpdated: validDate(antigravity.lastUpdated)?.toISOString() || null,
      models: models
        .map((model) => ({
          id: String(model.id || model.name || ""),
          name: String(model.name || "").trim(),
          tier: String(model.tier || "").trim(),
          remainingPercent: clampPercent(model.remainingPercent),
          status: String(model.status || ""),
          refreshText: String(model.refreshText || ""),
          refreshAt: validDate(model.refreshAt)?.toISOString() || null
        }))
        .filter((model) => model.name)
    }
  }
}

async function fetchSummary() {
  const req = new Request(`${SUMMARY_URL}?t=${Date.now()}`)
  req.timeoutInterval = 8
  req.headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache"
  }

  const raw = await req.loadString()
  const statusCode = Number(req.response?.statusCode || 0)
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode || "sem status"}`)
  }

  const payload = normalizeSummary(JSON.parse(raw))
  fm.writeString(cachePath, JSON.stringify(payload))
  return { payload, warning: "" }
}

function readCachedSummary() {
  if (!fm.fileExists(cachePath)) return null
  try {
    return normalizeSummary(JSON.parse(fm.readString(cachePath)))
  } catch {
    return null
  }
}

let summary = emptySummary()
let warning = ""

try {
  const loaded = await fetchSummary()
  summary = loaded.payload
  warning = loaded.warning
} catch (error) {
  summary = readCachedSummary() || emptySummary()
  warning = `Offline/cache: ${String(error.message || error).slice(0, 54)}`
}

const now = new Date()

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

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function muted(alpha = 0.72) {
  return new Color("#ffffff", alpha)
}

function colorForPercent(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return muted(0.5)
  if (n <= 10) return new Color("#ff453a")
  if (n <= 30) return new Color("#ff9f0a")
  return new Color("#66d9a3")
}

function statusForModel(model) {
  if (model.status) return model.status
  const n = Number(model.remainingPercent)
  if (!Number.isFinite(n)) return "unknown"
  if (n <= 0) return "empty"
  if (n < 20) return "low"
  return "ok"
}

function addText(parent, text, font, color = Color.white(), options = {}) {
  const t = parent.addText(String(text))
  t.font = font
  t.textColor = color
  t.lineLimit = options.lineLimit || 1
  t.minimumScaleFactor = options.scale || 0.75
  return t
}

function addProgress(parent, percent, width, height = 5) {
  const row = parent.addStack()
  row.layoutHorizontally()
  const bg = row.addStack()
  bg.size = new Size(width, height)
  bg.cornerRadius = height
  bg.backgroundColor = new Color("#ffffff", 0.18)

  const n = clampPercent(percent, 0)
  if (n > 0) {
    const fill = bg.addStack()
    fill.size = new Size(Math.max(3, Math.round(width * n / 100)), height)
    fill.cornerRadius = height
    fill.backgroundColor = colorForPercent(n)
  }

  bg.addSpacer()
  row.addSpacer()
}

function addHeader(widget) {
  const row = widget.addStack()
  row.centerAlignContent()
  addText(row, "Codex + Antigravity", Font.boldSystemFont(13), Color.white())
  row.addSpacer()

  const updated = validDate(summary.lastUpdated)
  addText(row, updated ? formatClock(updated) : "--", Font.mediumSystemFont(10), muted(0.7))
}

function addCodexBlock(widget) {
  const codex = summary.codex
  const fiveReset = validDate(codex.fiveHourReset)
  const weeklyReset = validDate(codex.weeklyReset)
  const fiveMs = fiveReset ? fiveReset.getTime() - now.getTime() : NaN
  const weeklyMs = weeklyReset ? weeklyReset.getTime() - now.getTime() : NaN

  const row = widget.addStack()
  row.layoutHorizontally()

  addCodexCard(row, "5h", codex.fiveHourPercent, fiveReset ? formatDuration(fiveMs) : "sem ciclo", formatClock(fiveReset))
  row.addSpacer(9)
  addCodexCard(row, "Semanal", codex.weeklyPercent, formatDuration(weeklyMs), formatShortDate(weeklyReset))
}

function addCodexCard(parent, title, percent, leftMeta, rightMeta) {
  const card = parent.addStack()
  card.layoutVertically()
  card.backgroundColor = new Color("#ffffff", 0.1)
  card.cornerRadius = 14
  card.setPadding(9, 10, 10, 10)
  card.size = new Size(151, 76)

  const top = card.addStack()
  top.centerAlignContent()
  addText(top, title.toUpperCase(), Font.boldSystemFont(8), muted(0.76))
  top.addSpacer()
  addText(top, formatPercent(percent), Font.boldSystemFont(20), colorForPercent(percent))

  card.addSpacer(8)
  addProgress(card, percent, 130, 5)
  card.addSpacer(7)

  const meta = card.addStack()
  meta.centerAlignContent()
  addText(meta, leftMeta, Font.systemFont(8), muted(0.72))
  meta.addSpacer()
  addText(meta, rightMeta, Font.systemFont(8), muted(0.72))
}

function addAntigravityBlock(widget) {
  const titleRow = widget.addStack()
  titleRow.centerAlignContent()
  addText(titleRow, "ANTIGRAVITY", Font.boldSystemFont(9), muted(0.82))
  titleRow.addSpacer()

  const updated = validDate(summary.antigravity.lastUpdated)
  addText(titleRow, updated ? `upd ${formatClock(updated)}` : "sem dados", Font.mediumSystemFont(8), muted(0.62))
  widget.addSpacer(6)

  const models = summary.antigravity.models.slice(0, 6)
  if (models.length === 0) {
    addText(widget, "Rode a automacao desktop para publicar antigravity_usage.json.", Font.systemFont(10), muted(0.72), {
      lineLimit: 2
    })
    return
  }

  for (const model of models) {
    addModelRow(widget, model)
    widget.addSpacer(5)
  }
}

function addModelRow(parent, model) {
  const row = parent.addStack()
  row.layoutVertically()
  row.backgroundColor = new Color("#ffffff", 0.075)
  row.cornerRadius = 9
  row.setPadding(5, 7, 6, 7)

  const top = row.addStack()
  top.centerAlignContent()

  const label = [model.name, model.tier].filter(Boolean).join(" ")
  addText(top, label, Font.semiboldSystemFont(10), Color.white(), { scale: 0.68 })
  top.addSpacer(6)

  const percent = formatPercent(model.remainingPercent)
  const status = statusForModel(model)
  const percentColor = status === "empty" || status === "low" ? colorForPercent(model.remainingPercent) : muted(0.9)
  addText(top, percent, Font.boldSystemFont(11), percentColor)

  row.addSpacer(3)

  const bottom = row.addStack()
  bottom.centerAlignContent()
  addProgress(bottom, model.remainingPercent, 86, 4)
  bottom.addSpacer(6)

  const refreshAt = validDate(model.refreshAt)
  const refresh = refreshAt
    ? `${formatDuration(refreshAt.getTime() - now.getTime())}`
    : model.refreshText.replace(/^Refreshes in\s*/i, "")

  addText(bottom, refresh || "--", Font.systemFont(8), muted(0.62), { scale: 0.6 })
}

const widget = new ListWidget()
widget.backgroundGradient = (() => {
  const g = new LinearGradient()
  g.colors = [new Color("#07111f"), new Color("#0e2530"), new Color("#121827")]
  g.locations = [0, 0.55, 1]
  return g
})()
widget.setPadding(14, 14, 12, 14)
widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000)

addHeader(widget)
widget.addSpacer(10)
addCodexBlock(widget)
widget.addSpacer(10)
addAntigravityBlock(widget)

if (warning) {
  widget.addSpacer()
  addText(widget, warning, Font.systemFont(8), new Color("#ff9f0a"), {
    lineLimit: 1,
    scale: 0.55
  })
}

Script.setWidget(widget)

if (!config.runsInWidget) {
  await widget.presentLarge()
}

Script.complete()

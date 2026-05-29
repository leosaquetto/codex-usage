// ------------------------------------------------------
// Codex Accounts — Scriptable Large Widget (8 contas)
// ------------------------------------------------------

const CODEX_USAGE_URL = "https://raw.githubusercontent.com/leosaquetto/codex-usage/main/codex_usage.json"
const CACHE_FILE = "codex-accounts-usage.json"
const REFRESH_MINUTES = 15
const LOGO_OPENAI = "https://i.imgur.com/qBlxQ5P.png"

const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE)

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

function normalizeAccount(raw) {
  return {
    name: String(raw.displayName || raw.name || "Conta").trim(),
    planType: String(raw.planType || "").trim().toUpperCase(),
    fiveHourPercent: clampPercent(raw.fiveHourPercent),
    fiveHourReset: validDate(raw.fiveHourReset)?.toISOString() || null,
    weeklyPercent: clampPercent(raw.weeklyPercent),
    weeklyReset: validDate(raw.weeklyReset)?.toISOString() || null,
    subscriptionExpiresAt: validDate(raw.subscriptionExpiresAt)?.toISOString() || null,
    status: raw.status === "error" ? "error" : "ok"
  }
}

function normalizePayload(raw) {
  const accounts = Array.isArray(raw?.accounts) ? raw.accounts.map(normalizeAccount) : []
  return {
    lastUpdated: validDate(raw?.lastUpdated)?.toISOString() || null,
    accounts
  }
}

function cacheBusted(url) {
  return `${url}?t=${Date.now()}`
}

async function fetchJson(url) {
  const req = new Request(cacheBusted(url))
  req.timeoutInterval = 8
  req.headers = { Accept: "application/json", "Cache-Control": "no-cache" }
  const raw = await req.loadString()
  const statusCode = req.response?.statusCode || 0
  if (statusCode < 200 || statusCode >= 300) throw new Error(`HTTP ${statusCode}`)
  return JSON.parse(raw)
}

function readCachedPayload() {
  if (!fm.fileExists(cachePath)) return null
  try { return normalizePayload(JSON.parse(fm.readString(cachePath))) } catch { return null }
}

async function loadPayload() {
  const payload = normalizePayload(await fetchJson(CODEX_USAGE_URL))
  fm.writeString(cachePath, JSON.stringify(payload))
  return payload
}

async function loadImage(url) {
  try {
    const req = new Request(url)
    req.timeoutInterval = 6
    return await req.loadImage()
  } catch { return null }
}

let payload
try {
  payload = await loadPayload()
} catch {
  payload = readCachedPayload() || { lastUpdated: null, accounts: [] }
}

const logo = await loadImage(LOGO_OPENAI)
const now = new Date()

function formatPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "--%"
  return `${Math.round(n)}%`
}

function formatResetDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "reset agora"
  const totalMins = Math.floor(ms / 60000)
  const d = Math.floor(totalMins / 1440)
  const h = Math.floor((totalMins % 1440) / 60)
  const m = totalMins % 60
  if (d > 0) return `reset em ${d}d ${h}h`
  if (h > 0) return `reset em ${h}h ${m}m`
  return `reset em ${m}m`
}

function getBadgeText(dateString) {
  const target = validDate(dateString)
  if (!target) return "--"
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 86400000)
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  if (targetDay.getTime() === today.getTime()) return "hoje"
  if (targetDay.getTime() === tomorrow.getTime()) return "amanhã"
  const dd = String(target.getDate()).padStart(2, "0")
  const mm = String(target.getMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}`
}

function colorFor(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return new Color("#ffffff", 0.4)
  if (n <= 10) return new Color("#ff453a")
  if (n <= 30) return new Color("#ff9f0a")
  return new Color("#3ade68")
}

function progressWidth(percent, barWidth) {
  const n = Number(percent)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(4, barWidth * (Math.max(0, Math.min(100, n)) / 100))
}

const cards = payload.accounts.slice(0, 8).map((account) => {
  const weeklyReset = validDate(account.weeklyReset)
  return {
    title: `${account.name}\n5h ${formatPercent(account.fiveHourPercent)}`,
    logo,
    percent: account.weeklyPercent,
    resetStr: weeklyReset ? formatResetDuration(weeklyReset.getTime() - now.getTime()) : "sem ciclo",
    badgeStr: getBadgeText(account.weeklyReset)
  }
})

while (cards.length < 8) {
  cards.push({ title: "Aguardando\n5h --%", logo, percent: null, resetStr: "sem dados", badgeStr: "--" })
}

const w = new ListWidget()
w.setPadding(20, 14, 20, 14)

const bgGrad = new LinearGradient()
bgGrad.colors = [new Color("#254885"), new Color("#173463")]
bgGrad.locations = [0, 1]
w.backgroundGradient = bgGrad
w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000)

const gridStack = w.addStack()
gridStack.layoutHorizontally()

const leftCol = gridStack.addStack()
leftCol.layoutVertically()
leftCol.size = new Size(156, 0)

gridStack.addSpacer(10)

const rightCol = gridStack.addStack()
rightCol.layoutVertically()
rightCol.size = new Size(156, 0)

function buildCard(parent, data) {
  const card = parent.addStack()
  card.layoutVertically()
  card.backgroundColor = new Color("#ffffff", 0.08)
  card.cornerRadius = 14
  card.setPadding(8, 12, 8, 12)
  card.borderWidth = 1
  card.borderColor = new Color("#ffffff", 0.06)

  const topRow = card.addStack()
  topRow.centerAlignContent()

  if (data.logo) {
    const icon = topRow.addImage(data.logo)
    icon.imageSize = new Size(15.5, 15.5)
    topRow.addSpacer(6)
  }

  const title = topRow.addText(data.title)
  title.font = Font.systemFont(8)
  title.textColor = Color.white()
  title.lineLimit = 2

  topRow.addSpacer()

  const perc = topRow.addText(formatPercent(data.percent))
  perc.font = Font.boldSystemFont(18)
  perc.textColor = colorFor(data.percent)
  perc.minimumScaleFactor = 0.8

  card.addSpacer(7)

  const barW = 132
  const barBg = card.addStack()
  barBg.layoutHorizontally()
  barBg.size = new Size(barW, 5)
  barBg.backgroundColor = new Color("#ffffff", 0.2)
  barBg.cornerRadius = 2.5

  const fillW = progressWidth(data.percent, barW)
  if (fillW > 0) {
    const fill = barBg.addStack()
    fill.size = new Size(fillW, 5)
    fill.backgroundColor = colorFor(data.percent)
    fill.cornerRadius = 2.5
  }
  barBg.addSpacer()

  card.addSpacer(7)

  const footRow = card.addStack()
  footRow.centerAlignContent()

  const clockSym = SFSymbol.named("clock")
  if (clockSym) {
    const clockImg = footRow.addImage(clockSym.image)
    clockImg.imageSize = new Size(10, 10)
    clockImg.tintColor = new Color("#ffffff", 0.8)
    footRow.addSpacer(4)
  }

  const resetTxt = footRow.addText(data.resetStr)
  resetTxt.font = Font.systemFont(8)
  resetTxt.textColor = new Color("#ffffff", 0.8)
  resetTxt.lineLimit = 1

  footRow.addSpacer()

  if (data.badgeStr !== "--") {
    const badge = footRow.addStack()
    badge.backgroundColor = new Color("#ffffff", 0.15)
    badge.cornerRadius = 5
    badge.setPadding(2, 4, 2, 4)
    badge.centerAlignContent()

    const calSym = SFSymbol.named("calendar")
    if (calSym) {
      const calImg = badge.addImage(calSym.image)
      calImg.imageSize = new Size(8, 8)
      calImg.tintColor = Color.white()
      badge.addSpacer(3)
    }

    const bTxt = badge.addText(data.badgeStr)
    bTxt.font = Font.mediumSystemFont(7)
    bTxt.textColor = Color.white()
    bTxt.lineLimit = 1
  }
}

for (let r = 0; r < 4; r++) {
  buildCard(leftCol, cards[r * 2])
  buildCard(rightCol, cards[r * 2 + 1])

  if (r < 3) {
    leftCol.addSpacer(8)
    rightCol.addSpacer(8)
  }
}

Script.setWidget(w)
if (!config.runsInWidget) await w.presentLarge()
Script.complete()

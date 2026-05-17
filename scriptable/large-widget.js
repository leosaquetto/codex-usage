// ------------------------------------------------------
// Codex + Antigravity — Scriptable Large Widget (Pro Modular 4x2)
// ------------------------------------------------------

const SUMMARY_URL = "https://codex-usage-nine.vercel.app/usage_summary.json"
const CACHE_FILE = "codex-antigravity-usage-summary.json"
const REFRESH_MINUTES = 20

// Novos URLs dos Logos Oficiais
const LOGO_GPT = "https://i.imgur.com/qBlxQ5P.png" // Usado para Codex e GPT
const LOGO_GEMINI = "https://i.imgur.com/5YrjiRD.png"
const LOGO_CLAUDE = "https://i.imgur.com/WKSOEc8.png"
const LOGO_AG = "https://brandlogos.net/wp-content/uploads/2025/12/google_antigravity-logo_brandlogos.net_qu4jc-512x472.png"

const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE)

// ==========================================
// 1. MOTOR DE DADOS E FETCH
// ==========================================

function emptySummary() {
  return {
    lastUpdated: null,
    codex: { fiveHourPercent: null, fiveHourReset: null, weeklyPercent: null, weeklyReset: null },
    antigravity: { lastUpdated: null, models: [] }
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
  const ag = source.antigravity || {}
  const models = Array.isArray(ag.models) ? ag.models : []

  return {
    lastUpdated: validDate(source.lastUpdated)?.toISOString() || null,
    codex: {
      fiveHourPercent: clampPercent(codex.fiveHourPercent),
      fiveHourReset: validDate(codex.fiveHourReset)?.toISOString() || null,
      weeklyPercent: clampPercent(codex.weeklyPercent),
      weeklyReset: validDate(codex.weeklyReset)?.toISOString() || null,
    },
    antigravity: {
      lastUpdated: validDate(ag.lastUpdated)?.toISOString() || null,
      models: models.map((model) => ({
        name: String(model.name || "").trim(),
        tier: String(model.tier || "").trim(),
        remainingPercent: clampPercent(model.remainingPercent),
        refreshText: String(model.refreshText || ""),
        refreshAt: validDate(model.refreshAt)?.toISOString() || null
      })).filter((model) => model.name)
    }
  }
}

async function fetchSummary() {
  const req = new Request(`${SUMMARY_URL}?t=${Date.now()}`)
  req.timeoutInterval = 8
  const raw = await req.loadString()
  const statusCode = req.response?.statusCode || 0
  if (statusCode < 200 || statusCode >= 300) throw new Error(`HTTP ${statusCode}`)

  const payload = normalizeSummary(JSON.parse(raw))
  fm.writeString(cachePath, JSON.stringify(payload))
  return { payload }
}

function readCachedSummary() {
  if (!fm.fileExists(cachePath)) return null
  try { return normalizeSummary(JSON.parse(fm.readString(cachePath))) } catch { return null }
}

async function loadImage(url) {
  try {
    const req = new Request(url)
    req.timeoutInterval = 6
    return await req.loadImage()
  } catch { return null }
}

let summary = emptySummary()
try {
  const loaded = await fetchSummary()
  summary = loaded.payload
} catch (error) {
  summary = readCachedSummary() || emptySummary()
}

const now = new Date()

// ==========================================
// 2. FORMATAÇÃO VISUAL
// ==========================================

function formatPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "--%"
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`
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
  if (!dateString) return "--"
  const target = new Date(dateString)
  if (!Number.isFinite(target.getTime())) return "--"

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

// ==========================================
// 3. MAPEAMENTO DOS DADOS (8 SLOTS)
// ==========================================

const [imgGpt, imgGemini, imgClaude, imgAg] = await Promise.all([
  loadImage(LOGO_GPT), loadImage(LOGO_GEMINI), loadImage(LOGO_CLAUDE), loadImage(LOGO_AG)
])

function getLogoForModel(name) {
  const lower = name.toLowerCase()
  if (lower.includes("gemini")) return imgGemini
  if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus")) return imgClaude
  if (lower.includes("gpt") || lower.includes("chatgpt") || lower.includes("codex")) return imgGpt
  return imgAg
}

const unifiedCards = []

// Linha 1: Codex (Quebrando manualmente em duas linhas com \n)
const c5Reset = validDate(summary.codex.fiveHourReset)
const c5Ms = c5Reset ? c5Reset.getTime() - now.getTime() : NaN
unifiedCards.push({
  title: "Codex\nLimite 5h",
  logo: imgGpt,
  percent: summary.codex.fiveHourPercent,
  resetStr: c5Reset ? formatResetDuration(c5Ms) : "sem ciclo ativo",
  badgeStr: getBadgeText(summary.codex.fiveHourReset)
})

const cwReset = validDate(summary.codex.weeklyReset)
const cwMs = cwReset ? cwReset.getTime() - now.getTime() : NaN
unifiedCards.push({
  title: "Codex\nLimite Semanal",
  logo: imgGpt,
  percent: summary.codex.weeklyPercent,
  resetStr: cwReset ? formatResetDuration(cwMs) : "sem ciclo ativo",
  badgeStr: getBadgeText(summary.codex.weeklyReset)
})

// Linhas 2, 3 e 4: Modelos Antigravity
const agModelsToUse = summary.antigravity.models.slice(0, 6)
agModelsToUse.forEach(m => {
  let resetStr = m.refreshText
  const mRefreshAt = validDate(m.refreshAt)
  if (mRefreshAt) {
    resetStr = formatResetDuration(mRefreshAt.getTime() - now.getTime())
  } else if (resetStr) {
    resetStr = resetStr.toLowerCase().replace(/^refreshes in\s*/i, "reset em ")
  } else {
    resetStr = "sem previsão"
  }

  // Forçando quebra de linha entre o Nome e o Tier (se houver tier)
  let titleStr = m.name.trim()
  if (m.tier && m.tier.trim() !== "") {
    titleStr += `\n${m.tier.trim()}`
  }

  unifiedCards.push({
    title: titleStr,
    logo: getLogoForModel(m.name),
    percent: m.remainingPercent,
    resetStr: resetStr,
    badgeStr: getBadgeText(m.refreshAt)
  })
})

while (unifiedCards.length < 8) {
  unifiedCards.push({ title: "Aguardando\nSlot", logo: imgAg, percent: null, resetStr: "sem dados", badgeStr: "--" })
}

// ==========================================
// 4. CONSTRUÇÃO DO WIDGET
// ==========================================

const w = new ListWidget()
w.setPadding(20, 14, 20, 14) // Margens aumentadas para mais "respiro" no topo e na base

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
  card.setPadding(8, 12, 8, 12) // Reduzido verticalmente para compensar as margens externas
  card.borderWidth = 1
  card.borderColor = new Color("#ffffff", 0.06)

  // LINHA 1: Logo + Título + Percentual
  const topRow = card.addStack()
  topRow.centerAlignContent()

  if (data.logo) {
    const icon = topRow.addImage(data.logo)
    icon.imageSize = new Size(15.5, 15.5)
    topRow.addSpacer(6)
  }

  // Nomes travados e quebrados para ocupar exatamente duas linhas e garantir simetria
  const title = topRow.addText(data.title)
  title.font = Font.systemFont(8)
  title.textColor = Color.white()
  title.lineLimit = 2
  // Sem minimumScaleFactor, garantindo que o texto use o espaço ou force a quebra de linha.

  topRow.addSpacer()

  // Porcentagem com maior peso na fonte
  const perc = topRow.addText(formatPercent(data.percent))
  perc.font = Font.boldSystemFont(18) // Fonte acentuada e levemente maior
  perc.textColor = colorFor(data.percent)
  perc.minimumScaleFactor = 0.8

  card.addSpacer(7) // Espaçamento reduzido

  // LINHA 2: Barra de Progresso
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

  card.addSpacer(7) // Espaçamento reduzido

  // LINHA 3: Relógio + Reset Text + Badge com Calendário
  const footRow = card.addStack()
  footRow.centerAlignContent()

  const clockSym = SFSymbol.named("clock")
  if (clockSym) {
    const clockImg = footRow.addImage(clockSym.image)
    clockImg.imageSize = new Size(10, 10)
    clockImg.tintColor = new Color("#ffffff", 0.8)
    footRow.addSpacer(4)
  }

  // Texto de limite estrito para que NUNCA apareça "..."
  const resetTxt = footRow.addText(data.resetStr)
  resetTxt.font = Font.systemFont(8)
  resetTxt.textColor = new Color("#ffffff", 0.8)
  resetTxt.lineLimit = 1

  footRow.addSpacer()

  // Badge Reduzida
  if (data.badgeStr !== "--") {
    const badge = footRow.addStack()
    badge.backgroundColor = new Color("#ffffff", 0.15)
    badge.cornerRadius = 5
    badge.setPadding(2, 4, 2, 4) // Badge mais enxuta
    badge.centerAlignContent()

    const calSym = SFSymbol.named("calendar")
    if (calSym) {
      const calImg = badge.addImage(calSym.image)
      calImg.imageSize = new Size(8, 8) // Ícone menor
      calImg.tintColor = Color.white()
      badge.addSpacer(3)
    }

    const bTxt = badge.addText(data.badgeStr)
    bTxt.font = Font.mediumSystemFont(7) // Texto sutilmente menor
    bTxt.textColor = Color.white()
    bTxt.lineLimit = 1
  }
}

// Inserção indexada
for (let r = 0; r < 4; r++) {
  const leftItem = unifiedCards[r * 2]
  const rightItem = unifiedCards[r * 2 + 1]

  buildCard(leftCol, leftItem)
  buildCard(rightCol, rightItem)

  if (r < 3) {
    leftCol.addSpacer(8)
    rightCol.addSpacer(8)
  }
}

Script.setWidget(w)
if (!config.runsInWidget) await w.presentLarge()
Script.complete()
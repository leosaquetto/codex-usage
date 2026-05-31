// Analítica do Codex — Scriptable Widget
// Small + Medium
// Somente leitura/renderização.
// Fonte única: codex_usage.json público no GitHub.

const GITHUB_OWNER = "leosaquetto"
const GITHUB_REPO = "codex-usage"
const GITHUB_BRANCH_PRODUCTION = "usage-data"
const GITHUB_BRANCH_STAGING = "staging"
const GITHUB_USAGE_PATH = "codex_usage.json"
const REMOTE_USAGE_URL_PRODUCTION = "https://raw.githubusercontent.com/leosaquetto/codex-usage/usage-data/codex_usage.json"
const REMOTE_USAGE_URL_STAGING = "https://raw.githubusercontent.com/leosaquetto/codex-usage/staging/codex_usage.json"
const REMOTE_USAGE_URL = REMOTE_USAGE_URL_PRODUCTION
const REMOTE_USAGE_BRANCH = GITHUB_BRANCH_PRODUCTION

const LOGO_URL = "https://i.imgur.com/JuMv8GO.png"

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

function cacheBusted(url) {
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}t=${Date.now()}`
}

function decodeBase64Json(content) {
  const normalized = String(content || "").replace(/\s/g, "")
  const decoded = Data.fromBase64String(normalized).toRawString()
  return JSON.parse(decoded)
}

async function fetchRawJson(url) {
  const req = new Request(cacheBusted(url))
  req.timeoutInterval = 8
  req.headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache"
  }

  const rawBody = await req.loadString()
  const statusCode = Number(req.response?.statusCode || 0)

  let payload = null
  try {
    payload = rawBody ? JSON.parse(rawBody) : null
  } catch {
    payload = null
  }

  if (statusCode < 200 || statusCode >= 300) {
    const apiMessage = payload && payload.error ? String(payload.error) : ""
    const bodySnippet = String(rawBody || "").replace(/\s+/g, " ").slice(0, 120)
    const details = apiMessage || bodySnippet || "sem detalhes"
    throw new Error(`HTTP ${statusCode || "sem status"} em fonte raw: ${details}`)
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Resposta raw inválida: corpo não é JSON objeto")
  }

  return payload
}

async function fetchGithubContentsJson(path, branch, fallbackRawUrl) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(branch)}`

  try {
    const req = new Request(cacheBusted(apiUrl))
    req.timeoutInterval = 10
    req.headers = {
      Accept: "application/vnd.github+json",
      "Cache-Control": "no-cache",
      "X-GitHub-Api-Version": "2022-11-28"
    }

    const rawBody = await req.loadString()
    const statusCode = Number(req.response?.statusCode || 0)

    let payload = null
    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = null
    }

    if (statusCode < 200 || statusCode >= 300) {
      const apiMessage = payload && payload.message ? String(payload.message) : ""
      const bodySnippet = String(rawBody || "").replace(/\s+/g, " ").slice(0, 120)
      const details = apiMessage || bodySnippet || "sem detalhes"
      throw new Error(`GitHub API HTTP ${statusCode || "sem status"}: ${details}`)
    }

    if (!payload || typeof payload !== "object" || !payload.content) {
      throw new Error("GitHub API não retornou content")
    }

    return decodeBase64Json(payload.content)
  } catch (error) {
    if (!fallbackRawUrl) throw error
    return await fetchRawJson(fallbackRawUrl)
  }
}

async function fetchRemoteUsage() {
  const payload = await fetchGithubContentsJson(GITHUB_USAGE_PATH, REMOTE_USAGE_BRANCH, REMOTE_USAGE_URL)
  const normalized = normalizeUsage(payload)

  if (!hasValidPercentPair(normalized)) {
    throw new Error("payload remoto sem percentuais válidos")
  }

  return normalized
}

function errorToMessage(error) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

let data = emptyUsageData()
let dataLoadWarning = ""

try {
  data = await fetchRemoteUsage()
} catch (error) {
  data = emptyUsageData()
  dataLoadWarning = `API indisponível. Rode o atualizador. ${errorToMessage(error).slice(0, 110)}`
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

function formatDurationPlain(ms) {
  if (!Number.isFinite(ms)) return "--"
  if (ms <= 0) return "agora"

  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatCompact(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const totalMins = Math.floor(ms / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatResetLine(ms, date) {
  if (!date || !Number.isFinite(ms)) return "reset --"
  const duration = formatDurationPlain(ms)

  if (ms <= 12 * 3600000) {
    return `reset em ${duration} às ${formatClock(date)}`
  }

  return `reset em ${duration} em ${formatShortDate(date)}`
}

function hoursFromMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return ms / 3600000
}

function daysFromMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return ms / 86400000
}

function formatRatePerHour(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "--/h"
  if (n > 0 && n < 0.1) return `${n.toFixed(2)}%/h`
  return `${round1(n)}%/h`
}

function formatRatePerDay(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "--/d"
  if (n > 0 && n < 0.1) return `${n.toFixed(2)}%/d`
  return `${round1(n)}%/d`
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

// Helpers para ícones locais (fallback para SF Symbols)
function getAsset(name) {
  const fm = FileManager.iCloud();
  const dirPath = "Analítica do Codex/assets/" + name;
  let path = fm.joinPath(fm.documentsDirectory(), dirPath);
  
  if (!fm.fileExists(path)) {
    const localFm = FileManager.local();
    path = localFm.joinPath(localFm.documentsDirectory(), dirPath);
    if (!localFm.fileExists(path)) return null;
    return localFm.readImage(path);
  }
  return fm.readImage(path);
}

function getIcon(name, sfFallback) {
  const img = getAsset(name);
  if (img) return img;
  const sym = SFSymbol.named(sfFallback);
  return sym ? sym.image : null;
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

function computeCombinedMetrics() {
  const fiveRemaining = clampPercent(data.fiveHourPercent, null)
  const weeklyRemaining = clampPercent(data.weeklyPercent, null)

  const fiveHoursLeft = hoursFromMs(fiveMs)
  const weeklyHoursLeft = hoursFromMs(weeklyMs)
  const weeklyDaysLeft = daysFromMs(weeklyMs)

  const fiveSafePerHour =
    fiveRemaining !== null && fiveHoursLeft
      ? fiveRemaining / fiveHoursLeft
      : null

  const weeklySafePerHour =
    weeklyRemaining !== null && weeklyHoursLeft
      ? weeklyRemaining / weeklyHoursLeft
      : null

  const weeklySafePerDay =
    weeklyRemaining !== null && weeklyDaysLeft
      ? weeklyRemaining / weeklyDaysLeft
      : null

  let combinedSafePerHour = null
  let bottleneck = "--"

  if (fiveSafePerHour !== null && weeklySafePerHour !== null) {
    if (weeklySafePerHour < fiveSafePerHour) {
      combinedSafePerHour = weeklySafePerHour
      bottleneck = "semanal"
    } else {
      combinedSafePerHour = fiveSafePerHour
      bottleneck = "5h"
    }
  } else if (fiveSafePerHour !== null) {
    combinedSafePerHour = fiveSafePerHour
    bottleneck = "5h"
  } else if (weeklySafePerHour !== null) {
    combinedSafePerHour = weeklySafePerHour
    bottleneck = "semanal"
  }

  return {
    fiveSafePerHour,
    weeklySafePerHour,
    weeklySafePerDay,
    combinedSafePerHour,
    bottleneck
  }
}

const weeklyMetrics = computeWeeklyMetrics()
const fiveMetrics = computeFiveMetrics()
const combinedMetrics = computeCombinedMetrics()
const logo = await loadLogo()

// Barra de progresso customizada (com gradiente e sempre da esquerda)
function progressWidth(percent, barWidth) {
  const n = Number(percent)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(4, barWidth * (Math.max(0, Math.min(100, n)) / 100))
}

function addGradientProgressBar(parent, percent, width) {
  const bg = parent.addStack();
  bg.layoutHorizontally(); // crucial para começar da esquerda
  bg.size = new Size(width, 6);
  bg.backgroundColor = new Color("#ffffff", 0.15);
  bg.cornerRadius = 3;

  const fillWidth = progressWidth(percent, width);
  if (fillWidth > 0) {
    const fill = bg.addStack();
    fill.size = new Size(fillWidth, 6);
    fill.cornerRadius = 3;
    
    const grad = new LinearGradient();
    grad.colors = [new Color("#7b88ff"), new Color("#a2abff")];
    grad.locations = [0, 1];
    fill.backgroundGradient = grad;
  }
  bg.addSpacer();
}

// ==========================================
// WIDGET PEQUENO (NOVO LAYOUT – MARGENS AUMENTADAS)
// ==========================================
function createSmallWidget() {
  const w = new ListWidget();
  w.setPadding(13, 15, 16, 14); // margens externas maiores
  
  const bgGrad = new LinearGradient();
  bgGrad.colors = [new Color("#2c344b"), new Color("#161a29")];
  bgGrad.locations = [0, 1];
  w.backgroundGradient = bgGrad;

  const mainStack = w.addStack();
  mainStack.layoutVertically();

  // --- TOPO: hora, timer e logo ---
  const topRow = mainStack.addStack();
  topRow.centerAlignContent();

  const timeLabel = topRow.addText(formatClock(now));
  timeLabel.font = Font.systemFont(9);
  timeLabel.textColor = mutedColor(0.6);

  topRow.addSpacer(6);

  const timerBadge = topRow.addStack();
  timerBadge.backgroundColor = new Color("#ffffff", 0.1);
  timerBadge.cornerRadius = 4;
  timerBadge.setPadding(2, 5, 2, 5);
  timerBadge.centerAlignContent();

  const timerIcon = getIcon("timer.png", "timer");
  if (timerIcon) {
    const ti = timerBadge.addImage(timerIcon);
    ti.imageSize = new Size(9, 9);
    ti.tintColor = Color.white();
    timerBadge.addSpacer(3);
  }
  const timerText = timerBadge.addText(formatCompact(fiveMs));
  timerText.font = Font.systemFont(8);
  timerText.textColor = Color.white();

  topRow.addSpacer();

  if (logo) {
    const logoImg = topRow.addImage(logo);
    logoImg.imageSize = new Size(20, 20);
  }

  mainStack.addSpacer(6);

  // --- BLOCO 5H ---
  const row5h = mainStack.addStack();
  row5h.bottomAlignContent();

  const p5 = row5h.addText(formatPercent(data.fiveHourPercent));
  p5.font = Font.boldSystemFont(32);
  p5.textColor = Color.white();
  p5.minimumScaleFactor = 0.7;
  p5.lineLimit = 1;

  row5h.addSpacer(26);

  const info5h = row5h.addStack();
  info5h.layoutVertically();
  info5h.addSpacer(0);

  const tag5h = info5h.addStack();
  tag5h.backgroundColor = new Color("#ffffff", 0.2);
  tag5h.cornerRadius = 3;
  tag5h.setPadding(1, 4, 1, 4);
  const tag5hText = tag5h.addText("5 HORAS");
  tag5hText.font = Font.boldSystemFont(7);
  tag5hText.textColor = Color.white();

  info5h.addSpacer(3);

  const rate5hStack = info5h.addStack();
  rate5hStack.centerAlignContent();
  const spark5h = getIcon("sparks.png", "sparkles");
  if (spark5h) {
    const sImg = rate5hStack.addImage(spark5h);
    sImg.imageSize = new Size(10, 10);
    sImg.tintColor = new Color("#a2abff");
    rate5hStack.addSpacer(3);
  }
  const r5h = rate5hStack.addText(formatRatePerHour(combinedMetrics.fiveSafePerHour));
  r5h.font = Font.boldSystemFont(9);
  r5h.textColor = Color.white();

  mainStack.addSpacer(6);
  addGradientProgressBar(mainStack, data.fiveHourPercent, 135);
  mainStack.addSpacer(8);

  // Linha divisória fina
  const divider = mainStack.addStack();
  divider.size = new Size(135, 1);  // largura igual à da barra de progresso (135)
  divider.backgroundColor = new Color("#ffffff", 0.18);
  divider.cornerRadius = 0.5;

  mainStack.addSpacer(5);

  // --- BLOCO SEMANAL ---
  const rowW = mainStack.addStack();
  rowW.bottomAlignContent();

  const pW = rowW.addText(formatPercent(data.weeklyPercent));
  pW.font = Font.boldSystemFont(35);
  pW.textColor = Color.white();
  pW.minimumScaleFactor = 0.7;
  pW.lineLimit = 1;

  rowW.addSpacer(34);

  const infoW = rowW.addStack();
  infoW.layoutVertically();
  infoW.addSpacer(2);

  const tagW = infoW.addStack();
  tagW.backgroundColor = new Color("#ffffff", 0.2);
  tagW.cornerRadius = 3;
  tagW.setPadding(1, 4, 1, 4);
  const tagWText = tagW.addText("SEMANAL");
  tagWText.font = Font.boldSystemFont(7);
  tagWText.textColor = Color.white();

  infoW.addSpacer(3);

  const rateWStack = infoW.addStack();
  rateWStack.centerAlignContent();
  const sparkW = getIcon("sparks.png", "sparkles");
  if (sparkW) {
    const sImgW = rateWStack.addImage(sparkW);
    sImgW.imageSize = new Size(10, 10);
    sImgW.tintColor = new Color("#a2abff");
    rateWStack.addSpacer(3);
  }
  // CORREÇÃO: alterado de formatRatePerHour para formatRatePerDay com o valor diário
  const rW = rateWStack.addText(formatRatePerDay(combinedMetrics.weeklySafePerDay));
  rW.font = Font.boldSystemFont(9);
  rW.textColor = Color.white();

  mainStack.addSpacer(6);
  addGradientProgressBar(mainStack, data.weeklyPercent, 135);
  mainStack.addSpacer(10);

  // --- FOOTER COM ÍCONES ---
  const footer = mainStack.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();

  function addFooterItem(parent, iconName, sfFallback, text) {
    const item = parent.addStack();
    item.backgroundColor = new Color("#ffffff", 0.1);
    item.cornerRadius = 4;
    item.setPadding(3, 3, 3, 4);
    item.centerAlignContent();

    const icon = getIcon(iconName, sfFallback);
    if (icon) {
      const img = item.addImage(icon);
      img.imageSize = new Size(9, 9);
      img.tintColor = new Color("#a2abff");
      item.addSpacer(2);
    }
    const t = item.addText(text);
    t.font = Font.systemFont(8);
    t.textColor = Color.white();
    return item;
  }

  // Tempo decorrido do ciclo semanal
  let elapsedStr = "--";
  if (weeklyMetrics.weeklyStartTime) {
    const elapsedMs = Math.max(0, now.getTime() - weeklyMetrics.weeklyStartTime.getTime());
    elapsedStr = formatCompact(elapsedMs);
  }

  addFooterItem(footer, "timer.png", "clock", formatCompact(weeklyMs));
  footer.addSpacer(2);
  addFooterItem(footer, "calendar.png", "calendar", formatShortDate(weeklyResetTime));
  footer.addSpacer(2);
  addFooterItem(footer, "calendar_time.png", "calendar.badge.clock", elapsedStr);

  return w;
}

// ==========================================
// WIDGET MÉDIO (mantido original)
// ==========================================
function buildDashboardCard(parent, title, percent, msUntil, resetDisplay, barWidth, options = {}) {
  const inactive = Boolean(options.inactive)
  const secondaryText = options.secondaryText || ""
  const tertiaryText = options.tertiaryText || ""
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

  const resetText = hasPercent ? resetDisplay : "sem dados válidos"
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

  if (tertiaryText) {
    card.addSpacer(1)
    const third = card.addText(tertiaryText)
    third.font = Font.systemFont(7)
    third.textColor = mutedColor(0.62)
    third.minimumScaleFactor = 0.55
    third.lineLimit = 1
  }

  return card
}

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

  const timeStr = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })

  header.addSpacer(4)
  const timeLabel = header.addText(timeStr)
  timeLabel.font = Font.systemFont(7)
  timeLabel.textColor = mutedColor(0.55)
  timeLabel.minimumScaleFactor = 0.6
  timeLabel.lineLimit = 1

  header.addSpacer()
}

function createMediumWidget() {
  const w = new ListWidget()
  w.setPadding(15, 14, 12, 15)

  addHeader(w, false)
  w.addSpacer(8)

  const row = w.addStack()
  row.layoutHorizontally()

  const barW = 124

  const fiveDisplay = fiveHourResetTime ? formatResetLine(fiveMs, fiveHourResetTime) : "reset cheio • sem ciclo"
  const fiveInactive = !fiveHourResetTime && Number(data.fiveHourPercent) >= 100

  const fiveSecondary =
    combinedMetrics.combinedSafePerHour !== null
      ? `sugestão ${formatRatePerHour(combinedMetrics.combinedSafePerHour)}`
      : Number.isFinite(Number(data.fiveHourPercent))
        ? "sem consumo ativo"
        : "rode o atualizador"

  const fiveTertiary =
    combinedMetrics.combinedSafePerHour !== null
      ? `gargalo ${combinedMetrics.bottleneck}`
      : ""

  buildDashboardCard(
    row,
    "Limite 5h",
    data.fiveHourPercent,
    fiveMs,
    fiveDisplay,
    barW,
    {
      inactive: fiveInactive,
      secondaryText: fiveSecondary,
      tertiaryText: fiveTertiary
    }
  )

  row.addSpacer(10)

  let weeklySecondary = "rode o atualizador"
  let weeklyTertiary = ""

  if (Number.isFinite(Number(data.weeklyPercent))) {
    weeklySecondary = `sugestão ${formatRatePerHour(combinedMetrics.weeklySafePerHour)}`
    weeklyTertiary = `ou ${formatRatePerDay(combinedMetrics.weeklySafePerDay)}`
  }

  const weeklyDisplay = weeklyResetTime ? formatResetLine(weeklyMs, weeklyResetTime) : "reset --"

  buildDashboardCard(
    row,
    "Limite Semanal",
    data.weeklyPercent,
    weeklyMs,
    weeklyDisplay,
    barW,
    {
      inactive: false,
      secondaryText: weeklySecondary,
      tertiaryText: weeklyTertiary
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

// Renderização final
const widget = config.widgetFamily === "small" ? createSmallWidget() : createMediumWidget()

if (config.runsInWidget) {
  widget.refreshAfterDate = new Date(Date.now() + (30 * 60 * 1000))
}

Script.setWidget(widget)

if (!config.runsInWidget) {
  if (config.widgetFamily === "small") {
    await widget.presentSmall()
  } else {
    await widget.presentMedium()
  }
}

Script.complete()

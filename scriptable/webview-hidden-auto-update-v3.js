// Codex Analytics — WebView Hidden Auto Update v3
// Captura a página de analytics do Codex, salva codex_usage.json no iCloud
// e publica no GitHub Contents API.
// Este script é o único responsável por atualizar dados reais.
// O widget NÃO lê este cache local; o widget lê somente a API de produção.

const fm = FileManager.iCloud()
const folderPath = fm.joinPath(fm.documentsDirectory(), "Analítica do Codex")
const filePath = fm.joinPath(folderPath, "codex_usage.json")

const CODEX_ANALYTICS_URL = "https://chatgpt.com/codex/cloud/settings/analytics"
const DEFAULT_WEEKLY_RESET = "2026-04-28T19:35:00-03:00"

const GITHUB_OWNER = "leosaquetto"
const GITHUB_REPO = "codex-usage"
const GITHUB_BRANCH = "main"
const GITHUB_FILE_PATH = "codex_usage.json"
const GITHUB_TOKEN_KEYCHAIN_KEY = "codex_usage_github_token"

if (!fm.fileExists(folderPath)) fm.createDirectory(folderPath)

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function validDateFromISO(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function emptyCurrentData() {
  return {
    fiveHourPercent: null,
    fiveHourReset: null,
    weeklyPercent: null,
    weeklyReset: DEFAULT_WEEKLY_RESET,
    lastUpdated: null
  }
}

function loadCurrentData() {
  if (!fm.fileExists(filePath)) {
    return emptyCurrentData()
  }

  try {
    const data = JSON.parse(fm.readString(filePath))
    return {
      fiveHourPercent: clampPercent(data.fiveHourPercent, null),
      fiveHourReset: validDateFromISO(data.fiveHourReset)
        ? new Date(data.fiveHourReset).toISOString()
        : null,
      weeklyPercent: clampPercent(data.weeklyPercent, null),
      weeklyReset: validDateFromISO(data.weeklyReset)
        ? new Date(data.weeklyReset).toISOString()
        : DEFAULT_WEEKLY_RESET,
      lastUpdated: validDateFromISO(data.lastUpdated)
        ? new Date(data.lastUpdated).toISOString()
        : null
    }
  } catch {
    return emptyCurrentData()
  }
}

function parseFiveHourReset(clockText, now = new Date()) {
  const m = String(clockText || "").match(/(\d{1,2})[:h](\d{2})/)
  if (!m) return null

  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null

  const d = new Date(now)
  d.setHours(h, min, 0, 0)
  if (d <= now) d.setDate(d.getDate() + 1)

  return Number.isFinite(d.getTime()) ? d : null
}

function parseWeeklyReset(text) {
  const raw = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  const months = {
    jan: 0, janeiro: 0,
    fev: 1, fevereiro: 1,
    mar: 2, marco: 2,
    abr: 3, abril: 3,
    mai: 4, maio: 4,
    jun: 5, junho: 5,
    jul: 6, julho: 6,
    ago: 7, agosto: 7,
    set: 8, setembro: 8,
    out: 9, outubro: 9,
    nov: 10, novembro: 10,
    dez: 11, dezembro: 11
  }

  const m = raw.match(/(\d{1,2})\s+de\s+([a-z.]{3,12})\.?\s+de\s+(\d{4})\s+(\d{1,2})[:h](\d{2})/)
  if (!m) return null

  const day = Number(m[1])
  const month = months[m[2].replace(".", "")]
  const year = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])

  if (typeof month !== "number") return null

  const d = new Date(year, month, day, hour, minute, 0, 0)
  return Number.isFinite(d.getTime()) ? d : null
}

async function wait(ms) {
  return new Promise(resolve => Timer.schedule(ms, false, resolve))
}

async function extractFromWebView(webView) {
  const js = `
(() => {
  const text = document.body && document.body.innerText
    ? document.body.innerText.replace(/\\s+/g, " ").trim()
    : "";

  function sliceBetween(startLabel, endLabels) {
    const lower = text.toLowerCase();
    const start = lower.indexOf(startLabel.toLowerCase());
    if (start < 0) return "";

    let end = text.length;
    for (const label of endLabels) {
      const idx = lower.indexOf(label.toLowerCase(), start + startLabel.length);
      if (idx >= 0 && idx < end) end = idx;
    }

    return text.slice(start, end).trim();
  }

  function parseBlock(block) {
    if (!block) return null;

    const pct = block.match(/(\\d{1,3})\\s*%\\s*restante/i);
    const reset = block.match(/Redefinição\\s+(.+)$/i);

    return {
      percent: pct ? Number(pct[1]) : null,
      resetText: reset ? reset[1].trim() : null
    };
  }

  const five = parseBlock(sliceBetween(
    "Limite de uso de 5 horas",
    ["Limite de uso semanal", "Créditos restantes", "Configurações"]
  ));

  const weekly = parseBlock(sliceBetween(
    "Limite de uso semanal",
    ["Créditos restantes", "Configurações", "Detalhes do uso"]
  ));

  return JSON.stringify({
    url: location.href,
    title: document.title,
    fiveHourPercent: five ? five.percent : null,
    fiveHourResetText: five ? five.resetText : null,
    weeklyPercent: weekly ? weekly.percent : null,
    weeklyResetText: weekly ? weekly.resetText : null,
    pageText: text.slice(0, 800),
    capturedAt: new Date().toISOString()
  });
})();
`

  const raw = await webView.evaluateJavaScript(js, false)
  return JSON.parse(raw)
}

async function readAnalyticsHidden() {
  const webView = new WebView()

  await webView.loadHTML(`
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
window.addEventListener("error", function(e) {
  if (String(e.message || "").includes("QuotaExceededError")) {
    e.preventDefault();
  }
});
window.addEventListener("unhandledrejection", function(e) {
  if (String(e.reason || "").includes("QuotaExceededError")) {
    e.preventDefault();
  }
});
</script>
</head>
<body></body>
</html>
`)

  await wait(500)
  await webView.loadURL(CODEX_ANALYTICS_URL)

  let last = null

  for (let i = 0; i < 14; i++) {
    await wait(1600)

    try {
      last = await extractFromWebView(webView)
    } catch (error) {
      last = {
        error: String(error),
        capturedAt: new Date().toISOString()
      }
    }

    if (
      last &&
      clampPercent(last.fiveHourPercent, null) !== null &&
      clampPercent(last.weeklyPercent, null) !== null
    ) {
      return last
    }
  }

  throw new Error(
    "WebView não extraiu os limites. Amostra: " +
    JSON.stringify(last, null, 2)
  )
}

function validateNextData(next) {
  const five = clampPercent(next.fiveHourPercent, null)
  const weekly = clampPercent(next.weeklyPercent, null)

  if (five === null || weekly === null) {
    throw new Error(
      "Dados inválidos: percentuais ausentes. " +
      JSON.stringify({
        fiveHourPercent: next.fiveHourPercent,
        weeklyPercent: next.weeklyPercent
      })
    )
  }

  if (!validDateFromISO(next.lastUpdated)) {
    throw new Error("Dados inválidos: lastUpdated ausente/inválido.")
  }

  if (next.fiveHourReset !== null && !validDateFromISO(next.fiveHourReset)) {
    throw new Error("Dados inválidos: fiveHourReset inválido.")
  }

  if (!validDateFromISO(next.weeklyReset)) {
    throw new Error("Dados inválidos: weeklyReset inválido.")
  }

  return {
    fiveHourPercent: five,
    fiveHourReset: next.fiveHourReset,
    weeklyPercent: weekly,
    weeklyReset: new Date(next.weeklyReset).toISOString(),
    lastUpdated: new Date(next.lastUpdated).toISOString()
  }
}

function buildNextData(current, extracted) {
  const now = new Date()

  const fivePercent = clampPercent(extracted.fiveHourPercent, null)
  const weeklyPercent = clampPercent(extracted.weeklyPercent, null)

  if (fivePercent === null || weeklyPercent === null) {
    throw new Error(
      "Extração sem percentuais válidos: " +
      JSON.stringify({
        fiveHourPercent: extracted.fiveHourPercent,
        weeklyPercent: extracted.weeklyPercent,
        pageText: extracted.pageText
      })
    )
  }

  const next = {
    fiveHourPercent: fivePercent,
    fiveHourReset: current.fiveHourReset || null,
    weeklyPercent: weeklyPercent,
    weeklyReset: current.weeklyReset || DEFAULT_WEEKLY_RESET,
    lastUpdated: now.toISOString()
  }

  if (fivePercent >= 100) {
    next.fiveHourPercent = 100
    next.fiveHourReset = null
  } else {
    const fiveReset = parseFiveHourReset(extracted.fiveHourResetText, now)
    if (fiveReset) {
      next.fiveHourReset = fiveReset.toISOString()
    }
  }

  const weeklyReset = parseWeeklyReset(extracted.weeklyResetText)
  if (weeklyReset) {
    next.weeklyReset = weeklyReset.toISOString()
  }

  return validateNextData(next)
}

function getGithubToken() {
  if (!Keychain.contains(GITHUB_TOKEN_KEYCHAIN_KEY)) {
    throw new Error(`Token ausente no Keychain: ${GITHUB_TOKEN_KEYCHAIN_KEY}`)
  }
  return Keychain.get(GITHUB_TOKEN_KEYCHAIN_KEY)
}

function githubApiUrl(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/")
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`
}

async function getRepoFileSha(path, branch, token) {
  const req = new Request(`${githubApiUrl(path)}?ref=${encodeURIComponent(branch)}`)
  req.method = "GET"
  req.headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  }

  let rawPayload = null

  try {
    rawPayload = await req.loadString()
    const payload = rawPayload ? JSON.parse(rawPayload) : null
    return payload && payload.sha ? payload.sha : null
  } catch (error) {
    const statusCode = Number(req.response?.statusCode || 0)
    if (statusCode === 404) return null

    throw new Error(
      `Falha ao buscar SHA no GitHub (${statusCode || "sem status"}): ${String(error)} | payload bruto: ${rawPayload || "<vazio>"}`
    )
  }
}

async function upsertRepoJsonFile(path, branch, jsonText) {
  const token = getGithubToken()
  const existingSha = await getRepoFileSha(path, branch, token)

  const body = {
    message: `chore(data): update ${path} via Scriptable [skip ci]`,
    content: Data.fromString(jsonText).toBase64String(),
    branch
  }

  if (existingSha) body.sha = existingSha

  const req = new Request(githubApiUrl(path))
  req.method = "PUT"
  req.headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  }
  req.body = JSON.stringify(body)

  let rawResponse = null
  let response = null

  try {
    rawResponse = await req.loadString()
    response = rawResponse ? JSON.parse(rawResponse) : null
  } catch (error) {
    const statusCode = Number(req.response?.statusCode || 0)
    throw new Error(
      `Falha no PUT do arquivo no GitHub (${statusCode || "sem status"}): ${String(error)} | payload bruto: ${rawResponse || "<vazio>"}`
    )
  }

  if (!response?.commit?.sha) {
    const statusCode = Number(req.response?.statusCode || 0)
    throw new Error(
      `GitHub não retornou commit SHA na atualização do arquivo (${statusCode || "sem status"}): ${JSON.stringify(response)}`
    )
  }

  return {
    commitSha: response.commit.sha,
    htmlUrl: response.commit.html_url || null,
    branch,
    path
  }
}

async function main() {
  const current = loadCurrentData()
  const extracted = await readAnalyticsHidden()
  const next = buildNextData(current, extracted)

  const nextJson = JSON.stringify(next, null, 2)
  JSON.parse(nextJson)

  fm.writeString(filePath, nextJson)

  const repoUpdate = await upsertRepoJsonFile(
    GITHUB_FILE_PATH,
    GITHUB_BRANCH,
    nextJson
  )

  Script.setShortcutOutput(JSON.stringify({
    ok: true,
    saved: next,
    repoUpdate,
    extracted: {
      fiveHourPercent: extracted.fiveHourPercent,
      fiveHourResetText: extracted.fiveHourResetText,
      weeklyPercent: extracted.weeklyPercent,
      weeklyResetText: extracted.weeklyResetText
    }
  }, null, 2))
}

await main()
Script.complete()

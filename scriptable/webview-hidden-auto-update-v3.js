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
const GITHUB_BRANCH = "usage-data"
const GITHUB_FILE_PATH = "codex_usage.json"
const GITHUB_HISTORY_FILE_PATH = "codex_usage_history.json"
const GITHUB_SUMMARY_FILE_PATH = "usage_summary.json"
const REMOTE_CODEX_HISTORY_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_HISTORY_FILE_PATH}`
const REMOTE_ANTIGRAVITY_USAGE_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/antigravity_usage.json`
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

function normalizeHistorySample(raw) {
  const capturedAtDate = validDateFromISO(raw && (raw.capturedAt || raw.lastUpdated))
  const weeklyResetDate = validDateFromISO(raw && raw.weeklyReset)
  const fiveHourPercent = clampPercent(raw && raw.fiveHourPercent, null)
  const weeklyPercent = clampPercent(raw && raw.weeklyPercent, null)

  if (!capturedAtDate || !weeklyResetDate || fiveHourPercent === null || weeklyPercent === null) {
    return null
  }

  const fiveHourResetDate = validDateFromISO(raw && raw.fiveHourReset)
  return {
    capturedAt: capturedAtDate.toISOString(),
    fiveHourPercent,
    fiveHourReset: fiveHourResetDate ? fiveHourResetDate.toISOString() : null,
    weeklyPercent,
    weeklyReset: weeklyResetDate.toISOString()
  }
}

function normalizeHistory(raw) {
  const samples = Array.isArray(raw && raw.samples)
    ? raw.samples.map(normalizeHistorySample).filter(Boolean)
    : []
  const byCapturedAt = {}

  for (const sample of samples) {
    byCapturedAt[sample.capturedAt] = sample
  }

  const sorted = Object.values(byCapturedAt).sort((a, b) => {
    return new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()
  })

  return {
    version: 1,
    lastUpdated: sorted.length ? sorted[sorted.length - 1].capturedAt : null,
    samples: sorted
  }
}

function appendCodexUsageSample(history, payload) {
  const normalized = normalizeHistory(history)
  const sample = normalizeHistorySample({
    capturedAt: payload.lastUpdated,
    fiveHourPercent: payload.fiveHourPercent,
    fiveHourReset: payload.fiveHourReset,
    weeklyPercent: payload.weeklyPercent,
    weeklyReset: payload.weeklyReset
  })

  if (!sample) throw new Error("Histórico inválido: payload Codex não gerou uma amostra válida.")

  const byCapturedAt = {}
  for (const current of normalized.samples) byCapturedAt[current.capturedAt] = current
  byCapturedAt[sample.capturedAt] = sample

  const samples = Object.values(byCapturedAt)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .slice(-2000)

  return {
    version: 1,
    lastUpdated: samples.length ? samples[samples.length - 1].capturedAt : sample.capturedAt,
    samples
  }
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

async function installNoiseFilter(webView) {
  try {
    await webView.evaluateJavaScript(`
(() => {
  if (window.__codexUsageNoiseFilterInstalled) return true;
  window.__codexUsageNoiseFilterInstalled = true;

  const noisePatterns = [
    "QuotaExceededError",
    "@formatjs/intl Error MISSING_TRANSLATION",
    "MISSING_TRANSLATION",
    "codex.analytics."
  ];

  const isNoise = (value) => {
    const text = String(value || "");
    return noisePatterns.some(pattern => text.includes(pattern));
  };

  window.addEventListener("error", function(e) {
    const message = String(e && e.message ? e.message : "");
    const detail = String(e && e.error ? (e.error.stack || e.error.message || e.error) : "");
    if (isNoise(message) || isNoise(detail)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    }
  }, true);

  window.addEventListener("unhandledrejection", function(e) {
    const reason = e && e.reason;
    const detail = String(reason && (reason.stack || reason.message || reason));
    if (isNoise(detail)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    }
  }, true);

  const origError = console.error;
  const origWarn = console.warn;
  const patch = (origFn) => function(...args) {
    const text = args.map(v => String(v || "")).join(" ");
    if (isNoise(text)) return;
    return origFn.apply(this, args);
  };
  console.error = patch(origError);
  console.warn = patch(origWarn);

  return true;
})();
`, false)
  } catch {}
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

    const pct = block.match(/(\\d{1,3})\\s*%\\s*(?:restante|remaining)/i);
    const reset = block.match(/(?:Redefinição|Reset|Resets)\\s+(.+)$/i);

    return {
      percent: pct ? Number(pct[1]) : null,
      resetText: reset ? reset[1].trim() : null
    };
  }

  const five = parseBlock(sliceBetween(
    "Limite de uso de 5 horas",
    [
      "Limite de uso semanal", "Weekly usage limit",
      "Créditos restantes", "Credits remaining",
      "Configurações", "Settings"
    ]
  ));

  const fiveEn = parseBlock(sliceBetween(
    "5-hour usage limit",
    [
      "Limite de uso semanal", "Weekly usage limit",
      "Créditos restantes", "Credits remaining",
      "Configurações", "Settings"
    ]
  )) || parseBlock(sliceBetween(
    "5 hour usage limit",
    [
      "Limite de uso semanal", "Weekly usage limit",
      "Créditos restantes", "Credits remaining",
      "Configurações", "Settings"
    ]
  ));

  const weekly = parseBlock(sliceBetween(
    "Limite de uso semanal",
    [
      "Créditos restantes", "Credits remaining",
      "Configurações", "Settings",
      "Detalhes do uso", "Usage details"
    ]
  ));

  const weeklyEn = parseBlock(sliceBetween(
    "Weekly usage limit",
    [
      "Créditos restantes", "Credits remaining",
      "Configurações", "Settings",
      "Detalhes do uso", "Usage details"
    ]
  ));

  return JSON.stringify({
    url: location.href,
    title: document.title,
    fiveHourPercent: (five && five.percent !== null) ? five.percent : (fiveEn ? fiveEn.percent : null),
    fiveHourResetText: (five && five.resetText) ? five.resetText : (fiveEn ? fiveEn.resetText : null),
    weeklyPercent: (weekly && weekly.percent !== null) ? weekly.percent : (weeklyEn ? weeklyEn.percent : null),
    weeklyResetText: (weekly && weekly.resetText) ? weekly.resetText : (weeklyEn ? weeklyEn.resetText : null),
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
  if (
    String(e.message || "").includes("QuotaExceededError") ||
    String(e.message || "").includes("MISSING_TRANSLATION") ||
    String(e.message || "").includes("codex.analytics.")
  ) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
}, true);
window.addEventListener("unhandledrejection", function(e) {
  if (
    String(e.reason || "").includes("QuotaExceededError") ||
    String(e.reason || "").includes("MISSING_TRANSLATION") ||
    String(e.reason || "").includes("codex.analytics.")
  ) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
}, true);
</script>
</head>
<body></body>
</html>
`)

  await wait(500)
  await webView.loadURL(CODEX_ANALYTICS_URL)
  await wait(300)
  await installNoiseFilter(webView)

  let last = null

  for (let i = 0; i < 14; i++) {
    await wait(1600)

    try {
      await installNoiseFilter(webView)
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

function githubGitApiUrl(path) {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/${path}`
}

async function githubJsonRequest(url, options = {}) {
  const token = getGithubToken()
  const req = new Request(url)
  req.method = options.method || "GET"
  req.headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  }
  if (options.body) req.body = JSON.stringify(options.body)

  let raw = null
  try {
    raw = await req.loadString()
  } catch (error) {
    const statusCode = Number(req.response?.statusCode || 0)
    throw new Error(
      `Falha GitHub API (${statusCode || "sem status"}) em ${url}: ${String(error)} | payload bruto: ${raw || "<vazio>"}`
    )
  }

  const statusCode = Number(req.response?.statusCode || 0)
  const payload = raw ? JSON.parse(raw) : null
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`GitHub API retornou HTTP ${statusCode} em ${url}: ${raw || "<vazio>"}`)
  }
  return payload
}

async function publishRepoJsonFilesAtomic(files) {
  const refName = `heads/${GITHUB_BRANCH}`
  const ref = await githubJsonRequest(githubGitApiUrl(`ref/${refName}`))
  const parentSha = ref?.object?.sha
  if (!parentSha) throw new Error(`GitHub não retornou SHA da branch ${GITHUB_BRANCH}.`)

  const parentCommit = await githubJsonRequest(githubGitApiUrl(`commits/${parentSha}`))
  const baseTreeSha = parentCommit?.tree?.sha
  if (!baseTreeSha) throw new Error(`GitHub não retornou tree SHA do commit ${parentSha}.`)

  const tree = files.map(file => ({
    path: file.path,
    mode: "100644",
    type: "blob",
    content: file.content
  }))

  const newTree = await githubJsonRequest(githubGitApiUrl("trees"), {
    method: "POST",
    body: {
      base_tree: baseTreeSha,
      tree
    }
  })
  if (!newTree?.sha) throw new Error("GitHub não retornou SHA da tree com os arquivos de uso.")

  const newCommit = await githubJsonRequest(githubGitApiUrl("commits"), {
    method: "POST",
    body: {
      message: "chore(data): update Codex usage summary via Scriptable [skip ci]",
      tree: newTree.sha,
      parents: [parentSha]
    }
  })
  if (!newCommit?.sha) throw new Error("GitHub não retornou SHA do commit atomicamente criado.")

  const updatedRef = await githubJsonRequest(githubGitApiUrl(`refs/${refName}`), {
    method: "PATCH",
    body: {
      sha: newCommit.sha,
      force: false
    }
  })

  return {
    commitSha: newCommit.sha,
    htmlUrl: newCommit.html_url || null,
    branch: GITHUB_BRANCH,
    paths: files.map(file => file.path),
    refSha: updatedRef?.object?.sha || null
  }
}

async function fetchRemoteJson(url, fallback) {
  const req = new Request(`${url}?t=${Date.now()}`)
  req.method = "GET"
  req.headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache"
  }
  req.timeoutInterval = 8

  try {
    const raw = await req.loadString()
    const statusCode = Number(req.response?.statusCode || 0)
    if (statusCode < 200 || statusCode >= 300) return fallback
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function latestIso(...values) {
  const times = values
    .map(value => {
      const date = validDateFromISO(value)
      return date ? date.getTime() : null
    })
    .filter(value => value !== null)

  if (times.length === 0) return new Date().toISOString()
  return new Date(Math.max(...times)).toISOString()
}

function validateUsageSummary(summary, codex) {
  const codexLastUpdated = codex?.lastUpdated || null
  const summaryLastUpdated = summary?.lastUpdated || null
  const summaryCodexLastUpdated = summary?.codex?.lastUpdated || null
  const codexTime = validDateFromISO(codexLastUpdated)?.getTime() || null
  const summaryTime = validDateFromISO(summaryLastUpdated)?.getTime() || null

  if (!codexTime) {
    throw new Error("Validação pós-update falhou: codex_usage.lastUpdated ausente ou inválido.")
  }

  if (summaryCodexLastUpdated !== codexLastUpdated) {
    throw new Error(
      `Validação pós-update falhou: usage_summary.codex.lastUpdated (${summaryCodexLastUpdated || "<ausente>"}) ` +
      `difere de codex_usage.lastUpdated (${codexLastUpdated}).`
    )
  }

  if (!summaryTime || summaryTime < codexTime) {
    throw new Error(
      `Validação pós-update falhou: usage_summary.lastUpdated (${summaryLastUpdated || "<ausente>"}) ` +
      `é mais antigo que codex_usage.lastUpdated (${codexLastUpdated}).`
    )
  }
}

async function buildUsageSummary(codex) {
  const remoteHistory = await fetchRemoteJson(REMOTE_CODEX_HISTORY_URL, {
    version: 1,
    lastUpdated: null,
    samples: []
  })
  const codexHistory = appendCodexUsageSample(remoteHistory, codex)
  const antigravity = await fetchRemoteJson(REMOTE_ANTIGRAVITY_USAGE_URL, {
    source: "desktop-automation",
    lastUpdated: null,
    models: []
  })

  return {
    lastUpdated: latestIso(codex.lastUpdated, codexHistory.lastUpdated, antigravity.lastUpdated),
    codex,
    codexHistory,
    antigravity
  }
}

async function main() {
  const current = loadCurrentData()
  const extracted = await readAnalyticsHidden()
  const next = buildNextData(current, extracted)

  const nextJson = JSON.stringify(next, null, 2)
  JSON.parse(nextJson)

  fm.writeString(filePath, nextJson)

  const summary = await buildUsageSummary(next)
  const historyJson = JSON.stringify(summary.codexHistory, null, 2)
  JSON.parse(historyJson)
  const summaryJson = JSON.stringify(summary, null, 2)
  JSON.parse(summaryJson)
  validateUsageSummary(summary, next)
  const repoUpdate = await publishRepoJsonFilesAtomic([
    { path: GITHUB_FILE_PATH, content: nextJson + "\n" },
    { path: GITHUB_HISTORY_FILE_PATH, content: historyJson + "\n" },
    { path: GITHUB_SUMMARY_FILE_PATH, content: summaryJson + "\n" }
  ])

  Script.setShortcutOutput(JSON.stringify({
    ok: true,
    saved: next,
    repoUpdate,
    summaryUpdate: repoUpdate,
    lastUpdated: {
      codex_usage: next.lastUpdated,
      usage_summary: summary.lastUpdated,
      usage_summary_codex: summary.codex.lastUpdated
    },
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

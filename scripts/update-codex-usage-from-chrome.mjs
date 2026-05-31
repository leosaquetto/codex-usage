#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendCodexUsageSample } from "./codex-usage-history.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const codexUsagePath = resolve(root, "codex_usage.json");
const historyPath = resolve(root, "codex_usage_history.json");
const summaryPath = resolve(root, "usage_summary.json");
const analyticsUrl = "https://chatgpt.com/codex/cloud/settings/analytics";
const githubOwner = "leosaquetto";
const githubRepo = "codex-usage";
const githubBranch = "usage-data";
const githubTokenKeychainService = "codex_usage_github_token";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, true);
  }
}

function usage() {
  return [
    "Usage:",
    "  node scripts/update-codex-usage-from-chrome.mjs",
    "  node scripts/update-codex-usage-from-chrome.mjs --publish",
    "  node scripts/update-codex-usage-from-chrome.mjs --text scripts/fixtures/codex-usage-pt.txt",
    "",
    "Chrome must be signed in to ChatGPT/Codex.",
    "Enable Chrome > View > Developer > Allow JavaScript from Apple Events.",
    "No OpenAI API key is used.",
  ].join("\n");
}

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace("%", "").replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function validDateFromISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function readCurrentData() {
  try {
    const data = JSON.parse(await readFile(codexUsagePath, "utf8"));
    return {
      fiveHourPercent: clampPercent(data.fiveHourPercent, null),
      fiveHourReset: validDateFromISO(data.fiveHourReset)
        ? new Date(data.fiveHourReset).toISOString()
        : null,
      weeklyPercent: clampPercent(data.weeklyPercent, null),
      weeklyReset: validDateFromISO(data.weeklyReset)
        ? new Date(data.weeklyReset).toISOString()
        : null,
      lastUpdated: validDateFromISO(data.lastUpdated)
        ? new Date(data.lastUpdated).toISOString()
        : null,
    };
  } catch {
    return {
      fiveHourPercent: null,
      fiveHourReset: null,
      weeklyPercent: null,
      weeklyReset: null,
      lastUpdated: null,
    };
  }
}

async function readCurrentHistory() {
  try {
    return JSON.parse(await readFile(historyPath, "utf8"));
  } catch {
    return { version: 1, lastUpdated: null, samples: [] };
  }
}

function parseFiveHourReset(clockText, now = new Date()) {
  const match = String(clockText || "").match(/(\d{1,2})[:h](\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const reset = new Date(now);
  reset.setHours(hour, minute, 0, 0);
  if (reset <= now) reset.setDate(reset.getDate() + 1);
  return Number.isFinite(reset.getTime()) ? reset : null;
}

function parseWeeklyReset(text) {
  const raw = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const months = {
    jan: 0,
    january: 0,
    janeiro: 0,
    fev: 1,
    feb: 1,
    february: 1,
    fevereiro: 1,
    mar: 2,
    march: 2,
    marco: 2,
    apr: 3,
    april: 3,
    abr: 3,
    abril: 3,
    may: 4,
    mai: 4,
    maio: 4,
    jun: 5,
    june: 5,
    junho: 5,
    jul: 6,
    july: 6,
    julho: 6,
    aug: 7,
    august: 7,
    ago: 7,
    agosto: 7,
    sep: 8,
    sept: 8,
    september: 8,
    set: 8,
    setembro: 8,
    oct: 9,
    october: 9,
    out: 9,
    outubro: 9,
    nov: 10,
    november: 10,
    novembro: 10,
    dec: 11,
    december: 11,
    dez: 11,
    dezembro: 11,
  };

  const pt = raw.match(/(\d{1,2})\s+de\s+([a-z.]{3,12})\.?\s+de\s+(\d{4})\s+(\d{1,2})[:h](\d{2})/);
  if (pt) {
    const month = months[pt[2].replace(".", "")];
    if (typeof month !== "number") return null;
    const d = new Date(Number(pt[3]), month, Number(pt[1]), Number(pt[4]), Number(pt[5]), 0, 0);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const en = raw.match(/([a-z.]{3,12})\.?\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2})[:h](\d{2})/);
  if (en) {
    const month = months[en[1].replace(".", "")];
    if (typeof month !== "number") return null;
    const d = new Date(Number(en[3]), month, Number(en[2]), Number(en[4]), Number(en[5]), 0, 0);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  return null;
}

function normalizePageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sliceBetween(text, startLabels, endLabels) {
  const normalized = normalizePageText(text);
  const lower = normalized.toLowerCase();

  let start = -1;
  let startLabel = "";
  for (const label of startLabels) {
    const idx = lower.indexOf(label.toLowerCase());
    if (idx >= 0 && (start < 0 || idx < start)) {
      start = idx;
      startLabel = label;
    }
  }

  if (start < 0) return "";

  let end = normalized.length;
  for (const label of endLabels) {
    const idx = lower.indexOf(label.toLowerCase(), start + startLabel.length);
    if (idx >= 0 && idx < end) end = idx;
  }

  return normalized.slice(start, end).trim();
}

function parseUsageBlock(block) {
  if (!block) return null;

  const percent =
    block.match(/(\d{1,3})\s*%\s*(?:restante|remaining)/i) ||
    block.match(/(?:restante|remaining)\s*(\d{1,3})\s*%/i) ||
    block.match(/(\d{1,3})\s*%/);

  const reset =
    block.match(/(?:Redefinição|Reset|Resets)\s+(.+)$/i) ||
    block.match(/(?:Renova|Renews)\s+(.+)$/i);

  return {
    percent: percent ? Number(percent[1]) : null,
    resetText: reset ? reset[1].trim() : null,
  };
}

function parseCodexAnalyticsText(pageText) {
  const text = normalizePageText(pageText);
  const signedOutHints = [
    "sign in",
    "log in",
    "entrar",
    "iniciar sessão",
    "continue with google",
    "continuar com google",
  ];

  const hasUsageHint = /usage limit|limite de uso|weekly usage|uso semanal/i.test(text);
  if (!hasUsageHint && signedOutHints.some((hint) => text.toLowerCase().includes(hint))) {
    const error = new Error("Chrome está deslogado do ChatGPT/Codex. Faça sign-in e rode novamente.");
    error.code = "SIGNED_OUT";
    throw error;
  }

  const five = parseUsageBlock(
    sliceBetween(
      text,
      ["Limite de uso de 5 horas", "5-hour usage limit", "5 hour usage limit"],
      [
        "Limite de uso semanal",
        "Weekly usage limit",
        "Créditos restantes",
        "Credits remaining",
        "Configurações",
        "Settings",
      ],
    ),
  );

  const weekly = parseUsageBlock(
    sliceBetween(
      text,
      ["Limite de uso semanal", "Weekly usage limit"],
      [
        "Créditos restantes",
        "Credits remaining",
        "Configurações",
        "Settings",
        "Detalhes do uso",
        "Usage details",
      ],
    ),
  );

  return {
    fiveHourPercent: five?.percent ?? null,
    fiveHourResetText: five?.resetText ?? null,
    weeklyPercent: weekly?.percent ?? null,
    weeklyResetText: weekly?.resetText ?? null,
    pageText: text.slice(0, 800),
    capturedAt: new Date().toISOString(),
  };
}

function buildNextData(current, extracted, now = new Date()) {
  const fivePercent = clampPercent(extracted.fiveHourPercent, null);
  const weeklyPercent = clampPercent(extracted.weeklyPercent, null);

  if (fivePercent === null || weeklyPercent === null) {
    throw new Error(
      "Extração sem percentuais válidos: " +
        JSON.stringify({
          fiveHourPercent: extracted.fiveHourPercent,
          weeklyPercent: extracted.weeklyPercent,
          pageText: extracted.pageText,
        }),
    );
  }

  const next = {
    fiveHourPercent: fivePercent,
    fiveHourReset: current.fiveHourReset || null,
    weeklyPercent,
    weeklyReset: current.weeklyReset || null,
    lastUpdated: now.toISOString(),
  };

  if (fivePercent >= 100) {
    next.fiveHourPercent = 100;
    next.fiveHourReset = null;
  } else {
    const fiveReset = parseFiveHourReset(extracted.fiveHourResetText, now);
    if (fiveReset) next.fiveHourReset = fiveReset.toISOString();
  }

  const weeklyReset = parseWeeklyReset(extracted.weeklyResetText);
  if (weeklyReset) next.weeklyReset = weeklyReset.toISOString();

  return validateNextData(next);
}

function validateNextData(next) {
  const five = clampPercent(next.fiveHourPercent, null);
  const weekly = clampPercent(next.weeklyPercent, null);

  if (five === null || weekly === null) {
    throw new Error("Dados inválidos: percentuais ausentes.");
  }

  if (!validDateFromISO(next.lastUpdated)) {
    throw new Error("Dados inválidos: lastUpdated ausente/inválido.");
  }

  if (next.fiveHourReset !== null && !validDateFromISO(next.fiveHourReset)) {
    throw new Error("Dados inválidos: fiveHourReset inválido.");
  }

  if (!validDateFromISO(next.weeklyReset)) {
    throw new Error("Dados inválidos: weeklyReset ausente/inválido.");
  }

  return {
    fiveHourPercent: five,
    fiveHourReset: next.fiveHourReset,
    weeklyPercent: weekly,
    weeklyReset: next.weeklyReset,
    lastUpdated: new Date(next.lastUpdated).toISOString(),
  };
}

function runOsaScript(script) {
  const result = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "osascript falhou").trim());
  }

  return result.stdout.trim();
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readAnalyticsFromChrome() {
  const chromeApp = "/Applications/Google Chrome.app";
  const openAttempts = [
    ["-b", "com.google.Chrome", analyticsUrl],
    ...(existsSync(chromeApp) ? [["-a", chromeApp, analyticsUrl]] : []),
    ["-a", "Google Chrome", analyticsUrl],
  ];

  let opened = null;
  for (const openArgs of openAttempts) {
    opened = spawnSync("open", openArgs, {
      encoding: "utf8",
    });
    if (opened.status === 0) break;
  }

  if (!opened || opened.status !== 0) {
    throw new Error((opened?.stderr || opened?.stdout || "Falha ao abrir Google Chrome").trim());
  }

  const activated = spawnSync("open", ["-b", "com.google.Chrome"], {
    encoding: "utf8",
  });
  if (activated.status !== 0) {
    throw new Error((activated.stderr || activated.stdout || "Falha ao ativar Google Chrome").trim());
  }

  const extractor = `(() => {
    if (location.hostname !== "chatgpt.com" || !location.pathname.startsWith("/codex/cloud/settings/analytics")) {
      return JSON.stringify({ ok: false, error: "unexpected-url", url: location.href });
    }

    const text = document.body && document.body.innerText
      ? document.body.innerText.replace(/\\s+/g, " ").trim()
      : "";

    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title,
      text,
      capturedAt: new Date().toISOString()
    });
  })();`;

  let last = null;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    spawnSync("sleep", ["1"], { encoding: "utf8" });

    const script = `
tell application "Google Chrome"
  if not (exists front window) then error "Chrome não tem janela ativa."
  tell active tab of front window
    return execute javascript ${appleScriptString(extractor)}
  end tell
end tell
`;

    try {
      last = JSON.parse(runOsaScript(script));
      if (last.ok && /usage limit|limite de uso|weekly usage|uso semanal/i.test(last.text || "")) {
        return last;
      }
      if (last.ok && /sign in|log in|entrar|iniciar sessão/i.test(last.text || "")) {
        break;
      }
    } catch (error) {
      last = { ok: false, error: String(error.message || error) };
    }
  }

  if (last?.error === "unexpected-url") {
    throw new Error(`A aba ativa saiu de chatgpt.com/codex/cloud/settings/analytics: ${last.url}`);
  }

  throw new Error(
    "Chrome não expôs a página de analytics. Confirme sign-in e habilite Chrome > View > Developer > Allow JavaScript from Apple Events. Última amostra: " +
      JSON.stringify(last),
  );
}

function githubTokenFromLocal() {
  const envToken = process.env.CODEX_USAGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", githubTokenKeychainService, "-w"],
    { encoding: "utf8" },
  );

  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();

  throw new Error(
    `GitHub token ausente. Defina CODEX_USAGE_GITHUB_TOKEN/GITHUB_TOKEN ou salve no Keychain service "${githubTokenKeychainService}".`,
  );
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubTokenFromLocal()}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function publishFilesAtomic(files) {
  const refName = `heads/${githubBranch}`;
  const ref = await githubRequest(
    `https://api.github.com/repos/${githubOwner}/${githubRepo}/git/ref/${refName}`,
  );
  const parentSha = ref?.object?.sha;
  if (!parentSha) throw new Error(`GitHub não retornou SHA da branch ${githubBranch}.`);

  const parentCommit = await githubRequest(
    `https://api.github.com/repos/${githubOwner}/${githubRepo}/git/commits/${parentSha}`,
  );
  const baseTreeSha = parentCommit?.tree?.sha;
  if (!baseTreeSha) throw new Error(`GitHub não retornou tree SHA do commit ${parentSha}.`);

  const treeResult = await githubRequest(`https://api.github.com/repos/${githubOwner}/${githubRepo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content,
      })),
    }),
  });
  if (!treeResult?.sha) throw new Error("GitHub não retornou SHA da tree com os arquivos de uso.");

  const commitResult = await githubRequest(`https://api.github.com/repos/${githubOwner}/${githubRepo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "chore(data): update Codex usage summary via Chrome sign-in [skip ci]",
      tree: treeResult.sha,
      parents: [parentSha],
    }),
  });
  if (!commitResult?.sha) throw new Error("GitHub não retornou SHA do commit atomicamente criado.");

  await githubRequest(`https://api.github.com/repos/${githubOwner}/${githubRepo}/git/refs/${refName}`, {
    method: "PATCH",
    body: JSON.stringify({
      sha: commitResult.sha,
      force: false,
    }),
  });

  return commitResult.sha;
}

async function validateGeneratedSummary() {
  const codex = JSON.parse(await readFile(codexUsagePath, "utf8"));
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const codexLastUpdated = codex?.lastUpdated || null;
  const summaryLastUpdated = summary?.lastUpdated || null;
  const summaryCodexLastUpdated = summary?.codex?.lastUpdated || null;
  const codexTime = validDateFromISO(codexLastUpdated)?.getTime() || null;
  const summaryTime = validDateFromISO(summaryLastUpdated)?.getTime() || null;

  if (!codexTime) {
    throw new Error("Validação pós-update falhou: codex_usage.lastUpdated ausente ou inválido.");
  }

  if (summaryCodexLastUpdated !== codexLastUpdated) {
    throw new Error(
      "Validação pós-update falhou: usage_summary.codex.lastUpdated " +
        `(${summaryCodexLastUpdated || "<ausente>"}) difere de codex_usage.lastUpdated (${codexLastUpdated}).`,
    );
  }

  if (!summaryTime || summaryTime < codexTime) {
    throw new Error(
      "Validação pós-update falhou: usage_summary.lastUpdated " +
        `(${summaryLastUpdated || "<ausente>"}) é mais antigo que codex_usage.lastUpdated (${codexLastUpdated}).`,
    );
  }

  return {
    codexLastUpdated,
    summaryLastUpdated,
    summaryCodexLastUpdated,
  };
}

async function main() {
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  const current = await readCurrentData();
  let extracted;

  if (args.has("text")) {
    const text = await readFile(resolve(process.cwd(), args.get("text")), "utf8");
    extracted = parseCodexAnalyticsText(text);
  } else {
    const page = await readAnalyticsFromChrome();
    extracted = parseCodexAnalyticsText(page.text);
  }

  const next = buildNextData(current, extracted);
  const codexJson = `${JSON.stringify(next, null, 2)}\n`;
  await writeFile(codexUsagePath, codexJson);

  const history = appendCodexUsageSample(await readCurrentHistory(), next);
  const historyJson = `${JSON.stringify(history, null, 2)}\n`;
  await writeFile(historyPath, historyJson);

  const summary = spawnSync(process.execPath, [resolve(root, "scripts/build-usage-summary.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (summary.status !== 0) process.exit(summary.status || 1);
  const validation = await validateGeneratedSummary();

  if (args.has("publish")) {
    const summaryJson = await readFile(summaryPath, "utf8");
    const commitSha = await publishFilesAtomic([
      { path: "codex_usage.json", content: codexJson },
      { path: "codex_usage_history.json", content: historyJson },
      { path: "usage_summary.json", content: summaryJson },
    ]);
    console.log(JSON.stringify({ ok: true, published: { commitSha }, lastUpdated: validation, saved: next }, null, 2));
    return;
  }

  console.log(JSON.stringify({ ok: true, lastUpdated: validation, saved: next, extracted }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}

export {
  buildNextData,
  parseCodexAnalyticsText,
  parseFiveHourReset,
  parseWeeklyReset,
  validateNextData,
};

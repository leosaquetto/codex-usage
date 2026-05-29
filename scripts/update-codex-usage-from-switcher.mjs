#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendCodexUsageSample } from "./codex-usage-history.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const accountsPath = resolve(homedir(), ".codex-switcher/accounts.json");
const codexUsagePath = resolve(root, "codex_usage.json");
const historyPath = resolve(root, "codex_usage_history.json");
const summaryPath = resolve(root, "usage_summary.json");
const usageUrl = "https://chatgpt.com/backend-api/wham/usage";
const tokenUrl = "https://auth.openai.com/oauth/token";
const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const githubOwner = "leosaquetto";
const githubRepo = "codex-usage";
const githubBranch = "main";
const githubTokenKeychainService = "codex_usage_github_token";

const DISPLAY_NAMES = new Map([
  ["leo", "LEO I"],
  ["leo (trial)", "LEO II"],
  ["douglas", "DOUGLAS"],
  ["natanael", "NATANAEL"],
  ["dinha", "DINHA"],
  ["fabinh", "FABINHO"],
  ["fabinho", "FABINHO"],
  ["free #1", "FREE #1"],
  ["free #2", "FREE #2"],
]);

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
    "  node scripts/update-codex-usage-from-switcher.mjs",
    "  node scripts/update-codex-usage-from-switcher.mjs --publish",
    "  node scripts/update-codex-usage-from-switcher.mjs --accounts ~/.codex-switcher/accounts.json",
    "",
    "Lê contas ChatGPT do Codex Switcher local e publica codex_usage.json,",
    "codex_usage_history.json e usage_summary.json de forma atômica.",
  ].join("\n");
}

function clampPercent(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function validIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function unixSecondsToIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(n * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function displayNameFor(account) {
  const raw = String(account?.name || "").trim();
  return DISPLAY_NAMES.get(raw.toLowerCase()) || raw.toUpperCase() || "CONTA";
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function tokenExpiredOrNearExpiry(token) {
  const exp = decodeJwtPayload(token)?.exp;
  return Number.isFinite(exp) ? exp <= Math.floor(Date.now() / 1000) + 60 : false;
}

async function refreshTokens(account) {
  const auth = account.auth_data || {};
  if (!auth.refresh_token) throw new Error("refresh_token ausente");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refresh_token,
    client_id: clientId,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`refresh HTTP ${response.status}: ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);

  const claims = decodeJwtPayload(payload.id_token || auth.id_token) || {};
  const authClaims = claims["https://api.openai.com/auth"] || {};
  return {
    ...account,
    email: claims["https://api.openai.com/profile"]?.email || claims.email || account.email || null,
    plan_type: authClaims.chatgpt_plan_type || account.plan_type || null,
    subscription_expires_at: authClaims.chatgpt_subscription_active_until || account.subscription_expires_at || null,
    auth_data: {
      ...auth,
      id_token: payload.id_token || auth.id_token,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || auth.refresh_token,
      account_id: authClaims.chatgpt_account_id || auth.account_id || null,
    },
  };
}

async function readSwitcherAccounts() {
  const configuredPath = args.get("accounts")
    ? resolve(String(args.get("accounts")).replace(/^~(?=$|\/)/, homedir()))
    : accountsPath;
  if (!existsSync(configuredPath)) throw new Error(`Arquivo de contas não encontrado: ${configuredPath}`);

  const store = JSON.parse(await readFile(configuredPath, "utf8"));
  const accounts = Array.isArray(store) ? store : Array.isArray(store.accounts) ? store.accounts : [];
  return {
    path: configuredPath,
    raw: store,
    activeAccountId: store.active_account_id || null,
    accounts: accounts.filter((account) => account?.auth_data?.access_token),
  };
}

function usageHeaders(account) {
  const auth = account.auth_data || {};
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${auth.access_token}`,
    "User-Agent": "codex-cli/1.0.0",
  };
  if (auth.account_id) headers["chatgpt-account-id"] = auth.account_id;
  return headers;
}

async function fetchUsage(account) {
  let current = account;
  if (tokenExpiredOrNearExpiry(current.auth_data?.access_token)) {
    current = await refreshTokens(current);
  }

  let response = await fetch(usageUrl, { headers: usageHeaders(current) });
  if (response.status === 401 && current.auth_data?.refresh_token) {
    current = await refreshTokens(current);
    response = await fetch(usageUrl, { headers: usageHeaders(current) });
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`usage HTTP ${response.status}: ${text.slice(0, 200)}`);
  return { account: current, payload: JSON.parse(text) };
}

function normalizeWindow(window) {
  if (!window || typeof window !== "object") return null;
  const used = clampPercent(window.used_percent, null);
  const windowSeconds = Number(window.limit_window_seconds);
  return {
    usedPercent: used,
    remainingPercent: used === null ? null : clampPercent(100 - used, null),
    windowMinutes: Number.isFinite(windowSeconds) ? Math.round(windowSeconds / 60) : null,
    reset: unixSecondsToIso(window.reset_at),
  };
}

function splitWindows(payload) {
  const candidates = [
    normalizeWindow(payload?.rate_limit?.primary_window),
    normalizeWindow(payload?.rate_limit?.secondary_window),
  ].filter(Boolean);

  const fiveHour = candidates.find((window) => window.windowMinutes && window.windowMinutes <= 360)
    || candidates[0]
    || null;
  const weekly = candidates.find((window) => window.windowMinutes && window.windowMinutes > 360)
    || candidates.find((window) => window !== fiveHour)
    || null;

  return { fiveHour, weekly };
}

function normalizeAccountResult(sourceAccount, payload, nowIso, activeAccountId) {
  const { fiveHour, weekly } = splitWindows(payload);
  return {
    id: sourceAccount.id,
    chatgptAccountId: sourceAccount.auth_data?.account_id || null,
    name: String(sourceAccount.name || "").trim(),
    displayName: displayNameFor(sourceAccount),
    email: null,
    planType: payload?.plan_type || sourceAccount.plan_type || null,
    subscriptionExpiresAt: validIso(sourceAccount.subscription_expires_at),
    isActive: sourceAccount.id === activeAccountId,
    lastUsedAt: validIso(sourceAccount.last_used_at),
    fiveHourPercent: fiveHour?.remainingPercent ?? null,
    fiveHourUsedPercent: fiveHour?.usedPercent ?? null,
    fiveHourReset: fiveHour?.reset || null,
    fiveHourWindowMinutes: fiveHour?.windowMinutes || null,
    weeklyPercent: weekly?.remainingPercent ?? null,
    weeklyUsedPercent: weekly?.usedPercent ?? null,
    weeklyReset: weekly?.reset || null,
    weeklyWindowMinutes: weekly?.windowMinutes || null,
    credits: payload?.credits ? {
      hasCredits: Boolean(payload.credits.has_credits),
      unlimited: Boolean(payload.credits.unlimited),
      balance: payload.credits.balance || null,
    } : null,
    lastUpdated: nowIso,
    status: "ok",
    error: null,
  };
}

function normalizeAccountError(account, error, nowIso, activeAccountId) {
  return {
    id: account.id,
    chatgptAccountId: account.auth_data?.account_id || null,
    name: String(account.name || "").trim(),
    displayName: displayNameFor(account),
    email: null,
    planType: account.plan_type || null,
    subscriptionExpiresAt: validIso(account.subscription_expires_at),
    isActive: account.id === activeAccountId,
    lastUsedAt: validIso(account.last_used_at),
    fiveHourPercent: null,
    fiveHourUsedPercent: null,
    fiveHourReset: null,
    fiveHourWindowMinutes: null,
    weeklyPercent: null,
    weeklyUsedPercent: null,
    weeklyReset: null,
    weeklyWindowMinutes: null,
    credits: null,
    lastUpdated: nowIso,
    status: "error",
    error: String(error?.message || error).slice(0, 240),
  };
}

function averagePercent(accounts, key) {
  const values = accounts.map((account) => clampPercent(account[key], null)).filter((value) => value !== null);
  if (values.length === 0) return null;
  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length, null);
}

function earliestIso(accounts, key) {
  const times = accounts
    .map((account) => validIso(account[key]))
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function buildPayload(accounts, nowIso, activeAccountId) {
  const okAccounts = accounts.filter((account) => account.status === "ok");
  const active = okAccounts.find((account) => account.isActive) || okAccounts[0] || null;

  return {
    source: "codex-switcher",
    lastUpdated: nowIso,
    accountCount: accounts.length,
    okCount: okAccounts.length,
    activeAccountId,
    aggregate: {
      fiveHourPercent: averagePercent(okAccounts, "fiveHourPercent"),
      fiveHourReset: earliestIso(okAccounts, "fiveHourReset"),
      weeklyPercent: averagePercent(okAccounts, "weeklyPercent"),
      weeklyReset: earliestIso(okAccounts, "weeklyReset"),
      lastUpdated: nowIso,
    },
    fiveHourPercent: active?.fiveHourPercent ?? averagePercent(okAccounts, "fiveHourPercent"),
    fiveHourReset: active?.fiveHourReset ?? earliestIso(okAccounts, "fiveHourReset"),
    weeklyPercent: active?.weeklyPercent ?? averagePercent(okAccounts, "weeklyPercent"),
    weeklyReset: active?.weeklyReset ?? earliestIso(okAccounts, "weeklyReset"),
    accounts,
  };
}

async function readCurrentHistory() {
  return readJson(historyPath, { version: 1, lastUpdated: null, samples: [] });
}

function historyPayloadFromAggregate(payload) {
  const aggregate = payload.aggregate || payload;
  return {
    lastUpdated: payload.lastUpdated,
    fiveHourPercent: aggregate.fiveHourPercent,
    fiveHourReset: aggregate.fiveHourReset,
    weeklyPercent: aggregate.weeklyPercent,
    weeklyReset: aggregate.weeklyReset,
  };
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

async function validateGeneratedSummary() {
  const codex = JSON.parse(await readFile(codexUsagePath, "utf8"));
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const codexLastUpdated = codex?.lastUpdated || null;
  const summaryCodexLastUpdated = summary?.codex?.lastUpdated || null;
  const summaryLastUpdated = summary?.lastUpdated || null;
  const codexTime = validDate(codexLastUpdated)?.getTime() || null;
  const summaryTime = validDate(summaryLastUpdated)?.getTime() || null;

  if (!codexTime) throw new Error("Validação falhou: codex_usage.lastUpdated ausente/inválido.");
  if (summaryCodexLastUpdated !== codexLastUpdated) {
    throw new Error(
      `Validação falhou: usage_summary.codex.lastUpdated=${summaryCodexLastUpdated || "<ausente>"} ` +
        `diferente de codex_usage.lastUpdated=${codexLastUpdated}.`,
    );
  }
  if (!summaryTime || summaryTime < codexTime) {
    throw new Error("Validação falhou: usage_summary.lastUpdated é mais antigo que codex_usage.lastUpdated.");
  }
  return { codexLastUpdated, summaryLastUpdated, summaryCodexLastUpdated };
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
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function publishFilesAtomic(files) {
  const refName = `heads/${githubBranch}`;
  const ref = await githubRequest(`https://api.github.com/repos/${githubOwner}/${githubRepo}/git/ref/${refName}`);
  const parentSha = ref?.object?.sha;
  if (!parentSha) throw new Error(`GitHub não retornou SHA da branch ${githubBranch}.`);

  const parentCommit = await githubRequest(`https://api.github.com/repos/${githubOwner}/${githubRepo}/git/commits/${parentSha}`);
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
      message: "chore(data): update Codex usage from switcher [skip ci]",
      tree: treeResult.sha,
      parents: [parentSha],
    }),
  });
  if (!commitResult?.sha) throw new Error("GitHub não retornou SHA do commit atomicamente criado.");

  await githubRequest(`https://api.github.com/repos/${githubOwner}/${githubRepo}/git/refs/${refName}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitResult.sha, force: false }),
  });

  return commitResult.sha;
}

async function main() {
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  const nowIso = new Date().toISOString();
  const store = await readSwitcherAccounts();
  if (store.accounts.length === 0) throw new Error("Nenhuma conta ChatGPT com access_token encontrada.");

  const results = await Promise.all(store.accounts.map(async (account) => {
    try {
      const { account: freshAccount, payload } = await fetchUsage(account);
      return {
        publicAccount: normalizeAccountResult(freshAccount, payload, nowIso, store.activeAccountId),
        freshAccount,
      };
    } catch (error) {
      return {
        publicAccount: normalizeAccountError(account, error, nowIso, store.activeAccountId),
        freshAccount: account,
      };
    }
  }));

  const refreshedById = new Map(results.map((result) => [result.freshAccount.id, result.freshAccount]));
  if (Array.isArray(store.raw?.accounts)) {
    let changed = false;
    store.raw.accounts = store.raw.accounts.map((account) => {
      const freshAccount = refreshedById.get(account.id);
      if (!freshAccount || JSON.stringify(freshAccount.auth_data) === JSON.stringify(account.auth_data)) return account;
      changed = true;
      return freshAccount;
    });
    if (changed) {
      await writeFile(store.path, `${JSON.stringify(store.raw, null, 2)}\n`);
    }
  }

  const payload = buildPayload(results.map((result) => result.publicAccount), nowIso, store.activeAccountId);
  if (!payload.okCount) throw new Error("Nenhuma conta retornou uso válido.");

  const codexJson = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(codexUsagePath, codexJson);

  const history = appendCodexUsageSample(await readCurrentHistory(), historyPayloadFromAggregate(payload));
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
    console.log(JSON.stringify({ ok: true, published: { commitSha }, lastUpdated: validation, accounts: payload.accounts.map(({ displayName, status, error }) => ({ displayName, status, error })) }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    lastUpdated: validation,
    accountCount: payload.accountCount,
    okCount: payload.okCount,
    accounts: payload.accounts.map(({ displayName, planType, fiveHourPercent, weeklyPercent, fiveHourReset, weeklyReset, status, error }) => ({
      displayName,
      planType,
      fiveHourPercent,
      weeklyPercent,
      fiveHourReset,
      weeklyReset,
      status,
      error,
    })),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}

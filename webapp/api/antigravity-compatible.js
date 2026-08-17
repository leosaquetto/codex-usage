const { timingSafeEqual } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { buildCompatiblePayload } = require("../lib/antigravity-compatible");

const LOCAL_PATH = resolve(__dirname, "../../antigravity_usage.json");
const REMOTE_TIMEOUT_MS = 7_000;
const GITHUB_OWNER = process.env.CODEX_USAGE_GITHUB_OWNER || "leosaquetto";
const GITHUB_REPO = process.env.CODEX_USAGE_GITHUB_REPO || "codex-usage";
const GITHUB_BRANCH = process.env.CODEX_USAGE_GITHUB_BRANCH || "usage-data";
const REMOTE_URL = process.env.CODEX_USAGE_REMOTE_ANTIGRAVITY_URL
  || `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/antigravity_usage.json`;

function bearerKey(request) {
  return String(request?.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function hasValidKey(request) {
  const expected = String(process.env.WHEN_RESET_ANTIGRAVITY_KEY || "");
  const provided = bearerKey(request);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (!expected || !provided || expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function withCacheBuster(url) {
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

async function readSnapshot() {
  if (process.env.CODEX_USAGE_USE_LOCAL_FILES === "1") {
    return JSON.parse(await readFile(LOCAL_PATH, "utf8"));
  }

  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(withCacheBuster(REMOTE_URL), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) throw new Error(`Fonte Antigravity HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutID);
  }
}

async function handle(request, response, options = {}) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET") {
    return response.status(405).json({ error: "Método não permitido." });
  }
  if (!process.env.WHEN_RESET_ANTIGRAVITY_KEY) {
    return response.status(503).json({ error: "Endpoint Antigravity não configurado." });
  }
  if (!hasValidKey(request)) {
    return response.status(401).json({ error: "Não autorizado." });
  }

  try {
    const snapshot = await readSnapshot();
    return response.status(200).json(buildCompatiblePayload(snapshot, new Date(), options));
  } catch (error) {
    console.error("Falha ao preparar quota Antigravity para o When Reset:", error?.message || error);
    return response.status(503).json({ error: "Quota Antigravity indisponível." });
  }
}

async function handler(request, response) {
  return handle(request, response);
}

async function accountHandler(request, response) {
  const rawAccount = request?.query?.account;
  const value = Array.isArray(rawAccount) ? rawAccount[0] : rawAccount;
  const accountSelector = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(accountSelector)) {
    return response.status(404).json({ error: "Conta Antigravity não encontrada." });
  }
  return handle(request, response, { accountSelector, includeAccountLabel: false });
}

module.exports = handler;
module.exports.accountHandler = accountHandler;

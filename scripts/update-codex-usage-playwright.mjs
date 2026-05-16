#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildNextData,
  parseCodexAnalyticsText,
  validateNextData,
} from "./update-codex-usage-from-chrome.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const analyticsUrl = "https://chatgpt.com/codex/cloud/settings/analytics";
const chromeExecutablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = "/Users/leosaquetto/Developer/BrowserProfiles/codex-chrome-profile";
const cdpProfileDir = "/Users/leosaquetto/Developer/BrowserProfiles/codex-cdp-profile";
const defaultCdpUrl = "http://127.0.0.1:9222";

const codexUsagePath = resolve(root, "codex_usage.json");
const summaryPath = resolve(root, "usage_summary.json");
const webappCodexUsagePath = resolve(root, "webapp/codex_usage.json");
const webappSummaryPath = resolve(root, "webapp/usage_summary.json");

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const map = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      map.set(key, next);
      i += 1;
    } else {
      map.set(key, true);
    }
  }
  return map;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/update-codex-usage-playwright.mjs",
    "  node scripts/update-codex-usage-playwright.mjs --headed",
    "  node scripts/update-codex-usage-playwright.mjs --headless",
    "  node scripts/update-codex-usage-playwright.mjs --headed --commit",
    "  node scripts/update-codex-usage-playwright.mjs --cdp",
    "  node scripts/update-codex-usage-playwright.mjs --ensure-cdp",
    "  node scripts/update-codex-usage-playwright.mjs --headless --cdp-profile",
    "  node scripts/update-codex-usage-playwright.mjs --headless --profile-dir /path/to/profile",
    "  node scripts/update-codex-usage-playwright.mjs --cdp-url http://127.0.0.1:9222",
    "  node scripts/update-codex-usage-playwright.mjs --cdp --debug-pages",
    "",
    "Behavior:",
    "  - Uses a persistent Playwright browser profile outside the repo.",
    "  - Reuses Google Chrome if available, otherwise falls back to Playwright Chromium.",
    "  - Tries network JSON first, then falls back to visible page text parsing.",
    "  - Can connect to an already-open Chrome via CDP to reuse a warmed session.",
    "  - Can start a hidden Chrome CDP session with --ensure-cdp.",
    "  - Updates root and webapp JSON files.",
    "",
    "Tip:",
    `  - Start CDP Chrome with: npm run chrome:cdp`,
  ].join("\n");
}

function determineMode() {
  if (args.has("headed") && args.has("headless")) {
    throw new Error("Use apenas uma das flags: --headed ou --headless.");
  }

  if (args.has("headed")) return { requested: "headed", headless: false };
  if (args.has("headless")) return { requested: "headless", headless: true };
  return { requested: "auto", headless: existsSync(selectedProfileDir()) };
}

function selectedProfileDir() {
  if (args.has("cdp-profile")) return cdpProfileDir;
  return String(args.get("profile-dir") || profileDir);
}

function cdpConfig() {
  if (!args.has("cdp") && !args.has("cdp-url") && !args.has("ensure-cdp")) return null;
  return {
    enabled: true,
    url: String(args.get("cdp-url") || defaultCdpUrl),
    ensure: args.has("ensure-cdp"),
    visible: args.has("cdp-visible"),
  };
}

function browserInfo() {
  if (existsSync(chromeExecutablePath)) {
    return {
      name: "google-chrome",
      launchOptions: {
        executablePath: chromeExecutablePath,
        channel: undefined,
      },
    };
  }

  return {
    name: "playwright-chromium",
    launchOptions: {},
  };
}

async function readCurrentData() {
  try {
    return JSON.parse(await readFile(codexUsagePath, "utf8"));
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

function loginHints(text) {
  const normalized = String(text || "").toLowerCase();
  return [
    "sign in",
    "log in",
    "entrar",
    "iniciar sessão",
    "continue with google",
    "continuar com google",
  ].some((hint) => normalized.includes(hint));
}

function analyticsVisible(text) {
  return /usage limit|limite de uso|weekly usage|uso semanal/i.test(String(text || ""));
}

function analyticsUrlLike(url) {
  return String(url || "").startsWith("https://chatgpt.com/codex/cloud/settings/analytics");
}

function analyticsTextLike(text) {
  return /analytics|usage|limite|weekly|5-hour|5 hour|semanal|remaining|restante/i.test(String(text || ""));
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function preview(value, maxLength = 700) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeDirectPayload(candidate) {
  if (!candidate || typeof candidate !== "object") return null;

  const next = {
    fiveHourPercent: candidate.fiveHourPercent,
    fiveHourReset: isoOrNull(candidate.fiveHourReset),
    weeklyPercent: candidate.weeklyPercent,
    weeklyReset: isoOrNull(candidate.weeklyReset),
    lastUpdated: isoOrNull(candidate.lastUpdated) || new Date().toISOString(),
  };

  try {
    return validateNextData(next);
  } catch {
    return null;
  }
}

function walkObjects(value, visit, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  visit(value);

  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit, seen);
    return;
  }

  for (const child of Object.values(value)) {
    walkObjects(child, visit, seen);
  }
}

function findValueByPatterns(object, patterns) {
  for (const [key, value] of Object.entries(object)) {
    if (patterns.some((pattern) => pattern.test(key))) return value;
  }
  return undefined;
}

function normalizePayloadCandidate(candidate) {
  const direct = normalizeDirectPayload(candidate);
  if (direct) return direct;

  let normalized = null;
  walkObjects(candidate, (object) => {
    if (normalized || Array.isArray(object)) return;

    const fiveHourPercent = findValueByPatterns(object, [
      /^five[_-]?hour(percent|remaining)$/i,
      /^fiveHourPercent$/i,
      /^remaining5h$/i,
    ]);
    const fiveHourReset = findValueByPatterns(object, [
      /^five[_-]?hour(reset|resetAt|renewsAt)$/i,
      /^fiveHourReset$/i,
      /^reset5h$/i,
    ]);
    const weeklyPercent = findValueByPatterns(object, [
      /^weekly(percent|remaining)$/i,
      /^weeklyPercent$/i,
      /^remainingWeekly$/i,
    ]);
    const weeklyReset = findValueByPatterns(object, [
      /^weekly(reset|resetAt|renewsAt)$/i,
      /^weeklyReset$/i,
      /^resetWeekly$/i,
    ]);
    const lastUpdated = findValueByPatterns(object, [
      /^lastUpdated$/i,
      /^updatedAt$/i,
      /^capturedAt$/i,
      /^timestamp$/i,
    ]);

    const candidatePayload = normalizeDirectPayload({
      fiveHourPercent,
      fiveHourReset,
      weeklyPercent,
      weeklyReset,
      lastUpdated,
    });

    if (candidatePayload) {
      normalized = candidatePayload;
    }
  });

  return normalized;
}

function isLikelyAnalyticsUrl(url) {
  return /analytics|usage|codex/i.test(String(url || ""));
}

function isLikelyJsonResponse(url, contentType) {
  const normalizedUrl = String(url || "");
  const normalizedType = String(contentType || "");
  return (
    /json/i.test(normalizedType) ||
    /backend-api|graphql|analytics|usage|codex/i.test(normalizedUrl)
  );
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function cdpEndpointAvailable(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdpEndpoint(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await cdpEndpointAvailable(url)) return true;
    await delay(500);
  }
  return false;
}

async function ensureCdpChrome(config) {
  if (await cdpEndpointAvailable(config.url)) {
    return { started: false };
  }

  if (!existsSync(chromeExecutablePath)) {
    throw new Error(`Google Chrome não encontrado em ${chromeExecutablePath}; não consigo subir CDP headless.`);
  }

  await mkdir(cdpProfileDir, { recursive: true });

  const cdpPort = new URL(config.url).port || "9222";
  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${cdpProfileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--window-position=-32000,-32000",
    "--window-size=800,600",
    analyticsUrl,
  ];

  const openArgs = [
    ...(config.visible ? [] : ["-gj"]),
    "-n",
    "-a",
    "/Applications/Google Chrome.app",
    "--args",
    ...chromeArgs,
  ];

  const child = spawn("open", openArgs, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderrChunks = [];
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk));
  });

  if (!(await waitForCdpEndpoint(config.url, 30000))) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    throw new Error(
      `Subi o Chrome CDP, mas ${config.url} não respondeu dentro do tempo esperado.` +
        (stderr ? ` stderr=${preview(stderr, 1000)}` : ""),
    );
  }

  return { started: true, pid: child.pid, hidden: !config.visible };
}

async function readPageSnapshot(page) {
  if (page.isClosed()) {
    return { closed: true, url: "", title: "", text: "", html: "" };
  }

  try {
    const snapshot = await page.evaluate(() => ({
      closed: false,
      url: location.href,
      title: document.title,
      text: [
        document.body?.innerText || "",
        document.body?.textContent || "",
        document.documentElement?.innerText || "",
        document.documentElement?.textContent || "",
      ]
        .map((value) => String(value || "").replace(/\s+/g, " ").trim())
        .sort((a, b) => b.length - a.length)[0] || "",
      html: document.documentElement?.outerHTML || "",
    }));

    if (snapshot.text || snapshot.html || snapshot.title) {
      return snapshot;
    }

    const cdpSnapshot = await readPageSnapshotViaCdp(page);
    return cdpSnapshot || snapshot;
  } catch (error) {
    const message = String(error?.message || error);
    if (/Execution context was destroyed|Cannot find context|Target page, context or browser has been closed/i.test(message)) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      const html = await page.content().catch(() => "");
      const text = htmlToText(html);

      if (url || title || text || html) {
        return {
          closed: false,
          url,
          title,
          text,
          html,
        };
      }

      return null;
    }
    throw error;
  }
}

async function readPageSnapshotViaCdp(page) {
  try {
    const session = await page.context().newCDPSession(page);
    const result = await session.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => ({
        closed: false,
        url: location.href,
        title: document.title,
        text: [
          document.body?.innerText || "",
          document.body?.textContent || "",
          document.documentElement?.innerText || "",
          document.documentElement?.textContent || ""
        ].map((value) => String(value || "").replace(/\\s+/g, " ").trim()).sort((a, b) => b.length - a.length)[0] || "",
        html: document.documentElement?.outerHTML || ""
      }))()`,
    });
    await session.detach().catch(() => null);

    const value = result?.result?.value;
    if (value && typeof value === "object") {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

async function waitForAuthenticatedAnalytics(getPage, timeoutMs) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    const page = await getPage();
    if (!page) {
      await delay(1000);
      continue;
    }

    if (page.isClosed()) {
      return lastSnapshot || { closed: true, url: "", title: "", text: "" };
    }

    const snapshot = await readPageSnapshot(page);
    if (!snapshot) {
      await delay(1000);
      continue;
    }

    lastSnapshot = snapshot;

    if (snapshot.closed) {
      return lastSnapshot;
    }

    if (
      analyticsUrlLike(snapshot.url) &&
      (analyticsVisible(snapshot.text) || analyticsTextLike(snapshot.text))
    ) {
      return snapshot;
    }

    if (analyticsUrlLike(snapshot.url) && Date.now() - startedAt > 8000) {
      return snapshot;
    }

    if (loginHints(snapshot.text)) {
      await delay(1500);
      continue;
    }

    await delay(1000);
  }

  return lastSnapshot;
}

async function finalizeCapture({
  getPage,
  networkCandidates,
  browserName,
  modeLabel,
  connectionLabel,
  cdpStarted = false,
  profileDir: captureProfileDir = null,
}) {
  const page = await getPage();
  if (!page) {
    throw new Error("Não encontrei uma aba disponível para capturar analytics.");
  }

  const snapshot = await waitForAuthenticatedAnalytics(getPage, 90000);

  if (!snapshot) {
    throw new Error("A página de analytics não respondeu a tempo.");
  }

  if (snapshot.closed) {
    throw new Error(
      connectionLabel === "cdp"
        ? "A aba/contexto do Chrome conectado por CDP foi fechado durante a autenticação."
        : "A janela/aba do navegador foi fechada durante a autenticação do Codex.",
    );
  }

  const signedOut = loginHints(snapshot.text) || !snapshot.url.includes("chatgpt.com");
  if (signedOut) {
    throw new Error(
      connectionLabel === "cdp"
        ? "O Chrome conectado por CDP não está autenticado no ChatGPT/Codex ou ficou preso em CAPTCHA/login."
        : "Login necessário no ChatGPT/Codex. Rode com --headed para fazer login manual ou use --cdp para reaproveitar um Chrome já logado.",
    );
  }

  await delay(3000);

  const latestPage = await getPage();
  const latestSnapshot = latestPage ? await readPageSnapshot(latestPage) : null;
  const finalSnapshot =
    latestSnapshot && !latestSnapshot.closed && (latestSnapshot.text || latestSnapshot.html)
      ? latestSnapshot
      : snapshot;

  const networkMatch = networkCandidates.find((entry) => entry.normalized);
  if (networkMatch) {
    return {
      browser: browserName,
      mode: modeLabel,
      source: "network-json",
      extracted: networkMatch.payload,
      details: {
        connection: connectionLabel,
        cdpStarted,
        profileDir: captureProfileDir,
        matchedUrl: networkMatch.url,
        matchedStatus: networkMatch.status,
      },
    };
  }

  const parseInput = finalSnapshot.text || htmlToText(finalSnapshot.html) || finalSnapshot.html || "";
  const captureDetails = {
    connection: connectionLabel,
    cdpStarted,
    profileDir: captureProfileDir,
    pageUrl: finalSnapshot.url,
    pageTitle: finalSnapshot.title,
    textLength: finalSnapshot.text?.length || 0,
    htmlLength: finalSnapshot.html?.length || 0,
    parseInputLength: parseInput.length,
    parseInputPreview: preview(parseInput),
    networkCandidateCount: networkCandidates.length,
    networkCandidates: networkCandidates.slice(-10).map((entry) => ({
      url: entry.url,
      status: entry.status,
      contentType: entry.contentType,
      normalized: entry.normalized,
      bodyPreview: entry.bodyPreview,
    })),
  };

  if (!parseInput.trim()) {
    throw new Error(`CDP capturou a aba de analytics, mas texto/HTML vieram vazios: ${JSON.stringify(captureDetails)}`);
  }

  return {
    browser: browserName,
    mode: modeLabel,
    source: "page-text",
    extracted: parseCodexAnalyticsText(parseInput),
    details: captureDetails,
  };
}

function captureFromSnapshot({ snapshot, networkCandidates, browserName, modeLabel, connectionLabel, cdpStarted = false }) {
  const networkMatch = networkCandidates.find((entry) => entry.normalized);
  if (networkMatch) {
    return {
      browser: browserName,
      mode: modeLabel,
      source: "network-json",
      extracted: networkMatch.payload,
      details: {
        connection: connectionLabel,
        cdpStarted,
        matchedUrl: networkMatch.url,
        matchedStatus: networkMatch.status,
      },
    };
  }

  const parseInput = snapshot.text || htmlToText(snapshot.html) || snapshot.html || "";
  const captureDetails = {
    connection: connectionLabel,
    cdpStarted,
    pageUrl: snapshot.url,
    pageTitle: snapshot.title,
    textLength: snapshot.text?.length || 0,
    htmlLength: snapshot.html?.length || 0,
    parseInputLength: parseInput.length,
    parseInputPreview: preview(parseInput),
    networkCandidateCount: networkCandidates.length,
    networkCandidates: networkCandidates.slice(-10).map((entry) => ({
      url: entry.url,
      status: entry.status,
      contentType: entry.contentType,
      normalized: entry.normalized,
      bodyPreview: entry.bodyPreview,
    })),
  };

  if (!parseInput.trim()) {
    throw new Error(`CDP capturou a aba de analytics, mas texto/HTML vieram vazios: ${JSON.stringify(captureDetails)}`);
  }

  return {
    browser: browserName,
    mode: modeLabel,
    source: "page-text",
    extracted: parseCodexAnalyticsText(parseInput),
    details: captureDetails,
  };
}

async function dumpContextPages(browser) {
  return browser.contexts().map((context, contextIndex) => ({
    context: contextIndex,
    pages: context.pages().map((page, pageIndex) => ({
      page: pageIndex,
      url: page.url(),
      closed: page.isClosed(),
    })),
  }));
}

function wireNetworkCapture(page, networkCandidates) {
  page.on("response", async (response) => {
    const url = response.url();

    const headers = response.headers();
    const contentType = String(headers["content-type"] || "");
    if (!isLikelyJsonResponse(url, contentType)) return;

    try {
      const body = await response.json();
      const normalized = normalizePayloadCandidate(body);
      networkCandidates.push({
        url,
        status: response.status(),
        contentType,
        normalized: Boolean(normalized),
        payload: normalized,
        bodyPreview: normalized ? undefined : preview(JSON.stringify(body), 500),
      });
    } catch {
      // Ignore non-JSON or opaque responses.
    }
  });
}

async function refreshAnalyticsPage(page) {
  if (page.isClosed()) return;

  const url = String(page.url() || "");
  if (analyticsUrlLike(url)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    return;
  }

  await page.goto(analyticsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
}

function pageLooksUsable(page) {
  return page && !page.isClosed();
}

function pagePriority(page) {
  const url = String(page?.url?.() || "");
  if (url.startsWith("https://chatgpt.com/codex/cloud/settings/analytics")) return 4;
  if (url.includes("chatgpt.com/codex/cloud/settings")) return 3;
  if (url.includes("chatgpt.com")) return 2;
  if (url && url !== "about:blank") return 1;
  return 0;
}

async function waitForPageFromContext(context, preferredPage = null, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (pageLooksUsable(preferredPage)) {
      const pages = context.pages().filter(pageLooksUsable);
      const betterPage = pages
        .slice()
        .sort((a, b) => pagePriority(b) - pagePriority(a))[0];
      if (!betterPage || betterPage === preferredPage || pagePriority(preferredPage) >= pagePriority(betterPage)) {
        return preferredPage;
      }
      return betterPage;
    }

    const pages = context.pages().filter(pageLooksUsable);
    const bestPage = pages
      .slice()
      .sort((a, b) => pagePriority(b) - pagePriority(a))[0];
    if (bestPage) return bestPage;

    await delay(500);
  }

  return null;
}

async function ensureTrackedPage(context, networkCandidates, tracked) {
  const currentPage = await waitForPageFromContext(context, tracked.page, 5000);
  if (!currentPage) return null;

  if (tracked.page !== currentPage) {
    tracked.page = currentPage;
    wireNetworkCapture(currentPage, networkCandidates);
  }

  return tracked.page;
}

async function captureViaPersistentContext({ headless, requestedMode }) {
  const persistentProfileDir = selectedProfileDir();
  await mkdir(persistentProfileDir, { recursive: true });

  const { chromium } = await import("playwright");
  const browser = browserInfo();
  const networkCandidates = [];
  const effectiveMode = headless ? "headless" : "headed";
  let retryHeaded = false;
  let result = null;

  const context = await chromium.launchPersistentContext(persistentProfileDir, {
    headless,
    viewport: null,
    ...browser.launchOptions,
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    wireNetworkCapture(page, networkCandidates);
    const tracked = { page };

    await refreshAnalyticsPage(page);
    const snapshot = await waitForAuthenticatedAnalytics(
      () => ensureTrackedPage(context, networkCandidates, tracked),
      90000,
    );

    if (!snapshot) {
      throw new Error("A página de analytics não respondeu a tempo.");
    }

    const signedOut = loginHints(snapshot.text) || !snapshot.url.includes("chatgpt.com");
    if (signedOut) {
      if (headless && requestedMode === "auto") {
        retryHeaded = true;
      } else if (headless) {
        throw new Error("Sessão ausente no modo headless. Rode com --headed para fazer login e persistir a sessão.");
      } else {
        console.log(
          "Login necessário no ChatGPT/Codex. Faça o login na janela aberta e aguarde a página de analytics carregar.",
        );
        const afterLogin = await waitForAuthenticatedAnalytics(
          () => ensureTrackedPage(context, networkCandidates, tracked),
          180000,
        );
        if (!afterLogin || afterLogin.closed || !analyticsVisible(afterLogin.text)) {
          throw new Error("Login não concluído ou página de analytics não ficou visível dentro do tempo esperado.");
        }
        snapshot.url = afterLogin.url;
        snapshot.title = afterLogin.title;
        snapshot.text = afterLogin.text;
      }
    }

    if (!retryHeaded) {
      result = await finalizeCapture({
        getPage: () => ensureTrackedPage(context, networkCandidates, tracked),
        networkCandidates,
        browserName: browser.name,
        modeLabel: effectiveMode,
        connectionLabel: "persistent-profile",
        profileDir: persistentProfileDir,
      });
    }
  } finally {
    await context.close();
  }

  if (retryHeaded) {
    return captureAnalytics({ headless: false, requestedMode });
  }

  if (result) {
    return result;
  }

  throw new Error("Não foi possível capturar a página de analytics do Codex.");
}

async function captureViaCdp(config) {
  const { chromium } = await import("playwright");
  const ensured = config.ensure ? await ensureCdpChrome(config) : { started: false };
  let browser;
  try {
    browser = await chromium.connectOverCDP(config.url);
  } catch (error) {
    const message = String(error?.message || error);
    if (/ECONNREFUSED/i.test(message)) {
      throw new Error(
        `Não consegui conectar no CDP em ${config.url}. Suba um Chrome dedicado com "npm run chrome:cdp" ou abra manualmente o binário com --remote-debugging-port=9222 --user-data-dir=${cdpProfileDir}.`,
      );
    }
    throw error;
  }
  const networkCandidates = [];

  try {
    if (args.has("debug-pages")) {
      console.log(JSON.stringify(await dumpContextPages(browser), null, 2));
    }

    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(
        `Nenhum contexto disponível via CDP em ${config.url}. Abra o Chrome com --remote-debugging-port=9222 e mantenha ao menos uma janela aberta.`,
      );
    }

    const page = (await waitForPageFromContext(context, null, 3000)) || (await context.newPage());
    wireNetworkCapture(page, networkCandidates);
    const tracked = { page };

    if (analyticsUrlLike(tracked.page.url())) {
      await delay(1000);
      const immediateSnapshot = await readPageSnapshot(tracked.page);
      if (immediateSnapshot && !immediateSnapshot.closed && (immediateSnapshot.text || immediateSnapshot.html)) {
        return captureFromSnapshot({
          snapshot: immediateSnapshot,
          networkCandidates,
          browserName: "google-chrome",
          modeLabel: "cdp",
          connectionLabel: "cdp",
          cdpStarted: ensured.started,
        });
      }
    }

    if (!analyticsUrlLike(tracked.page.url())) {
      await refreshAnalyticsPage(tracked.page);
    }

    return finalizeCapture({
      getPage: () => ensureTrackedPage(context, networkCandidates, tracked),
      networkCandidates,
      browserName: "google-chrome",
      modeLabel: "cdp",
      connectionLabel: "cdp",
      cdpStarted: ensured.started,
    });
  } finally {
    await browser?.disconnect?.().catch(() => null);
  }
}

async function captureAnalytics(mode) {
  const cdp = cdpConfig();

  if (cdp?.enabled) {
    return captureViaCdp(cdp);
  }

  try {
    return await captureViaPersistentContext(mode);
  } catch (error) {
    const message = String(error?.message || error);
    if (args.has("no-cdp-fallback")) throw error;
    if (/captcha|Login necessário|preso em CAPTCHA|sessão ausente/i.test(message)) {
      return captureViaCdp({ url: defaultCdpUrl });
    }
    throw error;
  }
}

async function syncWebappArtifacts() {
  await mkdir(dirname(webappCodexUsagePath), { recursive: true });
  await copyFile(codexUsagePath, webappCodexUsagePath);
  await copyFile(summaryPath, webappSummaryPath);
}

function runSummaryBuilder() {
  const summary = spawnSync(process.execPath, [resolve(root, "scripts/build-usage-summary.mjs")], {
    cwd: root,
    stdio: "inherit",
  });

  if (summary.status !== 0) {
    throw new Error("Falha ao regenerar usage_summary.json.");
  }
}

function maybeCommit() {
  if (args.has("no-commit")) return false;
  if (!args.has("commit")) return false;

  const add = spawnSync("git", ["add", "codex_usage.json", "usage_summary.json", "webapp/codex_usage.json", "webapp/usage_summary.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (add.status !== 0) {
    throw new Error("Falha no git add dos arquivos de uso do Codex.");
  }

  const commit = spawnSync("git", ["commit", "-m", "Update Codex usage via Playwright"], {
    cwd: root,
    stdio: "inherit",
  });
  if (commit.status !== 0) {
    throw new Error("Falha no git commit dos arquivos de uso do Codex.");
  }

  return true;
}

async function writeArtifacts(payload) {
  const codexJson = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(codexUsagePath, codexJson);
  runSummaryBuilder();
  await syncWebappArtifacts();
}

async function main() {
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  const mode = determineMode();
  const current = await readCurrentData();
  const capture = await captureAnalytics(mode);

  const next =
    capture.source === "network-json"
      ? validateNextData(capture.extracted)
      : (() => {
          try {
            return buildNextData(current, capture.extracted);
          } catch (error) {
            error.message = `${error.message} | captureDetails=${JSON.stringify(capture.details)}`;
            throw error;
          }
        })();

  await writeArtifacts(next);
  const committed = maybeCommit();

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: capture.mode,
        browser: capture.browser,
        source: capture.source,
        committed,
        saved: next,
        details: capture.details,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

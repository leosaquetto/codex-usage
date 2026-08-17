#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync, statSync } from "node:fs";
import {
  normalizeStructuredModels,
  validateModels,
  writeAntigravityUsage,
  splitNameTier,
  clampPercent,
  statusFor,
  slugify,
} from "./update-antigravity-usage.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);

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
    "  node scripts/update-antigravity-usage-auto.mjs",
    "  node scripts/update-antigravity-usage-auto.mjs --dry-run",
    "  node scripts/update-antigravity-usage-auto.mjs --commit --push",
    "",
    "Fetches Antigravity quotas using local IDE method (to get real percentages like 38%)",
    "and merges them into the multi-account Google Cloud CLI output.",
  ].join("\n");
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  return result;
}

// Kept for backward compatibility with parser test suite
function countBrightRunsFromRow(row, threshold = 135, minRunLength = 30) {
  let runs = 0;
  let current = 0;

  for (const value of row) {
    if (value >= threshold) {
      current += 1;
      continue;
    }

    if (current >= minRunLength) runs += 1;
    current = 0;
  }

  if (current >= minRunLength) runs += 1;
  return Math.max(0, Math.min(5, runs));
}

// Kept for backward compatibility with parser test suite
function extractRowsFromOcr(observations) {
  const items = Array.isArray(observations)
    ? observations
        .map((item) => ({
          text: String(item.text || "").replace(/\s+/g, " ").trim(),
          x: Number(item.x),
          y: Number(item.y),
          width: Number(item.width),
          height: Number(item.height),
        }))
        .filter((item) => item.text && [item.x, item.y, item.width, item.height].every(Number.isFinite))
    : [];

  const models = items
    .filter((item) => /^(Gemini|Claude|GPT-OSS)\b/i.test(item.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const refreshes = items
    .filter((item) => /refresh(?:es)?\s+in\s+\d+\s+days?,?\s*(?:\d+\s+)?\d+\s+hours?/i.test(item.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const percentages = items
    .filter((item) => /\b\d{1,3}%\b/.test(item.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows = [];
  for (const model of models) {
    const modelCenterY = model.y + model.height / 2;
    const refresh = refreshes
      .map((candidate) => ({
        ...candidate,
        distance: Math.abs((candidate.y + candidate.height / 2) - modelCenterY),
      }))
      .filter((candidate) => candidate.distance <= 26)
      .sort((a, b) => a.distance - b.distance || b.x - a.x)[0];

    if (!refresh) continue;

    const pct = percentages
      .map((candidate) => ({
        ...candidate,
        distance: Math.abs((candidate.y + candidate.height / 2) - modelCenterY),
      }))
      .filter((candidate) => candidate.distance <= 26)
      .sort((a, b) => a.distance - b.distance || b.x - a.x)[0];

    const parsedPercent = pct ? parseInt(pct.text.match(/(\d+)%/)[1], 10) : null;

    rows.push({
      name: model.text.replace(/\s*[△⚠].*$/, "").replace(/^(Gemini\s+3\s+Flash)\s+A$/i, "$1").trim(),
      refreshText: refresh.text.replace(/Refresh(?:es)? in/i, "Refreshes in"),
      y: model.y,
      parsedPercent
    });
  }

  const unique = new Map();
  for (const row of rows) {
    const key = `${row.name}|${row.refreshText}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return Array.from(unique.values()).sort((a, b) => a.y - b.y);
}

// Kept for backward compatibility with parser test suite
function decodePng() { return null; }
function detectQuotaBarPercents() { return []; }

function resolveCliPath() {
  const home = process.env.HOME || "/Users/leosaquetto";
  const paths = [
    join(home, ".npm-global/bin/antigravity-usage"),
    "/usr/local/bin/antigravity-usage",
    "antigravity-usage"
  ];
  for (const p of paths) {
    if (p.startsWith("/") && existsSync(p)) return p;
  }
  return "antigravity-usage";
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function newestCloudAccountsExport(downloadsPath = join(homedir(), "Downloads")) {
  if (!existsSync(downloadsPath)) return null;

  const candidates = readdirSync(downloadsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^cloud-accounts-export-.*\.json$/i.test(entry.name))
    .map((entry) => join(downloadsPath, entry.name))
    .filter((path) => existsSync(path));

  return candidates.sort((left, right) => {
    const leftTime = statSync(left).mtimeMs;
    const rightTime = statSync(right).mtimeMs;
    return rightTime - leftTime;
  })[0] || null;
}

function defaultAccountsSourcePath() {
  return join(homedir(), ".antigravity-agent", "decrypted_accounts.json");
}

function resolveAccountsSourcePath() {
  const configured = String(process.env.ANTIGRAVITY_ACCOUNTS_PATH || "").trim();
  if (configured) return configured;

  const defaultPath = defaultAccountsSourcePath();
  const exportPath = newestCloudAccountsExport();
  const candidates = [exportPath, defaultPath].filter(Boolean).filter((path) => existsSync(path));
  if (candidates.length === 0) return defaultPath;

  return candidates.sort((left, right) => {
    const leftTime = statSync(left).mtimeMs;
    const rightTime = statSync(right).mtimeMs;
    return rightTime - leftTime;
  })[0];
}

async function readActiveFlags(sourcePath) {
  const fallbackPath = defaultAccountsSourcePath();
  if (sourcePath === fallbackPath || !existsSync(fallbackPath)) return new Map();

  try {
    const parsed = JSON.parse(await readFile(fallbackPath, "utf8"));
    const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
    return new Map(
      (Array.isArray(accounts) ? accounts : [])
        .filter((account) => typeof account?.email === "string" && typeof account?.isActive === "boolean")
        .map((account) => [account.email.toLowerCase(), account.isActive]),
    );
  } catch {
    return new Map();
  }
}

function quotaWindow(bucket, index) {
  const remainingPercent = clampPercent(Number(bucket?.remaining_fraction) * 100);
  if (remainingPercent === null) return null;

  const rawKind = String(bucket?.window || bucket?.bucket_id || "additional").trim();
  const kind = /5\s*h|five[ -]?hour/i.test(rawKind) ? "5h" : /weekly|7\s*d/i.test(rawKind) ? "weekly" : rawKind;
  const windowMinutes = kind === "5h" ? 300 : kind === "weekly" ? 10_080 : null;
  const refreshAt = parseTimestamp(bucket?.reset_time)?.toISOString() || null;

  return {
    id: String(bucket?.bucket_id || `${kind}-${index}`),
    title: String(bucket?.display_name || bucket?.name || `${kind} limit`).trim(),
    kind,
    ...(windowMinutes === null ? {} : { windowMinutes }),
    remainingPercent,
    refreshAt,
  };
}

function parseCliOutput(cliJson, localSnapshot = null) {
  const accounts = [];
  let activeModels = [];

  for (const acc of cliJson) {
    if (!acc.email || !acc.snapshot) continue;
    
    let rawModels = acc.snapshot.models || [];
    
    // Merge the local snapshot's real session limits if it matches the current account email
    if (localSnapshot && localSnapshot.email && acc.email.toLowerCase() === localSnapshot.email.toLowerCase()) {
      rawModels = localSnapshot.models || [];
    }

    const models = rawModels.map((model) => {
      const { name, tier } = splitNameTier(model.label || model.displayName || model.modelId);
      const rawPct = model.remainingPercentage !== undefined && model.remainingPercentage !== null
        ? model.remainingPercentage * 100
        : null;
      const remainingPercent = clampPercent(rawPct);
      
      const refreshAt = model.resetTime || null;
      let refreshText = "";
      if (model.timeUntilResetMs && model.timeUntilResetMs > 0) {
        const hours = Math.round(model.timeUntilResetMs / 3600000);
        if (hours >= 24) {
          const days = Math.floor(hours / 24);
          const remHours = hours % 24;
          refreshText = `Refreshes in ${days} ${days === 1 ? "day" : "days"}${remHours > 0 ? `, ${remHours} ${remHours === 1 ? "hour" : "hours"}` : ""}`;
        } else {
          const totalMinutes = Math.round(model.timeUntilResetMs / 60000);
          const remMinutes = totalMinutes % 60;
          const remHours = Math.floor(totalMinutes / 60);
          if (remHours > 0) {
            refreshText = `Refreshes in ${remHours} ${remHours === 1 ? "hour" : "hours"}${remMinutes > 0 ? `, ${remMinutes} ${remMinutes === 1 ? "minute" : "minutes"}` : ""}`;
          } else {
            refreshText = `Refreshes in ${remMinutes} ${remMinutes === 1 ? "minute" : "minutes"}`;
          }
        }
      } else if (refreshAt) {
        const diffMs = new Date(refreshAt).getTime() - Date.now();
        if (diffMs > 0) {
          const hours = Math.round(diffMs / 3600000);
          if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            refreshText = `Refreshes in ${days} ${days === 1 ? "day" : "days"}${remHours > 0 ? `, ${remHours} ${remHours === 1 ? "hour" : "hours"}` : ""}`;
          } else {
            const totalMinutes = Math.round(diffMs / 60000);
            const remMinutes = totalMinutes % 60;
            const remHours = Math.floor(totalMinutes / 60);
            if (remHours > 0) {
              refreshText = `Refreshes in ${remHours} ${remHours === 1 ? "hour" : "hours"}${remMinutes > 0 ? `, ${remMinutes} ${remMinutes === 1 ? "minute" : "minutes"}` : ""}`;
            } else {
              refreshText = `Refreshes in ${remMinutes} ${remMinutes === 1 ? "minute" : "minutes"}`;
            }
          }
        }
      }

      // Normalize local placeholder modelIds (e.g. MODEL_PLACEHOLDER_M16) using slugified displayName
      const cleanId = (model.modelId && !model.modelId.startsWith("MODEL_PLACEHOLDER"))
        ? model.modelId
        : slugify([name, tier].filter(Boolean).join(" "));

      return {
        id: cleanId,
        name,
        tier,
        remainingPercent,
        status: statusFor(remainingPercent),
        refreshText: refreshText || "Refreshes soon",
        refreshAt
      };
    }).filter((model) => /^Gemini\b|^GPT-OSS\b|^Claude\b/i.test(model.name));

    accounts.push({
      email: acc.email,
      isActive: Boolean(acc.isActive),
      status: acc.status || "success",
      lastUpdated: acc.snapshot.timestamp || new Date().toISOString(),
      models
    });

    if (acc.isActive) {
      activeModels = models;
    }
  }

  if (activeModels.length === 0 && accounts.length > 0) {
    activeModels = accounts[0].models;
  }

  return {
    source: "antigravity-cli",
    lastUpdated: new Date().toISOString(),
    accounts,
    models: activeModels
  };
}

function getRefreshTextAndAt(resetTime, now = new Date()) {
  if (!resetTime) {
    return { refreshText: "Refreshes soon", refreshAt: null };
  }
  const resetDate = new Date(resetTime);
  const diffMs = resetDate.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { refreshText: "Refreshes soon", refreshAt: resetTime };
  }
  const totalHours = Math.round(diffMs / 3600000);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const remHours = totalHours % 24;
    return {
      refreshText: `Refreshes in ${days} ${days === 1 ? "day" : "days"}${remHours > 0 ? `, ${remHours} ${remHours === 1 ? "hour" : "hours"}` : ""}`,
      refreshAt: resetTime
    };
  } else {
    const totalMinutes = Math.round(diffMs / 60000);
    const remMinutes = totalMinutes % 60;
    const remHours = Math.floor(totalMinutes / 60);
    if (remHours > 0) {
      return {
        refreshText: `Refreshes in ${remHours} ${remHours === 1 ? "hour" : "hours"}${remMinutes > 0 ? `, ${remMinutes} ${remMinutes === 1 ? "minute" : "minutes"}` : ""}`,
        refreshAt: resetTime
      };
    } else {
      return {
        refreshText: `Refreshes in ${remMinutes} ${remMinutes === 1 ? "minute" : "minutes"}`,
        refreshAt: resetTime
      };
    }
  }
}

async function readDecryptedAccounts(decryptedPath = null, now = new Date()) {
  const sourcePath = decryptedPath || resolveAccountsSourcePath();
  const parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  const rawAccounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
  if (!Array.isArray(rawAccounts)) throw new Error("Accounts source must contain an accounts array.");

  const exportedAt = parseTimestamp(parsed?.exportedAt);
  const sourceStat = statSync(sourcePath);
  const capturedAt = exportedAt || (Number.isFinite(sourceStat.mtimeMs) ? new Date(sourceStat.mtimeMs) : now);
  const activeFlags = await readActiveFlags(sourcePath);
  
  const accounts = [];
  
  for (const acc of rawAccounts) {
    if (!acc.email || !acc.quota) continue;
    
    const quotaGroups = acc.quota.quota_groups || [];
    const geminiGroup = quotaGroups.find(g => g.display_name === "Gemini Models") || quotaGroups[0];
    if (!geminiGroup || !Array.isArray(geminiGroup.buckets)) continue;
    
    const buckets = geminiGroup.buckets;
    const windows = buckets.map(quotaWindow).filter(Boolean);
    const isPro = acc.email.toLowerCase() === "leosaquetto@gmail.com";
    
    const models = [];
    
    if (isPro) {
      // Find 5h bucket (Five Hour Limit) - put it first (above Weekly)
      const fiveHourBucket = buckets.find(b => b.bucket_id === "gemini-5h" || b.window === "5h");
      if (fiveHourBucket) {
        const { refreshText, refreshAt } = getRefreshTextAndAt(fiveHourBucket.reset_time, now);
        const remainingPercent = clampPercent(Number((fiveHourBucket.remaining_fraction * 100).toFixed(5)));
        models.push({
          id: "gemini-3-1-pro-low",
          name: "Gemini 3.1 Pro",
          tier: "Low",
          remainingPercent,
          status: statusFor(remainingPercent),
          refreshText,
          refreshAt
        });
      }
      
      // Find weekly bucket (Weekly Limit) - put it second
      const weeklyBucket = buckets.find(b => b.bucket_id === "gemini-weekly" || b.window === "weekly");
      if (weeklyBucket) {
        const { refreshText, refreshAt } = getRefreshTextAndAt(weeklyBucket.reset_time, now);
        const remainingPercent = clampPercent(Number((weeklyBucket.remaining_fraction * 100).toFixed(5)));
        models.push({
          id: "gemini-3-1-pro-high",
          name: "Gemini 3.1 Pro",
          tier: "High",
          remainingPercent,
          status: statusFor(remainingPercent),
          refreshText,
          refreshAt
        });
      }
    } else {
      // Standard accounts - only weekly limit
      const weeklyBucket = buckets.find(b => b.bucket_id === "gemini-weekly" || b.window === "weekly") || buckets[0];
      if (weeklyBucket) {
        const { refreshText, refreshAt } = getRefreshTextAndAt(weeklyBucket.reset_time, now);
        const remainingPercent = clampPercent(Number((weeklyBucket.remaining_fraction * 100).toFixed(5)));
        models.push({
          id: "gemini-3-1-pro-high",
          name: "Gemini 3.1 Pro",
          tier: "High",
          remainingPercent,
          status: statusFor(remainingPercent),
          refreshText,
          refreshAt
        });
      }
    }
    
    const isActive = typeof acc.isActive === "boolean"
      ? acc.isActive
      : activeFlags.get(String(acc.email).toLowerCase()) === true;

    accounts.push({
      email: acc.email,
      isActive,
      status: isActive ? "success" : "cached",
      lastUpdated: capturedAt.toISOString(),
      models,
      windows,
    });
  }
  
  // Find active models
  let activeModels = [];
  const activeAcc = accounts.find(acc => acc.isActive);
  if (activeAcc) {
    activeModels = activeAcc.models;
  } else if (accounts.length > 0) {
    activeModels = accounts[0].models;
  }
  
  return {
    source: exportedAt ? "local-account-export" : "desktop-automation",
    lastUpdated: capturedAt.toISOString(),
    accounts,
    models: activeModels
  };
}

async function tryLocalCliPayload() {
  return null;
}

async function tryCliPayload(localSnapshot = null) {
  return null;
}

async function main() {
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  let payload;
  let details = { method: "local-account-source" };

  try {
    console.log("Reading the newest local Antigravity accounts source...");
    payload = await readDecryptedAccounts();
  } catch (error) {
    console.error(`Failed to read decrypted accounts: ${error.message}`);
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "read-failed" }, null, 2));
    return;
  }

  if (args.has("dry-run")) {
    console.log(JSON.stringify({ ok: true, dryRun: true, saved: payload, details }, null, 2));
    return;
  }

  const result = await writeAntigravityUsage(payload, {
    commit: args.has("commit"),
    push: args.has("push"),
  });

  console.log(JSON.stringify({
    ok: true,
    committed: result.committed,
    pushed: result.pushed,
    saved: result.payload,
    details,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  countBrightRunsFromRow,
  decodePng,
  detectQuotaBarPercents,
  extractRowsFromOcr,
  parseCliOutput,
};

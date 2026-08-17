#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  writeAntigravityUsage,
  splitNameTier,
  clampPercent,
  statusFor,
  slugify,
} from "./update-antigravity-usage.mjs";
import { readAntigravityManagerUsage } from "./read-antigravity-manager-usage.mjs";

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
    "Reads the encrypted quota cache maintained by Antigravity Manager.",
    "Only sanitized account identity, percentages, plans, and reset times are published.",
  ].join("\n");
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


async function main() {
  if (args.has("help")) {
    console.log(usage());
    return;
  }

  let payload;
  let details = { method: "antigravity-manager-db" };

  try {
    console.log("Reading live quota cache from Antigravity Manager...");
    payload = readAntigravityManagerUsage();
  } catch (error) {
    throw new Error(`Failed to read Antigravity Manager quota cache: ${error.message}`);
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

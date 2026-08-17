#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  createDecipheriv,
  pbkdf2Sync,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ENCRYPTED_VALUE_PREFIX = "agm_enc_v1:";
const SAFE_STORAGE_PREFIX = "v10";
const SAFE_STORAGE_SALT = "saltysalt";
const SAFE_STORAGE_ITERATIONS = 1003;
const SAFE_STORAGE_IV = Buffer.alloc(16, 0x20);

const DEFAULT_DATABASE_PATH = join(homedir(), ".antigravity-agent", "cloud_accounts.db");
const DEFAULT_SELECTION_PATH = join(homedir(), ".antigravity-agent", "when-reset-accounts.json");
const DEFAULT_WRAPPED_KEY_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Antigravity Manager",
  ".mk",
);
const DEFAULT_KEYCHAIN_SERVICE = "Antigravity Manager Safe Storage";
const DEFAULT_KEYCHAIN_ACCOUNT = "Antigravity Manager Key";

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function unixDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number * 1000).toISOString();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/@/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeSelection(rawSelection) {
  const entries = Array.isArray(rawSelection)
    ? rawSelection
    : Array.isArray(rawSelection?.accounts)
      ? rawSelection.accounts
      : [];

  const normalized = entries.map((entry) => {
    const source = typeof entry === "string" ? { email: entry } : entry;
    const email = String(source?.email || "").trim().toLowerCase();
    const slug = slugify(source?.slug || email);
    const label = String(source?.label || email).trim();
    if (!email || !email.includes("@")) throw new Error("Invalid Antigravity account email in selection.");
    if (!slug) throw new Error(`Invalid When Reset slug for ${email}.`);
    return { email, slug, label: label || email };
  });

  const emails = new Set();
  const slugs = new Set();
  for (const entry of normalized) {
    if (emails.has(entry.email)) throw new Error(`Duplicate Antigravity account: ${entry.email}.`);
    if (slugs.has(entry.slug)) throw new Error(`Duplicate When Reset account slug: ${entry.slug}.`);
    emails.add(entry.email);
    slugs.add(entry.slug);
  }
  return normalized;
}

function readSelection(path = DEFAULT_SELECTION_PATH) {
  if (!existsSync(path)) return [];
  return normalizeSelection(JSON.parse(readFileSync(path, "utf8")));
}

function decryptSafeStorageMasterKey(wrappedKey, keychainPassword) {
  const envelope = Buffer.isBuffer(wrappedKey) ? wrappedKey : Buffer.from(wrappedKey);
  if (envelope.subarray(0, 3).toString("utf8") !== SAFE_STORAGE_PREFIX) {
    throw new Error("Unsupported Antigravity Manager safeStorage envelope.");
  }

  const safeStorageKey = pbkdf2Sync(
    String(keychainPassword),
    SAFE_STORAGE_SALT,
    SAFE_STORAGE_ITERATIONS,
    16,
    "sha1",
  );
  const decipher = createDecipheriv("aes-128-cbc", safeStorageKey, SAFE_STORAGE_IV);
  const masterKeyHex = Buffer.concat([
    decipher.update(envelope.subarray(3)),
    decipher.final(),
  ]).toString("utf8");

  if (!/^[a-f0-9]{64}$/i.test(masterKeyHex)) {
    throw new Error("Antigravity Manager master key has an invalid format.");
  }
  return Buffer.from(masterKeyHex, "hex");
}

function decryptQuotaEnvelope(encryptedValue, masterKey) {
  const value = String(encryptedValue || "");
  if (value.startsWith("{") || value.startsWith("[")) return JSON.parse(value);
  if (!value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
    throw new Error("Unsupported Antigravity Manager quota envelope.");
  }

  const [ivHex, authTagHex, ciphertextHex] = value.slice(ENCRYPTED_VALUE_PREFIX.length).split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed Antigravity Manager quota envelope.");
  }

  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = decipher.update(ciphertextHex, "hex", "utf8") + decipher.final("utf8");
  return JSON.parse(plaintext);
}

function quotaGroupID(displayName, index) {
  const value = String(displayName || "");
  if (/gemini/i.test(value)) return "gemini";
  if (/claude|gpt|third[ -]?party/i.test(value)) return "claude-gpt";
  return slugify(value) || `group-${index + 1}`;
}

function quotaKind(bucket) {
  const value = `${bucket?.window || ""} ${bucket?.bucket_id || ""}`;
  if (/5\s*h|five[ -]?hour/i.test(value)) return { kind: "5h", windowMinutes: 300 };
  if (/weekly|7\s*d/i.test(value)) return { kind: "weekly", windowMinutes: 10_080 };
  return { kind: String(bucket?.window || "additional"), windowMinutes: null };
}

function quotaWindow(group, groupIndex, bucket, bucketIndex) {
  const remainingPercent = clampPercent(Number(bucket?.remaining_fraction) * 100);
  const refreshAt = isoDate(bucket?.reset_time);
  if (remainingPercent === null || !refreshAt) return null;

  const groupName = String(group?.display_name || `Quota group ${groupIndex + 1}`).trim();
  const groupID = quotaGroupID(groupName, groupIndex);
  const { kind, windowMinutes } = quotaKind(bucket);
  const limitTitle = kind === "5h"
    ? "5-hour limit"
    : kind === "weekly"
      ? "Weekly limit"
      : String(bucket?.display_name || bucket?.window || `Limit ${bucketIndex + 1}`).trim();

  return {
    id: String(bucket?.bucket_id || `${groupID}-${kind}-${bucketIndex + 1}`),
    group: groupName,
    title: `${groupName} · ${limitTitle}`,
    kind,
    ...(windowMinutes === null ? {} : { windowMinutes }),
    remainingPercent: Number(remainingPercent.toFixed(5)),
    refreshAt,
  };
}

function modelFromWindow(window) {
  if (window.group !== "Gemini Models") return null;
  const isFiveHour = window.kind === "5h";
  const tier = isFiveHour ? "Low" : window.kind === "weekly" ? "High" : window.kind;
  return {
    id: isFiveHour ? "gemini-3-1-pro-low" : "gemini-3-1-pro-high",
    name: "Gemini 3.1 Pro",
    tier,
    remainingPercent: window.remainingPercent,
    status: window.remainingPercent <= 0 ? "empty" : window.remainingPercent < 20 ? "low" : "ok",
    refreshText: window.kind === "5h" ? "5-hour reset" : "Weekly reset",
    refreshAt: window.refreshAt,
  };
}

function buildUsagePayload(rows, selection, masterKey) {
  const byEmail = new Map(rows.map((row) => [String(row.email || "").toLowerCase(), row]));
  const selected = selection.length > 0
    ? selection
    : rows.map((row) => ({
        email: String(row.email || "").toLowerCase(),
        slug: slugify(row.email),
        label: String(row.email || ""),
      }));

  const accounts = selected.map((identity) => {
    const row = byEmail.get(identity.email);
    if (!row) throw new Error(`Configured Antigravity account not found: ${identity.email}.`);
    if (!row.quota_json) throw new Error(`Antigravity Manager has no quota for ${identity.email}.`);

    const quota = decryptQuotaEnvelope(row.quota_json, masterKey);
    const groups = Array.isArray(quota?.quota_groups) ? quota.quota_groups : [];
    const windows = groups.flatMap((group, groupIndex) =>
      (Array.isArray(group?.buckets) ? group.buckets : [])
        .map((bucket, bucketIndex) => quotaWindow(group, groupIndex, bucket, bucketIndex))
        .filter(Boolean)
    );
    if (windows.length === 0) throw new Error(`Antigravity Manager returned no reset windows for ${identity.email}.`);

    const models = windows.map(modelFromWindow).filter(Boolean);
    return {
      id: identity.slug,
      email: identity.email,
      name: String(row.name || identity.label || identity.email),
      displayName: identity.label,
      plan: String(quota?.subscription_tier || "Antigravity").trim(),
      isActive: Number(row.is_active) === 1,
      status: Number(row.is_active) === 1 ? "success" : "cached",
      lastUpdated: unixDate(row.last_used),
      windows,
      models,
    };
  });

  const accountDates = accounts
    .map((account) => isoDate(account.lastUpdated))
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  const lastUpdated = accountDates.length > 0
    ? new Date(Math.max(...accountDates)).toISOString()
    : new Date(0).toISOString();
  const activeAccount = accounts.find((account) => account.isActive) || accounts[0];
  const payload = {
    source: "antigravity-manager-db",
    lastUpdated,
    accounts,
    models: activeAccount?.models || [],
  };

  const serialized = JSON.stringify(payload);
  if (/access_token|refresh_token|id_token|token_json|client_secret|agm_enc_v1/i.test(serialized)) {
    throw new Error("Refusing to emit an Antigravity snapshot containing credential material.");
  }
  return payload;
}

function keychainPassword(options = {}) {
  return execFileSync(
    options.securityPath || "/usr/bin/security",
    [
      "find-generic-password",
      "-w",
      "-s",
      options.keychainService || DEFAULT_KEYCHAIN_SERVICE,
      "-a",
      options.keychainAccount || DEFAULT_KEYCHAIN_ACCOUNT,
    ],
    { encoding: "utf8", maxBuffer: 16_384 },
  ).trim();
}

function queryAccountRows(options = {}) {
  const databasePath = options.databasePath || DEFAULT_DATABASE_PATH;
  const sql = [
    "PRAGMA query_only=ON;",
    "SELECT email,name,is_active,status,last_used,quota_json",
    "FROM accounts ORDER BY email;",
  ].join(" ");
  const output = execFileSync(
    options.sqlitePath || "/usr/bin/sqlite3",
    ["-json", databasePath, sql],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(output || "[]");
}

function readAntigravityManagerUsage(options = {}) {
  const wrappedKeyPath = options.wrappedKeyPath || DEFAULT_WRAPPED_KEY_PATH;
  const selectionPath = options.selectionPath || process.env.ANTIGRAVITY_WHEN_RESET_ACCOUNTS_PATH
    || DEFAULT_SELECTION_PATH;
  const password = options.keychainPassword ?? keychainPassword(options);
  const masterKey = decryptSafeStorageMasterKey(readFileSync(wrappedKeyPath), password);
  const rows = options.rows || queryAccountRows(options);
  const selection = options.selection || readSelection(selectionPath);
  return buildUsagePayload(rows, selection, masterKey);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    console.log(JSON.stringify(readAntigravityManagerUsage(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  buildUsagePayload,
  decryptQuotaEnvelope,
  decryptSafeStorageMasterKey,
  normalizeSelection,
  readAntigravityManagerUsage,
};

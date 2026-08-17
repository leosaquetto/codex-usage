#!/usr/bin/env node

import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import {
  buildUsagePayload,
  decryptSafeStorageMasterKey,
  normalizeSelection,
} from "./read-antigravity-manager-usage.mjs";

const password = "fixture-safe-storage-password";
const masterKey = Buffer.from("11".repeat(32), "hex");
const safeStorageKey = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
const safeStorageCipher = createCipheriv("aes-128-cbc", safeStorageKey, Buffer.alloc(16, 0x20));
const wrappedKey = Buffer.concat([
  Buffer.from("v10"),
  safeStorageCipher.update(masterKey.toString("hex"), "utf8"),
  safeStorageCipher.final(),
]);
assert.deepEqual(decryptSafeStorageMasterKey(wrappedKey, password), masterKey);

function encryptedQuota(quota, byte) {
  const iv = Buffer.alloc(12, byte);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = cipher.update(JSON.stringify(quota), "utf8", "hex") + cipher.final("hex");
  return `agm_enc_v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext}`;
}

function quota(weeklyRemaining = 0.8) {
  return {
    subscription_tier: "Google AI Pro",
    quota_groups: [
      {
        display_name: "Gemini Models",
        buckets: [
          {
            bucket_id: "gemini-weekly",
            window: "weekly",
            remaining_fraction: weeklyRemaining,
            reset_time: "2026-08-24T22:37:54Z",
          },
          {
            bucket_id: "gemini-5h",
            window: "5h",
            remaining_fraction: 0.65,
            reset_time: "2026-08-18T03:37:54Z",
          },
        ],
      },
      {
        display_name: "Claude and GPT models",
        buckets: [
          {
            bucket_id: "3p-weekly",
            window: "weekly",
            remaining_fraction: 0.55,
            reset_time: "2026-08-24T22:37:54Z",
          },
          {
            bucket_id: "3p-5h",
            window: "5h",
            remaining_fraction: 0.45,
            reset_time: "2026-08-18T03:37:54Z",
          },
        ],
      },
    ],
  };
}

const selection = normalizeSelection({
  accounts: [
    { email: "second@example.com", slug: "second", label: "Second account" },
    { email: "first@example.com", slug: "first" },
  ],
});
const payload = buildUsagePayload([
  {
    email: "first@example.com",
    name: "First",
    is_active: 1,
    status: "active",
    last_used: 1_787_006_000,
    quota_json: encryptedQuota(quota(0.8), 1),
    token_json: "must-never-be-read-or-emitted",
  },
  {
    email: "second@example.com",
    name: "Second",
    is_active: 0,
    status: "active",
    last_used: 1_787_006_100,
    quota_json: encryptedQuota(quota(0.9), 2),
  },
], selection, masterKey);

assert.equal(payload.source, "antigravity-manager-db");
assert.deepEqual(payload.accounts.map((account) => account.email), [
  "second@example.com",
  "first@example.com",
]);
assert.equal(payload.accounts[0].id, "second");
assert.equal(payload.accounts[0].displayName, "Second account");
assert.equal(payload.accounts[0].plan, "Google AI Pro");
assert.equal(payload.accounts[0].windows.length, 4);
assert.deepEqual(
  payload.accounts[0].windows.map((window) => [window.id, window.kind, window.windowMinutes]),
  [
    ["gemini-weekly", "weekly", 10_080],
    ["gemini-5h", "5h", 300],
    ["3p-weekly", "weekly", 10_080],
    ["3p-5h", "5h", 300],
  ],
);
assert.equal(payload.accounts[0].windows[0].remainingPercent, 90);
assert.match(payload.accounts[0].windows[2].title, /Claude and GPT models/);
assert.equal(payload.accounts[1].models.length, 2);
assert.equal(payload.models.length, 2);
assert.ok(!JSON.stringify(payload).includes("must-never"));
assert.ok(!JSON.stringify(payload).includes("agm_enc_v1"));

assert.throws(
  () => normalizeSelection([{ email: "first@example.com" }, { email: "FIRST@example.com" }]),
  /Duplicate Antigravity account/,
);

console.log("Antigravity Manager reader tests ok");

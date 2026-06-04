#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.CODEX_USAGE_USE_LOCAL_FILES = "1";

const require = createRequire(import.meta.url);
const usageHandler = require("../webapp/api/usage.js");

let statusCode = null;
let payload = null;
const response = {
  setHeader() {},
  status(value) {
    statusCode = value;
    return this;
  },
  json(value) {
    payload = value;
    return this;
  },
};

await usageHandler({}, response);

assert.equal(statusCode, 200);
assert.ok(payload && typeof payload === "object");
assert.ok(Array.isArray(payload.accounts));
assert.equal(typeof payload.activeAccountId === "string" || payload.activeAccountId === null, true);
assert.equal(typeof payload.isStale, "boolean");
assert.equal(typeof payload.dataAgeMinutes === "number" || payload.dataAgeMinutes === null, true);
assert.equal(payload.staleAfterMinutes, 60);

for (const account of payload.accounts) {
  assert.equal(typeof account.id, "string");
  assert.equal(typeof account.lastUsedAt === "string" || account.lastUsedAt === null, true);
  assert.equal(typeof account.error === "string" ? account.error.length <= 160 : account.error === null, true);
}

console.log("usage api smoke tests ok");

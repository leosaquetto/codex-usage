#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pushConfigHandler = require("../webapp/api/push-config.js");
const pushDispatchHandler = require("../webapp/api/push-dispatch.js");

function responseCapture() {
  const capture = { statusCode: null, payload: null };
  return {
    capture,
    response: {
      setHeader() {},
      status(statusCode) {
        capture.statusCode = statusCode;
        return {
          json(payload) {
            capture.payload = payload;
          },
        };
      },
    },
  };
}

process.env.VAPID_PUBLIC_KEY = "public-test-key";
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";

const config = responseCapture();
await pushConfigHandler({ method: "GET" }, config.response);
assert.equal(config.capture.statusCode, 200);
assert.deepEqual(config.capture.payload, {
  enabled: true,
  publicKey: "public-test-key",
});

process.env.PUSH_DISPATCH_SECRET = "expected-secret";
const unauthorized = responseCapture();
await pushDispatchHandler({
  method: "POST",
  headers: { authorization: "Bearer wrong-secret" },
  body: { usage: {} },
}, unauthorized.response);
assert.equal(unauthorized.capture.statusCode, 401);
assert.equal(unauthorized.capture.payload.error, "Não autorizado.");

console.log("push api tests ok");

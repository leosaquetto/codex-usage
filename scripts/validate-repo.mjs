#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const syntaxFiles = [
  "webapp/app.js",
  "webapp/api/usage.js",
  "webapp/api/push-config.js",
  "webapp/api/push-dispatch.js",
  "webapp/api/push-subscription.js",
  "webapp/lib/push-service.js",
  "webapp/lib/push-store.js",
  "webapp/sw.js",
  "webapp/notification-engine.mjs",
  "scripts/build-usage-summary.mjs",
  "scripts/codex-usage-history.mjs",
  "scripts/run-usage-data-update.mjs",
  "scripts/update-antigravity-usage-auto.mjs",
  "scripts/update-antigravity-usage.mjs",
  "scripts/update-codex-usage-from-chrome.mjs",
  "scripts/update-codex-usage-from-switcher.mjs",
  "scripts/update-codex-usage-playwright.mjs",
];
const commands = [
  ...syntaxFiles.map((file) => ({ label: `syntax ${file}`, args: ["--check", file] })),
  { label: "codex parser", args: ["scripts/test-codex-usage-parser.mjs"] },
  { label: "codex history", args: ["scripts/test-codex-usage-history.mjs"] },
  { label: "antigravity parser", args: ["scripts/test-antigravity-usage-parser.mjs"] },
  { label: "notification engine", args: ["scripts/test-notification-engine.mjs"] },
  { label: "push API", args: ["scripts/test-push-api.mjs"] },
  { label: "usage API", args: ["scripts/test-usage-api.mjs"] },
  { label: "summary consistency", args: ["scripts/build-usage-summary.mjs", "--verify-only"] },
  { label: "static contracts", args: ["scripts/validate-static-contracts.mjs"] },
];

for (const command of commands) {
  process.stdout.write(`- ${command.label}: `);
  const result = spawnSync(process.execPath, command.args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stdout.write("failed\n");
    process.stderr.write([result.stdout, result.stderr].filter(Boolean).join("\n"));
    process.exit(result.status || 1);
  }
  process.stdout.write("ok\n");
}

console.log("repository validation ok");

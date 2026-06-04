#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webappRoot = resolve(root, "webapp");

async function read(path) {
  return readFile(resolve(root, path), "utf8");
}

function webappPathForUrl(rawUrl) {
  const clean = String(rawUrl).split(/[?#]/)[0];
  if (clean === "/" || clean === "") return resolve(webappRoot, "index.html");
  const relative = clean.replace(/^\.?\//, "");
  return resolve(webappRoot, relative);
}

async function assertWebappUrlExists(rawUrl, source) {
  const path = webappPathForUrl(rawUrl);
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${source} aponta para asset ausente: ${rawUrl} -> ${path}`);
  }
}

const html = await read("webapp/index.html");
const manifest = JSON.parse(await read("webapp/manifest.json"));
const serviceWorker = await read("webapp/sw.js");
const splash = await read("webapp/assets/splash.svg");
const api = await read("webapp/api/usage.js");
const devServer = await read("scripts/dev-webapp-server.mjs");
const vercel = JSON.parse(await read("webapp/vercel.json"));

const htmlLocalUrls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((url) => url.startsWith("/") || url.startsWith("./"));
for (const url of htmlLocalUrls) await assertWebappUrlExists(url, "webapp/index.html");

for (const icon of manifest.icons || []) await assertWebappUrlExists(icon.src, "webapp/manifest.json");
assert.equal(manifest.background_color, "#f5f7fb", "manifest background_color deve seguir o tema claro do app");

const criticalAssetsBlock = serviceWorker.match(/const CRITICAL_ASSETS = \[([\s\S]*?)\];/)?.[1] || "";
const criticalAssets = [...criticalAssetsBlock.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
assert.ok(criticalAssets.includes("/notification-engine.mjs?v=repo_closure_5"), "notification-engine.mjs deve estar no cache critico");
for (const url of criticalAssets) await assertWebappUrlExists(url, "webapp/sw.js");

const splashUrls = [...splash.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]);
for (const url of splashUrls) await assertWebappUrlExists(url, "webapp/assets/splash.svg");

assert.equal(vercel.git?.deploymentEnabled?.["usage-data"], false, "Vercel deve ignorar a branch usage-data");
assert.match(api, /CODEX_USAGE_GITHUB_BRANCH \|\| "usage-data"/, "API deve usar usage-data por padrao");
assert.match(devServer, /"\.mjs": "application\/javascript; charset=utf-8"/, "Servidor local deve servir modulos .mjs com MIME JavaScript");

for (const path of [
  "scriptable/large-widget.js",
  "scriptable/codex-accounts-large-widget.js",
  "scriptable/webview-hidden-auto-update-v3.js",
]) {
  const source = await read(path);
  const rawGithubUrls = [...source.matchAll(/https:\/\/raw\.githubusercontent\.com\/[^"'`\s]+/g)].map((match) => match[0]);
  for (const url of rawGithubUrls) {
    const usesDataBranch = url.includes("/usage-data/")
      || (url.includes("${GITHUB_BRANCH}") && /const GITHUB_BRANCH = "usage-data"/.test(source));
    assert.ok(usesDataBranch, `${path} deve ler dados da branch usage-data: ${url}`);
    assert.ok(!url.includes("/main/"), `${path} nao deve ler dados automaticos da main: ${url}`);
  }
}

console.log("static contracts and PWA assets ok");

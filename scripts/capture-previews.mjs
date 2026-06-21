import http from "node:http";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

async function main() {
  console.log("Starting dev server for preview...");
  const devServer = spawn("node", ["scripts/dev-webapp-server.mjs"], {
    env: { ...process.env, PORT: "8088", CODEX_USAGE_USE_LOCAL_FILES: "1" }
  });

  devServer.stdout.on("data", (data) => {
    console.log(`[Server]: ${data.toString().trim()}`);
  });

  // Wait 1.5s for server to start
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log("Launching playwright...");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. Capture Desktop Preview
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:8088/");
  
  // Wait for loadingOverlay to disappear
  await page.waitForSelector("body:not(.is-loading)", { timeout: 5000 });
  
  // Extra wait for layout calculations
  await new Promise((resolve) => setTimeout(resolve, 1000));
  
  const desktopPath = "/Users/leosaquetto/.gemini/antigravity/brain/74be577b-1dd4-4f6a-9387-a8ddbfe9a943/desktop_preview.png";
  await page.screenshot({ path: desktopPath, fullPage: true });
  console.log(`Saved desktop preview to ${desktopPath}`);

  // 2. Capture Mobile Preview
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8088/");
  await page.waitForSelector("body:not(.is-loading)", { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const mobilePath = "/Users/leosaquetto/.gemini/antigravity/brain/74be577b-1dd4-4f6a-9387-a8ddbfe9a943/mobile_preview.png";
  await page.screenshot({ path: mobilePath, fullPage: true });
  console.log(`Saved mobile preview to ${mobilePath}`);

  console.log("Closing browser and server...");
  await browser.close();
  devServer.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

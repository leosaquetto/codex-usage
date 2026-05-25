#!/usr/bin/env node
import http from "node:http";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import usageHandler from "../webapp/api/usage.js";

const rootDir = new URL("../webapp/", import.meta.url);
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function createApiResponse(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(code) {
      return {
        json(payload) {
          sendJson(res, code, payload);
        },
      };
    },
  };
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, "http://127.0.0.1").pathname;
  const safePath = normalize(requestPath === "/" ? "/index.html" : requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(rootDir.pathname, safePath);

  if (!filePath.startsWith(rootDir.pathname) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://127.0.0.1");

    if (pathname === "/api/usage") {
      await usageHandler(req, createApiResponse(res));
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    sendJson(res, 500, { error: message });
  }
});

function getLocalNetworkUrl() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return `http://${entry.address}:${port}`;
      }
    }
  }
  return null;
}

server.listen(port, host, async () => {
  const indexHtml = await readFile(new URL("../webapp/index.html", import.meta.url), "utf8");
  const pageTitleMatch = indexHtml.match(/<title>([^<]+)<\/title>/i);
  const pageTitle = pageTitleMatch ? pageTitleMatch[1] : "webapp";
  console.log(`${pageTitle} dev server running at http://127.0.0.1:${port}`);
  const networkUrl = getLocalNetworkUrl();
  if (networkUrl) console.log(`Network URL for phone: ${networkUrl}`);
});

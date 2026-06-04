#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataWorktree = resolve(root, ".local/usage-data-worktree");

async function readSnapshot(name) {
  const preferred = resolve(dataWorktree, name);
  const path = existsSync(preferred) ? preferred : resolve(root, name);
  const payload = JSON.parse(await readFile(path, "utf8"));
  const updatedAt = payload.lastUpdated ? new Date(payload.lastUpdated) : null;
  const ageMinutes = updatedAt && Number.isFinite(updatedAt.getTime())
    ? Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 60000))
    : null;
  return {
    path,
    lastUpdated: updatedAt?.toISOString() || null,
    ageMinutes,
  };
}

function launchAgent(label) {
  const target = `gui/${process.getuid()}/${label}`;
  const result = spawnSync("launchctl", ["print", target], { encoding: "utf8" });
  if (result.status !== 0) {
    return { label, loaded: false, state: "not-loaded", lastExitCode: null, runs: null };
  }
  const output = result.stdout;
  return {
    label,
    loaded: true,
    state: output.match(/\bstate = ([^\n]+)/)?.[1]?.trim() || "unknown",
    lastExitCode: Number(output.match(/\blast exit code = (-?\d+)/)?.[1] ?? NaN) || 0,
    runs: Number(output.match(/\bruns = (\d+)/)?.[1] ?? NaN) || 0,
  };
}

const report = {
  checkedAt: new Date().toISOString(),
  snapshots: {
    codex: await readSnapshot("codex_usage.json"),
    antigravity: await readSnapshot("antigravity_usage.json"),
  },
  launchAgents: {
    switcher: launchAgent("com.leosaquetto.codexusage.switcher.autoupdate"),
    antigravity: launchAgent("com.leosaquetto.codexusage.antigravity.autoupdate"),
  },
  notes: [
    "O dashboard publicado le a branch usage-data; o snapshot da main pode ser antigo por design.",
    "Antigravity so atualiza quando o app esta aberto e o LaunchAgent tem permissoes de Acessibilidade e Gravacao de Tela.",
  ],
};

console.log(JSON.stringify(report, null, 2));

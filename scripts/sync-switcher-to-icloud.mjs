#!/usr/bin/env node
/**
 * Sincronizador Automático Codex Switcher -> iCloud Drive
 * Disparado pelo launchd quando ~/.codex-switcher/accounts.json é modificado.
 *
 * Características:
 * - 100% Local: Zero Git commits, zero Git push, zero Vercel.
 * - Debounce: Aguarda 3 segundos após a gravação para consolidar alterações.
 * - Cooldown: Evita execuções repetidas em intervalo menor que 30 segundos.
 * - Grava direto no iCloud Drive do Scriptable.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const root = resolve(__dirname, "..");
const icloudDir = resolve(homedir(), "Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents");
const icloudTarget = resolve(icloudDir, "codex_usage.json");
const localUsage = resolve(root, "codex_usage.json");
const lockFile = "/tmp/codex-switcher-icloud-sync.lock";
const COOLDOWN_SECONDS = 30;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const now = Date.now();

  // 1. Verificar Cooldown
  if (existsSync(lockFile)) {
    try {
      const lastRun = Number(readFileSync(lockFile, "utf8").trim());
      if (Number.isFinite(lastRun) && (now - lastRun) < COOLDOWN_SECONDS * 1000) {
        console.log(`[iCloud Sync] Cooldown ativo (${Math.round((now - lastRun) / 1000)}s < ${COOLDOWN_SECONDS}s). Ignorando.`);
        return;
      }
    } catch {}
  }

  // 2. Debounce de 3 segundos (aguarda o app Switcher terminar de gravar)
  await sleep(3000);

  // Registrar timestamp no lock
  writeFileSync(lockFile, String(Date.now()));

  console.log(`[iCloud Sync] Iniciando atualização de uso via Switcher (${new Date().toLocaleTimeString("pt-BR")})...`);

  // 3. Executar o coletor local (SEM --commit, SEM --push, SEM --publish)
  const updaterScript = resolve(root, "scripts/update-codex-usage-from-switcher.mjs");
  const result = spawnSync(process.execPath, [updaterScript], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });

  if (result.status !== 0) {
    console.error("[iCloud Sync] Falha ao atualizar codex_usage.json:", result.stderr || result.stdout);
    return;
  }

  // 4. Copiar para o iCloud Drive
  if (existsSync(localUsage)) {
    if (!existsSync(icloudDir)) {
      await mkdir(icloudDir, { recursive: true });
    }
    await copyFile(localUsage, icloudTarget);
    console.log(`[iCloud Sync] ✅ codex_usage.json atualizado com sucesso no iCloud Drive!`);
  } else {
    console.error(`[iCloud Sync] Arquivo local ${localUsage} não encontrado.`);
  }
}

main().catch((err) => {
  console.error("[iCloud Sync] Erro inesperado:", err);
});

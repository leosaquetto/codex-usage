#!/usr/bin/env node
/**
 * Codex Widget Mirror — Espelho somente leitura do Widget Scriptable no Mac
 * Renderiza no terminal a visualização idêntica ao widget do iOS.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const root = resolve(__dirname, "..");
const usagePath = resolve(root, "codex_usage.json");

const ALIASES = new Map([
  ["dhj6smm47v@privaterelay.appleid.com", { alias: "codex-mae", label: "Mãe (Descartável)", priority: 1, banked: 2, expires: "01/10 às 15:00", expiresDate: "2026-10-01T15:00:00-03:00" }],
  ["gratinado-17-dirigiveis@icloud.com", { alias: "codex-gratinado", label: "Gratinado (Descartável)", priority: 2, banked: 1, expires: "03/10 às 08:39", expiresDate: "2026-10-03T08:39:00-03:00" }],
  ["leonardo.a@live.com", { alias: "codex-leonardo.a", label: "Leonardo.a (Descartável)", priority: 3, banked: 1, expires: "07/10 às 16:19", expiresDate: "2026-10-07T16:19:00-03:00" }],
  ["leosaquetto@outlook.com", { alias: "codex-leosaquetto@outlook", label: "Leo Outlook (Descartável)", priority: 4, banked: 0, expires: "07/10 às 18:41", expiresDate: "2026-10-07T18:41:00-03:00" }],
  ["ldionisioxavier@gmail.com", { alias: "codex-ldionisioxavier", label: "Lays Dionisio (Descartável)", priority: 5, banked: 1, expires: "18/10 às 11:50", expiresDate: "2026-10-18T11:50:00-03:00" }],
  ["peterscastro@gmail.com", { alias: "codex-peterscastro", label: "Peter Castro (Descartável)", priority: 6, banked: 1, expires: "18/10 às 14:00", expiresDate: "2026-10-18T14:00:00-03:00" }],
  ["stephanie.arcos@gmail.com", { alias: "codex-stephanie.arcos", label: "Stephanie (Descartável)", priority: 7, banked: 1, expires: "20/10 às 21:00", expiresDate: "2026-10-20T21:00:00-03:00" }],
  ["rohsuehiro@gmail.com", { alias: "codex-rohsuehiro", label: "Roh Suehiro (Descartável)", priority: 7, banked: 1, expires: "20/10 às 21:00", expiresDate: "2026-10-20T21:00:00-03:00" }],
  ["contatonatanaelrodrigs@gmail.com", { alias: "codex-natanael", label: "Natanael (Plus)", priority: 8, banked: 0, expires: "Contínua" }],
  ["daniel.lovizzaro@gmail.com", { alias: "codex-daniel", label: "Daniel (Recorrente)", priority: 9, banked: 3, expires: "Todo dia 24", recurringDay: 24 }],
  ["jv5pdcwnxp@privaterelay.appleid.com", { alias: "codex-leo", label: "Leo Principal (Recorrente)", priority: 10, banked: 3, expires: "Todo dia 20", recurringDay: 20 }],
]);

function getNextMonthlyDate(dayOfMonth) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (now.getDate() >= dayOfMonth) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return new Date(year, month, dayOfMonth, 23, 59, 59);
}

function formatDaysCountdown(target) {
  if (!target) return "";
  const targetTime = target instanceof Date ? target.getTime() : new Date(target).getTime();
  const diffMs = targetTime - Date.now();
  if (diffMs <= 0) return "0d";

  const oneDayMs = 24 * 60 * 60 * 1000;
  if (diffMs < oneDayMs) {
    const hours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)));
    return `${hours}h`;
  }
  const days = Math.ceil(diffMs / oneDayMs);
  return `${days}d`;
}

function formatRemainingDuration(targetIso) {
  if (!targetIso) return "sem ciclo";
  const target = new Date(targetIso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return "pronto para renovar";

  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  if (days > 0) return `${days} dia${days > 1 ? "s" : ""} ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

function renderProgressBar(percent, width = 24) {
  const p = Math.max(0, Math.min(100, percent ?? 100));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;
  // Bloco preenchido e bloco vazio
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

async function renderMirror() {
  if (!existsSync(usagePath)) {
    console.error(`Arquivo não encontrado: ${usagePath}. Execute: npm run update:codex-usage:switcher`);
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(usagePath, "utf8"));
  const allAccounts = raw.accounts || [];
  const plusAccounts = allAccounts.filter(a => String(a.planType).toLowerCase() === "plus");

  // Ordenar por prioridade
  plusAccounts.sort((a, b) => {
    const metaA = ALIASES.get(a.email) || { priority: 99 };
    const metaB = ALIASES.get(b.email) || { priority: 99 };
    return metaA.priority - metaB.priority;
  });

  const nowStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  console.log("\n" + "═".repeat(68));
  console.log(`  📱 CODEX PLUS WIDGET MIRROR (ESPELHO SOMENTE LEITURA)`);
  console.log(`  🕒 Atualizado em: ${nowStr} • ${plusAccounts.length} Contas Plus Monitoradas`);
  console.log("═".repeat(68) + "\n");

  for (const acc of plusAccounts) {
    const meta = ALIASES.get(acc.email) || { alias: acc.name, label: acc.name, expires: "--" };
    const sessaoPct = acc.fiveHourPercent !== null && acc.fiveHourPercent !== undefined ? acc.fiveHourPercent : 100;
    const semanalPct = acc.weeklyPercent !== null && acc.weeklyPercent !== undefined ? acc.weeklyPercent : 100;
    const sessaoRenova = formatRemainingDuration(acc.fiveHourReset);
    const semanalRenova = formatRemainingDuration(acc.weeklyReset);

    const isUrgent = meta.priority <= 2;
    const borderChar = isUrgent ? "🚨" : "🔹";
    const resetsBadge = meta.banked > 0 ? `[${meta.banked} ${meta.banked === 1 ? "reset" : "resets"}]` : "";

    const targetDate = meta.recurringDay ? getNextMonthlyDate(meta.recurringDay) : meta.expiresDate;
    const countdown = formatDaysCountdown(targetDate);
    const expInfo = countdown ? `${meta.expires} (${countdown} restantes)` : meta.expires;
    const resetsInfo = meta.banked > 0 ? `  |  Resets: ${meta.banked}` : "";

    console.log(`┌─ ${borderChar} ${meta.label.toUpperCase()} ${resetsBadge} ────────────────────────────────────`);
    console.log(`│ 📧 ${acc.email}  |  Expira: ${expInfo}${resetsInfo}`);
    console.log(`│`);
    console.log(`│  Sessão:  ${renderProgressBar(sessaoPct, 22)}  ${String(sessaoPct).padStart(3, " ")}% restante`);
    console.log(`│           ↻ Renova em: ${sessaoRenova}`);
    console.log(`│`);
    console.log(`│  Semanal: ${renderProgressBar(semanalPct, 22)}  ${String(semanalPct).padStart(3, " ")}% restante`);
    console.log(`│           ↻ Renova em: ${semanalRenova}`);
    console.log(`└───────────────────────────────────────────────────────────────────\n`);
  }

  console.log("═".repeat(68));
  console.log("  💡 Dica: Este espelho lê 'codex_usage.json' sem alterar tokens.");
  console.log("═".repeat(68) + "\n");
}

renderMirror().catch(err => {
  console.error("Erro ao renderizar espelho:", err);
  process.exit(1);
});

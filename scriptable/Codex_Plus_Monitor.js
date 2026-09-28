// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: gray; icon-glyph: cloud;
/**
 * ==============================================================================
 * ☁️ Codex Plus Monitor — Scriptable Widget
 * ==============================================================================
 * Monitor das 10 contas Codex ativas com layout Dark Frosted Glass (iOS nativo).
 * Exibe:
 *  - Nome amigável / Alias de cada conta
 *  - Cota de Sessão (5h) com barra de progresso e contagem regressiva
 *  - Cota Semanal (7d) com barra de progresso e contagem regressiva
 *  - Data de expiração da assinatura (ou renovação mensal)
 *  - Label com a quantidade de Resets acumulados ("2 resets")
 * ==============================================================================
 */

// 🌐 Endpoint Remoto no GitHub (branch usage-data)
const GITHUB_USAGE_URL = "https://raw.githubusercontent.com/leosaquetto/codex-usage/usage-data/codex_usage.json";
const CACHE_KEY = "codex_plus_monitor_cache_v2.json";
const REFRESH_INTERVAL_MINUTES = 15;

// 🏷️ Configuração Canônica das 10 Contas Monitoradas
const MONITORED_CONFIG = [
  {
    email: "dhj6smm47v@privaterelay.appleid.com",
    alias: "mãe",
    priority: 1,
    banked: 2,
    expires: "01/10 às 15:00",
    expiresDate: "2026-10-01T15:00:00-03:00",
    expiresBadge: "01/10",
    isUrgent: true,
  },
  {
    email: "gratinado-17-dirigiveis@icloud.com",
    alias: "gratinado",
    priority: 2,
    banked: 1,
    expires: "03/10 às 08:39",
    expiresDate: "2026-10-03T08:39:00-03:00",
    expiresBadge: "03/10",
    isUrgent: true,
  },
  {
    email: "leonardo.a@live.com",
    alias: "leo.a@live",
    priority: 3,
    banked: 1,
    expires: "07/10 às 16:19",
    expiresDate: "2026-10-07T16:19:00-03:00",
    expiresBadge: "07/10",
    isUrgent: false,
  },
  {
    email: "leosaquetto@outlook.com",
    alias: "ls@out",
    priority: 4,
    banked: 0,
    expires: "07/10 às 18:41",
    expiresDate: "2026-10-07T18:41:00-03:00",
    expiresBadge: "07/10",
    isUrgent: false,
  },
  {
    email: "ldionisioxavier@gmail.com",
    alias: "ldio",
    priority: 5,
    banked: 1,
    expires: "18/10 às 11:50",
    expiresDate: "2026-10-18T11:50:00-03:00",
    expiresBadge: "18/10",
    isUrgent: false,
  },
  {
    email: "peterscastro@gmail.com",
    alias: "ptr-cas",
    priority: 6,
    banked: 1,
    expires: "18/10 às 14:00",
    expiresDate: "2026-10-18T14:00:00-03:00",
    expiresBadge: "18/10",
    isUrgent: false,
  },
  {
    email: "rohsuehiro@gmail.com",
    alias: "roh-sue",
    priority: 7,
    banked: 1,
    expires: "20/10 às 21:00",
    expiresDate: "2026-10-20T21:00:00-03:00",
    expiresBadge: "20/10",
    isUrgent: false,
  },
  {
    email: "stephanie.arcos@gmail.com",
    alias: "step",
    priority: 8,
    banked: 1,
    expires: "20/10 às 21:00",
    expiresDate: "2026-10-20T21:00:00-03:00",
    expiresBadge: "20/10",
    isUrgent: false,
  },
  {
    email: "daniel.lovizzaro@gmail.com",
    alias: "dan",
    priority: 9,
    banked: 3,
    expires: "Mensal (24)",
    recurringDay: 24,
    expiresBadge: "Dia 24",
    isUrgent: false,
  },
  {
    email: "jv5pdcwnxp@privaterelay.appleid.com",
    alias: "leo",
    priority: 10,
    banked: 3,
    expires: "Mensal (20)",
    recurringDay: 20,
    expiresBadge: "Dia 20",
    isUrgent: false,
  },
];

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

// 📦 Snapshot Embutido (Garante que nunca fique vazio ou com dados antigos)
const EMBEDDED_SNAPSHOT = {
  "jv5pdcwnxp@privaterelay.appleid.com": { fiveHourPercent: 100, weeklyPercent: 51, fiveHourReset: "2026-09-29T01:03:56.000Z", weeklyReset: "2026-10-03T17:20:36.000Z" },
  "daniel.lovizzaro@gmail.com": { fiveHourPercent: 100, weeklyPercent: 36, fiveHourReset: "2026-09-29T01:08:02.000Z", weeklyReset: "2026-10-03T17:20:38.000Z" },
  "stephanie.arcos@gmail.com": { fiveHourPercent: 100, weeklyPercent: 100, fiveHourReset: null, weeklyReset: "2026-10-03T17:20:37.000Z" },
  "dhj6smm47v@privaterelay.appleid.com": { fiveHourPercent: 0, weeklyPercent: 5, fiveHourReset: "2026-09-28T23:45:24.000Z", weeklyReset: "2026-10-03T17:20:37.000Z" },
  "leonardo.a@live.com": { fiveHourPercent: 0, weeklyPercent: 52, fiveHourReset: "2026-09-28T23:48:51.000Z", weeklyReset: "2026-10-03T17:20:38.000Z" },
  "gratinado-17-dirigiveis@icloud.com": { fiveHourPercent: 13, weeklyPercent: 61, fiveHourReset: "2026-09-28T23:49:57.000Z", weeklyReset: "2026-10-03T17:20:36.000Z" },
  "leosaquetto@outlook.com": { fiveHourPercent: 100, weeklyPercent: 67, fiveHourReset: "2026-09-28T23:51:28.000Z", weeklyReset: "2026-10-03T17:20:37.000Z" },
  "peterscastro@gmail.com": { fiveHourPercent: 100, weeklyPercent: 68, fiveHourReset: "2026-09-29T01:43:03.000Z", weeklyReset: "2026-10-03T17:20:38.000Z" },
  "ldionisioxavier@gmail.com": { fiveHourPercent: 100, weeklyPercent: 68, fiveHourReset: "2026-09-29T01:43:33.000Z", weeklyReset: "2026-10-03T17:20:37.000Z" },
  "rohsuehiro@gmail.com": { fiveHourPercent: 100, weeklyPercent: 68, fiveHourReset: "2026-09-29T02:10:28.000Z", weeklyReset: "2026-10-03T17:20:37.000Z" },
};

function formatCountdown(targetIso) {
  if (!targetIso) return "sem ciclo";
  const target = new Date(targetIso).getTime();
  const diffMs = target - Date.now();
  if (diffMs <= 0) return "agora";

  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function parsePercent(val) {
  if (val === null || val === undefined || val === "") return 100;
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100;
}

async function loadData() {
  const fmLocal = FileManager.local();
  const localCachePath = fmLocal.joinPath(fmLocal.documentsDirectory(), CACHE_KEY);

  // 1. Tentar ler do iCloud Drive localmente
  const fmIcloud = FileManager.iCloud();
  const icloudPath = fmIcloud.joinPath(fmIcloud.documentsDirectory(), "codex_usage.json");
  if (fmIcloud.fileExists(icloudPath)) {
    try {
      if (!fmIcloud.isFileDownloaded(icloudPath)) {
        await fmIcloud.downloadFileFromiCloud(icloudPath);
      }
      const str = fmIcloud.readString(icloudPath);
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed?.accounts) && parsed.accounts.length >= 8) {
        try { fmLocal.writeString(localCachePath, str); } catch (_) {}
        return parsed;
      }
    } catch (e) {}
  }

  // 2. Tentar baixar do GitHub raw com cache-buster
  try {
    const req = new Request(`${GITHUB_USAGE_URL}?t=${Date.now()}`);
    req.timeoutInterval = 7;
    const json = await req.loadJSON();
    if (Array.isArray(json?.accounts) && json.accounts.length >= 8) {
      fmLocal.writeString(localCachePath, JSON.stringify(json));
      return json;
    }
  } catch (e) {}

  // 3. Tentar ler do cache local
  if (fmLocal.fileExists(localCachePath)) {
    try {
      const cachedStr = fmLocal.readString(localCachePath);
      const cached = JSON.parse(cachedStr);
      if (Array.isArray(cached?.accounts) && cached.accounts.length >= 8) {
        return cached;
      }
    } catch (e) {}
  }

  // 4. Fallback absoluto com o snapshot embutido
  return { accounts: [] };
}

function createProgressBar(parent, percent, width, height = 3.5) {
  const p = parsePercent(percent);
  const barBg = parent.addStack();
  barBg.layoutHorizontally();
  barBg.size = new Size(width, height);
  barBg.backgroundColor = new Color("#ffffff", 0.16);
  barBg.cornerRadius = height / 2;

  const fillWidth = Math.max(0, Math.round((p / 100) * width));
  if (fillWidth > 0) {
    const fill = barBg.addStack();
    fill.size = new Size(fillWidth, height);
    fill.backgroundColor = Color.white();
    fill.cornerRadius = height / 2;
  }
  barBg.addSpacer();
  return barBg;
}

// ------------------------------------------------------------------------------
// 📱 Layout MEDIUM (1 Conta Detalhada)
// ------------------------------------------------------------------------------
function buildMediumWidget(item) {
  const w = new ListWidget();
  const bgGrad = new LinearGradient();
  bgGrad.colors = [new Color("#1c1c1e"), new Color("#111113")];
  bgGrad.locations = [0, 1];
  w.backgroundGradient = bgGrad;
  w.setPadding(16, 18, 16, 18);

  const headRow = w.addStack();
  headRow.centerAlignContent();

  const symCloud = SFSymbol.named("cloud.fill") || SFSymbol.named("cpu");
  const iconImg = headRow.addImage(symCloud.image);
  iconImg.imageSize = new Size(18, 18);
  iconImg.tintColor = Color.white();

  headRow.addSpacer(8);

  const titleCol = headRow.addStack();
  titleCol.layoutVertically();

  const tRow = titleCol.addStack();
  tRow.centerAlignContent();
  const titleTxt = tRow.addText(`Codex • ${item.alias}`);
  titleTxt.font = Font.boldSystemFont(14);
  titleTxt.textColor = Color.white();

  if (item.banked > 0) {
    tRow.addSpacer(6);
    const bBadge = tRow.addStack();
    bBadge.backgroundColor = new Color("#ffffff", 0.14);
    bBadge.cornerRadius = 4;
    bBadge.setPadding(1, 4, 1, 4);
    const bTxt = bBadge.addText(`${item.banked} ${item.banked === 1 ? "reset" : "resets"}`);
    bTxt.font = Font.systemFont(8);
    bTxt.textColor = new Color("#ffd60a");
  }

  const expInfo = item.countdown ? `${item.expires} (${item.countdown} restantes)` : item.expires;
  const subTxt = titleCol.addText(`${item.email}  |  Expira: ${expInfo}`);
  subTxt.font = Font.systemFont(10);
  subTxt.textColor = new Color("#8e8e93");
  subTxt.lineLimit = 1;

  w.addSpacer(10);

  // Sessão
  const sRow = w.addStack();
  sRow.centerAlignContent();
  const sL = sRow.addText("Sessão");
  sL.font = Font.systemFont(12);
  sL.textColor = Color.white();
  sRow.addSpacer();
  const sV = sRow.addText(`${item.sessaoPct}% restante`);
  sV.font = Font.boldSystemFont(12);
  sV.textColor = Color.white();

  w.addSpacer(4);
  createProgressBar(w, item.sessaoPct, 290, 5);
  w.addSpacer(3);

  const sTime = w.addStack();
  sTime.centerAlignContent();
  const c1 = SFSymbol.named("arrow.clockwise");
  if (c1) {
    const i1 = sTime.addImage(c1.image);
    i1.imageSize = new Size(9, 9);
    i1.tintColor = new Color("#8e8e93");
    sTime.addSpacer(3);
  }
  const sT = sTime.addText(`Renova em ${item.sessaoReset}`);
  sT.font = Font.systemFont(10);
  sT.textColor = new Color("#8e8e93");

  w.addSpacer(8);

  // Semanal
  const wRow = w.addStack();
  wRow.centerAlignContent();
  const wL = wRow.addText("Semanal");
  wL.font = Font.systemFont(12);
  wL.textColor = Color.white();
  wRow.addSpacer();
  const wV = wRow.addText(`${item.semanalPct}% restante`);
  wV.font = Font.boldSystemFont(12);
  wV.textColor = Color.white();

  w.addSpacer(4);
  createProgressBar(w, item.semanalPct, 290, 5);
  w.addSpacer(3);

  const wTime = w.addStack();
  wTime.centerAlignContent();
  const c2 = SFSymbol.named("arrow.clockwise");
  if (c2) {
    const i2 = wTime.addImage(c2.image);
    i2.imageSize = new Size(9, 9);
    i2.tintColor = new Color("#8e8e93");
    wTime.addSpacer(3);
  }
  const wT = wTime.addText(`Renova em ${item.semanalReset}`);
  wT.font = Font.systemFont(10);
  wT.textColor = new Color("#8e8e93");

  w.addSpacer();
  return w;
}

// ------------------------------------------------------------------------------
// 📱 Layout LARGE (Todas as 10 Contas Plus em Grade 2 Colunas)
// ------------------------------------------------------------------------------
function buildLargeWidget(items) {
  const w = new ListWidget();
  const bgGrad = new LinearGradient();
  bgGrad.colors = [new Color("#1c1c1e"), new Color("#111113")];
  bgGrad.locations = [0, 1];
  w.backgroundGradient = bgGrad;
  w.setPadding(12, 10, 10, 10);

  // Top Bar
  const topBar = w.addStack();
  topBar.centerAlignContent();

  const symCloud = SFSymbol.named("cloud.fill") || SFSymbol.named("cpu");
  const iconImg = topBar.addImage(symCloud.image);
  iconImg.imageSize = new Size(13, 13);
  iconImg.tintColor = Color.white();
  topBar.addSpacer(5);

  const title = topBar.addText("Codex Plus Monitor");
  title.font = Font.boldSystemFont(12);
  title.textColor = Color.white();

  topBar.addSpacer();

  const countBadge = topBar.addStack();
  countBadge.backgroundColor = new Color("#ffffff", 0.12);
  countBadge.cornerRadius = 5;
  countBadge.setPadding(1.5, 5, 1.5, 5);
  const countText = countBadge.addText(`${items.length} contas`);
  countText.font = Font.boldSystemFont(8.5);
  countText.textColor = Color.white();

  w.addSpacer(7);

  // Grade de 2 Colunas com largura expandida
  const gridStack = w.addStack();
  gridStack.layoutHorizontally();

  const colLeft = gridStack.addStack();
  colLeft.layoutVertically();
  colLeft.size = new Size(163, 0);

  gridStack.addSpacer(7);

  const colRight = gridStack.addStack();
  colRight.layoutVertically();
  colRight.size = new Size(163, 0);

  function buildMiniCard(parent, item) {
    const card = parent.addStack();
    card.layoutVertically();
    card.backgroundColor = new Color("#ffffff", 0.08); // Dark frosted glass genuíno
    card.cornerRadius = 10;
    card.setPadding(6.5, 7.5, 6.5, 7.5);
    card.borderWidth = 1;
    card.borderColor = item.isUrgent ? new Color("#ff453a", 0.5) : new Color("#ffffff", 0.07);

    // Linha 1: Alias + Resets Label + Countdown & Expiração
    card.addSpacer(2);
    const row1 = card.addStack();
    row1.centerAlignContent();

    const nameTxt = row1.addText(item.alias);
    nameTxt.font = Font.boldSystemFont(9.5);
    nameTxt.textColor = item.isUrgent ? new Color("#ff453a") : Color.white();
    nameTxt.lineLimit = 1;

    // Label de resets (apenas exibe se tiver mais de 0 resets)
    if (item.banked > 0) {
      row1.addSpacer(3);
      const resetBadge = row1.addStack();
      resetBadge.backgroundColor = new Color("#ffffff", 0.1);
      resetBadge.cornerRadius = 3;
      resetBadge.setPadding(1, 3, 1, 3);
      const resetStr = `${item.banked} ${item.banked === 1 ? "reset" : "resets"}`;
      const rTxt = resetBadge.addText(resetStr);
      rTxt.font = Font.systemFont(7);
      rTxt.textColor = new Color("#ffd60a");
    }

    row1.addSpacer();

    // Countdown e Data de expiração
    const expStack = row1.addStack();
    expStack.centerAlignContent();

    if (item.countdown) {
      const cdTxt = expStack.addText(item.countdown);
      cdTxt.font = Font.boldSystemFont(7.5);
      cdTxt.textColor = item.isUrgent ? new Color("#ff453a") : new Color("#f2f2f7");
      expStack.addSpacer(2);

      const dotTxt = expStack.addText("•");
      dotTxt.font = Font.systemFont(7);
      dotTxt.textColor = new Color("#8e8e93");
      expStack.addSpacer(2);
    }

    const expTxt = expStack.addText(item.expiresBadge);
    expTxt.font = Font.systemFont(7.5);
    expTxt.textColor = item.isUrgent ? new Color("#ff453a") : new Color("#8e8e93");
    expTxt.lineLimit = 1;

    card.addSpacer(4.5);

    // Linha 2: Sessão (5h)
    const row2 = card.addStack();
    row2.centerAlignContent();
    const l5h = row2.addText("Sessão");
    l5h.font = Font.systemFont(7.5);
    l5h.textColor = new Color("#8e8e93");
    row2.addSpacer(3);
    createProgressBar(row2, item.sessaoPct, 54, 3.5);
    row2.addSpacer(3);
    const v5h = row2.addText(`${item.sessaoPct}%`);
    v5h.font = Font.boldSystemFont(7.5);
    v5h.textColor = item.sessaoPct === 0 ? new Color("#ff453a") : Color.white();
    row2.addSpacer(2);
    const t5h = row2.addText(item.sessaoReset);
    t5h.font = Font.systemFont(7);
    t5h.textColor = new Color("#8e8e93");
    t5h.lineLimit = 1;

    card.addSpacer(4);

    // Linha 3: Semanal
    const row3 = card.addStack();
    row3.centerAlignContent();
    const lWk = row3.addText("Semana");
    lWk.font = Font.systemFont(7.5);
    lWk.textColor = new Color("#8e8e93");
    row3.addSpacer(3);
    createProgressBar(row3, item.semanalPct, 54, 3.5);
    row3.addSpacer(3);
    const vWk = row3.addText(`${item.semanalPct}%`);
    vWk.font = Font.boldSystemFont(7.5);
    vWk.textColor = item.semanalPct <= 20 ? new Color("#ff453a") : (item.semanalPct <= 50 ? new Color("#ff9f0a") : new Color("#30d158"));
    row3.addSpacer(2);
    const tWk = row3.addText(item.semanalReset);
    tWk.font = Font.systemFont(7);
    tWk.textColor = new Color("#8e8e93");
    tWk.lineLimit = 1;

    card.addSpacer(2);
  }

  // Distribuir exatamente as 10 contas (5 por coluna)
  const count = Math.min(10, items.length);
  for (let i = 0; i < count; i++) {
    const parent = i % 2 === 0 ? colLeft : colRight;
    buildMiniCard(parent, items[i]);
    if (i < count - 2) {
      parent.addSpacer(7.5);
    }
  }

  w.addSpacer();
  return w;
}

// ------------------------------------------------------------------------------
// 🚀 Execução
// ------------------------------------------------------------------------------
async function main() {
  const rawData = await loadData();
  const remoteAccounts = rawData.accounts || [];

  // Mapear dados para as 10 contas canônicas
  const items = MONITORED_CONFIG.map(cfg => {
    // Buscar no payload remoto ou no snapshot embutido
    const remote = remoteAccounts.find(a => (a.email || "").toLowerCase() === cfg.email.toLowerCase());
    const snap = EMBEDDED_SNAPSHOT[cfg.email] || {};

    const sessaoPct = parsePercent(remote?.fiveHourPercent ?? snap.fiveHourPercent);
    const semanalPct = parsePercent(remote?.weeklyPercent ?? snap.weeklyPercent);
    const sessaoReset = formatCountdown(remote?.fiveHourReset || snap.fiveHourReset);
    const semanalReset = formatCountdown(remote?.weeklyReset || snap.weeklyReset);

    const targetDate = cfg.recurringDay ? getNextMonthlyDate(cfg.recurringDay) : cfg.expiresDate;
    const countdown = formatDaysCountdown(targetDate);

    return {
      ...cfg,
      sessaoPct,
      semanalPct,
      sessaoReset,
      semanalReset,
      countdown,
    };
  });

  // Ordenar pela prioridade rigorosa de queima
  items.sort((a, b) => a.priority - b.priority);

  const widgetFamily = config.widgetFamily || "large";
  let widget;

  if (widgetFamily === "medium") {
    // Medium: Conta prioritária ou pelo parâmetro
    const param = (args.widgetParameter || "").toLowerCase().trim();
    const sel = items.find(it => it.alias.toLowerCase().includes(param) || it.email.toLowerCase().includes(param)) || items[0];
    widget = buildMediumWidget(sel);
  } else {
    // Large ou Extra-Large: Grade com as 10 contas
    widget = buildLargeWidget(items);
  }

  widget.refreshAfterDate = new Date(Date.now() + REFRESH_INTERVAL_MINUTES * 60000);
  Script.setWidget(widget);

  if (config.runsInApp) {
    if (Device.isPad()) {
      await widget.presentExtraLarge();
    } else {
      await widget.presentLarge();
    }
  }
}

await main();
Script.complete();

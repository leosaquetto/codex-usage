const webpush = require("web-push");
const {
  listSubscriptions,
  loadPushState,
  removeSubscription,
  savePushState,
  saveUsageData,
} = require("./push-store");

// Cache em memória local para early exit (evita ler o estado do Blob se nada mudou)
let lastProcessedUsageUpdated = null;
let lastProcessedHasLoadError = null;

function configureWebPush() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error("VAPID não configurado.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function signalEnabled(record, signal) {
  const preferences = record?.preferences || {};
  if (preferences.globalEnabled !== true) return false;
  if (preferences.rules?.[signal.ruleId] !== true) return false;
  if (!signal.accountKey) return true;
  const accountRule = preferences.accountRules?.[signal.accountKey]?.[signal.ruleId];
  return accountRule !== false;
}

function notificationPayload(signal) {
  return JSON.stringify({
    title: signal.title,
    body: signal.body,
    tag: signal.tag,
    ruleId: signal.ruleId,
    accountKey: signal.accountKey,
    url: "/",
    timestamp: Date.now(),
  });
}

async function sendPush(subscription, payload) {
  configureWebPush();
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

async function dispatchUsagePushes(usage, hasLoadError = false) {
  configureWebPush();

  const { resetBlobOps, getBlobOps } = require("./push-store");
  resetBlobOps();

  // 1. Verificação do cache quente local (memória) para evitar chamadas de rede desnecessárias
  if (
    usage &&
    lastProcessedUsageUpdated === usage.lastUpdated &&
    lastProcessedHasLoadError === hasLoadError
  ) {
    console.log("dispatch skipped: no relevant change (warm cache)");
    const ops = getBlobOps();
    console.log(`blob ops this run: simple=${ops.simple} advanced=${ops.advanced}`);
    return { signals: 0, subscriptions: 0, sent: 0, removed: 0, failed: 0 };
  }

  // Carrega o estado persistido do Blob (custa 1 get / operação simples)
  const state = await loadPushState();

  // 2. Verificação de cache persistente (útil após cold start)
  if (
    usage &&
    state &&
    state.lastEvaluatedUsageUpdated === usage.lastUpdated &&
    state.lastEvaluatedHasLoadError === hasLoadError
  ) {
    // Atualiza o cache quente local
    lastProcessedUsageUpdated = usage.lastUpdated;
    lastProcessedHasLoadError = hasLoadError;

    console.log("dispatch skipped: no relevant change");
    const ops = getBlobOps();
    console.log(`blob ops this run: simple=${ops.simple} advanced=${ops.advanced}`);
    return { signals: 0, subscriptions: 0, sent: 0, removed: 0, failed: 0 };
  }

  const { evaluateNotificationSignals, markNotificationSignalSent } = await import("../notification-engine.mjs");
  const { signals, nextState } = evaluateNotificationSignals({
    usage,
    state,
    hasLoadError,
  });

  // Atualiza propriedades de controle do estado processado
  if (usage) {
    nextState.lastEvaluatedUsageUpdated = usage.lastUpdated;
  }
  nextState.lastEvaluatedHasLoadError = hasLoadError;

  // Atualiza cache quente local em memória
  if (usage) {
    lastProcessedUsageUpdated = usage.lastUpdated;
  }
  lastProcessedHasLoadError = hasLoadError;

  // Se não houver notificações/sinais para processar
  if (signals.length === 0) {
    // Opcionalmente atualiza dados de uso se necessário (respeitando o throttling individual)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await saveUsageData(usage);
      } catch (err) {
        console.error("[Push Service] Falha ao espelhar dados de uso no Vercel Blob:", err?.message || err);
      }
    }

    // ATENÇÃO: NÃO grava o push/state.json no Blob se signals for 0 (evitando escrita incondicional)
    const ops = getBlobOps();
    console.log(`blob ops this run: simple=${ops.simple} advanced=${ops.advanced}`);
    return { signals: 0, subscriptions: 0, sent: 0, removed: 0, failed: 0 };
  }

  // Se houver sinais, carrega a lista de subscriptions (lê o índice, custa 1 get / op simples)
  const subscriptions = await listSubscriptions();
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const signal of signals) {
    let signalSent = false;
    for (const record of subscriptions) {
      if (!signalEnabled(record, signal)) continue;
      try {
        await webpush.sendNotification(record.subscription, notificationPayload(signal));
        signalSent = true;
        sent += 1;
      } catch (error) {
        const statusCode = Number(error?.statusCode);
        if (statusCode === 404 || statusCode === 410) {
          await removeSubscription(record.subscription.endpoint);
          removed += 1;
        } else {
          failed += 1;
          console.error("Falha ao enviar Web Push:", error?.message || error);
        }
      }
    }
    if (signalSent) markNotificationSignalSent(nextState, signal);
  }

  // Salva dados de uso se o token estiver ativo
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await saveUsageData(usage);
    } catch (err) {
      console.error("[Push Service] Falha ao espelhar dados de uso no Vercel Blob:", err?.message || err);
    }
  }

  // Grava o novo estado no Blob apenas se houve notificações enviadas
  await savePushState(nextState);

  const ops = getBlobOps();
  console.log(`blob ops this run: simple=${ops.simple} advanced=${ops.advanced}`);

  return { signals: signals.length, subscriptions: subscriptions.length, sent, removed, failed };
}

module.exports = {
  dispatchUsagePushes,
  sendPush,
};

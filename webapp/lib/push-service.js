const webpush = require("web-push");
const {
  listSubscriptions,
  loadPushState,
  removeSubscription,
  savePushState,
} = require("./push-store");

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
  const { evaluateNotificationSignals, markNotificationSignalSent } = await import("../notification-engine.mjs");
  const state = await loadPushState();
  const { signals, nextState } = evaluateNotificationSignals({
    usage,
    state,
    hasLoadError,
  });
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

  await savePushState(nextState);
  return { signals: signals.length, subscriptions: subscriptions.length, sent, removed, failed };
}

module.exports = {
  dispatchUsagePushes,
  sendPush,
};

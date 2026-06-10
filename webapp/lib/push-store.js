const { createHash } = require("node:crypto");

const SUBSCRIPTION_PREFIX = "push/subscriptions/";
const STATE_PATH = "push/state.json";

async function blobSdk() {
  return import("@vercel/blob");
}

function endpointKey(endpoint) {
  return createHash("sha256").update(String(endpoint)).digest("hex");
}

function subscriptionPath(endpoint) {
  return `${SUBSCRIPTION_PREFIX}${endpointKey(endpoint)}.json`;
}

async function readJsonBlob(pathname, fallback = null) {
  const { get } = await blobSdk();
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return fallback;
  return new Response(result.stream).json();
}

async function writeJsonBlob(pathname, value) {
  const { put } = await blobSdk();
  return put(pathname, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    contentType: "application/json",
  });
}

async function saveSubscription(subscription, preferences = {}) {
  const endpoint = String(subscription?.endpoint || "");
  const p256dh = String(subscription?.keys?.p256dh || "");
  const auth = String(subscription?.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new Error("Subscription Web Push inválida.");
  }

  const pathname = subscriptionPath(endpoint);
  const previous = await readJsonBlob(pathname, {});
  const record = {
    subscription: { endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh, auth } },
    preferences: preferences && typeof preferences === "object" ? preferences : {},
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonBlob(pathname, record);
  return { pathname, record, created: !previous?.createdAt };
}

async function removeSubscription(endpoint) {
  const { del } = await blobSdk();
  if (!endpoint) return;
  try {
    await del(subscriptionPath(endpoint));
  } catch (error) {
    if (!/not found|404/i.test(String(error?.message || error))) throw error;
  }
}

async function listSubscriptions() {
  const { list } = await blobSdk();
  const records = [];
  let cursor;

  do {
    const page = await list({ prefix: SUBSCRIPTION_PREFIX, cursor, limit: 100 });
    for (const blob of page.blobs || []) {
      const record = await readJsonBlob(blob.pathname, null);
      if (record?.subscription?.endpoint) records.push({ pathname: blob.pathname, ...record });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return records;
}

async function loadPushState() {
  return readJsonBlob(STATE_PATH, {});
}

async function savePushState(state) {
  await writeJsonBlob(STATE_PATH, state || {});
}

module.exports = {
  listSubscriptions,
  loadPushState,
  removeSubscription,
  savePushState,
  saveSubscription,
};

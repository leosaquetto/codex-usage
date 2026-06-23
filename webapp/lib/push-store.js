const { createHash } = require("node:crypto");

const SUBSCRIPTION_PREFIX = "push/subscriptions/";
const STATE_PATH = "push/state.json";
const INDEX_PATH = "push/subscriptions-index.json";

// Constantes configuráveis por variáveis de ambiente
const BLOB_MIN_WRITE_INTERVAL_MINUTES = Number(process.env.BLOB_MIN_WRITE_INTERVAL_MINUTES || 30);
const CODEX_USAGE_BLOB_PATH = process.env.CODEX_USAGE_BLOB_PATH || "codex_usage.json";

const CODEX_USAGE_MIN_WRITE_INTERVAL_MINUTES = Number(process.env.CODEX_USAGE_MIN_WRITE_INTERVAL_MINUTES || 60);
const CODEX_HISTORY_MIN_WRITE_INTERVAL_MINUTES = Number(process.env.CODEX_HISTORY_MIN_WRITE_INTERVAL_MINUTES || 360);
const ANTIGRAVITY_MIN_WRITE_INTERVAL_MINUTES = Number(process.env.ANTIGRAVITY_MIN_WRITE_INTERVAL_MINUTES || 60);

const SUBSCRIPTIONS_CACHE_TTL_MINUTES = Number(process.env.SUBSCRIPTIONS_CACHE_TTL_MINUTES || 360);
const SUBSCRIPTION_CACHE_TTL_MS = SUBSCRIPTIONS_CACHE_TTL_MINUTES * 60 * 1000;

// Cache global em memória para throttling e comparação de conteúdo
// Chave: pathname -> { contentStr, timestamp: Date, lastResult }
const writeCache = new Map();

// Cache global para a lista de subscriptions
let subscriptionCache = null;
let subscriptionCacheTime = 0;

// Contadores de operações de blob executadas
const blobOps = {
  simple: 0,
  advanced: 0,
};

function resetBlobOps() {
  blobOps.simple = 0;
  blobOps.advanced = 0;
}

function getBlobOps() {
  return { ...blobOps };
}

function incrementSimpleOps() {
  blobOps.simple++;
}

function incrementAdvancedOps() {
  blobOps.advanced++;
}

async function blobSdk() {
  if (process.env.MOCK_VERCEL_BLOB === "1") {
    return global.__MOCK_VERCEL_BLOB__;
  }
  return import("@vercel/blob");
}

function endpointKey(endpoint) {
  return createHash("sha256").update(String(endpoint)).digest("hex");
}

function subscriptionPath(endpoint) {
  return `${SUBSCRIPTION_PREFIX}${endpointKey(endpoint)}.json`;
}

function getMinWriteIntervalMinutes(pathname) {
  if (pathname === INDEX_PATH || pathname.startsWith(SUBSCRIPTION_PREFIX)) {
    return 0;
  }
  if (pathname === CODEX_USAGE_BLOB_PATH) {
    return CODEX_USAGE_MIN_WRITE_INTERVAL_MINUTES;
  }
  if (pathname === "codex_usage_history.json") {
    return CODEX_HISTORY_MIN_WRITE_INTERVAL_MINUTES;
  }
  if (pathname === "antigravity_usage.json") {
    return ANTIGRAVITY_MIN_WRITE_INTERVAL_MINUTES;
  }
  return BLOB_MIN_WRITE_INTERVAL_MINUTES;
}

async function readJsonBlob(pathname, fallback = null) {
  try {
    const { get } = await blobSdk();
    incrementSimpleOps();
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      console.log("blob read completed");
      if (writeCache.has(pathname)) {
        return JSON.parse(writeCache.get(pathname).contentStr);
      }
      return fallback;
    }
    const contentStr = await new Response(result.stream).text();
    console.log("blob read completed");
    const uploadedAt = result.blob?.uploadedAt ? new Date(result.blob.uploadedAt) : new Date();
    writeCache.set(pathname, {
      contentStr,
      timestamp: uploadedAt,
      lastResult: result.blob,
    });
    return JSON.parse(contentStr);
  } catch (error) {
    if (!/not found|404/i.test(error.message || String(error))) {
      console.error(`[Vercel Blob] Erro ao ler blob ${pathname}:`, error?.message || error);
    }
    if (writeCache.has(pathname)) {
      console.log("blob read completed");
      return JSON.parse(writeCache.get(pathname).contentStr);
    }
    return fallback;
  }
}

async function writeJsonBlob(pathname, value) {
  const newContentStr = JSON.stringify(value);
  let cache = writeCache.get(pathname);

  // Se não houver cache em memória (ex: cold start), tenta puxar do blob para inicializar o cache
  if (!cache) {
    try {
      const { get } = await blobSdk();
      incrementSimpleOps();
      const result = await get(pathname, { access: "private", useCache: false });
      if (result && result.stream) {
        const contentStr = await new Response(result.stream).text();
        const uploadedAt = result.blob?.uploadedAt ? new Date(result.blob.uploadedAt) : new Date(0);
        cache = {
          contentStr,
          timestamp: uploadedAt,
          lastResult: result.blob,
        };
        writeCache.set(pathname, cache);
      }
    } catch (error) {
      if (!/not found|404/i.test(error.message || String(error))) {
        console.error(`[Vercel Blob] Erro ao recuperar metadados de ${pathname}:`, error?.message || error);
      }
    }
  }

  // Se ainda não existir no cache (ex: arquivo novo/não criado), inicializa dados padrão
  if (!cache) {
    cache = {
      contentStr: null,
      timestamp: new Date(0),
      lastResult: null,
    };
  }

  // 1. Proteção: Conteúdo idêntico
  if (cache.contentStr === newContentStr) {
    console.log("blob write skipped: unchanged");
    return cache.lastResult || { url: "", pathname };
  }

  // 2. Throttling: Intervalo mínimo entre escritas segmentado
  const now = Date.now();
  const elapsedMinutes = (now - cache.timestamp.getTime()) / 60000;
  const intervalMinutes = getMinWriteIntervalMinutes(pathname);
  if (elapsedMinutes < intervalMinutes) {
    console.log("blob write skipped: throttled");
    return cache.lastResult || { url: "", pathname };
  }

  // Se passou nas validações, realiza o put (operação avançada)
  const { put } = await blobSdk();
  incrementAdvancedOps();
  const result = await put(pathname, newContentStr, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    contentType: "application/json",
  });
  console.log("blob write completed");

  // Atualiza cache em memória
  writeCache.set(pathname, {
    contentStr: newContentStr,
    timestamp: new Date(),
    lastResult: result,
  });

  return result;
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
  
  // Salva o arquivo individual da subscription
  await writeJsonBlob(pathname, record);

  // Atualiza o arquivo de índice único
  try {
    const currentRecords = await listSubscriptions();
    const index = currentRecords.findIndex(r => r.pathname === pathname);
    const updatedRecord = { pathname, ...record };
    if (index >= 0) {
      currentRecords[index] = updatedRecord;
    } else {
      currentRecords.push(updatedRecord);
    }
    await writeJsonBlob(INDEX_PATH, currentRecords);
  } catch (err) {
    console.error("[Vercel Blob] Falha ao atualizar índice em saveSubscription:", err?.message || err);
  }

  // Invalida o cache
  subscriptionCache = null;
  subscriptionCacheTime = 0;

  return { pathname, record, created: !previous?.createdAt };
}

async function removeSubscription(endpoint) {
  const { del } = await blobSdk();
  if (!endpoint) return;
  const pathname = subscriptionPath(endpoint);

  try {
    incrementAdvancedOps();
    await del(pathname);
  } catch (error) {
    if (!/not found|404/i.test(String(error?.message || error))) throw error;
  }

  // Remove do arquivo de índice único
  try {
    const currentRecords = await listSubscriptions();
    const filtered = currentRecords.filter(r => r.pathname !== pathname);
    await writeJsonBlob(INDEX_PATH, filtered);
  } catch (err) {
    console.error("[Vercel Blob] Falha ao atualizar índice em removeSubscription:", err?.message || err);
  }

  // Invalida o cache de subscriptions
  subscriptionCache = null;
  subscriptionCacheTime = 0;
}

async function listSubscriptions() {
  if (subscriptionCache && (Date.now() - subscriptionCacheTime < SUBSCRIPTION_CACHE_TTL_MS)) {
    console.log("subscriptions read: cached");
    return subscriptionCache;
  }

  // Tenta ler do índice
  try {
    const indexRecords = await readJsonBlob(INDEX_PATH, null);
    if (indexRecords && Array.isArray(indexRecords)) {
      subscriptionCache = indexRecords;
      subscriptionCacheTime = Date.now();
      return indexRecords;
    }
  } catch (error) {
    console.error("[Vercel Blob] Erro ao ler índice de subscriptions:", error?.message || error);
  }

  // Fallback se o índice não existir: reconstrói e salva
  console.log("[Vercel Blob] Reconstrói índice de subscriptions via list()...");
  const { list } = await blobSdk();
  incrementAdvancedOps();
  const records = [];
  let cursor;

  try {
    do {
      const page = await list({ prefix: SUBSCRIPTION_PREFIX, cursor, limit: 100 });
      if (cursor) incrementAdvancedOps();
      
      for (const blob of page.blobs || []) {
        if (blob.pathname === INDEX_PATH) continue;
        const record = await readJsonBlob(blob.pathname, null);
        if (record?.subscription?.endpoint) records.push({ pathname: blob.pathname, ...record });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    // Salva o índice reconstruído
    await writeJsonBlob(INDEX_PATH, records);

    subscriptionCache = records;
    subscriptionCacheTime = Date.now();
    return records;
  } catch (error) {
    console.error("[Vercel Blob] Erro ao reconstruir list de subscriptions:", error?.message || error);
    if (subscriptionCache) {
      console.log("subscriptions read: cached fallback");
      return subscriptionCache;
    }
    throw error;
  }
}

async function loadPushState() {
  return readJsonBlob(STATE_PATH, {});
}

async function savePushState(state) {
  await writeJsonBlob(STATE_PATH, state || {});
}

async function saveUsageData(usage) {
  if (!usage) return;
  if (usage.codex) {
    await writeJsonBlob(CODEX_USAGE_BLOB_PATH, usage.codex);
  }
  if (usage.codexHistory) {
    await writeJsonBlob("codex_usage_history.json", usage.codexHistory);
  }
  if (usage.antigravity) {
    await writeJsonBlob("antigravity_usage.json", usage.antigravity);
  }
}

module.exports = {
  listSubscriptions,
  loadPushState,
  removeSubscription,
  savePushState,
  saveSubscription,
  readJsonBlob,
  writeJsonBlob,
  saveUsageData,
  CODEX_USAGE_BLOB_PATH,
  resetBlobOps,
  getBlobOps,
};



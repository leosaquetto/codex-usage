const WINDOW_KEYS = {
  fiveHour: /5\s*h|five[ -]?hour/i,
  weekly: /weekly|7\s*d/i,
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function accountLabel(account, index) {
  const email = String(account?.email || "").trim();
  if (email) return email;
  const name = String(account?.name || account?.displayName || "").trim();
  return name || `Conta ${index + 1}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/@/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function accountEndpointSlug(account, index) {
  return slugify(account?.id || account?.slug || account?.email) || `account-${index + 1}`;
}

function rawWindowTitle(rawWindow) {
  const explicit = String(
    rawWindow?.title
      || rawWindow?.displayName
      || rawWindow?.display_name
      || rawWindow?.label
      || rawWindow?.name
      || ""
  ).trim();
  const tier = String(rawWindow?.tier || "").trim();
  if (explicit) return tier && !explicit.toLowerCase().includes(tier.toLowerCase()) ? `${explicit} (${tier})` : explicit;

  const name = String(rawWindow?.name || "Gemini").trim();
  return tier ? `${name} (${tier})` : name;
}

function windowKind(rawWindow) {
  const raw = String(
    rawWindow?.kind
      || rawWindow?.window
      || rawWindow?.id
      || rawWindow?.tier
      || ""
  );
  if (WINDOW_KEYS.fiveHour.test(raw) || /\blow\b/i.test(raw)) return { kind: "5h", windowMinutes: 300 };
  if (WINDOW_KEYS.weekly.test(raw) || /\bhigh\b/i.test(raw)) return { kind: "weekly", windowMinutes: 10_080 };

  const explicitMinutes = finiteNumber(rawWindow?.windowMinutes ?? rawWindow?.window_minutes);
  return {
    kind: raw.trim() || "additional",
    windowMinutes: explicitMinutes === null ? null : Math.max(1, Math.round(explicitMinutes)),
  };
}

function rawWindowsForAccount(account) {
  if (Array.isArray(account?.windows) && account.windows.length > 0) return account.windows;
  return Array.isArray(account?.models) ? account.models : [];
}

function compatibleWindow(rawWindow, account, accountIndex, windowIndex, now, options = {}) {
  const remainingPercent = clampPercent(rawWindow?.remainingPercent);
  const resetAt = isoDate(rawWindow?.refreshAt || rawWindow?.resetAt || rawWindow?.reset_time);
  if (remainingPercent === null || !resetAt || new Date(resetAt) <= now) return null;

  const { kind, windowMinutes } = windowKind(rawWindow);
  const bucketID = String(rawWindow?.id || `${kind}-${windowIndex}`).trim();
  const title = options.includeAccountLabel === false
    ? rawWindowTitle(rawWindow)
    : `${accountLabel(account, accountIndex)} · ${rawWindowTitle(rawWindow)}`;

  return {
    id: `antigravity-${accountEndpointSlug(account, accountIndex)}-${bucketID}`,
    title,
    kind,
    ...(windowMinutes === null ? {} : { windowMinutes }),
    usedPercent: Math.max(0, Math.min(100, 100 - remainingPercent)),
    resetAt,
  };
}

function buildCompatiblePayload(snapshot, now = new Date(), options = {}) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new Error("Data de referência inválida.");

  const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  let accountIndex = options.accountIndex === undefined || options.accountIndex === null
    ? null
    : Number(options.accountIndex);
  const accountSelector = String(options.accountSelector || "").trim().toLowerCase();
  if (accountSelector) {
    accountIndex = accounts.findIndex((account, index) =>
      accountEndpointSlug(account, index) === accountSelector
    );
    if (accountIndex < 0) {
      const legacyMatch = /^account-(\d+)$/.exec(accountSelector);
      accountIndex = legacyMatch ? Number(legacyMatch[1]) - 1 : -1;
    }
  }
  if (accountIndex !== null && (!Number.isInteger(accountIndex) || !accounts[accountIndex])) {
    throw new Error("Conta Antigravity não encontrada.");
  }
  const selectedAccounts = accountIndex === null
    ? accounts.map((account, index) => ({ account, index }))
    : [{ account: accounts[accountIndex], index: accountIndex }];
  const windows = [];

  selectedAccounts.forEach(({ account, index }) => {
    rawWindowsForAccount(account).forEach((rawWindow, windowIndex) => {
      const window = compatibleWindow(rawWindow, account, index, windowIndex, current, options);
      if (window) windows.push(window);
    });
  });

  if (accountIndex === null && windows.length === 0 && Array.isArray(snapshot?.models)) {
    snapshot.models.forEach((rawWindow, windowIndex) => {
      const window = compatibleWindow(rawWindow, snapshot, 0, windowIndex, current, options);
      if (window) windows.push(window);
    });
  }

  if (windows.length === 0) {
    throw new Error("Nenhuma janela futura de quota Antigravity disponível.");
  }

  const lastUpdated = isoDate(snapshot?.lastUpdated) || current.toISOString();
  const selectedAccount = selectedAccounts.length === 1 ? selectedAccounts[0].account : null;
  const plan = String(selectedAccount?.plan || "").trim() || null;
  const account = selectedAccount ? {
    id: accountEndpointSlug(selectedAccount, selectedAccounts[0].index),
    name: String(selectedAccount?.name || selectedAccount?.displayName || accountLabel(selectedAccount, 0)),
    email: String(selectedAccount?.email || ""),
    ...(plan ? { plan } : {}),
  } : null;
  return {
    source: "codex-usage-antigravity",
    provider: "Antigravity",
    lastUpdated,
    accountCount: selectedAccounts.length || 1,
    data: {
      provider: "Antigravity",
      ...(plan ? { plan } : {}),
      ...(account ? { account } : {}),
      lastUpdated,
      windows,
    },
  };
}

module.exports = {
  accountEndpointSlug,
  buildCompatiblePayload,
};

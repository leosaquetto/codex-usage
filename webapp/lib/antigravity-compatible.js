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

function compatibleWindow(rawWindow, account, accountIndex, windowIndex, now) {
  const remainingPercent = clampPercent(rawWindow?.remainingPercent);
  const resetAt = isoDate(rawWindow?.refreshAt || rawWindow?.resetAt || rawWindow?.reset_time);
  if (remainingPercent === null || !resetAt || new Date(resetAt) <= now) return null;

  const { kind, windowMinutes } = windowKind(rawWindow);
  const bucketID = String(rawWindow?.id || `${kind}-${windowIndex}`).trim();
  const title = `${accountLabel(account, accountIndex)} · ${rawWindowTitle(rawWindow)}`;

  return {
    id: `antigravity-${accountIndex}-${bucketID}`,
    title,
    kind,
    ...(windowMinutes === null ? {} : { windowMinutes }),
    usedPercent: Math.max(0, Math.min(100, 100 - remainingPercent)),
    resetAt,
  };
}

function buildCompatiblePayload(snapshot, now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new Error("Data de referência inválida.");

  const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  const windows = [];

  accounts.forEach((account, accountIndex) => {
    rawWindowsForAccount(account).forEach((rawWindow, windowIndex) => {
      const window = compatibleWindow(rawWindow, account, accountIndex, windowIndex, current);
      if (window) windows.push(window);
    });
  });

  if (windows.length === 0 && Array.isArray(snapshot?.models)) {
    snapshot.models.forEach((rawWindow, windowIndex) => {
      const window = compatibleWindow(rawWindow, snapshot, 0, windowIndex, current);
      if (window) windows.push(window);
    });
  }

  if (windows.length === 0) {
    throw new Error("Nenhuma janela futura de quota Antigravity disponível.");
  }

  const lastUpdated = isoDate(snapshot?.lastUpdated) || current.toISOString();
  return {
    source: "codex-usage-antigravity",
    provider: "Antigravity",
    lastUpdated,
    accountCount: accounts.length || 1,
    data: {
      provider: "Antigravity",
      lastUpdated,
      windows,
    },
  };
}

module.exports = {
  buildCompatiblePayload,
};

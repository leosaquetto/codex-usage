function toPercent(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function buildPayload(raw = {}) {
  return {
    fiveHourPercent: toPercent(raw.fiveHourPercent),
    fiveHourReset: raw.fiveHourReset || null,
    weeklyPercent: toPercent(raw.weeklyPercent),
    weeklyReset: raw.weeklyReset || null,
    lastUpdated: raw.lastUpdated || new Date().toISOString(),
    statusLabel: raw.statusLabel || "acima do seguro",
    fiveHourSafeRate: raw.fiveHourSafeRate || "--/h",
    weeklyRemaining: raw.weeklyRemaining || "--",
    realDailyRate: raw.realDailyRate || "--/d",
    safeDailyRate: raw.safeDailyRate || "--/d",
    dailyDiff: raw.dailyDiff || "--/d",
    weeklyProjection: raw.weeklyProjection || "--%",
    zeroIn: raw.zeroIn || "--",
    history: {
      cycleStart: raw.history?.cycleStart || null
    }
  }
}

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store")

  const rawPayload = process.env.CODEX_USAGE_PAYLOAD

  if (!rawPayload || rawPayload === "undefined" || rawPayload === "null") {
    return res.status(503).json({
      error: "Usage payload indisponível"
    })
  }

  try {
    const parsed = JSON.parse(rawPayload)
    return res.status(200).json(buildPayload(parsed))
  } catch {
    return res.status(500).json({
      error: "Usage payload inválido"
    })
  }
}

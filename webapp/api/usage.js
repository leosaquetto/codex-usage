function toPercent(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function toDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatRate(value, unit) {
  if (!Number.isFinite(value)) return `--/${unit}`
  return `${value.toFixed(1)}%/${unit}`
}

function formatDays(value) {
  if (!Number.isFinite(value)) return "--"
  return `${value.toFixed(1)}d`
}

function formatDiff(value) {
  if (!Number.isFinite(value)) return "--/d"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}%/d`
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--%"
  const rounded = Math.round(value * 10) / 10
  return `${rounded.toFixed(1)}%`
}

function formatZeroIn(days) {
  if (!Number.isFinite(days) || days <= 0) return "agora"
  const totalHours = Math.floor(days * 24)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return d > 0 ? `${d}d ${h}h` : `${h}h`
}

function enrichPayload(raw = {}) {
  const now = Date.now()

  const fiveHourPercent = toPercent(raw.fiveHourPercent)
  const weeklyPercent = toPercent(raw.weeklyPercent)
  const fiveHourResetDate = toDate(raw.fiveHourReset)
  const weeklyResetDate = toDate(raw.weeklyReset)
  const lastUpdated = raw.lastUpdated || new Date().toISOString()

  const fiveHourMs = fiveHourResetDate ? fiveHourResetDate.getTime() - now : NaN
  const weeklyMs = weeklyResetDate ? weeklyResetDate.getTime() - now : NaN

  const fiveHourUsed = 100 - fiveHourPercent
  const weeklyUsed = 100 - weeklyPercent
  const weeklyDaysRemaining = Number.isFinite(weeklyMs) ? Math.max(0, weeklyMs / 86400000) : NaN

  const cycleStart = weeklyResetDate
    ? new Date(weeklyResetDate.getTime() - 7 * 24 * 60 * 60 * 1000)
    : null

  const elapsedMs = cycleStart ? Math.max(0, Math.min(7 * 24 * 60 * 60 * 1000, now - cycleStart.getTime())) : NaN
  const elapsedDays = Number.isFinite(elapsedMs) ? Math.max(1 / 24, elapsedMs / 86400000) : NaN

  const realDailyRateNumber = Number.isFinite(elapsedDays) ? weeklyUsed / elapsedDays : NaN
  const safeDailyRateNumber = Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining > 0
    ? weeklyPercent / weeklyDaysRemaining
    : NaN
  const dailyDiffNumber = Number.isFinite(realDailyRateNumber) && Number.isFinite(safeDailyRateNumber)
    ? realDailyRateNumber - safeDailyRateNumber
    : NaN

  const projectedRemainingNumber = Number.isFinite(realDailyRateNumber) && Number.isFinite(weeklyDaysRemaining)
    ? weeklyPercent - (realDailyRateNumber * weeklyDaysRemaining)
    : NaN

  const zeroInDays = Number.isFinite(realDailyRateNumber) && realDailyRateNumber > 0
    ? weeklyPercent / realDailyRateNumber
    : NaN

  const fiveHourSafeRateNumber = Number.isFinite(fiveHourMs) && fiveHourMs > 0
    ? fiveHourPercent / (fiveHourMs / 3600000)
    : NaN

  const statusLabel = raw.statusLabel
    || (fiveHourPercent <= 0 || weeklyPercent <= 0
      ? "limite esgotado"
      : Number.isFinite(dailyDiffNumber) && dailyDiffNumber > 0
        ? "acima do seguro"
        : fiveHourPercent < 20 || weeklyPercent < 20
          ? "atenção ao consumo"
          : "dentro do seguro")

  return {
    fiveHourPercent,
    fiveHourReset: fiveHourResetDate ? fiveHourResetDate.toISOString() : null,
    weeklyPercent,
    weeklyReset: weeklyResetDate ? weeklyResetDate.toISOString() : null,
    lastUpdated,
    statusLabel,
    fiveHourSafeRate: raw.fiveHourSafeRate || formatRate(fiveHourSafeRateNumber, "h"),
    weeklyRemaining: raw.weeklyRemaining || formatDays(weeklyDaysRemaining),
    realDailyRate: raw.realDailyRate || formatRate(realDailyRateNumber, "d"),
    safeDailyRate: raw.safeDailyRate || formatRate(safeDailyRateNumber, "d"),
    dailyDiff: raw.dailyDiff || formatDiff(dailyDiffNumber),
    weeklyProjection: raw.weeklyProjection || formatPercent(projectedRemainingNumber),
    zeroIn: raw.zeroIn || formatZeroIn(zeroInDays),
    history: {
      cycleStart: raw.history?.cycleStart || (cycleStart ? cycleStart.toISOString() : null)
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
    return res.status(200).json(enrichPayload(parsed))
  } catch {
    return res.status(500).json({
      error: "Usage payload inválido"
    })
  }
}

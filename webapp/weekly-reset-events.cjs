"use strict"

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toTime(value) {
  if (!value) return NaN
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : NaN
}

function sampleSort(a, b) {
  return toTime(a?.capturedAt) - toTime(b?.capturedAt)
}

function eventSort(a, b) {
  return toTime(a?.capturedAt) - toTime(b?.capturedAt)
    || String(a?.email || "").localeCompare(String(b?.email || ""))
}

function earlyReasonFor({ looksFullyRenewed, weeklyPercentIncreased }) {
  if (looksFullyRenewed) return "full-renewal"
  if (weeklyPercentIncreased) return "percent-increase"
  return null
}

function buildWeeklyResetEvent({ email, sample, previousReset, previousSample }) {
  const previousDeadlineMs = toTime(previousReset)
  const nextDeadlineMs = toTime(sample?.weeklyReset)
  const capturedMs = toTime(sample?.capturedAt)
  const previousWeeklyPercent = numberOrNull(previousSample?.weeklyPercent)
  const weeklyPercent = numberOrNull(sample?.weeklyPercent)
  const weeklyPercentDelta = previousWeeklyPercent !== null && weeklyPercent !== null
    ? weeklyPercent - previousWeeklyPercent
    : null
  const isBeforePreviousDeadline = Number.isFinite(previousDeadlineMs) && capturedMs < previousDeadlineMs
  const weeklyPercentIncreased = weeklyPercentDelta !== null && weeklyPercentDelta > 0
  const looksFullyRenewed = weeklyPercent !== null && weeklyPercent >= 99
  const isEarlyReset = isBeforePreviousDeadline && (looksFullyRenewed || weeklyPercentIncreased)
  const isNotifiableEarlyReset = isBeforePreviousDeadline && looksFullyRenewed
  const earlyReason = isEarlyReset
    ? earlyReasonFor({ looksFullyRenewed, weeklyPercentIncreased })
    : null

  return {
    email,
    displayName: sample?.displayName || email,
    capturedAt: sample?.capturedAt,
    weeklyReset: sample?.weeklyReset,
    previousWeeklyReset: previousReset,
    isEarlyReset,
    isNotifiableEarlyReset,
    deltaMs: Number.isFinite(previousDeadlineMs) ? capturedMs - previousDeadlineMs : null,
    cycleDurationMs: Number.isFinite(previousDeadlineMs) && Number.isFinite(nextDeadlineMs)
      ? nextDeadlineMs - previousDeadlineMs
      : null,
    weeklyPercent,
    previousWeeklyPercent,
    weeklyPercentDelta,
    earlyReason,
  }
}

function dedupeByFirstEventKey(events) {
  const deduped = new Map()
  for (const event of events) {
    const key = `${event.email}|${event.weeklyReset}`
    if (!deduped.has(key)) deduped.set(key, event)
  }
  return [...deduped.values()]
}

function buildWeeklyResetEvents(accountSamples) {
  const byEmail = new Map()
  for (const sample of Array.isArray(accountSamples) ? accountSamples : []) {
    if (!sample?.email || !sample?.capturedAt || !sample?.weeklyReset) continue
    if (!byEmail.has(sample.email)) byEmail.set(sample.email, [])
    byEmail.get(sample.email).push(sample)
  }

  const events = []
  for (const [email, samples] of byEmail.entries()) {
    const ordered = [...samples].sort(sampleSort)
    let previousReset = null
    let previousSample = null
    let lastEventReset = null

    for (const sample of ordered) {
      if (sample.weeklyReset === lastEventReset) {
        previousSample = sample
        continue
      }

      events.push(buildWeeklyResetEvent({ email, sample, previousReset, previousSample }))
      previousReset = sample.weeklyReset
      previousSample = sample
      lastEventReset = sample.weeklyReset
    }
  }

  return dedupeByFirstEventKey(events).sort(eventSort)
}

module.exports = {
  buildWeeklyResetEvent,
  buildWeeklyResetEvents,
  numberOrNull,
}

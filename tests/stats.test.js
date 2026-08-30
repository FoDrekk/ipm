// Uptime statistics are derived from the connectivity timeline rather
// than from a separate metrics store, so what is worth pinning down is
// the derivation: which stretches count, which are excluded, and what
// happens at the window's edges.
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { computeStats, startOfLocalDay, timelineStatusFor } = require('../dist-electron/shared/stats.js')
const { formatDuration, latencyQuality } = require('../dist-electron/shared/types.js')

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Builds a timeline as offsets from a base instant. */
function timeline(base, entries) {
  return entries.map(([status, offsetMs]) => ({ status, at: new Date(base + offsetMs).toISOString() }))
}

describe('computeStats', () => {
  const windowStart = startOfLocalDay(Date.now())
  const now = windowStart + 10 * HOUR

  test('splits monitored time into online, degraded and offline', () => {
    const events = timeline(windowStart, [
      ['ONLINE', 0],
      ['OFFLINE', 6 * HOUR],
      ['DEGRADED', 7 * HOUR],
      ['ONLINE', 8 * HOUR],
    ])

    const stats = computeStats(events, { now, windowStart, currentStatus: 'ONLINE' })

    assert.equal(stats.onlineMs, 8 * HOUR)
    assert.equal(stats.degradedMs, 1 * HOUR)
    assert.equal(stats.offlineMs, 1 * HOUR)
    assert.equal(stats.monitoredMs, 10 * HOUR)
    // DEGRADED counts as up: the connection worked.
    assert.equal(stats.uptimePercent, 90)
    assert.equal(stats.outageCount, 1)
    assert.equal(stats.longestOutageMs, 1 * HOUR)
  })

  test('excludes paused time from the denominator entirely', () => {
    const events = timeline(windowStart, [
      ['ONLINE', 0],
      ['PAUSED', 1 * HOUR],
      ['ONLINE', 9 * HOUR],
    ])

    const stats = computeStats(events, { now, windowStart, currentStatus: 'ONLINE' })

    // Two hours watched, eight hours not — the eight are neither uptime
    // nor downtime, and must not flatter the percentage or dilute it.
    assert.equal(stats.monitoredMs, 2 * HOUR)
    assert.equal(stats.offlineMs, 0)
    assert.equal(stats.uptimePercent, 100)
  })

  test('reports no percentage when nothing in the window was monitored', () => {
    const events = timeline(windowStart, [['PAUSED', 0]])
    const stats = computeStats(events, { now, windowStart, currentStatus: 'PAUSED' })

    // Not 0% and not 100%: unknown. Either number would be a claim the
    // data cannot support.
    assert.equal(stats.uptimePercent, null)
    assert.equal(stats.monitoredMs, 0)
  })

  test('clamps a status carried in from before the window', () => {
    const events = timeline(windowStart, [
      ['OFFLINE', -3 * HOUR], // started yesterday
      ['ONLINE', 2 * HOUR],
    ])

    const stats = computeStats(events, { now, windowStart, currentStatus: 'ONLINE' })

    // Only the part of the outage that falls inside today counts.
    assert.equal(stats.offlineMs, 2 * HOUR)
    assert.equal(stats.outageCount, 1, 'an outage spanning midnight counts once, today')
    assert.equal(stats.measuredFrom, new Date(windowStart).toISOString())
  })

  test('the open final stretch is attributed to what is happening now', () => {
    const events = timeline(windowStart, [['ONLINE', 0]])

    // History says ONLINE, but monitoring has since been paused — the
    // last stretch belongs to the live state, not the last transition.
    const paused = computeStats(events, { now, windowStart, currentStatus: 'PAUSED' })
    assert.equal(paused.monitoredMs, 0)

    const running = computeStats(events, { now, windowStart, currentStatus: 'ONLINE' })
    assert.equal(running.monitoredMs, 10 * HOUR)
  })

  test('counts each outage separately and finds the longest', () => {
    const events = timeline(windowStart, [
      ['ONLINE', 0],
      ['OFFLINE', 1 * HOUR],
      ['ONLINE', 1 * HOUR + 10 * MINUTE],
      ['OFFLINE', 5 * HOUR],
      ['ONLINE', 5 * HOUR + 30 * MINUTE],
    ])

    const stats = computeStats(events, { now, windowStart, currentStatus: 'ONLINE' })

    assert.equal(stats.outageCount, 2)
    assert.equal(stats.longestOutageMs, 30 * MINUTE)
    assert.equal(stats.offlineMs, 40 * MINUTE)
  })

  test('survives malformed entries instead of throwing', () => {
    const events = [
      { status: 'ONLINE', at: 'not-a-date' },
      { status: 'ONLINE', at: new Date(windowStart).toISOString() },
      { status: 'OFFLINE', at: new Date(windowStart + 9 * HOUR).toISOString() },
    ]

    const stats = computeStats(events, { now, windowStart, currentStatus: 'OFFLINE' })
    assert.equal(stats.offlineMs, 1 * HOUR)
    assert.equal(stats.onlineMs, 9 * HOUR)
  })

  test('an empty timeline yields nothing measured rather than an error', () => {
    const stats = computeStats([], { now, windowStart, currentStatus: 'ONLINE' })
    assert.equal(stats.monitoredMs, 0)
    assert.equal(stats.uptimePercent, null)
    assert.equal(stats.measuredFrom, null)
    assert.equal(stats.outageCount, 0)
  })
})

describe('timelineStatusFor', () => {
  test('paused monitoring is a timeline entry of its own', () => {
    assert.equal(timelineStatusFor('ONLINE', false), 'PAUSED')
    assert.equal(timelineStatusFor('OFFLINE', false), 'PAUSED')
  })

  test('VERIFYING never enters the timeline', () => {
    assert.equal(timelineStatusFor('VERIFYING', true), null)
  })

  test('confirmed verdicts pass through', () => {
    assert.equal(timelineStatusFor('ONLINE', true), 'ONLINE')
    assert.equal(timelineStatusFor('DEGRADED', true), 'DEGRADED')
    assert.equal(timelineStatusFor('OFFLINE', true), 'OFFLINE')
  })
})

describe('formatDuration', () => {
  test('reads naturally across the ranges a downtime figure spans', () => {
    assert.equal(formatDuration(0), '0s')
    assert.equal(formatDuration(45_000), '45s')
    assert.equal(formatDuration(60_000), '1m')
    assert.equal(formatDuration(4 * MINUTE + 12_000), '4m 12s')
    assert.equal(formatDuration(2 * HOUR), '2h')
    assert.equal(formatDuration(2 * HOUR + 5 * MINUTE), '2h 5m')
  })

  test('never renders a negative duration', () => {
    assert.equal(formatDuration(-5_000), '0s')
  })
})

describe('latencyQuality', () => {
  test('buckets at the documented thresholds', () => {
    assert.equal(latencyQuality(0), 'EXCELLENT')
    assert.equal(latencyQuality(49), 'EXCELLENT')
    assert.equal(latencyQuality(50), 'GOOD')
    assert.equal(latencyQuality(99), 'GOOD')
    assert.equal(latencyQuality(100), 'HIGH')
    assert.equal(latencyQuality(199), 'HIGH')
    assert.equal(latencyQuality(200), 'VERY_HIGH')
    assert.equal(latencyQuality(5_000), 'VERY_HIGH')
  })
})

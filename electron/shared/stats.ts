import type { ConfirmedStatus, ConnectivityStats, HistoryEvent, HistoryStatus } from './types'

interface Segment {
  status: HistoryStatus
  from: number
  to: number
}

/** Start of the local day containing `at`. */
export function startOfLocalDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Start of local day N days ago (0 = today). */
export function startOfLocalDayOffset(at: number, daysAgo: number): number {
  const base = startOfLocalDay(at)
  return base - daysAgo * 24 * 60 * 60 * 1000
}

function localDateKey(at: number): string {
  const d = new Date(at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Per-day buckets for charts. Splits every timeline segment at local
 * midnight so multi-day outages attribute correctly. Returns oldest-first.
 */
export function computeDailyBuckets(
  events: readonly HistoryEvent[],
  options: { now: number; days: number; currentStatus: HistoryStatus | null }
): import('./types').DailyBucket[] {
  const { now, days, currentStatus } = options
  const ordered = events
    .map((event) => ({ status: event.status, at: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at)

  const segments: Segment[] = []
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]
    const next = ordered[i + 1]
    segments.push({ status: entry.status, from: entry.at, to: next ? next.at : now })
  }
  const last = segments[segments.length - 1]
  if (last && currentStatus !== null) last.status = currentStatus

  const DAY_MS = 24 * 60 * 60 * 1000
  const todayStart = startOfLocalDay(now)
  const buckets = new Map<string, import('./types').DailyBucket>()
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = todayStart - d * DAY_MS
    buckets.set(localDateKey(dayStart), {
      date: localDateKey(dayStart),
      onlineMs: 0,
      degradedMs: 0,
      offlineMs: 0,
      outageCount: 0,
    })
  }

  for (const seg of segments) {
    let cursor = Math.max(seg.from, todayStart - (days - 1) * DAY_MS)
    const end = Math.min(seg.to, now)
    if (end <= cursor) continue
    // Walk across midnight boundaries.
    while (cursor < end) {
      const dayStart = startOfLocalDay(cursor)
      const dayEnd = Math.min(dayStart + DAY_MS, end)
      const key = localDateKey(cursor)
      const bucket = buckets.get(key)
      if (bucket) {
        const ms = dayEnd - cursor
        if (seg.status === 'ONLINE') bucket.onlineMs += ms
        else if (seg.status === 'DEGRADED') bucket.degradedMs += ms
        else if (seg.status === 'OFFLINE') {
          // One count per segment per day it touches. Gating on
          // `offlineMs === 0` undercounted two outages sharing a day.
          bucket.outageCount += 1
          bucket.offlineMs += ms
        }
      }
      cursor = dayEnd
    }
  }
  return [...buckets.values()]
}

/** CSV export of history, newest-first. Pure so renderer/tests reuse it. */
export function historyToCsv(events: readonly HistoryEvent[]): string {
  const lines = ['status,at']
  for (const e of events) {
    const status = String(e.status).replace(/[^A-Z]/g, '')
    const at = String(e.at).replace(/"/g, '')
    lines.push(`${status},"${at}"`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Turns the timeline into per-status totals for [windowStart, now].
 *
 * `events` is the stored history in any order; entries with unparseable
 * timestamps are ignored rather than throwing, because this runs on data
 * that may have been hand-edited. `currentStatus` is the live timeline
 * status, used for the open-ended final segment — history only records
 * transitions, so the stretch since the last one has no end event yet.
 */
export function computeStats(
  events: readonly HistoryEvent[],
  options: { now: number; windowStart: number; currentStatus: HistoryStatus | null }
): ConnectivityStats {
  const { now, windowStart } = options

  const ordered = events
    .map((event) => ({ status: event.status, at: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at)

  const segments: Segment[] = []
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]
    const next = ordered[i + 1]
    segments.push({ status: entry.status, from: entry.at, to: next ? next.at : now })
  }

  // The stretch since the last recorded transition belongs to whatever
  // is happening right now, which may be newer than the last event (a
  // status can be live before it is worth recording).
  const last = segments[segments.length - 1]
  if (last && options.currentStatus !== null) {
    last.status = options.currentStatus
  }

  const totals: Record<HistoryStatus, number> = { ONLINE: 0, DEGRADED: 0, OFFLINE: 0, PAUSED: 0 }
  let measuredFrom: number | null = null
  let outageCount = 0
  let longestOutageMs = 0

  for (const segment of segments) {
    const from = Math.max(segment.from, windowStart)
    const to = Math.min(segment.to, now)
    if (to <= from) continue

    totals[segment.status] += to - from
    if (measuredFrom === null || from < measuredFrom) measuredFrom = from

    if (segment.status === 'OFFLINE') {
      outageCount += 1
      longestOutageMs = Math.max(longestOutageMs, to - from)
    }
  }

  const monitoredMs = totals.ONLINE + totals.DEGRADED + totals.OFFLINE
  const usableMs = totals.ONLINE + totals.DEGRADED

  return {
    windowStart: new Date(windowStart).toISOString(),
    measuredFrom: measuredFrom === null ? null : new Date(measuredFrom).toISOString(),
    monitoredMs,
    onlineMs: totals.ONLINE,
    degradedMs: totals.DEGRADED,
    offlineMs: totals.OFFLINE,
    uptimePercent: monitoredMs === 0 ? null : (usableMs / monitoredMs) * 100,
    outageCount,
    longestOutageMs,
  }
}

/** The timeline status for a reported connectivity state. VERIFYING is
 *  not a verdict and never enters the timeline — the last confirmed one
 *  still stands while a failure is being checked. */
export function timelineStatusFor(
  status: ConfirmedStatus | 'VERIFYING',
  isMonitoring: boolean
): HistoryStatus | null {
  if (!isMonitoring) return 'PAUSED'
  return status === 'VERIFYING' ? null : status
}

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

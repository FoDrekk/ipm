import { useCallback, useEffect, useRef, useState } from 'react'
import { getStats, type ConnectivityStats, type StatsRange } from '../ipc/ipc-client'
import { useConnectivityStore } from '../state/connectivity.store'

// Slow on purpose. The numbers move continuously, but they are summaries
// of a whole day — a second of extra downtime does not change what they
// say, and the main process recomputes from history on every call.
const REFRESH_MS = 30_000

/**
 * Uptime/downtime figures for given range, computed in main process from
 * same history timeline is built from. Refetched on slow timer and
 * whenever connectivity status changes, because transition is exactly
 * what makes previous answer stale.
 */
export function useStats(range: StatsRange = 'day'): ConnectivityStats | null {
  const [stats, setStats] = useState<ConnectivityStats | null>(null)
  const mountedRef = useRef(true)

  // A transition is the only event that meaningfully invalidates the
  // figures; probes that change nothing do not.
  const statusChangedAt = useConnectivityStore((state) => state.statusChangedAt)
  const isMonitoring = useConnectivityStore((state) => state.isMonitoring)

  const refresh = useCallback(() => {
    getStats(range)
      .then((next) => {
        if (mountedRef.current) setStats(next)
      })
      .catch((error: unknown) => {
        console.error('[stats] failed to load statistics:', error)
      })
  }, [range])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh, statusChangedAt, isMonitoring])

  return stats
}

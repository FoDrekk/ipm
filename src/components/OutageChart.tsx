import { useEffect, useState } from 'react'
import { getDailyStats, type DailyBucket } from '../ipc/ipc-client'
import { useConnectivityStore } from '../state/connectivity.store'

/**
 * 7-day offline minutes per day. Pure display of `stats:get-daily`
 * buckets — no own calculation, no persistence.
 */
export default function OutageChart({ days = 7 }: { days?: number }) {
  const [buckets, setBuckets] = useState<DailyBucket[] | null>(null)
  const statusChangedAt = useConnectivityStore((s) => s.statusChangedAt)

  useEffect(() => {
    let cancelled = false
    getDailyStats(days)
      .then((b) => {
        if (!cancelled) setBuckets(b)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [days, statusChangedAt])

  if (!buckets || buckets.length === 0) return null
  const max = Math.max(...buckets.map((b) => b.offlineMs), 60000)
  return (
    <div className="flex items-end justify-center gap-1 px-6 pb-2" aria-hidden="true">
      {buckets.map((b) => {
        const h = Math.max(2, Math.round((b.offlineMs / max) * 28))
        return (
          <div
            key={b.date}
            title={`${b.date}: ${Math.round(b.offlineMs / 60000)}m offline, ${b.outageCount} outages`}
            className={`w-4 rounded-sm ${b.offlineMs > 0 ? 'bg-red-500/70' : 'bg-slate-800'}`}
            style={{ height: `${h}px` }}
          />
        )
      })}
    </div>
  )
}

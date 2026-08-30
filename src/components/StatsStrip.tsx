import { formatDuration } from '../../electron/shared/types'
import type { ConnectivityStats } from '../ipc/ipc-client'

interface StatsStripProps {
  stats: ConnectivityStats | null
  /** Live duration of the outage in progress, if there is one. Shown in
   *  place of the day's total, because while you are down that is the
   *  number you actually want. */
  currentOutage: string | null
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-sm font-semibold ${tone ?? 'text-slate-300'}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-slate-600">{label}</span>
    </div>
  )
}

/**
 * Today's connectivity at a glance. Derived entirely from the stored
 * timeline, so it survives restarts without anything extra being
 * persisted, and it counts only time that was actually monitored —
 * hours with the app closed are neither uptime nor downtime.
 */
export default function StatsStrip({ stats, currentOutage }: StatsStripProps) {
  const uptime =
    stats === null || stats.uptimePercent === null ? '—' : `${stats.uptimePercent.toFixed(1)}%`
  const downtime = stats === null ? '—' : formatDuration(stats.offlineMs)
  const outages = stats === null ? '—' : String(stats.outageCount)

  return (
    <div className="grid grid-cols-3 gap-2 border-t border-slate-900 px-6 py-3">
      <Stat
        label="Uptime today"
        value={uptime}
        tone={stats?.uptimePercent === 100 ? 'text-emerald-400' : 'text-slate-300'}
      />
      {currentOutage === null ? (
        <Stat label="Downtime today" value={downtime} />
      ) : (
        <Stat label="Offline for" value={currentOutage} tone="text-red-400" />
      )}
      <Stat label="Outages today" value={outages} />
    </div>
  )
}

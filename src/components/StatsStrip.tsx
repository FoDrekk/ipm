import { formatDuration } from '../../electron/shared/types'
import type { ConnectivityStats, StatsRange } from '../ipc/ipc-client'

interface StatsStripProps {
  stats: ConnectivityStats | null
  /** Live duration of the outage in progress, if there is one. Shown in
   *  place of the day's total, because while you are down that is the
   *  number you actually want. */
  currentOutage: string | null
  range: StatsRange
  onRangeChange: (range: StatsRange) => void
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
export default function StatsStrip({ stats, currentOutage, range, onRangeChange }: StatsStripProps) {
  const uptime =
    stats === null || stats.uptimePercent === null ? '—' : `${stats.uptimePercent.toFixed(1)}%`
  const downtime = stats === null ? '—' : formatDuration(stats.offlineMs)
  const outages = stats === null ? '—' : String(stats.outageCount)
  const rangeLabel = range === 'day' ? 'today' : range === 'week' ? '7d' : '30d'

  return (
    <div className="border-t border-slate-900 px-6 py-3">
      <div className="mb-2 flex items-center justify-center gap-1">
        {(['day', 'week', 'month'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRangeChange(r)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors active:scale-95 ${
              range === r ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {r === 'day' ? 'Today' : r === 'week' ? '7d' : '30d'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label={`Uptime ${rangeLabel}`}
          value={uptime}
          tone={stats?.uptimePercent === 100 ? 'text-emerald-400' : 'text-slate-300'}
        />
        {currentOutage === null || range !== 'day' ? (
          <Stat label={`Downtime ${rangeLabel}`} value={downtime} />
        ) : (
          <Stat label="Offline for" value={currentOutage} tone="text-red-400" />
        )}
        <Stat label={`Outages ${rangeLabel}`} value={outages} />
      </div>
    </div>
  )
}

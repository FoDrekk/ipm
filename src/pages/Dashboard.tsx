import { useConnectivityStore } from '../state/connectivity.store'
import { useRelativeTime } from '../hooks/useRelativeTime'
import StatusCard from '../components/StatusCard'
import StatusIndicator from '../components/StatusIndicator'
import ToggleSwitch from '../components/ToggleSwitch'
import MiniStatusBadge from '../components/MiniStatusBadge'

interface DashboardProps {
  onOpenSettings: () => void
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="15" cy="7" r="2.2" fill="currentColor" />
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="12" r="2.2" fill="currentColor" />
      <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="17" r="2.2" fill="currentColor" />
    </svg>
  )
}

/**
 * Pure presentation of the connectivity state the main process reports,
 * plus the monitoring toggle. It owns no subscription, no timers and no
 * alarm — those live at the app root so they survive the user opening
 * Settings.
 */
export default function Dashboard({ onOpenSettings }: DashboardProps) {
  const status = useConnectivityStore((state) => state.status)
  const lastChecked = useConnectivityStore((state) => state.lastChecked)
  const statusChangedAt = useConnectivityStore((state) => state.statusChangedAt)
  const isMonitoring = useConnectivityStore((state) => state.isMonitoring)
  const setMonitoring = useConnectivityStore((state) => state.setMonitoring)

  const relativeTime = useRelativeTime(lastChecked)
  const lastCheckedLabel = lastChecked ? relativeTime : isMonitoring ? 'Checking…' : 'Not started'

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950">
      <div className="flex items-center justify-between px-5 pt-5">
        <MiniStatusBadge status={status} isMonitoring={isMonitoring} statusChangedAt={statusChangedAt} />
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-lg p-2 text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-200 active:scale-95"
          aria-label="Open settings"
        >
          <SettingsIcon />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <StatusCard>
          <StatusIndicator status={status} isMonitoring={isMonitoring} />

          <p className="text-sm text-slate-500">
            Last checked: <span className="text-slate-300">{lastCheckedLabel}</span>
          </p>

          <div className="h-px w-full bg-slate-800" />

          <ToggleSwitch checked={isMonitoring} onChange={setMonitoring} label="Monitoring" />
        </StatusCard>
      </div>
    </div>
  )
}

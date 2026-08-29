import type { ConnectivityStatus } from '../ipc/ipc-client'
import { STATUS_INFO } from '../utils/statusVisuals'
import { useRelativeTime } from '../hooks/useRelativeTime'

interface MiniStatusBadgeProps {
  status: ConnectivityStatus
  isMonitoring: boolean
  statusChangedAt: string | null
}

export default function MiniStatusBadge({
  status,
  isMonitoring,
  statusChangedAt,
}: MiniStatusBadgeProps) {
  const changedLabel = useRelativeTime(statusChangedAt)

  if (!isMonitoring) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-slate-800/60 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-slate-600 transition-colors duration-300" />
        <span className="text-xs font-medium text-slate-400">Paused</span>
      </div>
    )
  }

  const { dot, text } = STATUS_INFO[status]

  return (
    <div className="flex items-center gap-2 rounded-full bg-slate-800/60 px-3 py-2">
      <span className={`h-2 w-2 rounded-full transition-colors duration-300 ${dot}`} />
      <span className={`text-xs font-medium ${text}`}>{status}</span>
      {statusChangedAt && <span className="text-xs text-slate-500">· changed {changedLabel}</span>}
    </div>
  )
}

import type { ConnectivityStatus } from '../ipc/ipc-client'
import { STATUS_INFO } from '../utils/statusVisuals'
import StatusIcon from './StatusIcon'

interface StatusIndicatorProps {
  status: ConnectivityStatus
  isMonitoring: boolean
}

export default function StatusIndicator({ status, isMonitoring }: StatusIndicatorProps) {
  if (!isMonitoring) {
    return (
      <div className="flex flex-col items-center gap-3 opacity-50 transition-opacity duration-300">
        <span className="h-6 w-6 rounded-full bg-slate-600 transition-colors duration-300" />
        <span className="text-2xl font-semibold tracking-wide text-slate-400">
          Monitoring is paused
        </span>
      </div>
    )
  }

  const { message, text } = STATUS_INFO[status]

  return (
    <div className="flex flex-col items-center gap-3 opacity-100 transition-opacity duration-300">
      <StatusIcon status={status} sizeClassName="h-6 w-6" />
      {/* key={status} remounts the text on every status change, which is
          what makes animate-fade-in replay — a smooth swap for the new
          message rather than an instant text-content jump. */}
      <span key={status} className={`animate-fade-in text-xl font-semibold tracking-wide ${text}`}>
        {message}
      </span>
    </div>
  )
}

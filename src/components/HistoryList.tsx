import type { HistoryEvent } from '../ipc/ipc-client'
import { HISTORY_VISUALS } from '../utils/statusVisuals'

interface HistoryListProps {
  events: HistoryEvent[]
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-700">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M12 7.5v5l3.2 1.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

/** Stored data is validated in the main process before it gets here, but
 *  this screen renders whatever it is handed and a crash would take the
 *  whole Settings view with it — so an unrecognised status degrades to
 *  plain text, and an unparseable timestamp to a dash. */
function visualFor(status: string): { label: string; text: string } {
  return status in HISTORY_VISUALS
    ? HISTORY_VISUALS[status as keyof typeof HISTORY_VISUALS]
    : { label: String(status), text: 'text-slate-400' }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export default function HistoryList({ events }: HistoryListProps) {
  if (events.length === 0) {
    return (
      <div className="animate-fade-in flex flex-col items-center gap-2 py-4 text-center">
        <ClockIcon />
        <p className="text-sm text-slate-500">
          Nothing to show yet — connection changes will appear here.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
      {events.map((event, index) => (
        <li
          // Index-qualified: two events sharing a timestamp would
          // otherwise collide on a duplicate React key.
          key={`${event.at}-${index}`}
          className="animate-fade-in flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-sm"
        >
          <span className={`font-medium ${visualFor(event.status).text}`}>
            {visualFor(event.status).label}
          </span>
          <span className="text-slate-500">{formatTimestamp(event.at)}</span>
        </li>
      ))}
    </ul>
  )
}

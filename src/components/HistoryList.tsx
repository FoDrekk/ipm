import type { HistoryEvent } from '../ipc/ipc-client'
import { STATUS_INFO } from '../utils/statusVisuals'

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
      {events.map((event) => (
        <li
          key={event.at}
          className="animate-fade-in flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-sm"
        >
          <span className={`font-medium ${STATUS_INFO[event.status].text}`}>{event.status}</span>
          <span className="text-slate-500">{new Date(event.at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}

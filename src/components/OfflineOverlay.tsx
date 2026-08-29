import { useEffect, useState } from 'react'
import { useOfflineDuration } from '../hooks/useOfflineDuration'
import type { AppSettings } from '../ipc/ipc-client'
import StatusIcon from './StatusIcon'
import ToggleSwitch from './ToggleSwitch'

interface OfflineOverlayProps {
  /** True while genuinely offline. False during the exit fade, when the
   *  parent still keeps this mounted for a moment. */
  isActive: boolean
  offlineSince: string | null
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => void
  isSnoozed: boolean
  onSnooze: () => void
  /** True when Diagnostics is forcing the outage. The alert is otherwise
   *  identical on purpose — that is what makes it a real test — so this
   *  line is the only thing telling the two apart. */
  isSimulated: boolean
}

/**
 * The full-screen offline alert. Purely visual: the alarm it used to own
 * now lives at the app root, so dismissing this with Esc, or letting it
 * unmount after the fade, has no effect on whether the alarm sounds —
 * only on whether the alert is on screen.
 *
 * Mounting is entirely the parent's decision (offline, plus a short exit
 * window), so there are no delay timers of its own to get out of step
 * with the reported status.
 */
export default function OfflineOverlay({
  isActive,
  offlineSince,
  settings,
  onUpdateSettings,
  isSnoozed,
  onSnooze,
  isSimulated,
}: OfflineOverlayProps) {
  const [isDismissed, setIsDismissed] = useState(false)
  const duration = useOfflineDuration(offlineSince)

  // A fresh outage always shows, even if the previous one was dismissed
  // with Esc while this component happened to stay mounted.
  useEffect(() => {
    if (isActive) setIsDismissed(false)
  }, [isActive])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setIsDismissed(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (isDismissed) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.11),rgba(2,6,23,0.86)_70%)] px-8 text-center backdrop-blur-md ${
        isActive ? 'animate-overlay-enter' : 'animate-overlay-exit'
      }`}
    >
      <StatusIcon status="OFFLINE" sizeClassName="h-16 w-16" gentlePulse />

      <p className="text-3xl font-extrabold tracking-wide text-red-400">NO INTERNET CONNECTION</p>

      {isSimulated && (
        <p className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300">
          Simulated outage — your connection has not actually dropped
        </p>
      )}

      {duration && <p className="text-sm text-slate-400">Offline for {duration}</p>}

      <button
        type="button"
        onClick={onSnooze}
        disabled={isSnoozed}
        className="mt-2 rounded-lg bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700 active:scale-95 disabled:cursor-default disabled:opacity-50"
      >
        {isSnoozed ? 'Snoozing…' : 'Snooze 30s'}
      </button>

      <div className="mt-4 w-full max-w-[220px]">
        <ToggleSwitch
          checked={settings.alarm.enabled}
          onChange={(enabled) => onUpdateSettings({ alarm: { ...settings.alarm, enabled } })}
          label="Alarm"
        />
      </div>

      <p className="mt-2 text-xs text-slate-600">Press Esc to dismiss</p>
    </div>
  )
}

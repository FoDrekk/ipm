import { useEffect, useState } from 'react'
import { useAlarm } from '../hooks/useAlarm'
import { useOfflineDuration } from '../hooks/useOfflineDuration'
import type { AppSettings } from '../ipc/ipc-client'
import StatusIcon from './StatusIcon'
import ToggleSwitch from './ToggleSwitch'

interface OfflineOverlayProps {
  /** True only while genuinely OFFLINE right now. False during the exit
   *  fade window even though the parent keeps this mounted then. */
  isActive: boolean
  offlineSince: string | null
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => void
}

const SNOOZE_MS = 30_000

/**
 * The parent controls whether this is mounted at all (real offline state
 * plus a short exit-transition grace period). Everything in here reacts
 * to `isActive` directly rather than to its own mount/unmount, since
 * those two no longer coincide during the exit fade.
 */
export default function OfflineOverlay({
  isActive,
  offlineSince,
  settings,
  onUpdateSettings,
}: OfflineOverlayProps) {
  const [isDismissed, setIsDismissed] = useState(false)
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)

  const isSnoozed = snoozedUntil !== null
  // Snoozing is just another reason the alarm shouldn't sound right now —
  // it doesn't change isActive itself (we're still genuinely offline),
  // only what useAlarm is told.
  useAlarm({
    active: isActive && !isSnoozed,
    enabled: settings.alarm.enabled,
    volume: settings.alarm.volume,
    sound: settings.alarm.sound,
  })
  const duration = useOfflineDuration(offlineSince)

  // A fresh outage should always show, even if the last one was
  // dismissed with Escape. Also clears any leftover snooze so a new
  // outage starts with the alarm active, not silently snoozed from before.
  useEffect(() => {
    if (isActive) {
      setIsDismissed(false)
      setSnoozedUntil(null)
    }
  }, [isActive])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setIsDismissed(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Auto-clears the snooze after SNOOZE_MS, and correctly handles a
  // snooze that got extended (or already elapsed) rather than assuming
  // a fixed delay from when this effect happened to run.
  useEffect(() => {
    if (snoozedUntil === null) return
    const remaining = snoozedUntil - Date.now()
    if (remaining <= 0) {
      setSnoozedUntil(null)
      return
    }
    const timer = setTimeout(() => setSnoozedUntil(null), remaining)
    return () => clearTimeout(timer)
  }, [snoozedUntil])

  // Escape hides the visual only — the alarm hook above is untouched by
  // isDismissed, so sound keeps going exactly as intended.
  if (isDismissed) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.11),rgba(2,6,23,0.86)_70%)] px-8 text-center backdrop-blur-md ${
        isActive ? 'animate-overlay-enter' : 'animate-overlay-exit'
      }`}
    >
      <StatusIcon status="OFFLINE" sizeClassName="h-16 w-16" gentlePulse />

      <p className="text-3xl font-extrabold tracking-wide text-red-400">NO INTERNET CONNECTION</p>

      {duration && <p className="text-sm text-slate-400">Offline for {duration}</p>}

      <button
        type="button"
        onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
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

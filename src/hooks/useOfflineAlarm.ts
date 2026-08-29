import { useCallback, useEffect, useState } from 'react'
import { useAlarm } from './useAlarm'
import type { AppSettings } from '../ipc/ipc-client'

const SNOOZE_MS = 30_000

interface UseOfflineAlarmResult {
  isSnoozed: boolean
  snooze: () => void
}

/**
 * Owns the alarm's whole lifecycle for the app, mounted at the root
 * rather than inside the overlay. That placement is the point: the
 * alarm is a consequence of being offline, not of a component being on
 * screen, so it keeps sounding while the user is in Settings, and it
 * stops the moment the connection is back — with no dependence on
 * whether the overlay happens to be mounted, dismissed or mid-fade.
 */
export function useOfflineAlarm(
  isOffline: boolean,
  settings: AppSettings
): UseOfflineAlarmResult {
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)
  const isSnoozed = snoozedUntil !== null

  // A snooze belongs to the outage it was made during. Coming back
  // online ends it, so a later outage starts out loud rather than
  // silently muted by a decision from minutes ago.
  useEffect(() => {
    if (!isOffline) setSnoozedUntil(null)
  }, [isOffline])

  // Expires from the deadline itself rather than a fixed delay from
  // whenever this effect happened to run, so a snooze that was extended
  // (or has already lapsed) resolves correctly either way.
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

  useAlarm({
    active: isOffline && !isSnoozed,
    enabled: settings.alarm.enabled,
    volume: settings.alarm.volume,
    sound: settings.alarm.sound,
  })

  const snooze = useCallback(() => setSnoozedUntil(Date.now() + SNOOZE_MS), [])

  return { isSnoozed, snooze }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeSettings } from '../../electron/shared/types'
import { getSettings, updateSettings as updateSettingsIpc, type AppSettings } from '../ipc/ipc-client'

const SAVED_INDICATOR_MS = 1_500

interface UseSettingsResult {
  settings: AppSettings | null
  updateSettings: (partial: Partial<AppSettings>) => void
  /** Briefly true right after a successful save, for a "Saved"
   *  indicator — clears itself, no separate action needed. */
  justSaved: boolean
}

/**
 * The renderer's copy of persisted settings.
 *
 * Updates are applied optimistically and then confirmed, which is what
 * makes controls like the volume slider usable: waiting for a round trip
 * before moving the handle makes a drag stutter and fight the user.
 * The optimistic value is produced by `mergeSettings` — the same
 * function the main process merges with — so the confirmation is
 * normally identical to what is already on screen.
 *
 * Every request carries a sequence number and only the newest one is
 * allowed to write. That is the guard against a fast drag: several saves
 * are in flight at once, and without it an older reply landing last
 * would drag the slider back to a value the user has already moved past.
 *
 * Settings have no push channel — nothing outside this app's own UI
 * changes them — so a fetch on mount plus each call's own confirmation
 * is the complete picture; no subscription is needed.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRequestRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  useEffect(() => {
    getSettings()
      .then((loaded) => {
        // An edit made while the initial load was in flight is newer
        // than what the load returns; it must not be undone by it.
        if (mountedRef.current && latestRequestRef.current === 0) setSettings(loaded)
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load settings:', error)
      })
  }, [])

  const updateSettings = useCallback((partial: Partial<AppSettings>): void => {
    setSettings((current) => (current ? mergeSettings(current, partial) : current))

    const requestId = (latestRequestRef.current += 1)
    updateSettingsIpc(partial)
      .then((persisted) => {
        if (!mountedRef.current || requestId !== latestRequestRef.current) return
        // The authoritative, validated result — normally identical to
        // the optimistic value, but it also corrects anything the main
        // process clamped or rejected.
        setSettings(persisted)
        setJustSaved(true)
        // Rapid edits keep extending the visible window rather than
        // racing each other to hide it early.
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setJustSaved(false)
        }, SAVED_INDICATOR_MS)
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to save settings:', error)
        // The optimistic value is now a lie — resync with what was
        // actually persisted so the UI doesn't show an unsaved change
        // as if it had been saved.
        if (requestId !== latestRequestRef.current) return
        getSettings()
          .then((actual) => {
            if (mountedRef.current && requestId === latestRequestRef.current) setSettings(actual)
          })
          .catch(() => undefined)
      })
  }, [])

  return { settings, updateSettings, justSaved }
}

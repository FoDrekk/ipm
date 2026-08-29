import { useEffect, useRef, useState } from 'react'
import { getSettings, updateSettings as updateSettingsIpc, type AppSettings } from '../ipc/ipc-client'

const SAVED_INDICATOR_MS = 1_500

interface UseSettingsResult {
  settings: AppSettings | null
  updateSettings: (partial: Partial<AppSettings>) => void
  /** Briefly true right after a successful update, for a "Saved"
   *  indicator — auto-clears itself, no separate action needed. */
  justSaved: boolean
}

/**
 * Settings have no push channel — nothing outside this app's own UI
 * changes them, unlike connectivity state. So unlike connectivity.store,
 * a plain fetch-once-then-update-from-each-call's-own-result is enough;
 * no separate event subscription needed.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch((error: unknown) => {
        console.error('[useSettings] Failed to fetch settings:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  function updateSettings(partial: Partial<AppSettings>): void {
    updateSettingsIpc(partial)
      .then((s) => {
        setSettings(s)
        setJustSaved(true)
        // Clear any pending hide first — rapid successive edits (e.g.
        // dragging a slider) should keep extending the visible window,
        // not race each other to hide it early.
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setJustSaved(false), SAVED_INDICATOR_MS)
      })
      .catch((error: unknown) => {
        console.error('[useSettings] Failed to update settings:', error)
      })
  }

  return { settings, updateSettings, justSaved }
}

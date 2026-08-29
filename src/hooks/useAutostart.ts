import { useCallback, useEffect, useRef, useState } from 'react'
import { getAutostart, setAutostart as setAutostartIpc } from '../ipc/ipc-client'

interface UseAutostartResult {
  /** null until the OS setting has been read. */
  enabled: boolean | null
  setEnabled: (next: boolean) => void
}

/**
 * "Launch on startup", read from and written to Windows itself through
 * Electron's login-item API. Windows is the source of truth — this app
 * keeps no copy of the setting, so the two can never disagree, and a
 * change made outside the app is picked up simply by reading it again.
 *
 * Every write answers with the setting actually in effect afterwards, so
 * if the OS refuses the change (locked-down profile, policy), the toggle
 * snaps back to reality instead of showing a preference that isn't real.
 */
export function useAutostart(): UseAutostartResult {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const mountedRef = useRef(true)
  const latestRequestRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    getAutostart()
      .then((value) => {
        if (mountedRef.current && latestRequestRef.current === 0) setEnabled(value)
      })
      .catch((error: unknown) => {
        console.error('[autostart] failed to read the launch-at-login setting:', error)
      })
  }, [])

  const update = useCallback((next: boolean): void => {
    setEnabled(next)
    const requestId = (latestRequestRef.current += 1)
    setAutostartIpc(next)
      .then((actual) => {
        if (mountedRef.current && requestId === latestRequestRef.current) setEnabled(actual)
      })
      .catch((error: unknown) => {
        console.error('[autostart] failed to change the launch-at-login setting:', error)
        if (mountedRef.current && requestId === latestRequestRef.current) setEnabled(!next)
      })
  }, [])

  return { enabled, setEnabled: update }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { setSimulatedOffline, testNotification, testTray } from '../ipc/ipc-client'
import { useConnectivityStore } from '../state/connectivity.store'

/** How long a "did it work?" result stays on the button. */
const RESULT_MS = 2_500

export type DiagnosticName = 'notification' | 'tray'

interface UseDiagnosticsResult {
  /** Whether the connectivity engine is currently being forced to fail.
   *  Read from the pushed state, not tracked locally, so the button can
   *  never disagree with what the engine is actually doing. */
  isSimulating: boolean
  toggleSimulation: (enabled: boolean) => void
  runTest: (name: DiagnosticName) => void
  /** Last outcome per test, for a brief inline confirmation. */
  results: Partial<Record<DiagnosticName, boolean>>
}

/**
 * The Diagnostics controls. Every one of them drives the real service
 * through the existing IPC — there is no parallel test implementation
 * that could pass while the thing it stands in for is broken.
 */
export function useDiagnostics(): UseDiagnosticsResult {
  const isSimulating = useConnectivityStore((state) => state.isSimulated)
  const [results, setResults] = useState<Partial<Record<DiagnosticName, boolean>>>({})
  const mountedRef = useRef(true)
  const timersRef = useRef<Map<DiagnosticName, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const recordResult = useCallback((name: DiagnosticName, ok: boolean) => {
    if (!mountedRef.current) return
    setResults((current) => ({ ...current, [name]: ok }))

    const existing = timersRef.current.get(name)
    if (existing) clearTimeout(existing)
    timersRef.current.set(
      name,
      setTimeout(() => {
        timersRef.current.delete(name)
        if (mountedRef.current) {
          setResults((current) => {
            const next = { ...current }
            delete next[name]
            return next
          })
        }
      }, RESULT_MS)
    )
  }, [])

  const runTest = useCallback(
    (name: DiagnosticName) => {
      const request = name === 'notification' ? testNotification : testTray
      request()
        .then((ok) => recordResult(name, ok))
        .catch((error: unknown) => {
          console.error(`[diagnostics] ${name} test failed:`, error)
          recordResult(name, false)
        })
    },
    [recordResult]
  )

  // Fire and forget: the resulting state arrives through the normal
  // connectivity push, so there is one path into the store rather than
  // two that could disagree.
  const toggleSimulation = useCallback((enabled: boolean) => {
    setSimulatedOffline(enabled).catch((error: unknown) => {
      console.error('[diagnostics] failed to change offline simulation:', error)
    })
  }, [])

  return { isSimulating, toggleSimulation, runTest, results }
}

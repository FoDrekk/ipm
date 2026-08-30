import { useEffect } from 'react'
import { create } from 'zustand'
import {
  getConnectivityStatus,
  startMonitoring,
  stopMonitoring,
  subscribeToConnectivityStatus,
  type ConnectivityState,
} from '../ipc/ipc-client'

interface ConnectivityStore extends ConnectivityState {
  applyState: (state: ConnectivityState) => void
  setMonitoring: (next: boolean) => void
}

/**
 * A mirror of the main process's connectivity state, never a second
 * opinion about it. Nothing in the renderer decides that the connection
 * is down — `applyState` is the only writer, and its only callers are
 * the initial fetch and the pushed updates below.
 *
 * The initial values are what the main process itself reports before its
 * first probe lands: not monitoring, nothing checked yet, and VERIFYING
 * rather than OFFLINE — a fresh window must never open onto a red screen
 * it has no evidence for.
 */
export const useConnectivityStore = create<ConnectivityStore>((set) => ({
  status: 'VERIFYING',
  lastChecked: null,
  offlineSince: null,
  statusChangedAt: null,
  isMonitoring: false,
  latencyMs: null,
  isSimulated: false,

  applyState: (state) => set(state),

  // Fire-and-forget: the resolved value is deliberately ignored, because
  // the main process pushes the same state through the subscription
  // below. One path into the store, not two racing ones. A failed
  // request leaves the state untouched rather than assuming an outcome.
  setMonitoring: (next) => {
    const request = next ? startMonitoring : stopMonitoring
    request().catch((error: unknown) => {
      console.error('[connectivity] start/stop monitoring request failed:', error)
    })
  },
}))

/**
 * Connects the store to the main process for as long as the app is
 * mounted. Call this exactly once, at the app root — not per screen: a
 * subscription that lives and dies with the dashboard would stop
 * applying updates the moment the user opened Settings, and the alarm
 * and overlay would go with it.
 *
 * Safe under React strict mode: the effect's cleanup removes precisely
 * the listener it added, so a double mount ends up with exactly one.
 */
export function useConnectivityBridge(): void {
  const applyState = useConnectivityStore((state) => state.applyState)

  useEffect(() => {
    let cancelled = false
    let pushed = false

    // Subscribe first, then fetch: the other order leaves a window in
    // which a status change is published and nobody is listening yet.
    const unsubscribe = subscribeToConnectivityStatus((state) => {
      if (cancelled) return
      pushed = true
      applyState(state)
    })

    getConnectivityStatus()
      .then((state) => {
        // A push that arrived while this request was in flight is newer
        // than its answer — applying the answer would rewind the UI.
        if (!cancelled && !pushed) applyState(state)
      })
      .catch((error: unknown) => {
        console.error('[connectivity] failed to fetch initial status:', error)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyState])
}

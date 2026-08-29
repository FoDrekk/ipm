import { create } from 'zustand'
import { startMonitoring, stopMonitoring, type ConnectivityState } from '../ipc/ipc-client'

interface ConnectivityStore extends ConnectivityState {
  applyState: (state: ConnectivityState) => void
  setMonitoring: (next: boolean) => void
}

export const useConnectivityStore = create<ConnectivityStore>((set) => ({
  status: 'OFFLINE',
  lastChecked: null,
  offlineSince: null,
  statusChangedAt: null,
  isMonitoring: false,

  // The only entry point that writes connectivity state. Called from
  // Dashboard's effect — once for the initial pull, and again for every
  // pushed event from the main process. The UI never guesses its own
  // state; it only ever reflects what main reports.
  applyState: (state) => set(state),

  // Fire-and-forget the IPC request. Deliberately does NOT set state from
  // the resolved value — the real state arrives via the pushed
  // 'connectivity:status-changed' event once MonitorService actually
  // starts/stops, so there's exactly one path into the store, not two
  // racing ones. A failed call just gets logged; state is left untouched
  // rather than assumed.
  setMonitoring: (next) => {
    const request = next ? startMonitoring : stopMonitoring
    request().catch((error: unknown) => {
      console.error('[connectivity.store] start/stop-monitoring request failed:', error)
    })
  },
}))

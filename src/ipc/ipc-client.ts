import type { ConnectivityState, ConnectivityStatus } from '../../electron/services/monitor.service'
import type { AppSettings, HistoryEvent, RetryStrategy } from '../../electron/services/storage.service'

export type { ConnectivityState, ConnectivityStatus, AppSettings, HistoryEvent, RetryStrategy }

declare global {
  interface Window {
    api: {
      connectivity: {
        getStatus: () => Promise<ConnectivityState>
        startMonitoring: () => Promise<ConnectivityState>
        stopMonitoring: () => Promise<ConnectivityState>
        onStatusChanged: (callback: (state: ConnectivityState) => void) => () => void
      }
      settings: {
        getAutostart: () => Promise<boolean>
        setAutostart: (enabled: boolean) => Promise<boolean>
        get: () => Promise<AppSettings>
        update: (partial: Partial<AppSettings>) => Promise<AppSettings>
      }
      history: {
        get: () => Promise<HistoryEvent[]>
      }
    }
  }
}

export function getConnectivityStatus(): Promise<ConnectivityState> {
  return window.api.connectivity.getStatus()
}

export function startMonitoring(): Promise<ConnectivityState> {
  return window.api.connectivity.startMonitoring()
}

export function stopMonitoring(): Promise<ConnectivityState> {
  return window.api.connectivity.stopMonitoring()
}

export function subscribeToConnectivityStatus(
  callback: (state: ConnectivityState) => void
): () => void {
  return window.api.connectivity.onStatusChanged(callback)
}

export function getAutostart(): Promise<boolean> {
  return window.api.settings.getAutostart()
}

export function setAutostart(enabled: boolean): Promise<boolean> {
  return window.api.settings.setAutostart(enabled)
}

export function getSettings(): Promise<AppSettings> {
  return window.api.settings.get()
}

export function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  return window.api.settings.update(partial)
}

export function getHistory(): Promise<HistoryEvent[]> {
  return window.api.history.get()
}

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppApi, AppSettings, ConnectivityState, HistoryEvent } from './shared/types'

/**
 * The entire surface the renderer can reach. Typed as AppApi — the same
 * type the renderer declares `window.api` with — so the two halves of
 * the bridge cannot drift apart without a compile error.
 *
 * Nothing here forwards raw Node or Electron objects: every method is a
 * named channel with a plain-data payload, and the renderer gets no way
 * to name a channel of its own.
 */
const api: AppApi = {
  connectivity: {
    getStatus: (): Promise<ConnectivityState> => ipcRenderer.invoke('connectivity:get-status'),

    startMonitoring: (): Promise<ConnectivityState> =>
      ipcRenderer.invoke('connectivity:start-monitoring'),

    stopMonitoring: (): Promise<ConnectivityState> =>
      ipcRenderer.invoke('connectivity:stop-monitoring'),

    onStatusChanged: (callback: (state: ConnectivityState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: ConnectivityState): void => callback(state)
      ipcRenderer.on('connectivity:status-changed', listener)
      // Removes this exact listener, so repeated subscribe/unsubscribe
      // cycles (React strict mode, remounts) can't leave duplicates
      // behind or tear down someone else's subscription.
      return () => {
        ipcRenderer.removeListener('connectivity:status-changed', listener)
      }
    },
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (partial: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:update', partial),
    getAutostart: (): Promise<boolean> => ipcRenderer.invoke('settings:get-autostart'),
    setAutostart: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke('settings:set-autostart', enabled),
  },

  history: {
    get: (): Promise<HistoryEvent[]> => ipcRenderer.invoke('history:get'),
  },
}

contextBridge.exposeInMainWorld('api', api)

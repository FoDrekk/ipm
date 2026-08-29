import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ConnectivityState } from './services/monitor.service'
import type { AppSettings, HistoryEvent } from './services/storage.service'

const connectivityApi = {
  getStatus: (): Promise<ConnectivityState> => ipcRenderer.invoke('connectivity:get-status'),

  startMonitoring: (): Promise<ConnectivityState> =>
    ipcRenderer.invoke('connectivity:start-monitoring'),

  stopMonitoring: (): Promise<ConnectivityState> =>
    ipcRenderer.invoke('connectivity:stop-monitoring'),

  onStatusChanged: (callback: (state: ConnectivityState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: ConnectivityState) => callback(state)
    ipcRenderer.on('connectivity:status-changed', listener)
    return () => ipcRenderer.removeListener('connectivity:status-changed', listener)
  },
}

const settingsApi = {
  getAutostart: (): Promise<boolean> => ipcRenderer.invoke('settings:get-autostart'),
  setAutostart: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:set-autostart', enabled),
  get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  update: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', partial),
}

const historyApi = {
  get: (): Promise<HistoryEvent[]> => ipcRenderer.invoke('history:get'),
}

contextBridge.exposeInMainWorld('api', {
  connectivity: connectivityApi,
  settings: settingsApi,
  history: historyApi,
})

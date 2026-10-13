import type {
  AlarmMode,
  AppApi,
  AppSettings,
  ConnectivityState,
  ConnectivityStats,
  ConnectivityStatus,
  DailyBucket,
  HistoryEvent,
  HistoryStatus,
  LatencySample,
  RetryStrategy,
  StatsRange,
  UpdateStatus,
} from '../../electron/shared/types'

export type {
  AlarmMode,
  AppSettings,
  ConnectivityState,
  ConnectivityStats,
  ConnectivityStatus,
  DailyBucket,
  HistoryEvent,
  HistoryStatus,
  LatencySample,
  RetryStrategy,
  StatsRange,
  UpdateStatus,
}

declare global {
  interface Window {
    /** Injected by preload.ts via contextBridge. Optional on purpose:
     *  if the preload script ever fails to run, this is undefined rather
     *  than a bridge that throws on first use — see `bridge()` below. */
    api?: AppApi
  }
}

/**
 * Every call into the main process goes through here, so a missing
 * preload fails once, loudly, and with an explanation — instead of
 * "cannot read properties of undefined" from whichever component
 * happened to call first. Callers already handle a rejected promise.
 */
function bridge(): AppApi {
  const api = window.api
  if (!api) {
    throw new Error('Preload bridge unavailable: window.api was not exposed by the main process.')
  }
  return api
}

export function getConnectivityStatus(): Promise<ConnectivityState> {
  return bridge().connectivity.getStatus()
}

export function startMonitoring(): Promise<ConnectivityState> {
  return bridge().connectivity.startMonitoring()
}

export function stopMonitoring(): Promise<ConnectivityState> {
  return bridge().connectivity.stopMonitoring()
}

export function subscribeToConnectivityStatus(
  callback: (state: ConnectivityState) => void
): () => void {
  return bridge().connectivity.onStatusChanged(callback)
}

export function getSettings(): Promise<AppSettings> {
  return bridge().settings.get()
}

export function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  return bridge().settings.update(partial)
}

export function getAutostart(): Promise<boolean> {
  return bridge().settings.getAutostart()
}

export function setAutostart(enabled: boolean): Promise<boolean> {
  return bridge().settings.setAutostart(enabled)
}

export function getHistory(): Promise<HistoryEvent[]> {
  return bridge().history.get()
}

export function exportHistoryCsv(): Promise<string> {
  return bridge().history.exportCsv()
}

export function getStats(range?: StatsRange): Promise<ConnectivityStats> {
  return bridge().stats.get(range)
}

export function getDailyStats(days?: number): Promise<DailyBucket[]> {
  return bridge().stats.getDaily(days)
}

export function getLatency(): Promise<LatencySample[]> {
  return bridge().latency.get()
}

export function pickAlarmFile(): Promise<string | null> {
  return bridge().settings.pickAlarmFile()
}

export function checkForUpdates(): Promise<UpdateStatus> {
  return bridge().updater.check()
}

export function quitAndInstall(): Promise<void> {
  return bridge().updater.quitAndInstall()
}

export function getLogs(): Promise<string> {
  return bridge().logs.get()
}

export function setSimulatedOffline(enabled: boolean): Promise<ConnectivityState> {
  return bridge().diagnostics.setSimulatedOffline(enabled)
}

export function testNotification(): Promise<boolean> {
  return bridge().diagnostics.testNotification()
}

export function testTray(): Promise<boolean> {
  return bridge().diagnostics.testTray()
}

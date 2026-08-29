import { useState } from 'react'
import type { AppSettings } from './ipc/ipc-client'
import { useSettings } from './hooks/useSettings'
import { useExitTransition } from './hooks/useExitTransition'
import { useOfflineAlarm } from './hooks/useOfflineAlarm'
import { useConnectivityBridge, useConnectivityStore } from './state/connectivity.store'
import Dashboard from './pages/Dashboard'
import SettingsPanel from './pages/SettingsPanel'
import OfflineOverlay from './components/OfflineOverlay'

type View = 'dashboard' | 'settings'

// Long enough for the overlay's fade-out to finish before it unmounts;
// matches .animate-overlay-exit in index.css.
const OVERLAY_EXIT_MS = 200

/** Stand-in for the moment before settings have loaded, when there is
 *  nothing to sound an alarm about anyway. Keeps the alarm hook's call
 *  unconditional without letting it make noise on a guess. */
const SILENT_SETTINGS: AppSettings = {
  alarm: { enabled: false, volume: 0, sound: 'classic-beep' },
  notifications: { enabled: false, cooldownMs: 0 },
  monitoring: { intervalMs: 10_000, retryStrategy: 'normal' },
}

/**
 * The app root owns the three things that must outlive any single
 * screen: the connectivity subscription, the alarm, and the offline
 * overlay. They used to live inside the dashboard, which meant opening
 * Settings during an outage silently tore all three down — status
 * updates stopped arriving, the alarm went quiet, and the full-screen
 * alert vanished. Screens below here are pure UI.
 *
 * There is no offline delay in this file. The main process already
 * refuses to report OFFLINE until it has confirmed one, so a second
 * delay here would only be a slower copy of that decision — and a
 * second place for it to get stuck.
 */
export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const { settings, updateSettings, justSaved } = useSettings()

  useConnectivityBridge()
  const status = useConnectivityStore((state) => state.status)
  const isMonitoring = useConnectivityStore((state) => state.isMonitoring)
  const offlineSince = useConnectivityStore((state) => state.offlineSince)

  // Only alert while actively monitoring: a paused monitor's last known
  // status is history, not a live alarm condition.
  const isOffline = isMonitoring && status === 'OFFLINE'
  const showOverlay = useExitTransition(isOffline, OVERLAY_EXIT_MS)

  // Hooks must run unconditionally, so the alarm is wired up before the
  // loading early-return below. It stays silent until settings load,
  // since `isOffline` cannot be true before the first status arrives.
  const { isSnoozed, snooze } = useOfflineAlarm(isOffline, settings ?? SILENT_SETTINGS)

  // Settings load over local IPC, so this is brief — just enough to
  // avoid rendering controls with defaults that don't match what is
  // persisted. Matches the app background, so there is no flash.
  if (!settings) {
    return <div className="h-screen w-screen bg-slate-950" />
  }

  return (
    <>
      {view === 'settings' ? (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          onBack={() => setView('dashboard')}
          justSaved={justSaved}
        />
      ) : (
        <Dashboard onOpenSettings={() => setView('settings')} />
      )}

      {showOverlay && (
        <OfflineOverlay
          isActive={isOffline}
          offlineSince={offlineSince}
          settings={settings}
          onUpdateSettings={updateSettings}
          isSnoozed={isSnoozed}
          onSnooze={snooze}
        />
      )}
    </>
  )
}

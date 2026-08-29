import { useEffect } from 'react'
import { useConnectivityStore } from '../state/connectivity.store'
import {
  getConnectivityStatus,
  subscribeToConnectivityStatus,
  type AppSettings,
} from '../ipc/ipc-client'
import { useRelativeTime } from '../hooks/useRelativeTime'
import { useEnterDelay } from '../hooks/useEnterDelay'
import { useExitTransition } from '../hooks/useExitTransition'
import StatusCard from '../components/StatusCard'
import StatusIndicator from '../components/StatusIndicator'
import ToggleSwitch from '../components/ToggleSwitch'
import OfflineOverlay from '../components/OfflineOverlay'
import MiniStatusBadge from '../components/MiniStatusBadge'

// The fullscreen overlay (and the alarm inside it) only appears after
// OFFLINE has held continuously for this long — status text/badge still
// update immediately regardless, only the disruptive full-screen part
// waits, so a connection blip that clears within the window never
// triggers the "nuclear option."
const OVERLAY_ENTER_DELAY_MS = 2_000
const OVERLAY_EXIT_MS = 200

interface DashboardProps {
  settings: AppSettings
  onOpenSettings: () => void
  onUpdateSettings: (partial: Partial<AppSettings>) => void
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="15" cy="7" r="2.2" fill="currentColor" />
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="12" r="2.2" fill="currentColor" />
      <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="17" r="2.2" fill="currentColor" />
    </svg>
  )
}

export default function Dashboard({ settings, onOpenSettings, onUpdateSettings }: DashboardProps) {
  const status = useConnectivityStore((state) => state.status)
  const lastChecked = useConnectivityStore((state) => state.lastChecked)
  const offlineSince = useConnectivityStore((state) => state.offlineSince)
  const statusChangedAt = useConnectivityStore((state) => state.statusChangedAt)
  const isMonitoring = useConnectivityStore((state) => state.isMonitoring)
  const applyState = useConnectivityStore((state) => state.applyState)
  const setMonitoring = useConnectivityStore((state) => state.setMonitoring)

  const relativeTime = useRelativeTime(lastChecked)
  const lastCheckedLabel = lastChecked ? relativeTime : isMonitoring ? 'Checking…' : 'Not started'

  // Only alert while actively monitoring — if the user paused monitoring,
  // a stale OFFLINE reading shouldn't leave a fullscreen alarm parked on
  // screen (StatusIndicator already applies this same guard for its own
  // paused view; this keeps the overlay consistent with it).
  const isOffline = isMonitoring && status === 'OFFLINE'

  // The overlay only shows once OFFLINE has held for OVERLAY_ENTER_DELAY_MS
  // (useEnterDelay), and then stays mounted up to OVERLAY_EXIT_MS after
  // that delayed signal goes false so it can fade out instead of
  // vanishing instantly (useExitTransition). overlayReady — not raw
  // isOffline — is what's passed down as isActive, so useAlarm inside
  // the overlay naturally inherits the same entrance delay: alarm and
  // visual appear together, not sound-before-you-see-why.
  const overlayReady = useEnterDelay(isOffline, OVERLAY_ENTER_DELAY_MS)
  const showOverlay = useExitTransition(overlayReady, OVERLAY_EXIT_MS)

  useEffect(() => {
    let cancelled = false

    getConnectivityStatus()
      .then((state) => {
        if (!cancelled) applyState(state)
      })
      .catch((error: unknown) => {
        console.error('[Dashboard] Failed to fetch initial status:', error)
      })

    const unsubscribe = subscribeToConnectivityStatus((state) => {
      try {
        applyState(state)
      } catch (error) {
        console.error('[Dashboard] Failed to apply pushed status:', error)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyState])

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950">
      <div className="flex items-center justify-between px-5 pt-5">
        <MiniStatusBadge status={status} isMonitoring={isMonitoring} statusChangedAt={statusChangedAt} />
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-lg p-2 text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-200 active:scale-95"
          aria-label="Open settings"
        >
          <SettingsIcon />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <StatusCard>
          <StatusIndicator status={status} isMonitoring={isMonitoring} />

          <p className="text-sm text-slate-500">
            Last checked: <span className="text-slate-300">{lastCheckedLabel}</span>
          </p>

          <div className="h-px w-full bg-slate-800" />

          <ToggleSwitch checked={isMonitoring} onChange={setMonitoring} label="Monitoring" />
        </StatusCard>
      </div>

      {showOverlay && (
        <OfflineOverlay
          isActive={overlayReady}
          offlineSince={offlineSince}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}
    </div>
  )
}

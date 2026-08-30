/**
 * The single source of truth for every type that crosses the IPC
 * boundary. Both the main process and the renderer import from here, so
 * a change to a payload shape is a compile error on both sides at once
 * rather than a silent mismatch at runtime.
 *
 * Deliberately free of `electron` and `node:*` imports: the renderer
 * type-checks this file too, and it is bundled into the renderer for the
 * few plain-data constants below (defaults, presets, the shallow merge).
 */

// ---- connectivity ------------------------------------------------------

/** Statuses the monitor's state machine actually settles into. */
export type ConfirmedStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE'

/**
 * Everything the UI can be shown. VERIFYING is not a verdict — it means
 * "a failure is being confirmed, or no verdict exists yet". It never
 * becomes a confirmed status, never reaches history, and never triggers
 * the alarm, the overlay, or a notification.
 */
export type ConnectivityStatus = ConfirmedStatus | 'VERIFYING'

export interface ConnectivityState {
  status: ConnectivityStatus
  /** When the most recent probe completed; null before the first one. */
  lastChecked: string | null
  /** Start of the current genuine OFFLINE stretch — the first failed
   *  probe of the streak that confirmed it, not the moment the verdict
   *  landed. Null whenever the status isn't OFFLINE. */
  offlineSince: string | null
  /** When the currently reported status began. Distinct from
   *  lastChecked, which advances on every probe. Null before the first
   *  transition. */
  statusChangedAt: string | null
  isMonitoring: boolean
  /** Round-trip to the checked endpoint on the most recent successful
   *  probe, in milliseconds — connection setup excluded, so it is
   *  comparable to a ping rather than to a page load. Null when no probe
   *  has succeeded yet this cycle, or while the connection is confirmed
   *  down. Purely informational: latency never influences the verdict. */
  latencyMs: number | null
  /** True while Diagnostics is forcing probe failures. The state machine
   *  is running normally underneath — only the probe results are faked —
   *  but the UI has to say so, or a simulated outage is indistinguishable
   *  from a real one. */
  isSimulated: boolean
}

// ---- latency -----------------------------------------------------------

export type LatencyQuality = 'EXCELLENT' | 'GOOD' | 'HIGH' | 'VERY_HIGH'

/** Buckets a round-trip time for display. Deliberately separate from the
 *  monitor's `slowResponseMs`: that one decides whether the connection is
 *  behaving badly enough to call DEGRADED, this one is only a label. */
export function latencyQuality(latencyMs: number): LatencyQuality {
  if (latencyMs < 50) return 'EXCELLENT'
  if (latencyMs < 100) return 'GOOD'
  if (latencyMs < 200) return 'HIGH'
  return 'VERY_HIGH'
}

export const LATENCY_QUALITY_LABELS: Record<LatencyQuality, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  HIGH: 'High',
  VERY_HIGH: 'Very high',
}

// ---- durations ---------------------------------------------------------

/** Compact human-readable duration ("45s", "4m 12s", "2h 5m"). Shared so
 *  a downtime figure reads the same in a notification and on screen. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`
}

// ---- settings ----------------------------------------------------------

export type AlarmSound = 'classic-beep' | 'gentle-chime' | 'urgent-siren'

export type RetryStrategy = 'normal' | 'aggressive'

/** How the alarm behaves for the length of one outage. `continuous`
 *  keeps sounding and escalating until the connection is back; `once`
 *  is a single alert burst when the outage is confirmed. */
export type AlarmMode = 'continuous' | 'once'

export interface AppSettings {
  alarm: {
    enabled: boolean
    volume: number // 0-100
    sound: AlarmSound
    mode: AlarmMode
  }
  notifications: {
    enabled: boolean
    cooldownMs: number
  }
  monitoring: {
    intervalMs: number
    retryStrategy: RetryStrategy
  }
  startup: {
    /** Begin monitoring as soon as the app launches, rather than waiting
     *  for the dashboard toggle. */
    startMonitoring: boolean
    /** Launch straight into the tray with no visible window. The
     *  renderer still loads, so the alarm and the offline alert work
     *  exactly the same — the window is simply not shown. */
    startMinimized: boolean
  }
}

/**
 * What one entry in the connectivity timeline records. PAUSED is not a
 * connectivity verdict — it marks the stretches where monitoring was off
 * (or the app was not running), which statistics must exclude rather than
 * silently credit as uptime.
 */
export type HistoryStatus = ConfirmedStatus | 'PAUSED'

export interface HistoryEvent {
  status: HistoryStatus
  at: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  alarm: { enabled: true, volume: 70, sound: 'classic-beep', mode: 'continuous' },
  notifications: { enabled: true, cooldownMs: 10_000 },
  monitoring: { intervalMs: 10_000, retryStrategy: 'normal' },
  startup: { startMonitoring: true, startMinimized: false },
}

/** How long a single alert lasts in `once` alarm mode. One playthrough of
 *  a roughly one-second sample is easy to miss entirely, which would make
 *  the mode useless; a short burst is what "alert me once" has to mean to
 *  be worth having. */
export const ONCE_ALARM_DURATION_MS = 3_000

/**
 * How hard the monitor works to tell a blip apart from a real outage.
 * These are the ONLY knobs the state machine has — there is no separate
 * debounce timer or transition cooldown layered on top, so there is
 * nothing for them to fight with.
 */
export interface RetryProfile {
  /** Consecutive failed probes required before OFFLINE is confirmed. */
  failureThreshold: number
  /** Consecutive successful probes required to confirm recovery. */
  recoveryThreshold: number
  /** Per-probe network timeout. */
  requestTimeoutMs: number
  /** Poll delay while confirming a loss, or while offline and waiting
   *  for recovery — faster than the idle interval so verdicts are
   *  reached promptly instead of one slow interval at a time. */
  verifyIntervalMs: number
  /** How long after the last instability the connection keeps reading
   *  DEGRADED before it is trusted as fully ONLINE again. */
  degradedGraceMs: number
  /** A probe that succeeds but takes longer than this counts as an
   *  unstable-network signal (not a failure). */
  slowResponseMs: number
}

export const RETRY_STRATEGY_PRESETS: Record<RetryStrategy, RetryProfile> = {
  normal: {
    failureThreshold: 3,
    recoveryThreshold: 2,
    requestTimeoutMs: 5_000,
    verifyIntervalMs: 2_000,
    degradedGraceMs: 60_000,
    slowResponseMs: 3_000,
  },
  aggressive: {
    failureThreshold: 2,
    recoveryThreshold: 1,
    requestTimeoutMs: 3_000,
    verifyIntervalMs: 1_000,
    degradedGraceMs: 30_000,
    slowResponseMs: 2_000,
  },
}

/**
 * Shallow per-category merge of a partial settings patch onto a full
 * settings object. Shared so the renderer's optimistic update and the
 * main process's persisted result are produced by the same rule — if
 * they disagreed, every save would visibly correct the UI a moment
 * later. Tolerates a malformed patch (the renderer is not trusted
 * input); anything nonsensical that survives here is still range-checked
 * by the storage layer's validation before it is persisted.
 */
export function mergeSettings(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const safe = isRecord(patch) ? patch : {}
  return {
    alarm: { ...base.alarm, ...pickRecord(safe.alarm) },
    notifications: { ...base.notifications, ...pickRecord(safe.notifications) },
    monitoring: { ...base.monitoring, ...pickRecord(safe.monitoring) },
    startup: { ...base.startup, ...pickRecord(safe.startup) },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

// ---- statistics --------------------------------------------------------

/**
 * Uptime/downtime figures for one window of time, derived entirely from
 * the connectivity timeline — there is no separate metrics store to fall
 * out of sync with history, and nothing new to persist.
 */
export interface ConnectivityStats {
  /** Start of the window these numbers cover. */
  windowStart: string
  /** Earliest moment in the window there is actual data for, or null if
   *  there is none. Anything before it was never measured, so the
   *  percentages describe [measuredFrom, now], not the whole window. */
  measuredFrom: string | null
  /** Time in the window that was actually monitored: the denominator.
   *  Excludes stretches where monitoring was off or the app was closed. */
  monitoredMs: number
  onlineMs: number
  degradedMs: number
  offlineMs: number
  /** Share of monitored time the connection was usable — DEGRADED counts
   *  as up, because the connection worked. Null when nothing in the
   *  window was monitored, which is not the same as 0%. */
  uptimePercent: number | null
  /** Distinct outages overlapping the window. An outage that began
   *  yesterday and is still running counts once, today. */
  outageCount: number
  longestOutageMs: number
}

// ---- the preload bridge ------------------------------------------------

/**
 * The complete API surface exposed to the renderer. preload.ts is typed
 * against this, and the renderer's `window.api` declaration reuses it,
 * so neither side can add, remove, or reshape a method alone.
 */
export interface AppApi {
  connectivity: {
    getStatus: () => Promise<ConnectivityState>
    startMonitoring: () => Promise<ConnectivityState>
    stopMonitoring: () => Promise<ConnectivityState>
    /** Returns an unsubscribe function. */
    onStatusChanged: (callback: (state: ConnectivityState) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (partial: Partial<AppSettings>) => Promise<AppSettings>
    getAutostart: () => Promise<boolean>
    /** Resolves with the setting actually in effect afterwards, which
     *  may differ from what was requested if the OS refused it. */
    setAutostart: (enabled: boolean) => Promise<boolean>
  }
  history: {
    get: () => Promise<HistoryEvent[]>
  }
  stats: {
    /** Uptime/downtime for the current local day, computed in the main
     *  process from the same history the timeline is built from. */
    get: () => Promise<ConnectivityStats>
  }
  diagnostics: {
    /** Forces the connectivity engine's probes to fail (or stops doing
     *  so) without altering the engine itself, so the real offline path
     *  runs end to end. Resolves with the resulting state. */
    setSimulatedOffline: (enabled: boolean) => Promise<ConnectivityState>
    /** Shows a notification immediately, bypassing the transition and
     *  cooldown rules — the point is to prove delivery works. */
    testNotification: () => Promise<boolean>
    /** Briefly cycles the tray through its icons, then restores the
     *  real one. Resolves false if there is no tray to test. */
    testTray: () => Promise<boolean>
  }
}

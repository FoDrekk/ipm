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
}

// ---- settings ----------------------------------------------------------

export type AlarmSound = 'classic-beep' | 'gentle-chime' | 'urgent-siren'

export type RetryStrategy = 'normal' | 'aggressive'

export interface AppSettings {
  alarm: {
    enabled: boolean
    volume: number // 0-100
    sound: AlarmSound
  }
  notifications: {
    enabled: boolean
    cooldownMs: number
  }
  monitoring: {
    intervalMs: number
    retryStrategy: RetryStrategy
  }
}

export interface HistoryEvent {
  status: ConfirmedStatus
  at: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  alarm: { enabled: true, volume: 70, sound: 'classic-beep' },
  notifications: { enabled: true, cooldownMs: 10_000 },
  monitoring: { intervalMs: 10_000, retryStrategy: 'normal' },
}

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
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
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
}

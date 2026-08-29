import https from 'node:https'

/** Statuses the internal state machine actually settles into. */
export type ConfirmedStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE'

/** Everything the UI can be shown — confirmed statuses plus the
 *  transient grace period while a failure is being verified. */
export type ConnectivityStatus = ConfirmedStatus | 'VERIFYING'

export interface ConnectivityState {
  status: ConnectivityStatus
  lastChecked: string | null
  /** When the current OFFLINE stretch began; null whenever not OFFLINE. */
  offlineSince: string | null
  /** When the confirmed status last actually changed; null before the
   *  first transition. Distinct from lastChecked, which advances on
   *  every probe regardless of whether the status changed. */
  statusChangedAt: string | null
  isMonitoring: boolean
}

interface MonitorServiceOptions {
  intervalMs?: number
  checkUrl?: string
  requestTimeoutMs?: number
  /** How long a failure is held in VERIFYING before it's trusted. */
  offlineDebounceMs?: number
  /** Minimum time between two reported status changes, to damp flapping. */
  transitionCooldownMs?: number
  onStatusChange?: (state: ConnectivityState) => void
}

const DEFAULT_INTERVAL_MS = 10_000
const DEFAULT_CHECK_URL = 'https://www.google.com'
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const DEFAULT_OFFLINE_DEBOUNCE_MS = 3_000
const DEFAULT_TRANSITION_COOLDOWN_MS = 5_000

/**
 * Polls a well-known HTTPS endpoint on a fixed interval to determine
 * whether the machine currently has internet connectivity.
 *
 * State machine, in four parts:
 *  - probe(): pure network I/O — did one HTTPS request succeed or not.
 *  - handleProbeResult(): decides what a probe result MEANS — a single
 *    failure enters VERIFYING (offlineDebounceMs) rather than being
 *    trusted immediately, since a one-off blip isn't "the internet is
 *    down". VERIFYING is display-only — it never becomes previousStatus,
 *    so it can't distort the real ONLINE/DEGRADED/OFFLINE comparisons.
 *  - commitStatus(): decides what actually gets REPORTED as the
 *    confirmed status — applies the transition cooldown so a flapping
 *    connection doesn't visibly thrash, tracks offlineSince, then logs
 *    and notifies only on a real, allowed change.
 *  - notify(): the single, safe path every status push goes through.
 */
export class MonitorService {
  private intervalMs: number
  private readonly checkUrl: string
  private requestTimeoutMs: number
  private offlineDebounceMs: number
  private transitionCooldownMs: number
  private readonly onStatusChange?: (state: ConnectivityState) => void

  private timer: NodeJS.Timeout | null = null
  private offlineConfirmTimer: NodeJS.Timeout | null = null
  private isVerifying = false
  private lastTransitionAt = 0
  private state: {
    status: ConfirmedStatus
    lastChecked: string | null
    offlineSince: string | null
  } = {
    status: 'OFFLINE',
    lastChecked: null,
    offlineSince: null,
  }

  constructor(options: MonitorServiceOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.checkUrl = options.checkUrl ?? DEFAULT_CHECK_URL
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.offlineDebounceMs = options.offlineDebounceMs ?? DEFAULT_OFFLINE_DEBOUNCE_MS
    this.transitionCooldownMs = options.transitionCooldownMs ?? DEFAULT_TRANSITION_COOLDOWN_MS
    this.onStatusChange = options.onStatusChange
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.runCheck(), this.intervalMs)
    this.runCheck()
    this.notify()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.cancelPendingOfflineConfirmation()
    this.notify()
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  getState(): ConnectivityState {
    return {
      status: this.isVerifying ? 'VERIFYING' : this.state.status,
      lastChecked: this.state.lastChecked,
      offlineSince: this.state.offlineSince,
      statusChangedAt: this.lastTransitionAt > 0 ? new Date(this.lastTransitionAt).toISOString() : null,
      isMonitoring: this.isRunning(),
    }
  }

  /** Applies new tunables to a service that may already be running —
   *  used when the user changes monitoring settings live. Does not touch
   *  checkUrl (not a user-facing setting) or restart any in-flight
   *  VERIFYING cycle; it'll pick up the new values on its next probe. */
  updateConfig(options: {
    intervalMs?: number
    requestTimeoutMs?: number
    offlineDebounceMs?: number
    transitionCooldownMs?: number
  }): void {
    if (options.intervalMs !== undefined) this.intervalMs = options.intervalMs
    if (options.requestTimeoutMs !== undefined) this.requestTimeoutMs = options.requestTimeoutMs
    if (options.offlineDebounceMs !== undefined) this.offlineDebounceMs = options.offlineDebounceMs
    if (options.transitionCooldownMs !== undefined) {
      this.transitionCooldownMs = options.transitionCooldownMs
    }

    // Restart the interval so a new check cadence takes effect right
    // away instead of waiting out whatever's left of the old one.
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this.runCheck(), this.intervalMs)
    }
  }

  // ---- network I/O ----------------------------------------------------

  /** Runs one HTTPS probe. Never throws — reports failure instead. */
  private probe(onResult: (succeeded: boolean) => void): void {
    try {
      let settled = false

      const request = https.get(this.checkUrl, { timeout: this.requestTimeoutMs }, (response) => {
        // Headers received: the network path is confirmed up. Drop the
        // body immediately — we don't need the page content.
        response.destroy()
        if (settled) return
        settled = true
        onResult(true)
      })

      request.on('timeout', () => {
        request.destroy(new Error('Connectivity check timed out'))
      })

      request.on('error', () => {
        if (settled) return
        settled = true
        onResult(false)
      })
    } catch {
      // Couldn't even start the request (e.g. a malformed checkUrl) —
      // that's a failure like any other, not a crash.
      onResult(false)
    }
  }

  private runCheck(): void {
    const isFirstCheck = this.state.lastChecked === null
    this.probe((succeeded) => this.handleProbeResult(succeeded, isFirstCheck))
  }

  // ---- interpreting a probe result -------------------------------------

  private handleProbeResult(succeeded: boolean, isFirstCheck: boolean): void {
    if (succeeded) {
      this.cancelPendingOfflineConfirmation()
      this.commitStatus('ONLINE', isFirstCheck)
      return
    }

    // Nothing to verify against yet, or we're already confirmed down —
    // report immediately.
    if (isFirstCheck || this.state.status === 'OFFLINE') {
      this.commitStatus('OFFLINE', isFirstCheck)
      return
    }

    // A single failure from ONLINE/DEGRADED might just be a blip. Show
    // the user we're checking rather than immediately alarming them.
    this.enterVerifying()
  }

  private enterVerifying(): void {
    if (this.offlineConfirmTimer) return // already verifying a failure

    this.isVerifying = true
    // Deliberately bypasses the transition cooldown and goes straight to
    // notify() — this is transient UI feedback ("we're checking"), not a
    // confirmed status change, so nothing about holding it back applies.
    this.notify()

    this.offlineConfirmTimer = setTimeout(() => {
      this.offlineConfirmTimer = null
      this.probe((succeeded) => {
        this.isVerifying = false
        // Recovered by the time we re-checked — but a real failure DID
        // just happen, so this is a degraded connection, not a clean one.
        this.commitStatus(succeeded ? 'DEGRADED' : 'OFFLINE', false)
      })
    }, this.offlineDebounceMs)
  }

  private cancelPendingOfflineConfirmation(): void {
    if (this.offlineConfirmTimer) {
      clearTimeout(this.offlineConfirmTimer)
      this.offlineConfirmTimer = null
    }
    this.isVerifying = false
  }

  // ---- committing + reporting a status --------------------------------

  private commitStatus(observedStatus: ConfirmedStatus, isFirstCheck: boolean): void {
    const previousStatus = this.state.status
    const wantsTransition = isFirstCheck || observedStatus !== previousStatus
    const cooldownBlocksIt = wantsTransition && !isFirstCheck && !this.cooldownElapsed()

    // Cooldown active: hold the previous status for display, but the
    // check still genuinely happened, so lastChecked still advances below.
    const nextStatus = cooldownBlocksIt ? previousStatus : observedStatus
    const didTransition = isFirstCheck || nextStatus !== previousStatus

    this.state = {
      status: nextStatus,
      lastChecked: new Date().toISOString(),
      offlineSince: this.nextOfflineSince(nextStatus, previousStatus),
    }

    if (didTransition) {
      this.lastTransitionAt = Date.now()
      this.notify()
    }
  }

  /** Starts the offline clock on a fresh drop, holds it steady while
   *  still down, and clears it the moment we're not fully OFFLINE. */
  private nextOfflineSince(nextStatus: ConfirmedStatus, previousStatus: ConfirmedStatus): string | null {
    if (nextStatus !== 'OFFLINE') return null
    return previousStatus === 'OFFLINE' ? this.state.offlineSince : new Date().toISOString()
  }

  private cooldownElapsed(): boolean {
    return Date.now() - this.lastTransitionAt >= this.transitionCooldownMs
  }

  private notify(): void {
    try {
      this.onStatusChange?.(this.getState())
    } catch (error) {
      console.error('[MonitorService] onStatusChange listener threw:', error)
    }
  }
}

import https from 'node:https'
import type {
  ConfirmedStatus,
  ConnectivityState,
  ConnectivityStatus,
  RetryProfile,
} from '../shared/types'
import { RETRY_STRATEGY_PRESETS } from '../shared/types'

export type { ConfirmedStatus, ConnectivityState, ConnectivityStatus }

/** Called after every probe, and on start/stop. `statusChanged` is true
 *  only when the reported status actually differs from the previous
 *  report — the signal for one-shot side effects (notification, history,
 *  tray icon) as opposed to the continuous state push to the renderer. */
export type MonitorListener = (state: ConnectivityState, statusChanged: boolean) => void

interface MonitorServiceOptions {
  intervalMs?: number
  profile?: RetryProfile
  /** Probed round-robin; overridable for tests. */
  endpoints?: readonly string[]
  onUpdate?: MonitorListener
}

const DEFAULT_INTERVAL_MS = 10_000
const MIN_SCHEDULE_MS = 500

/** What one probe learned. The two timings answer different questions and
 *  are deliberately not the same number: `totalMs` is how long the whole
 *  request took including DNS and connection setup, which is what "the
 *  connection feels slow" means and what the DEGRADED check uses;
 *  `roundTripMs` is the server round-trip once connected, which is what
 *  a latency reading should show. */
interface ProbeOutcome {
  ok: boolean
  totalMs: number
  roundTripMs: number | null
}

/**
 * Rotated one per probe rather than hammering a single host. A provider
 * outage, a poisoned DNS entry, or one CDN edge having a bad minute then
 * cannot produce the consecutive-failure streak that OFFLINE requires —
 * confirming an outage means several different, independently operated
 * endpoints all failed in a row.
 */
const DEFAULT_ENDPOINTS = [
  'https://www.gstatic.com/generate_204',
  'https://cloudflare.com/cdn-cgi/trace',
  'https://www.msftconnecttest.com/connecttest.txt',
] as const

/**
 * Decides whether this machine currently has internet access, by polling
 * small well-known HTTPS endpoints.
 *
 * The whole engine is one loop and one verdict rule:
 *
 *  - A single self-scheduling timer. The next probe is only scheduled
 *    once the previous one has resolved, so two probes can never be in
 *    flight and start() twice cannot produce two loops.
 *  - Verdicts come from consecutive-result streaks, nothing else. A
 *    failure does not mean OFFLINE; `failureThreshold` failures in a row
 *    does. A success while OFFLINE does not mean ONLINE;
 *    `recoveryThreshold` successes in a row does. That single rule is
 *    what absorbs packet loss, DNS hiccups, adapter transitions and slow
 *    responses — there is no second debounce timer or transition
 *    cooldown that could disagree with it.
 *  - VERIFYING is derived, never stored: it is simply "a failure streak
 *    is open, or no verdict exists yet". It cannot get stuck, because
 *    there is no state to get stuck in.
 *  - Every probe result carries the `runId` it was started under. stop()
 *    and start() bump that id, so a reply arriving from a previous
 *    monitoring cycle is discarded instead of mutating fresh state.
 */
export class MonitorService {
  private intervalMs: number
  private profile: RetryProfile
  private readonly endpoints: readonly string[]
  private readonly onUpdate?: MonitorListener

  private timer: NodeJS.Timeout | null = null
  private running = false
  private probeInFlight = false
  private runId = 0
  private endpointIndex = 0

  /** null until the first probe of a monitoring cycle produces a verdict. */
  private confirmed: ConfirmedStatus | null = null
  private failureStreak = 0
  private successStreak = 0
  private firstFailureAt: number | null = null
  private lastInstabilityAt: number | null = null
  private lastChecked: number | null = null
  private offlineSince: number | null = null
  private statusChangedAt: number | null = null
  private reportedStatus: ConnectivityStatus = 'VERIFYING'
  private latencyMs: number | null = null
  private simulateOffline = false

  constructor(options: MonitorServiceOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.profile = options.profile ?? RETRY_STRATEGY_PRESETS.normal
    this.endpoints = options.endpoints?.length ? options.endpoints : DEFAULT_ENDPOINTS
    this.onUpdate = options.onUpdate
  }

  // ---- lifecycle -------------------------------------------------------

  /** Idempotent: starting an already-running monitor does nothing at all
   *  (no extra timer, no extra probe, no duplicate report). */
  start(): void {
    if (this.running) return
    this.running = true
    this.beginCycle()
    this.publish()
    this.tick()
  }

  /** Idempotent, and total: the timer is cleared and any in-flight probe
   *  is orphaned by the runId bump, so no monitoring activity of any
   *  kind survives this call. */
  stop(): void {
    if (!this.running) return
    this.running = false
    this.clearTimer()
    this.runId += 1
    this.probeInFlight = false
    this.resetStreaks()
    this.publish()
  }

  isRunning(): boolean {
    return this.running
  }

  getState(): ConnectivityState {
    const status = this.deriveStatus()
    return {
      status,
      lastChecked: toIso(this.lastChecked),
      offlineSince: status === 'OFFLINE' ? toIso(this.offlineSince) : null,
      statusChangedAt: toIso(this.statusChangedAt),
      isMonitoring: this.running,
      latencyMs: status === 'OFFLINE' ? null : this.latencyMs,
      isSimulated: this.simulateOffline,
    }
  }

  /**
   * Diagnostics: make every probe report failure without going near the
   * network. Nothing about the state machine changes — the same streaks,
   * thresholds, timings and transitions run — so the offline path being
   * exercised is the real one, and turning it back off recovers through
   * the real recovery path too.
   *
   * Deliberately in-memory only, and never persisted: a simulation that
   * outlived a restart would be indistinguishable from a broken app.
   */
  setSimulatedOffline(enabled: boolean): void {
    if (this.simulateOffline === enabled) return
    this.simulateOffline = enabled
    // Announce immediately so the UI can label the state as simulated
    // before the next probe lands, rather than a beat later.
    this.publish()
  }

  isSimulatingOffline(): boolean {
    return this.simulateOffline
  }

  /** Applies new tunables to a monitor that may already be running. A
   *  changed interval reschedules the pending probe immediately rather
   *  than waiting out the remainder of the old one. */
  updateConfig(options: { intervalMs?: number; profile?: RetryProfile }): void {
    const previousInterval = this.intervalMs
    if (options.intervalMs !== undefined) this.intervalMs = options.intervalMs
    if (options.profile !== undefined) this.profile = options.profile

    if (this.running && !this.probeInFlight && this.intervalMs !== previousInterval) {
      this.clearTimer()
      this.scheduleNext()
    }
  }

  /** Releases the timer so the process can exit cleanly. */
  dispose(): void {
    this.stop()
  }

  // ---- the loop --------------------------------------------------------

  private beginCycle(): void {
    // A fresh cycle knows nothing yet: no stale verdict, and no offline
    // clock covering a period this monitor wasn't watching. Reporting
    // VERIFYING until the first probe lands is what stops a cold start
    // from announcing a fake OFFLINE (and alarming about it).
    this.runId += 1
    this.confirmed = null
    this.offlineSince = null
    this.lastInstabilityAt = null
    this.latencyMs = null
    this.resetStreaks()
  }

  private resetStreaks(): void {
    this.failureStreak = 0
    this.successStreak = 0
    this.firstFailureAt = null
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(): void {
    if (!this.running || this.timer) return
    const base = this.isSettled() ? this.intervalMs : Math.min(this.profile.verifyIntervalMs, this.intervalMs)
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
    }, Math.max(MIN_SCHEDULE_MS, base))
  }

  /** True when nothing is pending confirmation, so the relaxed interval
   *  applies. While offline we stay on the faster cadence so recovery is
   *  noticed promptly — failed probes are cheap. */
  private isSettled(): boolean {
    return this.confirmed !== null && this.confirmed !== 'OFFLINE' && this.failureStreak === 0
  }

  private tick(): void {
    if (!this.running || this.probeInFlight) return

    const runId = this.runId
    const url = this.endpoints[this.endpointIndex % this.endpoints.length]
    this.endpointIndex = (this.endpointIndex + 1) % this.endpoints.length
    this.probeInFlight = true

    const complete = (outcome: ProbeOutcome): void => {
      // A reply from a monitoring cycle that has since been stopped or
      // restarted must not touch current state, or schedule anything.
      if (runId !== this.runId) return
      this.probeInFlight = false
      this.applyProbeResult(outcome)
      this.scheduleNext()
    }

    if (this.simulateOffline) {
      // Same code path as a real failure, minus the request.
      complete({ ok: false, totalMs: 0, roundTripMs: null })
      return
    }

    this.probe(url, complete)
  }

  // ---- network I/O -----------------------------------------------------

  /** One HTTPS probe. Never throws, and calls back exactly once. */
  private probe(url: string, done: (outcome: ProbeOutcome) => void): void {
    let settled = false
    const startedAt = Date.now()
    // Set once the connection is up, so the round-trip can be measured
    // without DNS and TLS setup in it. Stays null if those events can't
    // be observed, in which case there is no round-trip figure to report
    // rather than a misleadingly inflated one.
    let connectedAt: number | null = null

    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      done({
        ok,
        totalMs: Date.now() - startedAt,
        roundTripMs: ok && connectedAt !== null ? Date.now() - connectedAt : null,
      })
    }

    try {
      const request = https.get(
        url,
        {
          timeout: this.profile.requestTimeoutMs,
          // A fresh connection every time: a pooled socket that died
          // with the network would otherwise report success from cache
          // or fail for reasons unrelated to current connectivity.
          agent: false,
          headers: { 'cache-control': 'no-cache', accept: '*/*' },
        },
        (response) => {
          // Headers arrived, so the full DNS -> TCP -> TLS -> HTTP path
          // works. The body is irrelevant; drop it immediately.
          response.destroy()
          request.destroy()
          finish(true)
        }
      )

      request.on('socket', (socket) => {
        // A fresh socket every time (agent: false), so this fires before
        // the handshake completes and the timestamp is meaningful.
        socket.once('secureConnect', () => {
          connectedAt = Date.now()
        })
      })

      request.on('timeout', () => {
        request.destroy(new Error(`Connectivity probe timed out: ${url}`))
      })

      // Covers DNS failure, refused/reset connections, TLS errors and
      // the timeout above. All of them mean the same thing here.
      request.on('error', () => finish(false))
    } catch {
      // Could not even start the request (e.g. a malformed URL). That's
      // a failed probe, not a crash.
      finish(false)
    }
  }

  // ---- the verdict rule ------------------------------------------------

  private applyProbeResult(outcome: ProbeOutcome): void {
    const now = Date.now()
    this.lastChecked = now

    if (outcome.ok) {
      this.failureStreak = 0
      this.firstFailureAt = null
      this.successStreak += 1
      // Reported for display only. It is read after the verdict below,
      // never before it: latency has no say in whether we are online.
      if (outcome.roundTripMs !== null) this.latencyMs = outcome.roundTripMs
      // A response this slow is a working connection behaving badly —
      // an unstable-network signal, not an outage.
      if (outcome.totalMs >= this.profile.slowResponseMs) this.lastInstabilityAt = now
      this.applySuccess(now)
    } else {
      this.successStreak = 0
      this.failureStreak += 1
      this.lastInstabilityAt = now
      if (this.firstFailureAt === null) this.firstFailureAt = now
      this.applyFailure(now)
    }

    this.publish()
  }

  private applySuccess(now: number): void {
    if (this.confirmed === null) {
      // First verdict of the cycle. A success is unambiguous — there is
      // no prior state it could be contradicting — so it lands directly.
      this.setConfirmed('ONLINE', now)
      return
    }

    if (this.confirmed === 'OFFLINE') {
      // Recovery is verified the same way loss is: it takes a streak.
      // One success during an outage is exactly the kind of blip that
      // would otherwise make the status (and the alarm) flap.
      if (this.successStreak >= this.profile.recoveryThreshold) {
        this.setConfirmed('ONLINE', now)
      }
      return
    }

    // ONLINE or DEGRADED. Recent instability keeps it DEGRADED until the
    // connection has been clean for the whole grace window.
    const unstable =
      this.lastInstabilityAt !== null && now - this.lastInstabilityAt < this.profile.degradedGraceMs
    this.setConfirmed(unstable ? 'DEGRADED' : 'ONLINE', now)
  }

  private applyFailure(now: number): void {
    if (this.failureStreak < this.profile.failureThreshold) return
    this.setConfirmed('OFFLINE', now)
  }

  private setConfirmed(next: ConfirmedStatus, now: number): void {
    if (next === 'OFFLINE') {
      // Dated from the first failure of the streak that proved it, not
      // from the moment the verdict landed — that first failure is when
      // the connection actually stopped working.
      if (this.confirmed !== 'OFFLINE' || this.offlineSince === null) {
        this.offlineSince = this.firstFailureAt ?? now
      }
    } else {
      this.offlineSince = null
    }
    this.confirmed = next
  }

  // ---- reporting -------------------------------------------------------

  private deriveStatus(): ConnectivityStatus {
    // No verdict yet, or a failure streak is open but hasn't reached the
    // threshold: we genuinely don't know, and say so.
    if (this.confirmed === null) return 'VERIFYING'
    // Once OFFLINE is confirmed it holds until recovery is confirmed —
    // dipping through VERIFYING on every hopeful probe would silence the
    // alarm and hide the overlay mid-outage.
    if (this.confirmed === 'OFFLINE') return 'OFFLINE'
    return this.failureStreak > 0 ? 'VERIFYING' : this.confirmed
  }

  private publish(): void {
    const status = this.deriveStatus()
    const statusChanged = status !== this.reportedStatus

    if (statusChanged) {
      this.reportedStatus = status
      this.statusChangedAt = Date.now()
    }

    try {
      this.onUpdate?.(this.getState(), statusChanged)
    } catch (error) {
      console.error('[MonitorService] update listener threw:', error)
    }
  }
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

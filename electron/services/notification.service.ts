import { Notification } from 'electron'
import { formatDuration, type ConnectivityState, type ConnectivityStatus } from '../shared/types'

const APP_NAME = 'Internet Monitor Pro'
const DEFAULT_COOLDOWN_MS = 10_000

type NotificationKind = 'lost' | 'restored'

/**
 * Fires a native notification for the two events worth interrupting
 * someone for: losing the connection, and recovering from it.
 *
 * Three independent guards keep it quiet:
 *
 *  - VERIFYING is ignored outright — it is not a verdict, so it neither
 *    notifies nor counts as the "previous status". Without that, an
 *    outage's OFFLINE -> VERIFYING -> ONLINE recovery would be read as
 *    VERIFYING -> ONLINE and the recovery notification would be lost.
 *  - DEGRADED never notifies at all. An unstable connection is visible
 *    in the window and the tray, and it is exactly the state that
 *    flaps — notifying on it is the definition of spam.
 *  - Only genuine transitions notify, and a per-kind cooldown throttles
 *    a flapping connection. Per-kind rather than global on purpose: a
 *    shared timer lets a fast drop/recover cycle swallow the *recovery*
 *    message and leave the user believing they are still offline.
 *
 * `lastStatus` starts at null so the very first report — whatever it says
 * — never notifies; there is nothing for it to have changed from. It is
 * also tracked while notifications are disabled, so re-enabling them
 * compares against reality instead of inventing a transition.
 */
export class NotificationService {
  private cooldownMs: number
  private enabled: boolean
  private lastStatus: ConnectivityStatus | null = null
  private lastNotifiedAt: Record<NotificationKind, number> = { lost: 0, restored: 0 }
  /** Captured when the outage is confirmed, because `offlineSince` is
   *  already cleared by the time the recovery is reported — and the
   *  downtime figure is the most useful thing that message can carry. */
  private outageStartedAt: number | null = null

  constructor(options: { cooldownMs?: number; enabled?: boolean } = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
    this.enabled = options.enabled ?? true
  }

  /** Applied when the user changes notification settings live. */
  updateConfig(options: { cooldownMs?: number; enabled?: boolean }): void {
    if (options.cooldownMs !== undefined) this.cooldownMs = options.cooldownMs
    if (options.enabled !== undefined) this.enabled = options.enabled
  }

  notify(state: ConnectivityState): void {
    const status = state.status
    if (status === 'VERIFYING') return

    const previous = this.lastStatus
    this.lastStatus = status

    // Tracked regardless of whether anything is shown, so a notification
    // that was suppressed (disabled, cooled down) still leaves the
    // recovery message able to report the full downtime.
    if (status === 'OFFLINE') {
      if (previous !== 'OFFLINE') {
        this.outageStartedAt = state.offlineSince === null ? Date.now() : Date.parse(state.offlineSince)
      }
    }

    if (previous === null || previous === status) return
    if (!this.enabled) return

    const kind: NotificationKind | null =
      status === 'OFFLINE' ? 'lost' : previous === 'OFFLINE' ? 'restored' : null
    if (kind === null) return

    const now = Date.now()
    if (now - this.lastNotifiedAt[kind] < this.cooldownMs) return
    this.lastNotifiedAt[kind] = now

    if (kind === 'lost') {
      this.show('Connection lost', this.lostBody(state))
    } else {
      this.show('Connection restored', this.restoredBody(now))
    }
  }

  /** Diagnostics only: proves delivery works, so it deliberately skips
   *  the transition, cooldown and enabled checks — the user asked for
   *  this one directly, and a test that silently declines to appear
   *  would be worse than useless. */
  showTest(): boolean {
    return this.show(
      'Test notification',
      'Notifications are working. This is a test from Diagnostics.'
    )
  }

  private lostBody(state: ConnectivityState): string {
    const startedAt = state.offlineSince === null ? null : Date.parse(state.offlineSince)
    if (startedAt === null || Number.isNaN(startedAt)) {
      return 'No internet connection.'
    }
    const since = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `No internet connection. Offline since ${since}.`
  }

  private restoredBody(now: number): string {
    if (this.outageStartedAt === null || Number.isNaN(this.outageStartedAt)) {
      return 'You are back online.'
    }
    const downtime = formatDuration(now - this.outageStartedAt)
    this.outageStartedAt = null
    return `You are back online. Downtime: ${downtime}.`
  }

  private show(title: string, body: string): boolean {
    try {
      if (!Notification.isSupported()) return false
      new Notification({ title: `${APP_NAME} — ${title}`, body }).show()
      return true
    } catch (error) {
      // A notification that can't be shown (no toast support, a locked
      // session, group policy) is never a reason to take the app down.
      console.warn('[NotificationService] Failed to show notification:', error)
      return false
    }
  }
}

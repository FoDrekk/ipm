import { Notification } from 'electron'
import type { ConnectivityStatus } from '../shared/types'

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
 *  - Only genuine transitions notify: repeated reports of a status
 *    already shown are dropped.
 *  - A per-kind cooldown throttles a flapping connection. Per-kind
 *    rather than global on purpose: a shared timer lets a fast
 *    drop/recover cycle swallow the *recovery* message and leave the
 *    user believing they are still offline. Suppressing a second "lost"
 *    inside the window is the intent; suppressing the "all clear" is not.
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

  constructor(options: { cooldownMs?: number; enabled?: boolean } = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
    this.enabled = options.enabled ?? true
  }

  /** Applied when the user changes notification settings live. */
  updateConfig(options: { cooldownMs?: number; enabled?: boolean }): void {
    if (options.cooldownMs !== undefined) this.cooldownMs = options.cooldownMs
    if (options.enabled !== undefined) this.enabled = options.enabled
  }

  notify(status: ConnectivityStatus): void {
    if (status === 'VERIFYING') return

    const previous = this.lastStatus
    this.lastStatus = status
    if (previous === null || previous === status) return
    if (!this.enabled) return

    const kind: NotificationKind | null =
      status === 'OFFLINE' ? 'lost' : previous === 'OFFLINE' ? 'restored' : null
    if (kind === null) return

    const now = Date.now()
    if (now - this.lastNotifiedAt[kind] < this.cooldownMs) return
    this.lastNotifiedAt[kind] = now

    if (kind === 'lost') {
      this.show('Connection lost', 'No internet connection.')
    } else {
      this.show('Connection restored', 'You are back online.')
    }
  }

  private show(title: string, body: string): void {
    try {
      if (!Notification.isSupported()) return
      new Notification({ title: `${APP_NAME} — ${title}`, body }).show()
    } catch (error) {
      // A notification that can't be shown (no toast support, a locked
      // session, group policy) is never a reason to take the app down.
      console.warn('[NotificationService] Failed to show notification:', error)
    }
  }
}

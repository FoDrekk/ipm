import { Notification } from 'electron'
import type { ConnectivityStatus } from './monitor.service'

const APP_NAME = 'Internet Monitor Pro'
const DEFAULT_COOLDOWN_MS = 10_000

/**
 * Fires a native notification for the two events worth interrupting
 * someone for: losing the connection, and a clean recovery from OFFLINE
 * back to ONLINE. DEGRADED/VERIFYING never notify — consistent with the
 * alarm system's own "uncertainty isn't an alert" rule.
 *
 * Tracks the last status itself (rather than main.ts passing a previous
 * value in) so the comparison lives in one place. Starts at `null`
 * specifically so the very first report — whatever it says — never fires
 * a notification; there's nothing to have "changed" from yet.
 *
 * The transition check alone isn't quite "no spam": MonitorService's own
 * anti-flap cooldown (5s) is shorter than what's wanted here, so two
 * genuine transitions could still land under 10s apart. cooldownMs is a
 * second, independent floor specifically on notifications — a skipped
 * notification just isn't shown; the tray icon and dashboard remain the
 * accurate record regardless.
 */
export class NotificationService {
  private cooldownMs: number
  private enabled: boolean
  private lastStatus: ConnectivityStatus | null = null
  private lastNotifiedAt = 0

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
    const previous = this.lastStatus
    this.lastStatus = status

    if (previous === null) return
    // lastStatus above still tracks even while disabled, so re-enabling
    // later compares against the real previous status, not a stale one.
    if (!this.enabled) return

    const lost = status === 'OFFLINE' && previous !== 'OFFLINE'
    const restored = previous === 'OFFLINE' && status === 'ONLINE'
    if (!lost && !restored) return

    if (Date.now() - this.lastNotifiedAt < this.cooldownMs) return

    this.lastNotifiedAt = Date.now()
    if (lost) {
      this.show('Connection lost', 'No internet connection.')
    } else {
      this.show('Connection restored', 'You are back online.')
    }
  }

  private show(title: string, body: string): void {
    if (!Notification.isSupported()) return
    new Notification({ title: `${APP_NAME} — ${title}`, body }).show()
  }
}

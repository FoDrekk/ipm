import { Tray, Menu, nativeImage, app, type NativeImage } from 'electron'
import path from 'node:path'
import type { ConnectivityState, ConnectivityStatus } from '../shared/types'

interface TrayServiceOptions {
  /** Shows the dashboard, creating the window again if it was destroyed. */
  onShowWindow: () => void
  onStartMonitoring: () => void
  onStopMonitoring: () => void
  onQuit: () => void
}

/** The tray's own view of the app: the connectivity status, or the fact
 *  that nothing is being monitored at all — which is not a connectivity
 *  status and must not be shown as one. */
type TrayState = ConnectivityStatus | 'PAUSED'

// VERIFYING reuses DEGRADED's icon — the same amber "uncertain" treatment
// the rest of the UI already uses for both, no need for another asset.
const ICON_FILES: Record<TrayState, string> = {
  ONLINE: 'tray-online.png',
  DEGRADED: 'tray-degraded.png',
  VERIFYING: 'tray-degraded.png',
  OFFLINE: 'tray-offline.png',
  PAUSED: 'tray-paused.png',
}

/** How long each icon is held during the diagnostics flash. */
const TRAY_TEST_STEP_MS = 450

const STATUS_LABELS: Record<TrayState, string> = {
  ONLINE: '🟢 Online',
  DEGRADED: '🟡 Degraded',
  VERIFYING: '🟡 Checking…',
  OFFLINE: '🔴 Offline',
  PAUSED: '⚪ Monitoring paused',
}

// In dev, dist-electron/services/ sits two levels below the project root
// (same as the source tree), so this relative traversal finds
// assets/tray directly on disk. Packaged is different: this file is
// bundled inside app.asar, so the same traversal would resolve to a path
// inside the archive. The icons are placed outside it via
// electron-builder's "extraResources", at <install>/resources/assets/tray
// — which is exactly what process.resourcesPath points at.
const TRAY_ICONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'assets/tray')
  : path.join(__dirname, '../../assets/tray')

/**
 * Owns the tray icon and its context menu. Has no polling or state of its
 * own — `update` is called from the same monitor callback that drives the
 * IPC push and notifications, so the tray cannot drift out of sync with
 * what the window shows.
 *
 * Both the icon and the menu are rebuilt only when the state they depend
 * on actually changed, so the steady-state cost of a probe landing every
 * few seconds is a comparison, not a menu rebuild.
 */
export class TrayService {
  private tray: Tray | null = null
  private readonly options: TrayServiceOptions
  private state: TrayState = 'PAUSED'
  private readonly iconCache = new Map<TrayState, NativeImage>()
  private testTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: TrayServiceOptions) {
    this.options = options
  }

  /** Idempotent — a second call is a no-op rather than a second tray. */
  init(): void {
    if (this.tray) return
    try {
      this.tray = new Tray(this.iconFor(this.state))
      this.tray.on('click', () => this.options.onShowWindow())
      this.tray.on('double-click', () => this.options.onShowWindow())
      this.applyIcon()
      this.refreshMenu()
    } catch (error) {
      // A tray that won't initialise (missing icon file, no system tray)
      // is a degraded experience, not a reason to fail startup — the
      // window and monitoring work regardless.
      console.error('[TrayService] Failed to create tray icon:', error)
      this.tray = null
    }
  }

  update(state: ConnectivityState): void {
    const next: TrayState = state.isMonitoring ? state.status : 'PAUSED'
    if (next === this.state) return
    this.state = next
    // A diagnostics flash must not outlive a real status change; the
    // icon below is the truth, and the test has just been overtaken.
    this.clearTest()
    this.applyIcon()
    this.refreshMenu()
  }

  /**
   * Diagnostics: cycles the icon through each state and back, so the user
   * can see at a glance that the tray exists, is reachable, and can
   * repaint. Restoring from `this.state` rather than from a saved copy
   * means a status change arriving mid-test wins, instead of the test
   * stamping a stale icon over it when it finishes.
   *
   * Returns false when there is no tray to test — the honest answer, and
   * itself a useful diagnostic result.
   */
  runTest(): boolean {
    if (!this.tray) return false
    if (this.testTimer) return true // a test is already running

    const sequence: TrayState[] = ['ONLINE', 'DEGRADED', 'OFFLINE']
    let step = 0

    const advance = (): void => {
      if (!this.tray) {
        this.clearTest()
        return
      }
      if (step < sequence.length) {
        this.tray.setImage(this.iconFor(sequence[step]))
        step += 1
        return
      }
      this.clearTest()
      this.applyIcon()
    }

    advance()
    this.testTimer = setInterval(advance, TRAY_TEST_STEP_MS)
    return true
  }

  destroy(): void {
    this.clearTest()
    this.tray?.destroy()
    this.tray = null
  }

  private clearTest(): void {
    if (this.testTimer === null) return
    clearInterval(this.testTimer)
    this.testTimer = null
  }

  private applyIcon(): void {
    if (!this.tray) return
    this.tray.setImage(this.iconFor(this.state))
    this.tray.setToolTip(`Internet Monitor Pro — ${STATUS_LABELS[this.state]}`)
  }

  private refreshMenu(): void {
    if (!this.tray) return

    const isMonitoring = this.state !== 'PAUSED'
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: STATUS_LABELS[this.state], enabled: false },
        { type: 'separator' },
        { label: 'Open Dashboard', click: () => this.options.onShowWindow() },
        { type: 'separator' },
        {
          label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
          click: () =>
            isMonitoring ? this.options.onStopMonitoring() : this.options.onStartMonitoring(),
        },
        { type: 'separator' },
        { label: 'Exit App', click: () => this.options.onQuit() },
      ])
    )
  }

  private iconFor(state: TrayState): NativeImage {
    const cached = this.iconCache.get(state)
    if (cached) return cached

    const image = nativeImage.createFromPath(path.join(TRAY_ICONS_DIR, ICON_FILES[state]))
    if (image.isEmpty()) {
      console.warn(`[TrayService] Tray icon not found or unreadable: ${ICON_FILES[state]}`)
    }
    this.iconCache.set(state, image)
    return image
  }
}

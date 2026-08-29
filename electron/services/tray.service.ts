import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron'
import path from 'node:path'
import type { ConnectivityStatus } from './monitor.service'

interface TrayServiceOptions {
  getMainWindow: () => BrowserWindow | null
  isMonitoring: () => boolean
  onStartMonitoring: () => void
  onStopMonitoring: () => void
}

// VERIFYING reuses DEGRADED's icon — same amber "uncertain" treatment the
// rest of the UI already uses for both, no need for a fourth asset.
const ICON_FILES: Record<ConnectivityStatus, string> = {
  ONLINE: 'tray-online.png',
  DEGRADED: 'tray-degraded.png',
  VERIFYING: 'tray-degraded.png',
  OFFLINE: 'tray-offline.png',
}

const STATUS_LABELS: Record<ConnectivityStatus, string> = {
  ONLINE: '🟢 Online',
  DEGRADED: '🟡 Degraded',
  VERIFYING: '🟡 Checking…',
  OFFLINE: '🔴 Offline',
}

// In dev mode, dist-electron/services/ sits two levels below the project
// root (same as the source tree), so the existing relative traversal
// finds assets/tray directly on disk. A packaged app is different: this
// file compiles into dist-electron/, which is bundled INSIDE app.asar
// (see package.json's "files"), so the same relative traversal would
// resolve to a path inside the asar archive. The tray icons are instead
// placed outside the asar via "extraResources", at <install-dir>/resources
// /assets/tray — process.resourcesPath always points there, packaged or
// not, so that's what's used once app.isPackaged is true.
const TRAY_ICONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'assets/tray')
  : path.join(__dirname, '../../assets/tray')

/**
 * Owns the tray icon and its context menu. Has no polling or state of its
 * own — `updateStatus` is called from the same onStatusChange callback
 * that drives the IPC push and notifications, so the tray can't drift out
 * of sync with what the window shows.
 */
export class TrayService {
  private tray: Tray | null = null
  private readonly options: TrayServiceOptions
  private currentStatus: ConnectivityStatus = 'OFFLINE'

  constructor(options: TrayServiceOptions) {
    this.options = options
  }

  init(): void {
    if (this.tray) return
    this.tray = new Tray(this.iconFor(this.currentStatus))
    this.tray.on('click', () => this.showWindow())
    this.applyIcon(this.currentStatus) // sets the tooltip too, for first paint
    this.refreshMenu()
  }

  updateStatus(status: ConnectivityStatus): void {
    // Only touch the icon/tooltip on a genuine change. updateStatus is
    // also called for isMonitoring-only announcements (start/stop),
    // where status is unchanged — re-setting the same image every time
    // is exactly the "update when nothing changed" this was asked to
    // avoid, even though it wouldn't have been visibly wrong.
    if (status !== this.currentStatus) {
      this.currentStatus = status
      this.applyIcon(status)
    }

    // The menu always rebuilds: its Start/Stop enabled-state depends on
    // isMonitoring, which can change independently of status.
    this.refreshMenu()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private applyIcon(status: ConnectivityStatus): void {
    if (!this.tray) return
    this.tray.setImage(this.iconFor(status))
    this.tray.setToolTip(`Internet Monitor Pro — ${STATUS_LABELS[status]}`)
  }

  private refreshMenu(): void {
    if (!this.tray) return

    const isMonitoring = this.options.isMonitoring()
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: STATUS_LABELS[this.currentStatus], enabled: false },
        { type: 'separator' },
        { label: 'Open Dashboard', click: () => this.showWindow() },
        { type: 'separator' },
        {
          label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
          click: () =>
            isMonitoring ? this.options.onStopMonitoring() : this.options.onStartMonitoring(),
        },
        { type: 'separator' },
        { label: 'Exit App', click: () => app.quit() },
      ])
    )
  }

  private iconFor(status: ConnectivityStatus): Electron.NativeImage {
    return nativeImage.createFromPath(path.join(TRAY_ICONS_DIR, ICON_FILES[status]))
  }

  private showWindow(): void {
    const win = this.options.getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

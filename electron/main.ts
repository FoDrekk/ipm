import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { MonitorService } from './services/monitor.service'
import { TrayService } from './services/tray.service'
import { NotificationService } from './services/notification.service'
import { StorageService } from './services/storage.service'
import {
  RETRY_STRATEGY_PRESETS,
  type AppSettings,
  type ConnectivityState,
  type HistoryEvent,
} from './shared/types'

const isDev = process.env.NODE_ENV === 'development'
const DEV_SERVER_URL = 'http://localhost:5173'

// Bundled assets live inside app.asar once packaged, where the OS can't
// read them as image files. electron-builder copies them out via
// "extraResources", and process.resourcesPath is where they land — the
// same lookup TrayService uses for its icons.
const ASSETS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '../assets')

// Pins app.getName() — and therefore the userData path StorageService
// reads from — to one value regardless of how the app was launched.
// Without it, electron-builder's productName would take priority once
// packaged, silently pointing dev mode and the installed app at two
// different settings folders.
app.setName('Internet Monitor Pro')

// Windows resolves toast notifications through the App User Model ID.
// Without an explicit one, a packaged build's notifications are
// attributed to the generic Electron identity and can be dropped
// outright, which is the difference between notifications working and
// silently doing nothing in production.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.internetmonitorpro.app')
}

// The alarm needs audio.play() to work without prior page interaction —
// Electron's effective autoplay default has varied across versions, so
// this is set explicitly rather than relied on implicitly. Must run
// before the app is ready.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// A second copy of the app would mean a second tray icon, a second
// monitoring loop, and two processes writing the same settings file.
// The first instance takes the lock and every later launch simply hands
// focus back to it.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  let mainWindow: BrowserWindow | null = null

  // Set only by an explicit quit (tray "Exit App", or the OS shutting
  // down) — distinguishes a real quit from the user clicking the
  // window's close button, which hides to the tray instead.
  let isQuitting = false

  // Loaded synchronously before anything else is constructed, so the
  // services start up already configured the way the user left them
  // rather than with defaults that get corrected a moment later.
  const storageService = new StorageService()
  const initialSettings = storageService.getSettings()

  const notificationService = new NotificationService({
    enabled: initialSettings.notifications.enabled,
    cooldownMs: initialSettings.notifications.cooldownMs,
  })

  const monitorService = new MonitorService({
    intervalMs: initialSettings.monitoring.intervalMs,
    profile: RETRY_STRATEGY_PRESETS[initialSettings.monitoring.retryStrategy],
    // The single fan-out point for connectivity state: the renderer, the
    // tray, notifications and history all read from this one callback,
    // so they cannot disagree about what the current status is.
    onUpdate: (state, statusChanged) => {
      sendToRenderer(state)
      trayService.update(state)

      // The rest are one-shot reactions to a real transition. Repeated
      // reports of an unchanged status (one per probe) must not produce
      // repeated notifications or history entries.
      if (!statusChanged) return
      notificationService.notify(state.status)
      // History records confirmed verdicts only — VERIFYING is transient
      // and unconfirmed, the same reason it drives no alarm or alert.
      if (state.status !== 'VERIFYING') {
        storageService.addHistoryEvent(state.status)
      }
    },
  })

  const trayService = new TrayService({
    onShowWindow: () => showWindow(),
    onStartMonitoring: () => monitorService.start(),
    onStopMonitoring: () => monitorService.stop(),
    onQuit: () => quit(),
  })

  function sendToRenderer(state: ConnectivityState): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connectivity:status-changed', state)
    }
  }

  function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 480,
      height: 560,
      resizable: false,
      // Painted before the renderer's first frame, so opening the window
      // doesn't flash white against the app's dark UI.
      backgroundColor: '#020617',
      show: false,
      autoHideMenuBar: true,
      icon: path.join(ASSETS_DIR, 'icons/app-icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    window.once('ready-to-show', () => window.show())

    // This window only ever shows the app's own UI. Anything trying to
    // navigate it elsewhere, or open a new window, is refused; external
    // links go to the user's real browser instead.
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url).catch(() => undefined)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== window.webContents.getURL()) event.preventDefault()
    })

    // A renderer crash takes down the UI, not the app: monitoring, the
    // tray and notifications all live here in the main process and keep
    // running. The window is rebuilt so the dashboard comes back.
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[main] Renderer process gone:', details.reason)
      if (!isQuitting) {
        mainWindow = null
        window.destroy()
        showWindow()
      }
    })

    // Closing hides to the tray so monitoring continues. Only a real
    // quit sets isQuitting first and is allowed through.
    window.on('close', (event) => {
      if (isQuitting) return
      event.preventDefault()
      window.hide()
    })

    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null
    })

    if (isDev) {
      void window.loadURL(DEV_SERVER_URL)
    } else {
      void window.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    return window
  }

  /** The one way the window is ever shown — recreates it if it was
   *  destroyed, so the tray's "Open Dashboard" always works. */
  function showWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow()
      // Pushed as soon as the renderer is ready, so a freshly created
      // window shows live state without waiting for the next probe.
      mainWindow.webContents.once('did-finish-load', () => {
        sendToRenderer(monitorService.getState())
      })
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  function quit(): void {
    isQuitting = true
    app.quit()
  }

  // ---- IPC ------------------------------------------------------------
  // Registered once, at startup, so there is no path to a duplicate
  // handler. Every one of them is total: renderer input is untrusted and
  // is narrowed or validated before use, and none can throw, so the
  // renderer never has to handle a rejected bridge call as a normal case.

  ipcMain.handle('connectivity:get-status', (): ConnectivityState => monitorService.getState())

  ipcMain.handle('connectivity:start-monitoring', (): ConnectivityState => {
    monitorService.start()
    return monitorService.getState()
  })

  ipcMain.handle('connectivity:stop-monitoring', (): ConnectivityState => {
    monitorService.stop()
    return monitorService.getState()
  })

  ipcMain.handle('settings:get', (): AppSettings => storageService.getSettings())

  ipcMain.handle('settings:update', (_event, partial: unknown): AppSettings => {
    // Anything that isn't an object patch is a no-op that still returns
    // the truth, rather than a thrown error the UI has to handle. The
    // storage layer validates and clamps every field regardless.
    const patch: Partial<AppSettings> =
      typeof partial === 'object' && partial !== null && !Array.isArray(partial)
        ? (partial as Partial<AppSettings>)
        : {}
    const updated = storageService.updateSettings(patch)

    // Applied live — a settings change shouldn't need a restart. Alarm
    // settings need no action here: the alarm lives in the renderer,
    // which is handed these exact values back.
    monitorService.updateConfig({
      intervalMs: updated.monitoring.intervalMs,
      profile: RETRY_STRATEGY_PRESETS[updated.monitoring.retryStrategy],
    })
    notificationService.updateConfig({
      enabled: updated.notifications.enabled,
      cooldownMs: updated.notifications.cooldownMs,
    })

    return updated
  })

  // Windows registry-backed via Electron's own API — the OS is already
  // the source of truth for this, so there is nothing of our own to keep
  // in sync with it (and no way for the two to disagree).
  ipcMain.handle('settings:get-autostart', (): boolean => readAutostart())

  ipcMain.handle('settings:set-autostart', (_event, enabled: unknown): boolean => {
    if (typeof enabled !== 'boolean') return readAutostart()
    try {
      app.setLoginItemSettings({ openAtLogin: enabled })
    } catch (error) {
      console.error('[main] Failed to change the launch-at-login setting:', error)
    }
    // Reports what is actually in effect, not what was asked for, so a
    // refusal by the OS shows up in the UI as the toggle staying put.
    return readAutostart()
  })

  ipcMain.handle('history:get', (): HistoryEvent[] => storageService.getHistory())

  function readAutostart(): boolean {
    try {
      return app.getLoginItemSettings().openAtLogin
    } catch (error) {
      console.error('[main] Failed to read the launch-at-login setting:', error)
      return false
    }
  }

  // ---- app lifecycle ---------------------------------------------------

  app.on('second-instance', () => {
    // Someone launched the app again (Start Menu, autostart, a shortcut).
    // Surface the instance that's already running instead.
    showWindow()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    monitorService.dispose()
    trayService.destroy()
  })

  // The app deliberately outlives its window: closing it hides to the
  // tray and monitoring continues, so there is nothing to do here. Quit
  // happens through the tray's Exit App, which calls app.quit() directly.
  app.on('window-all-closed', () => undefined)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow()
  })

  void app.whenReady().then(() => {
    showWindow()
    trayService.init()
    // Monitoring starts immediately rather than waiting for the user to
    // open the dashboard and flip the toggle — the app has a launch-on-
    // startup option, which would otherwise open into the tray and
    // monitor nothing. The toggle still works normally afterwards.
    monitorService.start()
  })
}

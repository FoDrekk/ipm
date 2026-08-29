import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { MonitorService, type ConnectivityState } from './services/monitor.service'
import { TrayService } from './services/tray.service'
import { NotificationService } from './services/notification.service'
import {
  StorageService,
  RETRY_STRATEGY_PRESETS,
  type AppSettings,
  type HistoryEvent,
} from './services/storage.service'

const isDev = process.env.NODE_ENV === 'development'

// Fixes app.getName() (and therefore the userData path StorageService
// reads from) to the same value regardless of how the app was launched.
// Without this, electron-builder's productName ("Internet Monitor Pro")
// would take priority over package.json's name ("internet-monitor-pro")
// once packaged, silently pointing dev mode and the installed app at two
// different settings folders. Must run before anything reads userData —
// StorageService is constructed just below.
app.setName('Internet Monitor Pro')

// The alarm needs audio.play() to work without prior page interaction —
// Electron's effective autoplay default has varied across versions, so
// this is set explicitly rather than relied on implicitly. Must run
// before the app is ready.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null

// Set only by the tray's "Exit App" (via app.quit()) or an OS shutdown —
// distinguishes a real quit from the user clicking the window's own
// close button, which should hide to tray instead.
let isQuitting = false

// Loads persisted settings/history synchronously before anything else is
// constructed, so monitorService/notificationService start up already
// configured the way the user left them, not with hardcoded defaults
// that then get corrected a moment later.
const storageService = new StorageService()
const initialSettings = storageService.getSettings()
const initialRetryPreset = RETRY_STRATEGY_PRESETS[initialSettings.monitoring.retryStrategy]

const notificationService = new NotificationService({
  enabled: initialSettings.notifications.enabled,
  cooldownMs: initialSettings.notifications.cooldownMs,
})

// Constructed here, started in app.whenReady() below. References
// trayService/notificationService/storageService below by closure; this
// is safe regardless of declaration order since the callback only runs
// later, well after every module-level const here has been initialized.
const monitorService = new MonitorService({
  intervalMs: initialSettings.monitoring.intervalMs,
  offlineDebounceMs: initialRetryPreset.offlineDebounceMs,
  transitionCooldownMs: initialRetryPreset.transitionCooldownMs,
  requestTimeoutMs: initialRetryPreset.requestTimeoutMs,
  onStatusChange: (state: ConnectivityState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connectivity:status-changed', state)
    }
    trayService.updateStatus(state.status)
    notificationService.notify(state.status)
    storageService.setLastStatus(state)
    // History only records confirmed statuses — VERIFYING is transient
    // and unconfirmed, same reason it's excluded from the alarm/tray.
    if (state.status !== 'VERIFYING') {
      storageService.addHistoryEvent(state.status)
    }
  },
})

const trayService = new TrayService({
  getMainWindow: () => mainWindow,
  isMonitoring: () => monitorService.isRunning(),
  onStartMonitoring: () => monitorService.start(),
  onStopMonitoring: () => monitorService.stop(),
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Closing the window hides it instead of quitting — monitoring and the
  // tray keep running. Only an actual quit (tray's Exit App, or the OS)
  // sets isQuitting first and is allowed through.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('connectivity:get-status', (): ConnectivityState => monitorService.getState())

ipcMain.handle('connectivity:start-monitoring', (): ConnectivityState => {
  monitorService.start()
  return monitorService.getState()
})

ipcMain.handle('connectivity:stop-monitoring', (): ConnectivityState => {
  monitorService.stop()
  return monitorService.getState()
})

// Windows registry-backed via Electron's built-in API — no separate
// config file needed, the OS is already the source of truth for this.
ipcMain.handle('settings:get-autostart', (): boolean => app.getLoginItemSettings().openAtLogin)

ipcMain.handle('settings:set-autostart', (_event, enabled: boolean): boolean => {
  app.setLoginItemSettings({ openAtLogin: enabled })
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('settings:get', (): AppSettings => storageService.getSettings())

ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>): AppSettings => {
  const updated = storageService.updateSettings(partial)

  // Apply live — settings changes shouldn't need an app restart to take
  // effect. Alarm settings need no main-process action: the alarm lives
  // entirely in the renderer, which reads settings straight from here.
  const preset = RETRY_STRATEGY_PRESETS[updated.monitoring.retryStrategy]
  monitorService.updateConfig({
    intervalMs: updated.monitoring.intervalMs,
    offlineDebounceMs: preset.offlineDebounceMs,
    transitionCooldownMs: preset.transitionCooldownMs,
    requestTimeoutMs: preset.requestTimeoutMs,
  })
  notificationService.updateConfig({
    enabled: updated.notifications.enabled,
    cooldownMs: updated.notifications.cooldownMs,
  })

  return updated
})

ipcMain.handle('history:get', (): HistoryEvent[] => storageService.getHistory())

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  createWindow()
  trayService.init()
  // Starts monitoring immediately rather than waiting for the user to
  // open the dashboard and flip the toggle — the app already has a
  // "Launch on Startup" setting, which would otherwise open silently
  // into the tray and monitor nothing until manually turned on. The
  // toggle still works normally afterward, including turning it back off.
  monitorService.start()
})

app.on('window-all-closed', () => {
  monitorService.stop()
  trayService.destroy()
  app.quit()
})

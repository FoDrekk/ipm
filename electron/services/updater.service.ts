import { app } from 'electron'
import type { UpdateStatus } from '../shared/types'
import { logger } from './logger.service'

interface UpdaterBackend {
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): void
  autoDownload: boolean
}

/**
 * Thin wrapper over electron-updater. Loads lazily so dev/test without
 * the package still runs — check() then reports "no update" instead of
 * throwing. In packaged builds with publish config, real checks run.
 */
export class UpdaterService {
  private backend: UpdaterBackend | null = null
  private available = false
  private version: string | null = null
  private checking = false
  private error: string | null = null

  private loadBackend(): UpdaterBackend | null {
    if (this.backend) return this.backend
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require('electron-updater') as {
        autoUpdater: UpdaterBackend
      }
      autoUpdater.autoDownload = true
      autoUpdater.on('update-available', (info: unknown) => {
        const v =
          typeof info === 'object' && info !== null && 'version' in info
            ? String((info as { version: unknown }).version)
            : null
        this.available = true
        this.version = v
        logger.info('[Updater] Update available:', v ?? 'unknown')
      })
      autoUpdater.on('update-not-available', () => {
        this.available = false
        logger.info('[Updater] No update available.')
      })
      autoUpdater.on('error', (err: unknown) => {
        this.error = err instanceof Error ? err.message : String(err)
        logger.warn('[Updater] Check failed:', this.error)
      })
      this.backend = autoUpdater
      return this.backend
    } catch (error) {
      logger.warn('[Updater] electron-updater unavailable:', error)
      return null
    }
  }

  async check(): Promise<UpdateStatus> {
    this.checking = true
    this.error = null
    try {
      if (!app.isPackaged) {
        return { available: false, version: null, checking: false, error: null }
      }
      const backend = this.loadBackend()
      if (!backend) {
        return { available: false, version: null, checking: false, error: 'updater unavailable' }
      }
      await backend.checkForUpdates()
      return {
        available: this.available,
        version: this.version,
        checking: false,
        error: this.error,
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const missingPublish = /publish|update\.yml|update\.yaml|config/i.test(raw)
      const msg = missingPublish ? 'updates not configured' : raw
      logger.warn('[Updater] Check threw:', msg)
      return { available: false, version: null, checking: false, error: msg }
    } finally {
      this.checking = false
    }
  }

  quitAndInstall(): void {
    try {
      this.backend?.quitAndInstall()
    } catch (error) {
      logger.error('[Updater] quitAndInstall failed:', error)
    }
  }

  status(): UpdateStatus {
    return {
      available: this.available,
      version: this.version,
      checking: this.checking,
      error: this.error,
    }
  }
}

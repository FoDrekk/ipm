import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { ConnectivityState, ConfirmedStatus } from './monitor.service'

// Mirrors src/utils/alarmSounds.ts's AlarmSound type. Duplicated rather
// than imported: tsconfig.electron.json's rootDir is scoped to electron/,
// so importing a renderer-side file here risks a rootDir violation for
// what's just a 3-value string union.
export type AlarmSound = 'classic-beep' | 'gentle-chime' | 'urgent-siren'

export type RetryStrategy = 'normal' | 'aggressive'

export interface AppSettings {
  alarm: {
    enabled: boolean
    volume: number // 0-100
    sound: AlarmSound
  }
  notifications: {
    enabled: boolean
    cooldownMs: number
  }
  monitoring: {
    intervalMs: number
    retryStrategy: RetryStrategy
  }
}

export interface HistoryEvent {
  status: ConfirmedStatus
  at: string
}

/** Bumped whenever AppSettings' shape changes in a way that would need
 *  explicit migration logic (a field renamed or removed, not just added
 *  — added fields are already handled by the per-category default-merge
 *  below). Nothing to migrate yet since this is version 1, but the field
 *  is there now so a future version bump has something to check against
 *  instead of guessing from shape alone. */
const SCHEMA_VERSION = 1

interface PersistedData {
  version: number
  settings: AppSettings
  lastStatus: ConnectivityState | null
  history: HistoryEvent[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  alarm: { enabled: true, volume: 70, sound: 'classic-beep' },
  notifications: { enabled: true, cooldownMs: 10_000 },
  monitoring: { intervalMs: 10_000, retryStrategy: 'normal' },
}

export const RETRY_STRATEGY_PRESETS: Record<
  RetryStrategy,
  { offlineDebounceMs: number; transitionCooldownMs: number; requestTimeoutMs: number }
> = {
  normal: { offlineDebounceMs: 3_000, transitionCooldownMs: 5_000, requestTimeoutMs: 5_000 },
  aggressive: { offlineDebounceMs: 1_000, transitionCooldownMs: 2_000, requestTimeoutMs: 3_000 },
}

const FILE_NAME = 'app-data.json'
const MAX_HISTORY = 20

function isAlarmSound(value: unknown): value is AlarmSound {
  return value === 'classic-beep' || value === 'gentle-chime' || value === 'urgent-siren'
}

function isRetryStrategy(value: unknown): value is RetryStrategy {
  return value === 'normal' || value === 'aggressive'
}

/** For numeric fields specifically: a value of the wrong type (or NaN/
 *  Infinity) has nothing sensible to clamp, so it falls back to the
 *  given default same as any other invalid field. A value that IS a
 *  real number but outside [min, max] is clamped to the nearest bound
 *  rather than discarded — a corrupted volume of 150 becomes 100, not a
 *  default of 70, preserving "as loud as it goes" intent instead of
 *  resetting to an unrelated value. */
function clampedNumberOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Validates one settings category against its own defaults, field by
 *  field. Numeric fields (volume, cooldownMs, intervalMs) are clamped to
 *  their valid range rather than rejected — see clampedNumberOrDefault.
 *  Non-numeric fields (booleans, sound/retry-strategy enums) have no
 *  sensible "nearest valid value," so a wrong type or unrecognized enum
 *  still falls back to that field's default. Either way, a bad value
 *  never propagates past this function, and it never takes down the
 *  whole category for one bad field. */
function validateSettings(raw: unknown): AppSettings {
  const r = (raw ?? {}) as Partial<AppSettings>
  const alarm = (r.alarm ?? {}) as Partial<AppSettings['alarm']>
  const notifications = (r.notifications ?? {}) as Partial<AppSettings['notifications']>
  const monitoring = (r.monitoring ?? {}) as Partial<AppSettings['monitoring']>

  const alarmEnabled = typeof alarm.enabled === 'boolean' ? alarm.enabled : DEFAULT_SETTINGS.alarm.enabled
  const alarmVolume = clampedNumberOrDefault(alarm.volume, 0, 100, DEFAULT_SETTINGS.alarm.volume)
  const alarmSound = isAlarmSound(alarm.sound) ? alarm.sound : DEFAULT_SETTINGS.alarm.sound
  const notificationsEnabled =
    typeof notifications.enabled === 'boolean'
      ? notifications.enabled
      : DEFAULT_SETTINGS.notifications.enabled
  const notificationsCooldownMs = clampedNumberOrDefault(
    notifications.cooldownMs,
    0,
    3_600_000,
    DEFAULT_SETTINGS.notifications.cooldownMs
  )
  const monitoringIntervalMs = clampedNumberOrDefault(
    monitoring.intervalMs,
    500,
    3_600_000,
    DEFAULT_SETTINGS.monitoring.intervalMs
  )
  const monitoringRetryStrategy = isRetryStrategy(monitoring.retryStrategy)
    ? monitoring.retryStrategy
    : DEFAULT_SETTINGS.monitoring.retryStrategy

  // Aggregate, not per-field: one warning if anything needed correcting,
  // not up to seven lines for a file with several bad fields at once.
  const anyCorrected =
    alarmEnabled !== alarm.enabled ||
    alarmVolume !== alarm.volume ||
    alarmSound !== alarm.sound ||
    notificationsEnabled !== notifications.enabled ||
    notificationsCooldownMs !== notifications.cooldownMs ||
    monitoringIntervalMs !== monitoring.intervalMs ||
    monitoringRetryStrategy !== monitoring.retryStrategy

  if (anyCorrected) {
    console.warn(
      '[StorageService] One or more settings values were invalid or out of range — corrected to safe defaults/bounds.'
    )
  }

  return {
    alarm: { enabled: alarmEnabled, volume: alarmVolume, sound: alarmSound },
    notifications: { enabled: notificationsEnabled, cooldownMs: notificationsCooldownMs },
    monitoring: { intervalMs: monitoringIntervalMs, retryStrategy: monitoringRetryStrategy },
  }
}

/**
 * Owns the single persisted JSON file — settings, last known status, and
 * recent event history all live in one in-memory object here, with one
 * save path. That matters: settings and history are written from
 * different call sites, and if each independently loaded-modified-saved
 * the file, one could clobber the other's recent change. Keeping a
 * single owned copy in memory makes that impossible by construction.
 */
export class StorageService {
  private data: PersistedData

  constructor() {
    this.data = this.load()
  }

  getSettings(): AppSettings {
    return this.data.settings
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const merged: AppSettings = {
      alarm: { ...this.data.settings.alarm, ...partial.alarm },
      notifications: { ...this.data.settings.notifications, ...partial.notifications },
      monitoring: { ...this.data.settings.monitoring, ...partial.monitoring },
    }
    this.data.settings = validateSettings(merged)
    this.save()
    return this.data.settings
  }

  getLastStatus(): ConnectivityState | null {
    return this.data.lastStatus
  }

  setLastStatus(state: ConnectivityState): void {
    this.data.lastStatus = state
    this.save()
  }

  getHistory(): HistoryEvent[] {
    return this.data.history
  }

  /** No-ops if `status` matches the most recent recorded event — this is
   *  the "only real transitions" guard, self-contained using the history
   *  list itself as the "previous status" reference. */
  addHistoryEvent(status: ConfirmedStatus): void {
    if (this.data.history[0]?.status === status) return
    this.data.history = [{ status, at: new Date().toISOString() }, ...this.data.history].slice(
      0,
      MAX_HISTORY
    )
    this.save()
  }

  private filePath(): string {
    return path.join(app.getPath('userData'), FILE_NAME)
  }

  private load(): PersistedData {
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<PersistedData>

      // SCHEMA_VERSION tracks AppSettings' shape specifically (see its
      // definition above) — a mismatch resets settings only, not
      // lastStatus/history, which aren't what this version describes.
      // Missing version (parsed.version === undefined, e.g. a file from
      // before this field existed) also counts as a mismatch — there's
      // nothing to compare it against, so it's treated the same as an
      // explicit different number.
      const versionMatches = parsed.version === SCHEMA_VERSION
      if (!versionMatches) {
        console.warn(
          `[StorageService] Settings schema version mismatch (file: ${
            parsed.version ?? 'none'
          }, expected: ${SCHEMA_VERSION}) — resetting settings to defaults.`
        )
      }

      return {
        version: SCHEMA_VERSION,
        settings: versionMatches ? validateSettings(parsed.settings) : DEFAULT_SETTINGS,
        lastStatus: parsed.lastStatus ?? null,
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_HISTORY) : [],
      }
    } catch (error) {
      // ENOENT (no file yet) is the normal first-launch case, not a
      // problem worth a warning. Anything else — unreadable, not valid
      // JSON, permissions — is a genuine corrupted-file case.
      const isMissingFile = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      if (!isMissingFile) {
        console.warn('[StorageService] Data file corrupted or unreadable, falling back to defaults:', error)
      }
      return { version: SCHEMA_VERSION, settings: DEFAULT_SETTINGS, lastStatus: null, history: [] }
    }
  }

  private save(): void {
    try {
      const dir = app.getPath('userData')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      // Atomic write: temp file + rename, so a crash mid-write can't
      // leave a truncated/corrupt JSON file behind.
      const tmpPath = this.filePath() + '.tmp'
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmpPath, this.filePath())
    } catch (error) {
      console.error('[StorageService] Failed to save:', error)
    }
  }
}

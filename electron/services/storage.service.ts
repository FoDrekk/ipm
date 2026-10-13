import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './logger.service'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type AlarmMode,
  type AlarmSound,
  type AppSettings,
  type HistoryEvent,
  type HistoryStatus,
  type RetryStrategy,
} from '../shared/types'

export type { AlarmMode, AlarmSound, AppSettings, HistoryEvent, HistoryStatus, RetryStrategy }
export { DEFAULT_SETTINGS }

/** Bumped whenever AppSettings' shape changes in a way that would need
 *  explicit migration logic (a field renamed or removed, not just added
 *  — added fields are already handled by the per-field default-merge
 *  below). Nothing to migrate yet since this is version 1, but the field
 *  is there now so a future version bump has something to check against
 *  instead of guessing from shape alone. */
const SCHEMA_VERSION = 1

interface PersistedData {
  version: number
  settings: AppSettings
  history: HistoryEvent[]
}

const FILE_NAME = 'app-data.json'
const BACKUP_COUNT = 3

// The timeline backs 30-day stats + charts, so retention covers a full
// month plus margin. Bounded by count and age so flapping cannot grow
// the file without limit.
const MAX_HISTORY = 2000
const HISTORY_RETENTION_MS = 32 * 24 * 60 * 60 * 1_000

function isAlarmSound(value: unknown): value is AlarmSound {
  return value === 'classic-beep' || value === 'gentle-chime' || value === 'urgent-siren'
}

function isRetryStrategy(value: unknown): value is RetryStrategy {
  return value === 'normal' || value === 'aggressive'
}

function isHistoryStatus(value: unknown): value is HistoryStatus {
  return value === 'ONLINE' || value === 'DEGRADED' || value === 'OFFLINE' || value === 'PAUSED'
}

function isAlarmMode(value: unknown): value is AlarmMode {
  return value === 'continuous' || value === 'once'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/**
 * Validates settings field by field against their defaults. Numeric
 * fields are clamped to their valid range; booleans and enums have no
 * "nearest valid value" so a wrong type falls back to that field's
 * default. A bad value never propagates past this function, and one bad
 * field never takes down the rest of the category.
 */
function validateSettings(raw: unknown): AppSettings {
  const r = isRecord(raw) ? raw : {}
  const alarm = isRecord(r.alarm) ? r.alarm : {}
  const notifications = isRecord(r.notifications) ? r.notifications : {}
  const monitoring = isRecord(r.monitoring) ? r.monitoring : {}
  const startup = isRecord(r.startup) ? r.startup : {}

  const validated: AppSettings = {
    alarm: {
      enabled: typeof alarm.enabled === 'boolean' ? alarm.enabled : DEFAULT_SETTINGS.alarm.enabled,
      volume: clampedNumberOrDefault(alarm.volume, 0, 100, DEFAULT_SETTINGS.alarm.volume),
      sound: isAlarmSound(alarm.sound) ? alarm.sound : DEFAULT_SETTINGS.alarm.sound,
      mode: isAlarmMode(alarm.mode) ? alarm.mode : DEFAULT_SETTINGS.alarm.mode,
      customSoundPath:
        typeof alarm.customSoundPath === 'string' && alarm.customSoundPath.length > 0
          ? alarm.customSoundPath.slice(0, 1024)
          : null,
    },
    notifications: {
      enabled:
        typeof notifications.enabled === 'boolean'
          ? notifications.enabled
          : DEFAULT_SETTINGS.notifications.enabled,
      cooldownMs: clampedNumberOrDefault(
        notifications.cooldownMs,
        0,
        3_600_000,
        DEFAULT_SETTINGS.notifications.cooldownMs
      ),
    },
    monitoring: {
      intervalMs: clampedNumberOrDefault(
        monitoring.intervalMs,
        1_000,
        3_600_000,
        DEFAULT_SETTINGS.monitoring.intervalMs
      ),
      retryStrategy: isRetryStrategy(monitoring.retryStrategy)
        ? monitoring.retryStrategy
        : DEFAULT_SETTINGS.monitoring.retryStrategy,
    },
    startup: {
      startMonitoring:
        typeof startup.startMonitoring === 'boolean'
          ? startup.startMonitoring
          : DEFAULT_SETTINGS.startup.startMonitoring,
      startMinimized:
        typeof startup.startMinimized === 'boolean'
          ? startup.startMinimized
          : DEFAULT_SETTINGS.startup.startMinimized,
    },
  }

  // Aggregate, not per-field: one warning if anything present in the
  // input had to be corrected, not up to seven lines. A field that was
  // simply absent (a file written by an older version) is filled in
  // silently — that's a default, not a correction.
  const corrected =
    wasCorrected(alarm.enabled, validated.alarm.enabled) ||
    wasCorrected(alarm.volume, validated.alarm.volume) ||
    wasCorrected(alarm.sound, validated.alarm.sound) ||
    wasCorrected(alarm.mode, validated.alarm.mode) ||
    wasCorrected(alarm.customSoundPath, validated.alarm.customSoundPath) ||
    wasCorrected(notifications.enabled, validated.notifications.enabled) ||
    wasCorrected(notifications.cooldownMs, validated.notifications.cooldownMs) ||
    wasCorrected(monitoring.intervalMs, validated.monitoring.intervalMs) ||
    wasCorrected(monitoring.retryStrategy, validated.monitoring.retryStrategy) ||
    wasCorrected(startup.startMonitoring, validated.startup.startMonitoring) ||
    wasCorrected(startup.startMinimized, validated.startup.startMinimized)

  if (corrected) {
    logger.warn(
      '[StorageService] One or more settings values were invalid or out of range — corrected to safe defaults/bounds.'
    )
  }

  return validated
}

function wasCorrected(input: unknown, output: unknown): boolean {
  return input !== undefined && input !== output
}

/** Drops anything that isn't a well-formed event, so a hand-edited or
 *  half-written file can't reach the UI as an unknown status (which the
 *  history list would have no colour or label for) or an unparseable
 *  date. */
function validateHistory(raw: unknown, now: number): HistoryEvent[] {
  if (!Array.isArray(raw)) return []
  const oldestKept = now - HISTORY_RETENTION_MS
  const valid: HistoryEvent[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    if (!isHistoryStatus(entry.status)) continue
    if (typeof entry.at !== 'string') continue
    const at = Date.parse(entry.at)
    if (Number.isNaN(at) || at < oldestKept) continue
    valid.push({ status: entry.status, at: entry.at })
    if (valid.length >= MAX_HISTORY) break
  }
  return valid
}

/**
 * Owns the single persisted JSON file — settings and recent event
 * history live in one in-memory object here, with one save path. That
 * matters: settings and history are written from different call sites,
 * and if each independently loaded-modified-saved the file, one could
 * clobber the other's recent change. Keeping a single owned copy in
 * memory makes that impossible by construction.
 */
export class StorageService {
  private data: PersistedData
  private lastBackupAt = 0

  constructor() {
    this.data = this.load()
  }

  getSettings(): AppSettings {
    return this.data.settings
  }

  /** Merges a (possibly malformed — it comes from the renderer) partial
   *  onto the current settings, validates the result, persists it, and
   *  returns exactly what was stored. */
  updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.data.settings = validateSettings(mergeSettings(this.data.settings, partial))
    this.save()
    return this.data.settings
  }

  getHistory(): HistoryEvent[] {
    return this.data.history
  }

  /** Appends a timeline entry, unless it repeats the most recent one —
   *  that is the "only real transitions" guard, self-contained using the
   *  history list itself as the "previous status" reference. Safe to call
   *  on every status report; it only writes when something changed. */
  addHistoryEvent(status: HistoryStatus): void {
    if (this.data.history[0]?.status === status) return
    this.appendHistory(status, new Date().toISOString())
    this.save()
  }

  private appendHistory(status: HistoryStatus, at: string): void {
    this.data.history = [{ status, at }, ...this.data.history].slice(0, MAX_HISTORY)
  }

  private filePath(): string {
    return path.join(app.getPath('userData'), FILE_NAME)
  }

  /**
   * Marks the end of a session that never recorded one.
   *
   * The timeline's last entry stays in force until the next entry
   * replaces it, so a session that ended without a PAUSED marker — a
   * crash, a kill, a power cut — would have its final status credited
   * for every hour the app was closed, inventing uptime that was never
   * measured. Dating the marker at that last entry instead of at load
   * time is the conservative choice: it claims nothing about a stretch
   * nobody was watching, in either direction.
   */
  private closeUnfinishedSession(history: HistoryEvent[]): HistoryEvent[] {
    const newest = history[0]
    if (!newest || newest.status === 'PAUSED') return history
    const marker: HistoryEvent = { status: 'PAUSED', at: newest.at }
    return [marker, ...history].slice(0, MAX_HISTORY)
  }

  private load(): PersistedData {
    const primary = this.filePath()
    const candidates = [primary]
    for (let i = 1; i <= BACKUP_COUNT; i++) candidates.push(`${primary}.bak.${i}`)
    for (const candidate of candidates) {
      let raw: string | null = null
      try {
        raw = fs.readFileSync(candidate, 'utf-8')
      } catch (error) {
        const isMissing = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
        if (!isMissing) logger.warn(`[StorageService] Backup unreadable (${candidate}):`, error)
        continue
      }
      try {
        const parsed: unknown = JSON.parse(raw)
        const record = isRecord(parsed) ? parsed : {}
        if (candidate !== primary) logger.warn(`[StorageService] Recovered data from backup: ${candidate}`)

        // SCHEMA_VERSION tracks AppSettings' shape specifically (see its
        // definition above) — a mismatch resets settings only, not
        // history, which isn't what this version describes. A missing
        // version (a file from before the field existed) counts as a
        // mismatch: there's nothing to compare against.
      const versionMatches = record.version === SCHEMA_VERSION
      if (!versionMatches) {
        logger.warn(
          `[StorageService] Settings schema version mismatch (file: ${
            typeof record.version === 'number' ? record.version : 'none'
          }, expected: ${SCHEMA_VERSION}) — resetting settings to defaults.`
        )
      }

        return {
          version: SCHEMA_VERSION,
          settings: versionMatches ? validateSettings(record.settings) : DEFAULT_SETTINGS,
          history: this.closeUnfinishedSession(validateHistory(record.history, Date.now())),
        }
      } catch {
        // Corrupt candidate — try next backup instead of discarding all.
        logger.warn(`[StorageService] Data file corrupt, trying next backup: ${candidate}`)
        continue
      }
    }
    return { version: SCHEMA_VERSION, settings: DEFAULT_SETTINGS, history: [] }
  }

  private save(): void {
    const target = this.filePath()
    const tmpPath = `${target}.tmp`
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      // Atomic write: temp file + rename, so a crash mid-write can't
      // leave a truncated/corrupt JSON file behind.
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmpPath, target)
      this.rotateBackups(target)
    } catch (error) {
      // A failed save is not fatal — the in-memory copy stays correct
      // for this session, so the app keeps working with the user's
      // choices; only persistence across restarts is lost.
      logger.error('[StorageService] Failed to save app data:', error)
      try {
        fs.rmSync(tmpPath, { force: true })
      } catch {
        // Nothing more to do; a stray .tmp file is harmless.
      }
    }
  }

  /**
   * Keeps BACKUP_COUNT rolling copies after every successful save.
   * Cheap insurance: each copy is a few KB. Best-effort — a failure
   * here never fails the save itself. Throttled to once per 5s so
   * rapid saves (volume drag) keep atomic writes without copy storms.
   */
  private rotateBackups(target: string): void {
    const now = Date.now()
    if (now - this.lastBackupAt < 5_000) return
    this.lastBackupAt = now
    try {
      for (let i = BACKUP_COUNT; i >= 1; i--) {
        const src = i === 1 ? target : `${target}.bak.${i - 1}`
        const dest = `${target}.bak.${i}`
        try {
          fs.copyFileSync(src, dest)
        } catch {
          // Missing predecessor on first runs — nothing to rotate yet.
        }
      }
    } catch {
      // Backups are best-effort only.
    }
  }
}

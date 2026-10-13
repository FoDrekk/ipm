import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const LOG_FILE = 'app.log'
const MAX_LOG_BYTES = 512 * 1024
const KEEP_ROTATED = 3

function logDir(): string {
  try {
    return path.join(app.getPath('userData'), 'logs')
  } catch {
    return path.join(process.cwd(), 'logs')
  }
}

function logFile(): string {
  return path.join(logDir(), LOG_FILE)
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file)
    if (stat.size < MAX_LOG_BYTES) return
    for (let i = KEEP_ROTATED; i >= 1; i--) {
      const src = i === 1 ? file : `${file}.${i - 1}`
      const dest = `${file}.${i}`
      try {
        if (fs.existsSync(src)) fs.renameSync(src, dest)
      } catch {
        // best-effort
      }
    }
  } catch {
    // No file yet — nothing to rotate.
  }
}

function append(level: string, message: string, detail?: unknown): void {
  const file = logFile()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    rotateIfNeeded(file)
    const ts = new Date().toISOString()
    const extra =
      detail === undefined
        ? ''
        : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 2000)}`
    fs.appendFileSync(file, `[${ts}] [${level}] ${message}${extra}\n`, 'utf-8')
  } catch {
    // Logging must never crash the app.
  }
}

/**
 * Minimal file logger for main process. Mirrors to console so existing
 * dev output stays, plus persists to logs/app.log with rotation.
 * Diagnostics reads the tail via `readTail`.
 */
export const logger = {
  info(message: string, detail?: unknown): void {
    console.log(message, detail ?? '')
    append('INFO', message, detail)
  },
  warn(message: string, detail?: unknown): void {
    console.warn(message, detail ?? '')
    append('WARN', message, detail)
  },
  error(message: string, detail?: unknown): void {
    console.error(message, detail ?? '')
    append('ERROR', message, detail)
  },
  filePath(): string {
    return logFile()
  },
  readTail(maxChars = 20000): string {
    try {
      const raw = fs.readFileSync(logFile(), 'utf-8')
      return raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw
    } catch {
      return ''
    }
  },
}

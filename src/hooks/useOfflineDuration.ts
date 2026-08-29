import { useEffect, useReducer } from 'react'

const TICK_MS = 1000

/**
 * Live duration text ("5 seconds", "2 minutes") for a nullable start
 * timestamp, ticking once a second while `since` is set. Returns null
 * when there is nothing to time, so callers can omit the line entirely.
 *
 * Separate from useRelativeTime rather than reusing it: the two produce
 * different phrasing (a plain duration versus "ago", and no "just now"
 * bucket), so sharing would mean string-manipulating one into the other.
 */
export function useOfflineDuration(since: string | null): string | null {
  const [, forceTick] = useReducer((tick: number) => tick + 1, 0)

  useEffect(() => {
    if (!since) return
    const id = setInterval(forceTick, TICK_MS)
    return () => clearInterval(id)
  }, [since])

  if (!since) return null

  const start = new Date(since).getTime()
  if (Number.isNaN(start)) return null

  const totalSeconds = Math.max(0, Math.round((Date.now() - start) / 1000))

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`
  }
  const totalHours = Math.floor(totalMinutes / 60)
  return `${totalHours} hour${totalHours === 1 ? '' : 's'}`
}

import { useEffect, useReducer } from 'react'
import { formatRelativeTime } from '../utils/formatRelativeTime'

const TICK_MS = 1000

/**
 * Live "N seconds ago" text for a nullable ISO timestamp. Re-renders once
 * a second while a timestamp is present so the label keeps advancing
 * without needing a new check to arrive.
 */
export function useRelativeTime(timestamp: string | null): string {
  const [, forceTick] = useReducer((tick: number) => tick + 1, 0)

  useEffect(() => {
    if (!timestamp) return
    const id = setInterval(forceTick, TICK_MS)
    return () => clearInterval(id)
  }, [timestamp])

  return timestamp ? formatRelativeTime(timestamp) : '—'
}

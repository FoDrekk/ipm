/** Formats an ISO timestamp as a short human-readable relative string.
 *  An unparseable timestamp renders as a dash rather than "NaN seconds
 *  ago" — this is displayed text, not a place to surface a data problem. */
export function formatRelativeTime(timestamp: string): string {
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return '—'

  const diffSeconds = Math.max(0, Math.round((Date.now() - then) / 1000))

  if (diffSeconds < 5) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`

  const diffHours = Math.round(diffMinutes / 60)
  return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
}

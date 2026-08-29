import { useEffect, useState } from 'react'

/**
 * Keeps rendering `true` for `exitDurationMs` after `isActive` goes
 * false, so a consumer can play an exit animation instead of vanishing
 * instantly. Becoming active again always shows immediately — only the
 * exit is delayed. If `isActive` flips back to true before the delay
 * elapses, the pending hide is cancelled outright (no flicker).
 */
export function useExitTransition(isActive: boolean, exitDurationMs: number): boolean {
  const [shouldRender, setShouldRender] = useState(isActive)

  useEffect(() => {
    if (isActive) {
      setShouldRender(true)
      return
    }

    const timer = setTimeout(() => setShouldRender(false), exitDurationMs)
    return () => clearTimeout(timer)
  }, [isActive, exitDurationMs])

  return shouldRender
}

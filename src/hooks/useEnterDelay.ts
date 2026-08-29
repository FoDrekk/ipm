import { useEffect, useState } from 'react'

/**
 * Returns true only after `isActive` has been true continuously for at
 * least `delayMs` — a grace period before committing to something
 * disruptive, so a connection blip that resolves within the window never
 * triggers it. Going false is always immediate: only entering waits.
 *
 * Complements useExitTransition (which delays the false transition
 * instead) — used together, a value can have a slow, deliberate entrance
 * and a quick, cancellable exit.
 */
export function useEnterDelay(isActive: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false)

  useEffect(() => {
    if (!isActive) {
      setDelayed(false)
      return
    }
    const timer = setTimeout(() => setDelayed(true), delayMs)
    return () => clearTimeout(timer)
  }, [isActive, delayMs])

  return delayed
}

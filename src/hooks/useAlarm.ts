import { useEffect, useRef } from 'react'
import { ALARM_SOUND_SOURCES, type AlarmSound } from '../utils/alarmSounds'

interface UseAlarmOptions {
  /** Genuinely OFFLINE right now (already accounting for snooze — pass
   *  false while snoozed, same as any other reason not to sound). */
  active: boolean
  /** The user's mute toggle. */
  enabled: boolean
  /** 0-100, the user's base volume setting. */
  volume: number
  sound: AlarmSound
}

const RAMP_TICK_MS = 500
const LOUDER_AT_MS = 3_000
const STRONG_AT_MS = 10_000
const SOFT_FRACTION = 0.3
const LOUDER_FRACTION = 0.65
const STRONG_FRACTION = 1.0
// Fraction of the remaining distance closed per ramp tick — smooths out
// both the 3s/10s tier boundary and any live volume-slider change,
// rather than snapping straight to the new target.
const VOLUME_EASE_FACTOR = 0.35

// Fade-out-on-stop runs on its own, much faster timer than the ramp —
// this needs to complete in a couple hundred ms, not seconds, so
// "immediately" (per the existing reconnect/mute behavior) still feels
// immediate, just without an audible click at the cutoff.
const FADE_OUT_TICK_MS = 40
const FADE_OUT_DECAY = 0.5 // volume multiplier per tick — halves each step
const FADE_OUT_SILENCE_THRESHOLD = 0.02

/** Pure elapsed-time -> volume-fraction mapping, isolated from the
 *  audio.volume side effect below so the ramp's actual rule (what tier
 *  applies at what elapsed time) is a single, independently-checkable
 *  function rather than logic embedded inside an I/O-performing one. */
export function volumeFractionForElapsed(elapsedMs: number): number {
  if (elapsedMs >= STRONG_AT_MS) return STRONG_FRACTION
  if (elapsedMs >= LOUDER_AT_MS) return LOUDER_FRACTION
  return SOFT_FRACTION
}

/**
 * Loops the alarm sound while `active && enabled`, ramping up smoothly
 * from silence (0-3s soft / 3-10s louder / 10s+ strong) and fading out
 * smoothly on stop rather than cutting off abruptly. Guarantees exactly
 * one Audio instance at a time.
 *
 * Two independent timers, both ref-tracked and always cleared before a
 * new one starts: rampTimerRef eases volume UP toward the current tier
 * target while playing; a separate fade-out timer eases it DOWN to
 * silence before actually pausing. They're kept separate rather than
 * one "volume timer" because they run at different rates (500ms ramp
 * ticks vs. 40ms fade-out ticks) and are active at different times —
 * combining them would mean one interval switching behavior mid-flight,
 * which is harder to reason about than two single-purpose ones.
 *
 * The ramp is driven by a long-lived setInterval that must read the
 * LATEST volume, not whatever volume was in scope when the interval was
 * created — otherwise a volume change mid-alarm would silently stop
 * applying once the interval's stale closure took over. volumeRef is
 * updated on every render specifically so the interval (which is not
 * recreated on every volume change) always reads the current value.
 */
export function useAlarm({ active, enabled, volume, sound }: UseAlarmOptions): void {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const rampTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fadeOutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  // Recreate the element when the selected sound changes. Sound changes
  // are a deliberate, infrequent settings action, not a hot path, so
  // recreating rather than trying to hot-swap .src is the simpler choice.
  useEffect(() => {
    const audio = new Audio(ALARM_SOUND_SOURCES[sound])
    audio.loop = true
    audioRef.current = audio

    return () => {
      audio.pause()
      audioRef.current = null
    }
  }, [sound])

  function stopRampTimer(): void {
    if (rampTimerRef.current) {
      clearInterval(rampTimerRef.current)
      rampTimerRef.current = null
    }
  }

  function stopFadeOutTimer(): void {
    if (fadeOutTimerRef.current) {
      clearInterval(fadeOutTimerRef.current)
      fadeOutTimerRef.current = null
    }
  }

  function applyRampVolume(): void {
    const audio = audioRef.current
    if (!audio || startedAtRef.current === null) return
    const elapsed = Date.now() - startedAtRef.current
    const fraction = volumeFractionForElapsed(elapsed)
    const target = Math.max(0, Math.min(1, (volumeRef.current / 100) * fraction))
    audio.volume = audio.volume + (target - audio.volume) * VOLUME_EASE_FACTOR
  }

  function fadeOutAndStop(): void {
    const audio = audioRef.current
    if (!audio) return
    stopFadeOutTimer() // never more than one fade-out running at once
    fadeOutTimerRef.current = setInterval(() => {
      const next = audio.volume * FADE_OUT_DECAY
      if (next < FADE_OUT_SILENCE_THRESHOLD) {
        stopFadeOutTimer()
        audio.volume = 0
        audio.pause()
        audio.currentTime = 0
        return
      }
      audio.volume = next
    }, FADE_OUT_TICK_MS)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const shouldPlay = active && enabled

    if (shouldPlay) {
      stopFadeOutTimer() // starting again cancels any fade-out in progress
      if (audio.paused) {
        startedAtRef.current = Date.now()
        // Explicit silent starting point, not the Audio element's
        // meaningless default of 1.0 — the ramp then eases UP from here
        // toward the soft tier, a genuine fade-in rather than a jump.
        audio.volume = 0
        applyRampVolume()
        audio.play().catch((error: unknown) => {
          console.warn('[useAlarm] play() failed, staying silent:', error)
          audio.currentTime = 0
        })
        stopRampTimer()
        rampTimerRef.current = setInterval(applyRampVolume, RAMP_TICK_MS)
      } else {
        // Already playing — only the volume setting changed. Reapply at
        // the current ramp tier without restarting the ramp or the loop.
        applyRampVolume()
      }
    } else if (!audio.paused) {
      stopRampTimer()
      startedAtRef.current = null
      fadeOutAndStop()
    }
  }, [active, enabled, volume, sound])

  // Belt-and-suspenders: guarantees both timers are cleared on unmount
  // even if the branches above somehow didn't run.
  useEffect(() => {
    return () => {
      stopRampTimer()
      stopFadeOutTimer()
    }
  }, [])
}

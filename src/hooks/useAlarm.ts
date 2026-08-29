import { useEffect, useRef } from 'react'
import { alarmEngine } from '../audio/alarmEngine'
import type { AlarmSound } from '../utils/alarmSounds'

interface UseAlarmOptions {
  /** Genuinely OFFLINE right now, already accounting for every reason
   *  not to sound (monitoring paused, snoozed). */
  active: boolean
  /** The user's alarm on/off setting. */
  enabled: boolean
  /** 0-100. */
  volume: number
  sound: AlarmSound
}

/**
 * Binds the alarm engine to React state. Deliberately thin: all the
 * playback logic lives in the engine, which is a module singleton, so
 * this hook holds no audio state of its own and cannot be the source of
 * a second alarm.
 *
 * Two effects with different jobs, which is what keeps live setting
 * changes from interrupting playback:
 *  - one keyed on whether the alarm should sound at all, which starts
 *    and stops it;
 *  - one that pushes volume/sound changes into an already-running alarm.
 * If they were merged, every drag of the volume slider would tear the
 * alarm down and start it again.
 */
export function useAlarm({ active, enabled, volume, sound }: UseAlarmOptions): void {
  const shouldPlay = active && enabled

  // Read by the start effect, which must not re-run when the settings
  // change (that is the second effect's job) but must still start with
  // current values rather than whatever they were when it last ran.
  const latest = useRef({ sound, volume })
  latest.current = { sound, volume }

  useEffect(() => {
    if (!shouldPlay) return
    alarmEngine.startAlarm(latest.current.sound, latest.current.volume)
    return () => {
      alarmEngine.stopAlarm()
    }
  }, [shouldPlay])

  useEffect(() => {
    if (!shouldPlay) return
    alarmEngine.updateAlarm(sound, volume)
  }, [shouldPlay, sound, volume])
}

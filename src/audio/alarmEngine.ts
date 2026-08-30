import { ONCE_ALARM_DURATION_MS, type AlarmMode } from '../../electron/shared/types'
import { ALARM_SOUND_SOURCES, type AlarmSound } from '../utils/alarmSounds'

const TICK_MS = 50

// Volume travel rates, expressed as the time it takes to cross the full
// 0..1 range. Rising is deliberately unhurried (it is also the fade-in);
// stopping has to feel immediate while still avoiding the click of a
// hard cut.
const RAMP_MS = 900
const FADE_OUT_MS = 250
const SILENCE = 0.001

// How often to re-attempt playback that the browser refused. Slow on
// purpose: the point is that an outage alarm eventually sounds, not that
// it hammers a blocked audio device.
const PLAY_RETRY_MS = 2_000

// Escalation tiers: how loud, as a fraction of the user's volume
// setting, the alarm gets the longer an outage lasts.
const LOUDER_AT_MS = 3_000
const STRONG_AT_MS = 10_000
const SOFT_FRACTION = 0.3
const LOUDER_FRACTION = 0.65
const STRONG_FRACTION = 1

/** Pure elapsed-time -> volume-fraction mapping, kept separate from the
 *  audio side effects so the escalation rule is one small function that
 *  can be reasoned about (and checked) on its own. */
export function volumeFractionForElapsed(elapsedMs: number): number {
  if (elapsedMs >= STRONG_AT_MS) return STRONG_FRACTION
  if (elapsedMs >= LOUDER_AT_MS) return LOUDER_FRACTION
  return SOFT_FRACTION
}

type Mode = 'idle' | 'alarm' | 'test'

/**
 * The one place in the app that plays a sound.
 *
 * A module-level singleton rather than per-component state, because the
 * thing being modelled — "is the alarm currently sounding" — is global.
 * There is exactly one HTMLAudioElement and exactly one timer for its
 * whole lifetime, so overlapping playback, a second alarm racing the
 * first, or a test tone talking over a real outage are not states this
 * can reach.
 *
 * The single ticker does all volume work: it walks the element's volume
 * toward a target that is recomputed every tick from the current mode,
 * elapsed time and the user's setting. A live volume change, an
 * escalation tier boundary and a fade-out are therefore the same
 * mechanism, not three competing ones, and none of them can strand the
 * audio at a wrong volume.
 */
class AlarmEngine {
  private audio: HTMLAudioElement | null = null
  private mode: Mode = 'idle'
  private loadedSound: AlarmSound | null = null
  private volume = 0
  private startedAt = 0
  private ticker: ReturnType<typeof setInterval> | null = null
  private fadingOut = false
  private alarmMode: AlarmMode = 'continuous'
  /** Ends a playback that is meant to stop on its own — a test tone, or
   *  a `once` alarm. Continuous alarms have no such timer: they stop
   *  when the connection comes back, and nothing else. */
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null
  private lastPlayAttemptAt = 0
  private playbackBlocked = false
  /** Bumped by every state change, so a play() promise that settles late
   *  can tell whether it is still the current intent. */
  private generation = 0

  /**
   * Starts the outage alarm, or takes over from a test tone that is
   * already playing. Idempotent: calling it again while the same alarm
   * is sounding updates the settings instead of restarting anything.
   *
   * `once` differs from `continuous` in two ways and no others: it does
   * not escalate, and it arms a timer to fade itself out. Everything
   * else — the single element, the single ticker, stopping on recovery —
   * is identical, so the two modes cannot drift apart.
   */
  startAlarm(sound: AlarmSound, volume: number, mode: AlarmMode = 'continuous'): void {
    this.clearAutoStop()
    this.volume = volume

    const resuming =
      this.mode === 'alarm' && this.alarmMode === mode && !this.fadingOut && this.isPlaying()
    this.mode = 'alarm'
    this.alarmMode = mode
    this.fadingOut = false
    // A restart after a stop (or after a fade-out began) is a new
    // outage, so the escalation starts over. A no-op re-entry is not.
    if (!resuming) this.startedAt = Date.now()

    this.ensurePlaying(sound, true)

    if (mode === 'once') {
      this.autoStopTimer = setTimeout(() => {
        this.autoStopTimer = null
        if (this.mode === 'alarm') this.beginFadeOut()
      }, ONCE_ALARM_DURATION_MS)
    }
  }

  /** Applies live setting changes without interrupting playback: the
   *  ticker eases to the new volume, and a new sound swaps in at the
   *  volume already reached rather than restarting at silence. */
  updateAlarm(sound: AlarmSound, volume: number): void {
    if (this.mode !== 'alarm') return
    this.volume = volume
    if (sound === this.loadedSound) return

    const wasPlaying = this.isPlaying()
    this.loadSound(sound, true)
    if (wasPlaying) this.play()
  }

  /** Fades out and stops. Safe to call when nothing is playing. */
  stopAlarm(): void {
    if (this.mode !== 'alarm') return
    this.beginFadeOut()
  }

  /**
   * Plays the chosen sound at the configured volume for `durationMs`.
   * Refused while a real alarm is sounding — the user can already hear
   * it, and two sources fighting over one element is exactly what this
   * class exists to prevent.
   */
  playTest(sound: AlarmSound, volume: number, durationMs: number): void {
    if (this.mode === 'alarm') return

    this.clearAutoStop()
    this.mode = 'test'
    this.fadingOut = false
    this.volume = volume
    this.startedAt = Date.now()
    // Restarted from the beginning so repeated presses sound the same,
    // rather than resuming a half-faded tail. Looped, so the test lasts
    // its full duration instead of falling silent when the one-second
    // sample ends.
    this.restart(sound, true)

    this.autoStopTimer = setTimeout(() => {
      this.autoStopTimer = null
      if (this.mode === 'test') this.beginFadeOut()
    }, durationMs)
  }

  /** Stops a test tone if one is playing; leaves a real alarm alone. */
  stopTest(): void {
    if (this.mode !== 'test') return
    this.clearAutoStop()
    this.beginFadeOut()
  }

  private isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused
  }

  // ---- internals -------------------------------------------------------

  /** Continues whatever is already sounding, or starts it from silence
   *  if nothing is. Never resets the volume of audio that is already
   *  playing — that would be an audible dip on a no-op re-entry. */
  private ensurePlaying(sound: AlarmSound, loop: boolean): void {
    const audio = this.element()
    audio.loop = loop

    if (sound !== this.loadedSound) {
      const wasPlaying = this.isPlaying()
      this.loadSound(sound, loop)
      if (wasPlaying) {
        this.play()
        this.startTicker()
        return
      }
    }

    if (audio.paused) {
      this.restart(sound, loop)
      return
    }
    this.startTicker()
  }

  private restart(sound: AlarmSound, loop: boolean): void {
    const audio = this.element()
    if (sound !== this.loadedSound) this.loadSound(sound, loop)
    audio.loop = loop
    this.resetPosition()
    // Always from silence: the ticker ramps up from here, which is what
    // makes the start a fade-in instead of a click.
    audio.volume = 0
    this.play()
    this.startTicker()
  }

  /** Points the element at a different sound. Assigning `src` pauses the
   *  element per the HTML media spec, so callers that were mid-playback
   *  resume with play() — the element's volume survives the swap, so
   *  that resume continues at the level already reached, without a jump. */
  private loadSound(sound: AlarmSound, loop: boolean): void {
    const audio = this.element()
    this.loadedSound = sound
    audio.src = ALARM_SOUND_SOURCES[sound]
    audio.loop = loop
  }

  private play(): void {
    const audio = this.element()
    const generation = ++this.generation
    this.lastPlayAttemptAt = Date.now()

    audio
      .play()
      .then(() => {
        if (generation !== this.generation) return
        this.playbackBlocked = false
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return
        // Logged once per blocked stretch rather than once per retry.
        if (!this.playbackBlocked) {
          this.playbackBlocked = true
          console.warn('[alarm] playback was refused by the browser:', error)
        }
        // A test tone that won't start is simply abandoned. A real alarm
        // is not: the ticker keeps retrying, because an outage the user
        // never hears about is the failure this whole class exists to
        // prevent.
        if (this.mode === 'test') this.finishStop()
      })
  }

  private element(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio()
      this.audio.preload = 'auto'
      this.audio.volume = 0
    }
    return this.audio
  }

  private beginFadeOut(): void {
    this.generation += 1
    if (!this.audio || this.audio.paused) {
      this.finishStop()
      return
    }
    this.fadingOut = true
    this.startTicker()
  }

  private finishStop(): void {
    this.stopTicker()
    this.clearAutoStop()
    this.fadingOut = false
    this.mode = 'idle'
    if (this.audio) {
      this.audio.pause()
      this.audio.volume = 0
      this.resetPosition()
    }
  }

  /** Rewinding is guarded: seeking an element that has never loaded a
   *  source is allowed to throw, and must not take the engine with it. */
  private resetPosition(): void {
    try {
      if (this.audio) this.audio.currentTime = 0
    } catch {
      // Nothing loaded yet — there is no position to reset.
    }
  }

  private startTicker(): void {
    if (this.ticker !== null) return
    this.ticker = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTicker(): void {
    if (this.ticker === null) return
    clearInterval(this.ticker)
    this.ticker = null
  }

  private tick(): void {
    const audio = this.audio
    if (!audio || this.mode === 'idle') {
      this.stopTicker()
      return
    }

    // Playback can be refused (autoplay policy) or interrupted (an audio
    // device disappearing). While the alarm should be sounding and
    // isn't, keep trying at a bounded cadence instead of staying silent
    // for the rest of the outage.
    if (this.mode === 'alarm' && !this.fadingOut && audio.paused) {
      if (Date.now() - this.lastPlayAttemptAt >= PLAY_RETRY_MS) this.play()
    }

    const target = this.fadingOut ? 0 : this.targetVolume()
    const rate = TICK_MS / (this.fadingOut ? FADE_OUT_MS : RAMP_MS)
    const distance = target - audio.volume
    const step = Math.sign(distance) * Math.min(Math.abs(distance), rate)
    audio.volume = Math.min(1, Math.max(0, audio.volume + step))

    if (this.fadingOut && audio.volume <= SILENCE) {
      this.finishStop()
    }
  }

  private targetVolume(): number {
    const base = Math.min(1, Math.max(0, this.volume / 100))
    // Escalation belongs to a continuous alarm, which has time to build.
    // A single burst and a test both play at exactly the volume the user
    // configured — starting a three-second alert at 30% would make the
    // setting mean nothing.
    if (this.mode !== 'alarm' || this.alarmMode !== 'continuous') return base
    return base * volumeFractionForElapsed(Date.now() - this.startedAt)
  }

  private clearAutoStop(): void {
    if (this.autoStopTimer === null) return
    clearTimeout(this.autoStopTimer)
    this.autoStopTimer = null
  }
}

export const alarmEngine = new AlarmEngine()

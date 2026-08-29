import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, HistoryEvent, RetryStrategy } from '../ipc/ipc-client'
import { getHistory } from '../ipc/ipc-client'
import { ALARM_SOUND_OPTIONS, ALARM_SOUND_SOURCES, type AlarmSound } from '../utils/alarmSounds'
import { useExitTransition } from '../hooks/useExitTransition'
import ToggleSwitch from '../components/ToggleSwitch'
import SegmentedControl from '../components/SegmentedControl'
import VolumeSlider from '../components/VolumeSlider'
import HistoryList from '../components/HistoryList'

interface SettingsPanelProps {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  onBack: () => void
  justSaved: boolean
}

const COOLDOWN_OPTIONS: { value: string; label: string }[] = [
  { value: '5000', label: '5s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
]

const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: '2000', label: '2s' },
  { value: '5000', label: '5s' },
  { value: '10000', label: '10s' },
]

const RETRY_OPTIONS: { value: RetryStrategy; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'aggressive', label: 'Aggressive' },
]

const TEST_ALARM_DURATION_MS = 2_000
const SAVED_EXIT_MS = 200

// One bordered card per settings group — the border/background does the
// grouping, so the divider lines the old layout used between sections
// aren't needed anymore.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </section>
  )
}

function FieldLabel({ children, description }: { children: string; description?: string }) {
  return (
    <div className="mb-2">
      <p className="text-xs text-slate-400">{children}</p>
      {description && <p className="mt-0.5 text-[11px] text-slate-600">{description}</p>}
    </div>
  )
}

export default function SettingsPanel({ settings, onUpdate, onBack, justSaved }: SettingsPanelProps) {
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const testAudioRef = useRef<HTMLAudioElement | null>(null)

  // Keeps the "Saved" text mounted for SAVED_EXIT_MS after justSaved goes
  // false so it can fade out instead of vanishing — same pattern the
  // offline overlay already uses for its own exit transition.
  const showSavedIndicator = useExitTransition(justSaved, SAVED_EXIT_MS)

  useEffect(() => {
    let cancelled = false
    getHistory()
      .then((events) => {
        if (!cancelled) setHistory(events)
      })
      .catch((error: unknown) => {
        console.error('[SettingsPanel] Failed to fetch history:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Guards against overlapping test playback (no overlapping sounds) and
  // stops a still-playing test if the panel closes early.
  useEffect(() => {
    return () => {
      testAudioRef.current?.pause()
      testAudioRef.current = null
    }
  }, [])

  function handleTestAlarm(): void {
    if (testAudioRef.current) return
    const audio = new Audio(ALARM_SOUND_SOURCES[settings.alarm.sound])
    audio.volume = settings.alarm.volume / 100
    testAudioRef.current = audio
    audio.play().catch((error: unknown) => {
      console.warn('[SettingsPanel] Test alarm playback failed:', error)
      testAudioRef.current = null
    })
    setTimeout(() => {
      testAudioRef.current?.pause()
      testAudioRef.current = null
    }, TEST_ALARM_DURATION_MS)
  }

  return (
    <div className="animate-fade-in flex h-screen w-screen flex-col bg-[radial-gradient(ellipse_at_top,rgba(30,41,59,0.4),rgba(2,6,23,1)_60%)] text-slate-100">
      <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-2 py-1 text-sm text-slate-400 transition-colors duration-150 hover:text-slate-100 active:scale-95"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-slate-200">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-4">
          <Section title="Alarm">
            <ToggleSwitch
              checked={settings.alarm.enabled}
              onChange={(enabled) => onUpdate({ alarm: { ...settings.alarm, enabled } })}
              label="Enable alarm"
              description="Play a sound when the connection drops"
            />
            <div>
              <FieldLabel description="How loud the alarm sounds">Volume</FieldLabel>
              <VolumeSlider
                value={settings.alarm.volume}
                onChange={(volume) => onUpdate({ alarm: { ...settings.alarm, volume } })}
              />
            </div>
            <div>
              <FieldLabel description="Choose the alarm tone">Sound</FieldLabel>
              <SegmentedControl
                options={ALARM_SOUND_OPTIONS}
                value={settings.alarm.sound}
                onChange={(sound: AlarmSound) => onUpdate({ alarm: { ...settings.alarm, sound } })}
              />
            </div>
            <button
              type="button"
              onClick={handleTestAlarm}
              className="self-start rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700 active:scale-95"
            >
              Test Alarm
            </button>
          </Section>

          <Section title="Notifications">
            <ToggleSwitch
              checked={settings.notifications.enabled}
              onChange={(enabled) => onUpdate({ notifications: { ...settings.notifications, enabled } })}
              label="Enable notifications"
              description="Show a system notification when your connection status changes"
            />
            <div>
              <FieldLabel description="Minimum time between two notifications">
                Cooldown between notifications
              </FieldLabel>
              <SegmentedControl
                options={COOLDOWN_OPTIONS}
                value={String(settings.notifications.cooldownMs)}
                onChange={(v) =>
                  onUpdate({ notifications: { ...settings.notifications, cooldownMs: Number(v) } })
                }
              />
            </div>
          </Section>

          <Section title="Monitoring">
            <div>
              <FieldLabel description="How often to check your connection">Check interval</FieldLabel>
              <SegmentedControl
                options={INTERVAL_OPTIONS}
                value={String(settings.monitoring.intervalMs)}
                onChange={(v) =>
                  onUpdate({ monitoring: { ...settings.monitoring, intervalMs: Number(v) } })
                }
              />
            </div>
            <div>
              <FieldLabel description="Aggressive reacts to changes sooner; Normal is more conservative">
                Retry strategy
              </FieldLabel>
              <SegmentedControl
                options={RETRY_OPTIONS}
                value={settings.monitoring.retryStrategy}
                onChange={(retryStrategy: RetryStrategy) =>
                  onUpdate({ monitoring: { ...settings.monitoring, retryStrategy } })
                }
              />
            </div>
          </Section>

          <Section title="Recent Activity">
            <HistoryList events={history} />
          </Section>
        </div>
      </div>

      {/* Fixed near the bottom of the body, not the header — closer to
          where the controls the user is actually touching live. */}
      {showSavedIndicator && (
        <div
          className={`pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-800/90 px-3 py-2 text-xs font-medium text-emerald-400 shadow-lg backdrop-blur-sm ${
            justSaved ? 'animate-fade-in' : 'animate-fade-out'
          }`}
        >
          Saved
        </div>
      )}
    </div>
  )
}

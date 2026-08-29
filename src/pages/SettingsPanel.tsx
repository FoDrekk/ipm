import { useEffect, useState, type ReactNode } from 'react'
import type { AlarmMode, AppSettings, HistoryEvent, RetryStrategy } from '../ipc/ipc-client'
import { getHistory } from '../ipc/ipc-client'
import { ALARM_SOUND_OPTIONS, type AlarmSound } from '../utils/alarmSounds'
import { alarmEngine } from '../audio/alarmEngine'
import { useConnectivityStore } from '../state/connectivity.store'
import { useExitTransition } from '../hooks/useExitTransition'
import { useAutostart } from '../hooks/useAutostart'
import { useDiagnostics } from '../hooks/useDiagnostics'
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

const ALARM_MODE_OPTIONS: { value: AlarmMode; label: string }[] = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'once', label: 'Once' },
]

const TEST_ALARM_DURATION_MS = 2_000
const SAVED_EXIT_MS = 200

// One bordered card per settings group — the border/background does the
// grouping, so no divider lines between sections are needed.
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

/** Reports its own outcome briefly after running, so a test that quietly
 *  did nothing is distinguishable from one that worked. */
function DiagnosticButton({
  label,
  result,
  onClick,
}: {
  label: string
  result: boolean | undefined
  onClick: () => void
}) {
  const tone =
    result === undefined
      ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
      : result
        ? 'bg-emerald-500/20 text-emerald-300'
        : 'bg-red-500/20 text-red-300'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 active:scale-95 ${tone}`}
    >
      {result === undefined ? label : result ? `${label} — sent` : `${label} — unavailable`}
    </button>
  )
}

export default function SettingsPanel({ settings, onUpdate, onBack, justSaved }: SettingsPanelProps) {
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const { enabled: autostart, setEnabled: setAutostart } = useAutostart()

  // The engine refuses a test while the outage alarm is sounding — one
  // audio source, so they cannot overlap. Reflecting that in the button
  // makes the refusal visible instead of a click that does nothing.
  const isAlarmSounding = useConnectivityStore(
    (state) => state.isMonitoring && state.status === 'OFFLINE'
  )
  const diagnostics = useDiagnostics()

  // Keeps the "Saved" text mounted for SAVED_EXIT_MS after justSaved goes
  // false so it can fade out instead of vanishing.
  const showSavedIndicator = useExitTransition(justSaved, SAVED_EXIT_MS)

  useEffect(() => {
    let cancelled = false
    getHistory()
      .then((events) => {
        if (!cancelled) setHistory(events)
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load history:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Leaving this screen stops a test tone that is still playing. A real
  // alarm is untouched: the engine only ever stops what it started as a
  // test, so navigating away mid-outage cannot silence the alert.
  useEffect(() => {
    return () => {
      alarmEngine.stopTest()
    }
  }, [])

  function handleTestAlarm(): void {
    alarmEngine.playTest(settings.alarm.sound, settings.alarm.volume, TEST_ALARM_DURATION_MS)
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
            <div>
              <FieldLabel description="Continuous keeps sounding until the connection is back; Once is a single alert when it drops">
                Alarm mode
              </FieldLabel>
              <SegmentedControl
                options={ALARM_MODE_OPTIONS}
                value={settings.alarm.mode}
                onChange={(mode: AlarmMode) => onUpdate({ alarm: { ...settings.alarm, mode } })}
              />
            </div>
            <button
              type="button"
              onClick={handleTestAlarm}
              disabled={isAlarmSounding}
              className="self-start rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700 active:scale-95 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-slate-800"
            >
              {isAlarmSounding ? 'Alarm is sounding' : 'Test Alarm'}
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
              <FieldLabel description="Aggressive confirms a drop after fewer failed checks; Normal waits for more">
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

          <Section title="Startup">
            <ToggleSwitch
              checked={autostart ?? false}
              onChange={setAutostart}
              label="Launch on startup"
              description={
                autostart === null
                  ? 'Reading the current Windows setting…'
                  : 'Start Internet Monitor Pro automatically when you sign in to Windows'
              }
            />
            <ToggleSwitch
              checked={settings.startup.startMonitoring}
              onChange={(startMonitoring) =>
                onUpdate({ startup: { ...settings.startup, startMonitoring } })
              }
              label="Start monitoring automatically"
              description="Begin checking as soon as the app launches"
            />
            <ToggleSwitch
              checked={settings.startup.startMinimized}
              onChange={(startMinimized) =>
                onUpdate({ startup: { ...settings.startup, startMinimized } })
              }
              label="Start minimized to tray"
              description="Launch into the tray without opening the window — monitoring, alerts and the alarm still run"
            />
          </Section>

          <Section title="Diagnostics">
            <p className="-mt-1 text-[11px] text-slate-600">
              Each test drives the real service, so a passing test means the feature itself works.
            </p>
            <div className="flex flex-wrap gap-2">
              <DiagnosticButton
                label="Test Notification"
                result={diagnostics.results.notification}
                onClick={() => diagnostics.runTest('notification')}
              />
              <DiagnosticButton
                label="Test Tray"
                result={diagnostics.results.tray}
                onClick={() => diagnostics.runTest('tray')}
              />
            </div>

            <div className="mt-1 flex flex-col gap-2 rounded-lg border border-slate-800/70 bg-slate-950/40 p-3">
              <p className="text-xs text-slate-400">Offline simulation</p>
              <p className="text-[11px] text-slate-600">
                Forces connection checks to fail so the real offline path runs end to end — overlay,
                alarm, notification, window restore and history. Stops on its own if the app is
                restarted.
              </p>
              {diagnostics.isSimulating ? (
                <button
                  type="button"
                  onClick={() => diagnostics.toggleSimulation(false)}
                  className="self-start rounded-lg bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-300 transition-colors duration-150 hover:bg-amber-500/30 active:scale-95"
                >
                  Stop Simulation
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => diagnostics.toggleSimulation(true)}
                  className="self-start rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700 active:scale-95"
                >
                  Simulate Offline
                </button>
              )}
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

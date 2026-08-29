import { useState } from 'react'
import { useSettings } from './hooks/useSettings'
import Dashboard from './pages/Dashboard'
import SettingsPanel from './pages/SettingsPanel'

type View = 'dashboard' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const { settings, updateSettings, justSaved } = useSettings()

  // Settings load via a local IPC call (no network involved), so this is
  // brief — just enough to avoid rendering with defaults that don't
  // match what's actually persisted. Matches the app background so
  // there's no flash of the wrong color while it resolves.
  if (!settings) {
    return <div className="h-screen w-screen bg-slate-950" />
  }

  if (view === 'settings') {
    return (
      <SettingsPanel
        settings={settings}
        onUpdate={updateSettings}
        onBack={() => setView('dashboard')}
        justSaved={justSaved}
      />
    )
  }

  return (
    <Dashboard
      settings={settings}
      onOpenSettings={() => setView('settings')}
      onUpdateSettings={updateSettings}
    />
  )
}

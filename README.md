# Internet Monitor Pro

A Windows desktop app that continuously monitors your internet connection in the background, with a full-screen alert and alarm when it drops, a system tray presence, and a short history of recent connection changes.

## Features

- Continuous connectivity checks at a configurable interval, running in the main process (not tied to the window being open)
- Three-state detection — **Connected**, **Unstable Network**, and **Connection Lost** — not just up/down, with a short debounce before a drop is treated as confirmed
- Full-screen alert with a progressive alarm (soft → louder → strong) when the connection is genuinely lost, with snooze and Esc-to-dismiss
- System tray icon that reflects live status, with quick start/stop monitoring and status at a glance
- Desktop notifications on connection loss/recovery, with a configurable cooldown
- Connection history (last 20 events)
- Optional launch at Windows startup
- All settings persist across restarts and are validated/repaired automatically if the settings file is ever corrupted

## Installing

1. Download `Internet Monitor Pro Setup 1.0.0.exe` (or build it yourself — see [Building the installer](#building-the-installer) below)
2. Run the installer. You'll be able to choose the install location; a Desktop and Start Menu shortcut are created automatically
3. Launch **Internet Monitor Pro** from the Start Menu or Desktop shortcut

Monitoring starts automatically as soon as the app launches — there's nothing else to turn on.

## Using the app

- Closing the window doesn't quit the app — it keeps running in the system tray so monitoring continues. Right-click the tray icon and choose **Exit App** to fully quit
- Click the gear icon on the dashboard to open Settings: alarm volume/sound, notification cooldown, monitoring interval, and retry strategy all live there
- Turn on **Launch on Startup** in Settings if you want the app running in the background automatically whenever Windows starts

## Development

### Requirements

- Node.js 20 LTS or newer
- Windows, for testing the packaged app and building the installer without extra setup. Development itself can run on any OS; building the Windows installer from Linux/macOS additionally requires [Wine](https://www.winehq.org/) for the icon/version-embedding step

### Setup

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite dev server, compiles the main process in watch mode, and launches Electron once both are ready.

### Building

```bash
npm run build      # production build: renderer (Vite) + main process (tsc)
npm start           # run the production build
npm run dist:win    # build a distributable Windows installer
```

### Building the installer

```bash
npm run dist:win
```

This runs the full production build, then packages a Windows installer (NSIS) to:

```
release/Internet Monitor Pro Setup 1.0.0.exe
```

### Project structure

```
internet-monitor-pro/
├── electron/                 # Main process (Node.js / Electron)
│   ├── main.ts                #   entry point, IPC handlers, service wiring
│   ├── preload.ts             #   contextBridge API surface
│   └── services/
│       ├── monitor.service.ts       # connectivity detection engine
│       ├── tray.service.ts          # system tray
│       ├── notification.service.ts
│       └── storage.service.ts       # JSON persistence + settings validation
├── src/                       # Renderer (React UI)
│   ├── pages/                  Dashboard, SettingsPanel
│   ├── components/             StatusCard, StatusIndicator, OfflineOverlay, etc.
│   ├── hooks/                  useAlarm, useSettings, useEnterDelay, etc.
│   ├── state/                  connectivity.store.ts (Zustand)
│   ├── ipc/                    ipc-client.ts
│   └── utils/                  statusVisuals.ts, alarmSounds.ts
├── assets/
│   ├── icons/app-icon.ico      # installer/exe icon
│   └── tray/*.png              # tray status icons
└── package.json
```

### Where data is stored

Settings and connection history are saved to:

```
%APPDATA%\Internet Monitor Pro\app-data.json
```

This is the same location whether you're running in development or from the installed app. To reset everything to defaults: fully quit the app (tray icon → **Exit App**, not just closing the window), then delete that file. It's recreated automatically with defaults the next time the app launches.

import type { ConnectivityStatus, HistoryStatus } from '../ipc/ipc-client'

export interface StatusVisual {
  message: string
  dot: string
  text: string
  glow: string
  pulse?: boolean
}

// Single source of truth per status — color, glow, pulse, and the
// human-readable message all live together, so there's one table to
// update, not several that have to be kept in sync.
export const STATUS_INFO: Record<ConnectivityStatus, StatusVisual> = {
  ONLINE: {
    message: 'Connected',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
    glow: 'shadow-[0_0_16px_rgba(16,185,129,0.65)]',
  },
  DEGRADED: {
    message: 'Unstable Network',
    dot: 'bg-amber-500',
    text: 'text-amber-400',
    glow: 'shadow-[0_0_16px_rgba(245,158,11,0.65)]',
    pulse: true,
  },
  VERIFYING: {
    message: 'Checking connection…',
    dot: 'bg-amber-500',
    text: 'text-amber-400',
    glow: 'shadow-[0_0_16px_rgba(245,158,11,0.65)]',
    pulse: true,
  },
  OFFLINE: {
    message: 'Connection Lost',
    dot: 'bg-red-500',
    text: 'text-red-400',
    glow: 'shadow-[0_0_16px_rgba(239,68,68,0.65)]',
    pulse: true,
  },
}

/** Timeline entries include PAUSED, which is not a connectivity status
 *  and has no place in STATUS_INFO — it says nothing about the
 *  connection, only that nobody was watching it. */
export const HISTORY_VISUALS: Record<HistoryStatus, { label: string; text: string }> = {
  ONLINE: { label: 'ONLINE', text: STATUS_INFO.ONLINE.text },
  DEGRADED: { label: 'DEGRADED', text: STATUS_INFO.DEGRADED.text },
  OFFLINE: { label: 'OFFLINE', text: STATUS_INFO.OFFLINE.text },
  PAUSED: { label: 'PAUSED', text: 'text-slate-500' },
}

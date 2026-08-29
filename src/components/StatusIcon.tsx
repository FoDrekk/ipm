import type { ConnectivityStatus } from '../ipc/ipc-client'
import { STATUS_INFO } from '../utils/statusVisuals'

interface StatusIconProps {
  status: ConnectivityStatus
  /** Tailwind size classes, e.g. 'h-6 w-6' or 'h-16 w-16'. */
  sizeClassName: string
  /** Uses the gentler pulse-alert animation even for OFFLINE, which
   *  otherwise gets the more pronounced pulse-strong (see index.css) —
   *  for contexts, like the fullscreen overlay, that are already
   *  visually intense on their own and don't need the icon to escalate
   *  further on top of that. */
  gentlePulse?: boolean
}

/**
 * A colored circle with a simple glyph — checkmark for ONLINE, "!" for
 * DEGRADED/VERIFYING, "X" for OFFLINE. Plain SVG lines/paths, no icon
 * library: the shapes are simple enough not to need one, and colors come
 * from the same STATUS_INFO table StatusIndicator's text already uses.
 */
export default function StatusIcon({ status, sizeClassName, gentlePulse }: StatusIconProps) {
  const { dot, glow, pulse } = STATUS_INFO[status]
  const animationClass = !pulse
    ? ''
    : status === 'OFFLINE'
      ? gentlePulse
        ? 'animate-pulse-alert'
        : 'animate-pulse-strong'
      : 'animate-subtle-sway'

  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 rounded-full transition-colors duration-300 ${sizeClassName} ${dot} ${glow} ${animationClass}`}
    >
      {status === 'ONLINE' && (
        <path
          d="M7 12.5l3 3 7-7"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {(status === 'DEGRADED' || status === 'VERIFYING') && (
        <>
          <line x1="12" y1="6" x2="12" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17.3" r="1.3" fill="white" />
        </>
      )}
      {status === 'OFFLINE' && (
        <>
          <line x1="8" y1="8" x2="16" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="16" y1="8" x2="8" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

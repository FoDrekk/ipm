import { LATENCY_QUALITY_LABELS, latencyQuality } from '../../electron/shared/types'

interface LatencyReadoutProps {
  latencyMs: number | null
}

const QUALITY_TEXT = {
  EXCELLENT: 'text-emerald-400',
  GOOD: 'text-emerald-400/80',
  HIGH: 'text-amber-400',
  VERY_HIGH: 'text-orange-400',
} as const

/**
 * The round-trip to the endpoint the monitor just checked, with a plain
 * word for what that number means. Informational only — latency never
 * decides the connectivity status, and this deliberately says nothing
 * about being online or offline.
 */
export default function LatencyReadout({ latencyMs }: LatencyReadoutProps) {
  if (latencyMs === null) {
    return (
      <p className="text-sm text-slate-500">
        Latency: <span className="text-slate-400">—</span>
      </p>
    )
  }

  const quality = latencyQuality(latencyMs)

  return (
    <p className="text-sm text-slate-500">
      Latency: <span className="text-slate-300">{Math.round(latencyMs)} ms</span>{' '}
      <span className={QUALITY_TEXT[quality]}>· {LATENCY_QUALITY_LABELS[quality]}</span>
    </p>
  )
}

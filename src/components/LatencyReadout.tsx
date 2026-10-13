import { useEffect, useState } from 'react'
import { LATENCY_QUALITY_LABELS, latencyQuality } from '../../electron/shared/types'
import { getLatency } from '../ipc/ipc-client'

interface LatencyReadoutProps {
  latencyMs: number | null
}

const QUALITY_TEXT = {
  EXCELLENT: 'text-emerald-400',
  GOOD: 'text-emerald-400/80',
  HIGH: 'text-amber-400',
  VERY_HIGH: 'text-orange-400',
} as const

function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const max = Math.max(...values, 10)
  const min = Math.min(...values, 0)
  const span = Math.max(1, max - min)
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * The round-trip to the endpoint the monitor just checked, with a plain
 * word for what that number means. Informational only — latency never
 * decides the connectivity status, and this deliberately says nothing
 * about being online or offline.
 */
export default function LatencyReadout({ latencyMs }: LatencyReadoutProps) {
  const [history, setHistory] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    getLatency()
      .then((samples) => {
        if (!cancelled) setHistory(samples.slice(-60).map((s) => s.latencyMs))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [latencyMs])

  if (latencyMs === null) {
    return (
      <p className="text-sm text-slate-500">
        Latency: <span className="text-slate-400">—</span>
      </p>
    )
  }

  const quality = latencyQuality(latencyMs)
  const points = sparkPoints(history.length >= 2 ? history : [latencyMs, latencyMs], 72, 20)

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-sm text-slate-500">
        Latency: <span className="text-slate-300">{Math.round(latencyMs)} ms</span>{' '}
        <span className={QUALITY_TEXT[quality]}>· {LATENCY_QUALITY_LABELS[quality]}</span>
      </p>
      {points && (
        <svg width="72" height="20" className="opacity-70" aria-hidden="true">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" className="text-slate-500" />
        </svg>
      )}
    </div>
  )
}

import type { ReactNode } from 'react'

interface StatusCardProps {
  children: ReactNode
}

export default function StatusCard({ children }: StatusCardProps) {
  return (
    <div className="animate-card-enter flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-slate-800 bg-slate-900 p-10 shadow-2xl shadow-black/40 ring-1 ring-white/5">
      {children}
    </div>
  )
}

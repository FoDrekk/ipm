/**
 * Says, unmissably, that the outage on screen is not real. Without it a
 * simulated OFFLINE is indistinguishable from a genuine one — which is
 * the whole point of the simulation, and exactly why it needs a label.
 */
export default function SimulationBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center">
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
      <span className="text-[11px] font-medium tracking-wide text-amber-300">
        Simulation active — connection checks are being forced to fail
      </span>
    </div>
  )
}

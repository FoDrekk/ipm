interface VolumeSliderProps {
  value: number
  onChange: (value: number) => void
}

export default function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-emerald-500"
        aria-label="Alarm volume"
      />
      <span className="w-10 shrink-0 text-right text-sm text-slate-400">{value}%</span>
    </div>
  )
}

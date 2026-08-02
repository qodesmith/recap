/** PROTOTYPE chrome — deliberately not part of any design being evaluated. */
import type {Dataset} from './store'

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  dataset,
  onDataset,
  onReset,
  segmentCount,
}: {
  variants: Array<{key: string; name: string}>
  current: string
  onChange: (key: string) => void
  dataset: Dataset
  onDataset: (d: Dataset) => void
  onReset: () => void
  segmentCount: number
}) {
  const i = Math.max(
    0,
    variants.findIndex(v => v.key === current)
  )
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key)

  return (
    <div className="fixed bottom-1.5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-white px-2 py-1.5 text-black shadow-2xl ring-1 ring-black/20">
      <button
        onClick={() => go(-1)}
        className="grid size-7 place-items-center rounded-full text-lg leading-none hover:bg-black/10"
        aria-label="Previous variant">
        ‹
      </button>
      <div className="min-w-52 px-2 text-center text-xs font-semibold tracking-tight">
        {variants[i].key} — {variants[i].name}
      </div>
      <button
        onClick={() => go(1)}
        className="grid size-7 place-items-center rounded-full text-lg leading-none hover:bg-black/10"
        aria-label="Next variant">
        ›
      </button>
      <span className="mx-1 h-5 w-px bg-black/15" />
      <button
        onClick={() => onDataset(dataset === 'real' ? 'stress' : 'real')}
        className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/10">
        {dataset === 'real' ? `real · ${segmentCount} segs` : `stress · ${segmentCount} segs`}
      </button>
      <button
        onClick={onReset}
        className="rounded-full px-2 py-1 text-[11px] font-semibold text-black/60 hover:bg-black/10">
        reset
      </button>
    </div>
  )
}

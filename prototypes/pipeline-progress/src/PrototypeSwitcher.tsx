/** PROTOTYPE chrome — deliberately not part of any design being evaluated. */
export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: Array<{key: string; name: string}>
  current: string
  onChange: (key: string) => void
}) {
  const i = Math.max(
    0,
    variants.findIndex(v => v.key === current)
  )
  const go = (d: number) =>
    onChange(variants[(i + d + variants.length) % variants.length].key)

  return (
    <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-white px-2 py-1.5 text-black shadow-2xl ring-1 ring-black/20">
      <button
        onClick={() => go(-1)}
        className="grid size-7 place-items-center rounded-full text-lg leading-none hover:bg-black/10"
        aria-label="Previous variant">
        ‹
      </button>
      <div className="min-w-56 px-2 text-center text-xs font-semibold tracking-tight">
        {variants[i].key} — {variants[i].name}
      </div>
      <button
        onClick={() => go(1)}
        className="grid size-7 place-items-center rounded-full text-lg leading-none hover:bg-black/10"
        aria-label="Next variant">
        ›
      </button>
    </div>
  )
}

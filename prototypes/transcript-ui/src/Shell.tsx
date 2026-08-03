import {useEffect, useState} from 'react'
import {PrototypeSwitcher} from './PrototypeSwitcher'
import {store, useStore} from './store'
import {transport} from './transport'
import {VariantA} from './variants/VariantA'
import {VariantB} from './variants/VariantB'
import {VariantC} from './variants/VariantC'
import {VariantD} from './variants/VariantD'
import {fmt} from './data'

const VARIANTS = [
  {key: 'D', name: 'Conversation + lanes', render: VariantD},
  {key: 'A', name: 'Conversation', render: VariantA},
  {key: 'B', name: 'Script', render: VariantB},
  {key: 'C', name: 'Studio', render: VariantC},
]

/**
 * App chrome around the variants — a stand-in for the real window so the
 * transcript is judged at real density, not in a vacuum. The sidebar is #13's
 * decision (permanent Activity section); only the main pane is under evaluation.
 */
export function Shell() {
  const {data, overlaps, dataset} = useStore()
  const [variant, setVariant] = useState(
    () => new URLSearchParams(location.search).get('variant')?.toUpperCase() ?? 'D'
  )

  const change = (key: string) => {
    setVariant(key)
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        e.metaKey
      ) {
        return
      }
      const i = VARIANTS.findIndex(v => v.key === variant)
      if (e.key === 'ArrowLeft') change(VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length].key)
      if (e.key === 'ArrowRight') change(VARIANTS[(i + 1) % VARIANTS.length].key)
      if (e.key === ' ') {
        e.preventDefault()
        transport.toggle()
      }
      if (e.key === ',') transport.nudge(-5)
      if (e.key === '.') transport.nudge(5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant])

  const Current = (VARIANTS.find(v => v.key === variant) ?? VARIANTS[0]).render

  return (
    // pb-12 keeps the prototype switcher clear of the variants' own bottom bars.
    <div className="flex h-full pb-12">
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/8 bg-ink-2/60">
        <div className="px-4 py-3 text-sm font-semibold tracking-tight">Recap</div>
        <div className="px-4 pb-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Library
        </div>
        <div className="px-2">
          {[
            {t: data.recording.title, sub: `${fmt(data.recording.durationSeconds)} · 2 tracks`, on: true},
            {t: 'Standup 2026-07-28', sub: '14:02 · 1 track', on: false},
            {t: 'Interview — imported.m4a', sub: '48:19 · 1 track', on: false},
          ].map(r => (
            <div
              key={r.t}
              className={`mb-0.5 truncate rounded-md px-2 py-1.5 text-xs ${
                r.on ? 'bg-white/10 text-white' : 'text-slate-400'
              }`}>
              <div className="truncate font-medium">{r.t}</div>
              <div className="text-[10px] text-slate-500">{r.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-auto border-t border-white/8 px-4 py-3">
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Activity
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Nothing running</div>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <Current data={data} overlaps={overlaps} />
      </main>

      <PrototypeSwitcher
        variants={VARIANTS.map(({key, name}) => ({key, name}))}
        current={variant}
        onChange={change}
        dataset={dataset}
        onDataset={d => store.setDataset(d)}
        onReset={() => store.reset()}
        segmentCount={data.segments.length}
      />
    </div>
  )
}

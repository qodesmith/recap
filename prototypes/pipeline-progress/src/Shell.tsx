/**
 * PROTOTYPE — three variants of Recap's processing-progress surface (issue #13),
 * switchable via ?variant= and the floating bottom bar.
 *
 * Each variant owns its whole layout, including where the global "I'm still
 * working" indicator lives — that placement is half the question.
 */
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  cancel as doCancel,
  createWorld,
  startCapture as doStartCapture,
  startTranscribe,
  stopCapture as doStopCapture,
  tick,
  type World,
} from './pipeline'
import {PrototypeSwitcher} from './PrototypeSwitcher'
import type {Actions, View} from './types'
import {VariantA} from './variants/VariantA'
import {VariantB} from './variants/VariantB'
import {VariantC} from './variants/VariantC'

const VARIANTS = [
  {key: 'A', name: 'Stepper + sidebar activity', Component: VariantA},
  {key: 'B', name: 'Mission-control table + top strip', Component: VariantB},
  {key: 'C', name: 'Waveform sweep + floating dock', Component: VariantC},
]

function useVariantParam() {
  const read = () =>
    (new URLSearchParams(location.search).get('variant') ?? 'A').toUpperCase()
  const [variant, setVariant] = useState(read)

  useEffect(() => {
    const onPop = () => setVariant(read())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const change = useCallback((key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable
      )
        return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const i = VARIANTS.findIndex(v => v.key === variant)
      const d = e.key === 'ArrowRight' ? 1 : -1
      change(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [variant, change])

  return [variant, change] as const
}

export function Shell() {
  const [variant, setVariant] = useVariantParam()
  const worldRef = useRef<World>(createWorld())
  const [, force] = useState(0)
  const [view, setView] = useState<View>({kind: 'library'})

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      tick(worldRef.current, dt)
      force(n => n + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const w = worldRef.current
  const actions: Actions = {
    transcribe: id => startTranscribe(w, id),
    cancel: id => doCancel(w, id),
    startCapture: () => doStartCapture(w),
    stopCapture: id => doStopCapture(w, id),
  }

  const entry = VARIANTS.find(v => v.key === variant) ?? VARIANTS[0]
  const Variant = entry.Component

  return (
    <>
      <Variant world={w} view={view} navigate={setView} actions={actions} />
      <ControlPanel world={w} onChange={() => force(n => n + 1)} />
      <PrototypeSwitcher
        variants={VARIANTS.map(({key, name}) => ({key, name}))}
        current={entry.key}
        onChange={setVariant}
      />
    </>
  )
}

/** PROTOTYPE chrome — the knobs that make the timings testable. */
function ControlPanel({world, onChange}: {world: World; onChange: () => void}) {
  const [open, setOpen] = useState(true)
  const set = <K extends keyof World>(k: K, v: World[K]) => {
    world[k] = v
    onChange()
  }
  const failable = world.recordings.flatMap(r =>
    r.tracks.map(t => ({id: t.id, label: `${r.title} — ${t.label}`}))
  )

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed top-3 right-3 z-[100] rounded-md bg-amber-400 px-2 py-1 text-[11px] font-bold text-black shadow-lg">
        PROTOTYPE CONTROLS
      </button>
    )

  return (
    <div className="fixed top-3 right-3 z-[100] w-72 space-y-3 rounded-lg bg-amber-400 p-3 text-[11px] text-black shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="font-bold tracking-wide">PROTOTYPE CONTROLS</span>
        <button onClick={() => setOpen(false)} className="font-bold">
          ×
        </button>
      </div>

      <label className="block">
        <span className="font-semibold">Sim speed — {world.speed}×</span>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={world.speed}
          onChange={e => set('speed', Number(e.target.value))}
          className="w-full"
        />
        <span className="opacity-70">1× is real time. Judge feel at 1×.</span>
      </label>

      <label className="block">
        <span className="font-semibold">Machine — {world.machine}× slower</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.5}
          value={world.machine}
          onChange={e => set('machine', Number(e.target.value))}
          className="w-full"
        />
        <span className="opacity-70">
          1× = the Mac #10 measured (79× realtime). 3–4× = slowest supported.
        </span>
      </label>

      <label className="block">
        <span className="font-semibold">
          Clustering share — {Math.round(world.clusterShare * 100)}% of diarization
        </span>
        <input
          type="range"
          min={0.2}
          max={0.9}
          step={0.05}
          value={world.clusterShare}
          onChange={e => set('clusterShare', Number(e.target.value))}
          className="w-full"
        />
        <span className="opacity-70">
          UNMEASURED — #10 never split it. This is how much of the run is pure
          spinner. Push it to 90% to see the worst case.
        </span>
      </label>

      <label className="block">
        <span className="font-semibold">Fail a track (#11)</span>
        <select
          value={world.failTrackId ?? ''}
          onChange={e => set('failTrackId', e.target.value || null)}
          className="mt-1 w-full rounded bg-white/70 px-1 py-0.5">
          <option value="">none</option>
          {failable.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

    </div>
  )
}

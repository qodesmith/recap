/**
 * PROTOTYPE — four variants of Recap's capture surface (issue #24),
 * switchable via ?variant= and the floating bottom bar.
 *
 * The variants disagree on two axes at once, because the two questions are
 * not separable: WHERE capture lives, and WHAT it becomes after Start.
 * Each variant therefore owns its entire layout — sidebar, library, the lot.
 */
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  createWorld,
  dismissNotice,
  effectiveMicDevice,
  publishFrame,
  reset,
  setMicDevice,
  start,
  stop,
  tick,
  toggleSource,
  yankMicDevice,
  restoreDevices,
  type SignalMode,
  type SourceId,
  type World,
} from './capture'
import {PrototypeSwitcher} from './PrototypeSwitcher'
import type {Actions} from './types'
import {VariantA} from './variants/VariantA'
import {VariantB} from './variants/VariantB'
import {VariantC} from './variants/VariantC'
import {VariantD} from './variants/VariantD'

const VARIANTS = [
  {key: 'A', name: 'Route, transforms in place', Component: VariantA},
  {key: 'B', name: 'Modal, hands off to Activity', Component: VariantB},
  {key: 'C', name: 'Sidebar panel, never navigates', Component: VariantC},
  {key: 'D', name: 'Fullscreen takeover', Component: VariantD},
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
        el instanceof HTMLSelectElement ||
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

  /**
   * One rAF loop drives everything. Meters ride `publishFrame` and write to
   * the DOM at 60 Hz; React re-renders only ~8×/s, or immediately whenever a
   * structural change bumps `rev`. Re-rendering the whole app every frame
   * would hide exactly the cost the real app is trying to avoid.
   */
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastRender = 0
    let lastRev = -1
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const w = worldRef.current
      tick(w, dt)
      publishFrame(w)
      if (w.rev !== lastRev || now - lastRender > 120) {
        lastRev = w.rev
        lastRender = now
        force(n => n + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const w = worldRef.current
  const actions: Actions = {
    toggleSource: s => toggleSource(w, s),
    setMicDevice: id => setMicDevice(w, id),
    start: () => start(w),
    stop: () => stop(w),
    reset: () => reset(w),
    dismissNotice: id => dismissNotice(w, id),
  }

  const entry = VARIANTS.find(v => v.key === variant) ?? VARIANTS[0]
  const Variant = entry.Component

  return (
    <>
      <Variant world={w} actions={actions} />
      <ControlPanel world={w} onChange={() => w.rev++} />
      <PrototypeSwitcher
        variants={VARIANTS.map(({key, name}) => ({key, name}))}
        current={entry.key}
        onChange={setVariant}
      />
    </>
  )
}

const SIGNAL_CHOICES: Array<{key: SignalMode; label: string}> = [
  {key: 'talking', label: 'Talking'},
  {key: 'quiet', label: 'Quiet room'},
  {key: 'dead', label: 'Dead'},
]

/** PROTOTYPE chrome — the knobs that make the meter question testable. */
function ControlPanel({world, onChange}: {world: World; onChange: () => void}) {
  const [open, setOpen] = useState(true)

  const setSignal = (s: SourceId, mode: SignalMode) => {
    world.signal[s] = mode
    onChange()
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 bottom-3 z-[100] rounded-md bg-amber-400 px-2 py-1 text-[11px] font-bold text-black shadow-lg">
        PROTOTYPE CONTROLS
      </button>
    )

  return (
    <div className="fixed right-3 bottom-3 z-[100] max-h-[92vh] w-76 space-y-3 overflow-y-auto rounded-lg bg-amber-400 p-3 text-[11px] text-black shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="font-bold tracking-wide">PROTOTYPE CONTROLS</span>
        <button onClick={() => setOpen(false)} className="font-bold">
          ×
        </button>
      </div>

      {(['mic', 'system'] as SourceId[]).map(s => (
        <div key={s}>
          <div className="font-semibold">
            {s === 'mic' ? 'Microphone' : 'System audio'} signal
          </div>
          <div className="mt-1 flex gap-1">
            {SIGNAL_CHOICES.map(c => (
              <button
                key={c.key}
                onClick={() => setSignal(s, c.key)}
                className={`flex-1 rounded px-1 py-1 text-[10px] font-medium ${
                  world.signal[s] === c.key
                    ? 'bg-black text-amber-300'
                    : 'bg-black/10 hover:bg-black/20'
                }`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <p className="leading-snug opacity-80">
        <b>Quiet room vs Dead is the whole question</b> — #9: a denied tap returns
        silence, not an error. Details in the README.
      </p>

      <label className="block">
        <span className="font-semibold">Sim speed — {world.speed}× (judge at 1×)</span>
        <input
          type="range"
          min={1}
          max={12}
          step={1}
          value={world.speed}
          onChange={e => {
            world.speed = Number(e.target.value)
            onChange()
          }}
          className="w-full"
        />
      </label>

      <div className="space-y-1">
        <div className="font-semibold">
          Mic on: {effectiveMicDevice(world).name}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => {
              yankMicDevice(world)
              onChange()
            }}
            className="flex-1 rounded bg-black px-1 py-1 text-[10px] font-medium text-amber-300">
            Unplug it
          </button>
          <button
            onClick={() => {
              restoreDevices(world)
              onChange()
            }}
            className="flex-1 rounded bg-black/10 px-1 py-1 text-[10px] font-medium hover:bg-black/20">
            Reconnect all
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={world.transcribing}
          onChange={e => {
            world.transcribing = e.target.checked
            onChange()
          }}
        />
        <span className="font-semibold">A transcription is running (#13)</span>
      </label>

      <button
        onClick={() => {
          reset(world)
          onChange()
        }}
        className="w-full rounded bg-black/10 px-1 py-1 text-[10px] font-medium hover:bg-black/20">
        Reset to setup
      </button>
    </div>
  )
}

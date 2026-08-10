/**
 * PROTOTYPE — Recap's recording modal (issue #25).
 *
 * ONE refined design, not four. The floating switcher does not swap layouts —
 * it swaps only the CONFIRMATION, which is the single sub-question #25 says is
 * genuinely open. Everything else is identical across A/B/C on purpose.
 */
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  createWorld,
  discard,
  dismissNotice,
  effectiveMicDevice,
  formatDuration,
  publishFrame,
  reset,
  restoreDevices,
  setMicDevice,
  start,
  stop,
  tick,
  toggleSource,
  yankMicDevice,
  type SignalMode,
  type SourceId,
  type World,
} from './capture'
import {CONFIRM_VARIANTS} from './Confirm'
import {Library, PreparingPage} from './Library'
import {PrototypeSwitcher} from './PrototypeSwitcher'
import {RecordingModal} from './RecordingModal'
import type {Actions} from './types'

function useVariantParam() {
  const read = () =>
    (new URLSearchParams(location.search).get('variant') ?? 'A').toUpperCase()
  const [variant, setVariant] = useState(read)

  const change = useCallback((key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
  }, [])

  useEffect(() => {
    const onPop = () => setVariant(read())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
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
      const i = CONFIRM_VARIANTS.findIndex(v => v.key === variant)
      const d = e.key === 'ArrowRight' ? 1 : -1
      change(CONFIRM_VARIANTS[(i + d + CONFIRM_VARIANTS.length) % CONFIRM_VARIANTS.length].key)
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
  const [open, setOpen] = useState(true)
  const [meterStyle, setMeterStyle] = useState<'unified' | 'split'>('split')

  /** One rAF loop. Meters + clock ride publishFrame straight to the DOM (#5). */
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
      if (w.rev !== lastRev || now - lastRender > 150) {
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
  const live = w.phase === 'capturing'

  const actions: Actions = {
    toggleSource: s => toggleSource(w, s),
    setMicDevice: id => setMicDevice(w, id),
    start: () => start(w),
    stop: () => {
      stop(w)
      setOpen(false)
    },
    // Discard closes the modal, silently. Landing back on setup would have
    // implied "now start over", which is a suggestion the app has no business
    // making about a recording the user just threw away — you asked to be rid
    // of it, so you get the library back.
    discard: () => {
      discard(w)
      setOpen(false)
    },
    reset: () => {
      reset(w)
      setOpen(false)
    },
    dismissNotice: id => dismissNotice(w, id),
  }

  const confirmVariant =
    CONFIRM_VARIANTS.find(v => v.key === variant) ?? CONFIRM_VARIANTS[0]

  return (
    <>
      <div className="h-full">
        {w.phase === 'preparing' ? (
          <PreparingPage onBack={actions.reset} />
        ) : (
          <Library
            w={w}
            inert={live}
            onNew={() => setOpen(true)}
            onOpen={() => {}}
          />
        )}
      </div>

      {open && w.phase !== 'preparing' && (
        <RecordingModal
          w={w}
          actions={actions}
          confirmVariant={confirmVariant}
          meterStyle={meterStyle}
          onClose={() => setOpen(false)}
        />
      )}

      <ControlPanel
        world={w}
        meterStyle={meterStyle}
        setMeterStyle={setMeterStyle}
        reopen={() => setOpen(true)}
        onChange={() => w.rev++}
      />
      <PrototypeSwitcher
        variants={CONFIRM_VARIANTS.map(({key, name}) => ({key, name}))}
        current={confirmVariant.key}
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

/** PROTOTYPE chrome — the knobs, plus a readout of the state (rule 5). */
function ControlPanel({
  world,
  meterStyle,
  setMeterStyle,
  reopen,
  onChange,
}: {
  world: World
  meterStyle: 'unified' | 'split'
  setMeterStyle: (s: 'unified' | 'split') => void
  reopen: () => void
  onChange: () => void
}) {
  const [open, setOpen] = useState(true)

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 bottom-3 z-[100] rounded-md bg-amber-400 px-2 py-1 text-[11px] font-bold text-black shadow-lg">
        PROTOTYPE CONTROLS
      </button>
    )

  return (
    <div className="fixed right-3 bottom-3 z-[100] max-h-[76vh] w-76 space-y-3 overflow-y-auto rounded-lg bg-amber-400 p-3 text-[11px] text-black shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="font-bold tracking-wide">PROTOTYPE CONTROLS</span>
        <button onClick={() => setOpen(false)} className="font-bold">
          ×
        </button>
      </div>

      <div className="rounded bg-black/10 p-2 font-mono leading-relaxed">
        phase <b>{world.phase}</b> · elapsed <b>{formatDuration(world.elapsed)}</b>
        <br />
        sources{' '}
        <b>
          {(['mic', 'system'] as SourceId[]).filter(s => world.enabled[s]).join(' + ') ||
            'none'}
        </b>
        <br />
        mic on <b>{effectiveMicDevice(world).name}</b>
        <br />
        discarded <b>{world.discarded.n}×</b>
        {world.discarded.n > 0 && <> (last at {formatDuration(world.discarded.at)})</>}
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
                onClick={() => {
                  world.signal[s] = c.key
                  onChange()
                }}
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

      <div>
        <div className="font-semibold">Meter shape</div>
        <div className="mt-1 flex gap-1">
          {(['unified', 'split'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMeterStyle(m)}
              className={`flex-1 rounded px-1 py-1 text-[10px] font-medium ${
                meterStyle === m ? 'bg-black text-amber-300' : 'bg-black/10 hover:bg-black/20'
              }`}>
              {m === 'unified' ? 'Unified (proposed)' : 'Split (#24 literal)'}
            </button>
          ))}
        </div>
        <p className="mt-1 leading-snug opacity-80">
          Unified puts “now” on the end of the history’s own dB axis. Split is #24’s
          two meters as written.
        </p>
      </div>

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
        <div className="font-semibold">Device loss (#23: never stops on its own)</div>
        <div className="flex gap-1">
          <button
            onClick={() => {
              yankMicDevice(world)
              onChange()
            }}
            className="flex-1 rounded bg-black px-1 py-1 text-[10px] font-medium text-amber-300">
            Unplug the mic
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

      <div className="flex gap-1">
        <button
          onClick={reopen}
          className="flex-1 rounded bg-black/10 px-1 py-1 text-[10px] font-medium hover:bg-black/20">
          Open the modal
        </button>
        <button
          onClick={() => {
            reset(world)
            onChange()
          }}
          className="flex-1 rounded bg-black/10 px-1 py-1 text-[10px] font-medium hover:bg-black/20">
          Reset world
        </button>
      </div>
    </div>
  )
}

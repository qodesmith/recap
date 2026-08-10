/**
 * THE RECORDING MODAL — one refined design (#25).
 *
 * Not a pick-one-of-four. Everything here is a proposal to react to, and the
 * comments say what each choice is answering, because a design nobody can argue
 * with is a design nobody read.
 *
 * The thesis under test, from #24: THE MODAL IS RECORD MODE. Start does not
 * dismiss it; the app has nothing else for you to do until you stop.
 */
import {useEffect, useRef, useState} from 'react'
import {
  SOURCES,
  SOURCE_LABEL,
  canStart,
  effectiveMicDevice,
  formatDuration,
  pinnedButMissing,
  sourceSublabel,
  subscribeFrame,
  type SourceId,
  type World,
} from './capture'
import {Meter, SignalWord} from './Meter'
import type {ConfirmVariant} from './Confirm'
import type {Actions} from './types'

/* ------------------------------------------------------------------ */
/* the live clock — DOM-written, like the meters (#5)                  */
/* ------------------------------------------------------------------ */

function Elapsed({className}: {className?: string}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      subscribeFrame(w => {
        const el = ref.current
        if (!el) return
        const t = formatDuration(w.elapsed)
        if (el.textContent !== t) el.textContent = t
      }),
    []
  )
  return <span ref={ref} className={className} />
}

/* ------------------------------------------------------------------ */
/* a source row                                                        */
/* ------------------------------------------------------------------ */

/**
 * The row is the SAME component in both phases, and that is the answer to
 * "what does the modal become at Start?": the modal does not become a different
 * thing, it loses its controls. The meter is in the same place, the same size,
 * on the same axis — so the reading you did before Start is the reading you
 * keep doing after it, and nothing about the surface asks you to re-orient at
 * the exact moment a conversation has started.
 */
function SourceRow({
  w,
  actions,
  source,
  live,
  meterStyle,
}: {
  w: World
  actions: Actions
  source: SourceId
  live: boolean
  meterStyle: 'unified' | 'split'
}) {
  const on = w.enabled[source]
  const missing = pinnedButMissing(w)

  // During capture a disabled source is not dimmed-out, it is GONE — it isn't
  // part of this recording and a greyed row is just a control that lies about
  // being reachable.
  if (live && !on) return null

  return (
    <div
      className={`rounded-xl p-3.5 ring-1 transition-colors ${
        on ? 'bg-black/25 ring-white/10' : 'bg-black/10 ring-white/5'
      }`}>
      <div className="flex items-center gap-3">
        {/* the toggle exists only where it can be used; it does not linger disabled */}
        {!live && (
          <button
            onClick={() => actions.toggleSource(source)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              on ? 'bg-emerald-500' : 'bg-white/15'
            }`}
            aria-label={`Toggle ${SOURCE_LABEL[source]}`}>
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
                on ? 'left-4.5' : 'left-0.5'
              }`}
            />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{SOURCE_LABEL[source]}</div>
          {/*
            Live, the device stops being a control and becomes a FACT. #23 says
            a vanished device is swapped underneath you, so this line has to
            keep telling the truth for the whole capture — it is read from the
            world, not frozen at Start.
          */}
          <div className="truncate text-[11px] text-white/40">
            {sourceSublabel(w, source)}
          </div>
        </div>
        {on && <SignalWord source={source} />}
      </div>

      {source === 'mic' && on && !live && (
        <>
          <select
            value={w.micDeviceId}
            onChange={e => actions.setMicDevice(e.target.value)}
            className="mt-2.5 w-full rounded-md bg-black/40 px-2 py-1.5 text-xs ring-1 ring-white/10">
            <option value="default">
              System default ({effectiveMicDevice(w).name})
            </option>
            {w.devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.available ? '' : ' — unavailable'}
              </option>
            ))}
          </select>
          {missing && (
            <div className="mt-1.5 text-[11px] text-amber-300">
              {missing.name} isn’t connected — {effectiveMicDevice(w).name} will be
              used.
            </div>
          )}
        </>
      )}

      {on && (
        <div className="mt-2.5">
          <Meter source={source} height={live ? 68 : 54} style={meterStyle} />
        </div>
      )}
    </div>
  )
}

/**
 * #9's headline finding, made actionable, and ONLY at setup.
 *
 * A denied tap is pure silence with no error and no preflight API, and granting
 * it needs a relaunch. A relaunch destroys a modal — so the affordance that
 * causes one is offered before Start, when losing the modal costs nothing, and
 * is never offered during a capture. That is how this design stays out of
 * onboarding's way without owning onboarding.
 */
function DeniedTapHint({w}: {w: World}) {
  const [show, setShow] = useState(false)
  useEffect(
    () =>
      subscribeFrame(x =>
        setShow(s => {
          const next = x.enabled.system && x.silentFor.system > 8 && x.phase === 'setup'
          return s === next ? s : next
        })
      ),
    []
  )
  if (!show) return null
  return (
    <div className="rounded-lg bg-orange-500/10 p-3 text-[11px] leading-snug text-orange-100 ring-1 ring-orange-400/25">
      <div className="font-semibold text-orange-200">
        Nothing is arriving from System audio — not even room tone.
      </div>
      <p className="mt-1 text-orange-100/70">
        macOS may have denied audio capture. Granting it needs Recap to restart —
        do it now rather than mid-conversation.
      </p>
      <div className="mt-2 flex gap-2">
        <button className="rounded bg-orange-400/20 px-2 py-1 font-medium text-orange-100 hover:bg-orange-400/30">
          Open Privacy settings
        </button>
        <button className="rounded px-2 py-1 text-orange-200/70 hover:bg-white/5">
          Restart Recap
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* the modal                                                           */
/* ------------------------------------------------------------------ */

export function RecordingModal({
  w,
  actions,
  confirmVariant,
  meterStyle,
  onClose,
}: {
  w: World
  actions: Actions
  confirmVariant: ConfirmVariant
  meterStyle: 'unified' | 'split'
  onClose: () => void
}) {
  const live = w.phase === 'capturing'
  const [confirming, setConfirming] = useState(false)
  const [nudge, setNudge] = useState(0)
  const Confirm = confirmVariant.Component

  // Esc: closes at setup, asks during capture. Never closes a live capture
  // outright — a modal that dismisses on reflex would end a conversation.
  // Phase is read off the world at keypress time, not off the last render: the
  // gap between Start and the next React render is exactly when a stray Esc
  // would have thrown a recording away.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setConfirming(c => {
        if (c) return false
        if (w.phase === 'capturing') return true
        onCloseRef.current()
        return false
      })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [w])

  useEffect(() => {
    if (!live) setConfirming(false)
  }, [live])

  /*
   * Backdrop click is the MOST accidental gesture there is, so it does not open
   * the confirmation — it refuses, visibly, and that is ALL it does. The shake
   * is the whole message: nothing else on the surface changes, because a click
   * out here was never a request for anything.
   */
  const onBackdrop = () => {
    if (w.phase !== 'capturing') return onClose()
    setNudge(n => n + 1)
  }

  return (
    <div
      /* pb-20 only so the prototype's own switcher bar doesn't cover the footer */
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 pb-20 backdrop-blur-[2px]"
      onMouseDown={e => e.target === e.currentTarget && onBackdrop()}>
      <div
        key={nudge}
        className={`relative w-[34rem] overflow-hidden rounded-2xl bg-ink-2 shadow-2xl ring-1 ${
          live ? 'ring-red-400/30' : 'ring-white/10'
        } ${nudge ? 'proto-shake' : ''}`}>
        {/* the one piece of chrome that changes at Start: a live rail */}
        {live && <div className="h-1 w-full bg-red-500/80" />}

        <div className="p-5">
          {/* ---------------- header ---------------- */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {live ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
                    <span className="size-2 animate-pulse rounded-full bg-red-400" />
                    Recording
                  </div>
                  <p className="mt-0.5 text-[11px] text-white/35">
                    Sources are fixed for this recording.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-base font-semibold">New recording</h2>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    Check both meters are moving before you start.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/*
                THE TIMER, top-right. One clock for the whole capture belongs
                above the per-source rows, not among them: it is the only number
                on the surface that is not about a source, and the header is the
                only region that is not either. Big, tabular, and the largest
                thing in the modal — it is what you glance at.
              */}
              {live && (
                <Elapsed className="text-2xl leading-none font-semibold tabular-nums" />
              )}
              <button
                onClick={() =>
                  w.phase === 'capturing' ? setConfirming(true) : onClose()
                }
                className="grid size-7 place-items-center rounded text-white/40 hover:bg-white/10 hover:text-white"
                aria-label="Close">
                ×
              </button>
            </div>
          </div>

          {/* -------- device-fallback notice, pinned under the header -------- */}
          {/*
            #23 put this in the sidebar Activity row; #24 removed the sidebar
            from reach. It lives here, directly under the header and ABOVE the
            sources, because it is a statement about a source you are about to
            read the meter of. Nothing in this modal scrolls, so "does it
            survive being scrolled past" is answered by construction.
          */}
          {w.notices.length > 0 && (
            <div className="mt-4 space-y-2">
              {w.notices.map(n => (
                <div
                  key={n.id}
                  className="flex items-start gap-3 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-400/25">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-amber-200">{n.title}</div>
                    <div className="mt-0.5 text-[11px] text-amber-100/70">{n.detail}</div>
                  </div>
                  <button
                    onClick={() => actions.dismissNotice(n.id)}
                    className="shrink-0 rounded px-1.5 text-amber-200/60 hover:bg-white/10"
                    aria-label="Dismiss">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ---------------- sources ---------------- */}
          <div className="mt-4 space-y-2.5">
            {SOURCES.map(s => (
              <SourceRow
                key={s}
                w={w}
                actions={actions}
                source={s}
                live={live}
                meterStyle={meterStyle}
              />
            ))}
          </div>

          {!live && (
            <div className="mt-3">
              <DeniedTapHint w={w} />
            </div>
          )}

          {/* ---------------- footer ---------------- */}
          <div className="mt-4">
            {!live ? (
              <button
                disabled={!canStart(w)}
                onClick={actions.start}
                className="w-full rounded-lg bg-red-500 py-3 text-sm font-semibold hover:bg-red-400 disabled:bg-white/10 disabled:text-white/30">
                {canStart(w) ? 'Start recording' : 'Pick at least one source'}
              </button>
            ) : confirming && confirmVariant.slot === 'footer' ? (
              <Confirm
                elapsed={w.elapsed}
                onStop={actions.stop}
                onDiscard={actions.discard}
                onCancel={() => setConfirming(false)}
              />
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-black hover:bg-white/90">
                Stop
              </button>
            )}
          </div>

          {/*
            #13 allows a transcription to run while you capture. A modal blocks
            INTERACTION, not background work — so the rule is not narrowed, but
            the Activity section is unreachable, and silently unreachable
            progress is the one thing this app has said it will never do. One
            read-only line, no controls: it is running, here is how far, you
            will get it back when you stop.
          */}
          {w.transcribing && (
            <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-white/45">
                  Still transcribing “Call with Dana” in the background
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-sky-400/70"
                    style={{width: `${w.transcribeProgress * 100}%`}}
                  />
                </div>
              </div>
              <span className="text-[11px] tabular-nums text-white/35">
                {Math.round(w.transcribeProgress * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* confirmation layers that are not the footer */}
        {live && confirming && confirmVariant.slot !== 'footer' && (
          <Confirm
            elapsed={w.elapsed}
            onStop={actions.stop}
            onDiscard={actions.discard}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    </div>
  )
}

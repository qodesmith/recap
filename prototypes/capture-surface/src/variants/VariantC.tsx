/**
 * VARIANT C — "Sidebar panel, never navigates"
 *
 * Capture is not a place you go. It is a permanent panel at the top of the
 * sidebar: collapsed it is one Record button, expanded it is the source
 * toggles and the meters, and it stays exactly there once recording starts.
 * Nothing navigates, nothing is dismissed, and the library never moves — so
 * you can browse, read a transcript and watch the meters at the same time.
 *
 * Also the only variant with nothing to lose to #9's relaunch: there is no
 * route to restore and no modal to reopen.
 *
 * Meter: a hardware-style LED ladder. The bottom rungs are a *different
 * colour* and are the room-tone rungs — "at least one grey rung lit" is the
 * whole granted-but-quiet signal, and it reads at 10 px.
 */
import {useState} from 'react'
import {
  SOURCES,
  SOURCE_LABEL,
  canStart,
  effectiveMicDevice,
  formatDuration,
  meterFraction,
  pinnedButMissing,
  sourceSublabel,
  type SourceId,
} from '../capture'
import type {VariantProps} from '../types'
import {useFrame, useLevelVars} from '../useFrame'

const RUNGS = 16
/** Rungs below this index are room tone, not speech. */
const FLOOR_RUNGS = 3

function Ladder({source, height = 56}: {source: SourceId; height?: number}) {
  const ref = useLevelVars<HTMLDivElement>(w => ({
    level: meterFraction(w.level[source]),
    peak: meterFraction(w.peak[source]),
    signal: w.silentFor[source] > 8 ? 'dead' : 'live',
  }))

  return (
    <div
      ref={ref}
      className="flex w-3.5 shrink-0 flex-col-reverse gap-px"
      style={{height}}
      title="bottom three rungs = room tone">
      {Array.from({length: RUNGS}, (_, i) => {
        const tone =
          i < FLOOR_RUNGS
            ? 'bg-slate-400'
            : i > RUNGS - 3
              ? 'bg-amber-400'
              : 'bg-emerald-400'
        return (
          <div key={i} className="relative flex-1 rounded-[1px] bg-white/[0.06]">
            <div
              className={`absolute inset-0 rounded-[1px] ${tone}`}
              style={{
                // clamped by CSS: lit hard once --level passes this rung
                opacity: `calc((var(--level, 0) - ${i / RUNGS}) * ${RUNGS})`,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

function Status({source}: {source: SourceId}) {
  const [txt, setTxt] = useState('')
  const [bad, setBad] = useState(false)
  useFrame(w => {
    const s = w.silentFor[source]
    const next =
      s > 8 ? `Silent ${Math.round(s)}s` : s > 0.5 ? 'Room tone' : 'Hearing you'
    setTxt(t => (t === next ? t : next))
    setBad(b => (b === s > 8 ? b : s > 8))
  })
  return (
    <span className={`text-[10px] ${bad ? 'text-orange-300' : 'text-white/35'}`}>
      {txt}
    </span>
  )
}

export function VariantC({world: w, actions}: VariantProps) {
  const [expanded, setExpanded] = useState(true)
  const missing = pinnedButMissing(w)
  const live = w.phase === 'capturing'
  const open = expanded || live

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-white/5 bg-ink-2">
        <div className="px-4 py-4 text-sm font-bold tracking-tight">Recap</div>

        {/* ---------- the capture panel: permanent, in place, never moves ---------- */}
        <div
          className={`mx-2 rounded-xl p-3 ring-1 transition-colors ${
            live ? 'bg-red-500/10 ring-red-400/25' : 'bg-black/25 ring-white/10'
          }`}>
          <div className="flex items-center justify-between">
            <span
              className={`flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase ${
                live ? 'text-red-300' : 'text-white/40'
              }`}>
              {live && <span className="size-2 animate-pulse rounded-full bg-red-400" />}
              {live ? 'Recording' : 'Record'}
            </span>
            {live ? (
              <span className="text-sm font-semibold tabular-nums">
                {formatDuration(w.elapsed)}
              </span>
            ) : (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-[11px] text-white/35 hover:text-white">
                {expanded ? 'Hide' : 'Set up'}
              </button>
            )}
          </div>

          {open && (
            <div className="mt-3 space-y-2.5">
              {SOURCES.map(s => {
                const on = w.enabled[s]
                if (live && !on) return null
                return (
                  <div key={s} className="flex items-stretch gap-2.5">
                    <Ladder source={s} height={on ? 52 : 26} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {!live && (
                          <button
                            onClick={() => actions.toggleSource(s)}
                            className={`relative h-4 w-7 shrink-0 rounded-full ${
                              on ? 'bg-emerald-500' : 'bg-white/15'
                            }`}>
                            <span
                              className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${
                                on ? 'left-3.5' : 'left-0.5'
                              }`}
                            />
                          </button>
                        )}
                        <span className="text-xs font-medium">{SOURCE_LABEL[s]}</span>
                        {on && (
                          <span className="ml-auto">
                            <Status source={s} />
                          </span>
                        )}
                      </div>

                      {s === 'mic' && on && !live && (
                        <select
                          value={w.micDeviceId}
                          onChange={e => actions.setMicDevice(e.target.value)}
                          className="mt-1.5 w-full rounded bg-black/50 px-1.5 py-1 text-[11px] ring-1 ring-white/10">
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
                      )}
                      {s !== 'mic' && on && (
                        <div className="mt-1 truncate text-[11px] text-white/35">
                          {sourceSublabel(w, s)}
                        </div>
                      )}
                      {s === 'mic' && on && live && (
                        <div className="mt-1 truncate text-[11px] text-white/35">
                          {effectiveMicDevice(w).name}
                        </div>
                      )}
                      {s === 'mic' && missing && !live && (
                        <div className="mt-1 text-[10px] text-amber-300">
                          {missing.name} isn’t connected
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {w.notices.map(n => (
                <div
                  key={n.id}
                  className="rounded bg-amber-500/15 p-2 text-[10px] leading-snug text-amber-100 ring-1 ring-amber-400/20">
                  <div className="font-semibold text-amber-200">{n.title}</div>
                  <div className="mt-0.5">{n.detail}</div>
                  <button
                    onClick={() => actions.dismissNotice(n.id)}
                    className="mt-1 text-amber-200/60 underline">
                    Dismiss
                  </button>
                </div>
              ))}

              {live ? (
                <button
                  onClick={actions.stop}
                  className="w-full rounded-lg bg-white py-2 text-xs font-semibold text-black hover:bg-white/90">
                  Stop
                </button>
              ) : (
                <button
                  disabled={!canStart(w)}
                  onClick={actions.start}
                  className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold hover:bg-red-400 disabled:bg-white/10 disabled:text-white/30">
                  Start recording
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 px-4 text-[11px] font-semibold tracking-wider text-white/35 uppercase">
          Activity
        </div>
        <div className="mt-2 space-y-2 px-2">
          {w.transcribing ? (
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="truncate text-xs font-medium">Call with Dana</div>
              <div className="mt-1 text-[11px] text-white/50">Transcribing · ASR</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-sky-400"
                  style={{width: `${w.transcribeProgress * 100}%`}}
                />
              </div>
            </div>
          ) : (
            <div className="px-2.5 py-2 text-[11px] text-white/25">Nothing running</div>
          )}
        </div>

        <nav className="mt-auto px-2 pb-2">
          <button className="w-full rounded-md bg-white/10 px-2 py-1.5 text-left text-sm">
            Library
          </button>
        </nav>
      </aside>

      {/* ---------- main never changes because of capture ---------- */}
      <main className="flex-1 overflow-y-auto p-8 pb-28">
        <h1 className="text-xl font-bold">Library</h1>
        <p className="mt-1 text-xs text-white/40">
          Untouched by recording — that is the point of this variant.
        </p>
        <div className="mt-5 space-y-2">
          {w.recordings.map(r => (
            <div
              key={r.id}
              className="flex items-center gap-4 rounded-lg bg-ink-2 p-4 ring-1 ring-white/5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="text-xs text-white/40">
                  {r.when} · {r.tracks.join(', ')}
                </div>
              </div>
              {r.state === 'capturing' ? (
                <span className="flex items-center gap-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">
                  <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
                  Recording {formatDuration(w.elapsed)}
                </span>
              ) : r.state === 'preparing' ? (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">
                  Preparing…
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                  {r.state}
                </span>
              )}
            </div>
          ))}
        </div>

        {w.phase === 'preparing' && (
          <p className="mt-6 text-xs text-white/35">
            Stop left you here, in the library, with the new recording at the top —
            #22's page is one click away rather than pushed at you.
          </p>
        )}
      </main>
    </div>
  )
}

/**
 * VARIANT B — "Modal, hands off to Activity"
 *
 * Capture has no page at all. "New recording" opens a sheet over the library;
 * Start dismisses it and the *only* live surface left is #13's sidebar
 * Activity section. This variant exists to test the ticket's own doubt:
 * "#13's Activity row can show *that* audio is arriving; it probably can't
 * show two labelled meters well enough to notice one has gone flat."
 * B commits to that being wrong — there is nowhere else to look.
 *
 * Meter: a rolling ~12 s history, not an instantaneous bar. A flat line has a
 * *shape*, so dead reads differently from a pause even at sidebar size.
 */
import {useEffect, useRef, useState} from 'react'
import {
  SOURCES,
  SOURCE_LABEL,
  canStart,
  effectiveMicDevice,
  formatDuration,
  meterFraction,
  pinnedButMissing,
  sourceSublabel,
  subscribeFrame,
  type SourceId,
} from '../capture'
import type {VariantProps} from '../types'
import {useFrame} from '../useFrame'
import {PreparingPage} from './VariantA'

function History({source, height}: {source: SourceId; height: number}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    return subscribeFrame(w => {
      const c = ref.current
      if (!c) return
      const dpr = devicePixelRatio || 1
      const cw = c.clientWidth * dpr
      const ch = c.clientHeight * dpr
      if (c.width !== cw || c.height !== ch) {
        c.width = cw
        c.height = ch
      }
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, cw, ch)

      const h = w.history[source]
      const dead = w.silentFor[source] > 8

      // the floor line — anything touching it is room tone, anything under it
      // is nothing at all
      const floorY = ch - meterFraction(0.0022) * ch
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([3 * dpr, 3 * dpr])
      ctx.beginPath()
      ctx.moveTo(0, floorY)
      ctx.lineTo(cw, floorY)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = dead ? 'rgba(251,146,60,0.55)' : 'rgba(52,211,153,0.85)'
      const n = h.length
      if (!n) return
      const step = cw / (12 * 60)
      for (let i = 0; i < n; i++) {
        const x = cw - (n - i) * step
        const bh = Math.max(1 * dpr, h[i] * ch)
        ctx.fillRect(x, ch - bh, Math.max(1 * dpr, step * 0.85), bh)
      }
    })
  }, [source])

  return <canvas ref={ref} className="w-full" style={{height}} />
}

function SilenceLine({source}: {source: SourceId}) {
  const [txt, setTxt] = useState<string | null>(null)
  useFrame(w => {
    const s = w.silentFor[source]
    const next = !w.enabled[source]
      ? null
      : s > 8
        ? `Flat for ${Math.round(s)}s — nothing is arriving`
        : null
    setTxt(t => (t === next ? t : next))
  })
  if (!txt) return null
  return <div className="mt-1 text-[10px] leading-tight text-orange-300">{txt}</div>
}

export function VariantB({world: w, actions}: VariantProps) {
  const [sheet, setSheet] = useState(false)
  const missing = pinnedButMissing(w)
  const live = w.phase === 'capturing'

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-2">
        <div className="px-4 py-4 text-sm font-bold tracking-tight">Recap</div>
        <nav className="px-2">
          <button className="w-full rounded-md bg-white/10 px-2 py-1.5 text-left text-sm">
            Library
          </button>
        </nav>

        <div className="mt-6 px-4 text-[11px] font-semibold tracking-wider text-white/35 uppercase">
          Activity
        </div>
        <div className="mt-2 space-y-2 px-2">
          {live && (
            <div className="rounded-lg bg-red-500/10 p-2.5 ring-1 ring-red-400/20">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-medium text-red-300">
                  <span className="size-2 animate-pulse rounded-full bg-red-400" />
                  Recording
                </span>
                <span className="text-xs tabular-nums text-white/70">
                  {formatDuration(w.elapsed)}
                </span>
              </div>

              {/* two labelled meters, at sidebar width — the variant's whole bet */}
              <div className="mt-2 space-y-2">
                {SOURCES.filter(s => w.enabled[s]).map(s => (
                  <div key={s}>
                    <div className="flex items-baseline justify-between text-[10px] text-white/45">
                      <span>{SOURCE_LABEL[s]}</span>
                      <span className="truncate pl-2 text-white/25">
                        {s === 'mic' ? effectiveMicDevice(w).name : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 rounded bg-black/40 px-1 py-0.5">
                      <History source={s} height={22} />
                    </div>
                    <SilenceLine source={s} />
                  </div>
                ))}
              </div>

              {w.notices.map(n => (
                <div
                  key={n.id}
                  className="mt-2 rounded bg-amber-500/15 p-2 text-[10px] leading-snug text-amber-100 ring-1 ring-amber-400/20">
                  <div className="font-semibold text-amber-200">{n.title}</div>
                  <div className="mt-0.5">{n.detail}</div>
                  <button
                    onClick={() => actions.dismissNotice(n.id)}
                    className="mt-1 text-amber-200/60 underline">
                    Dismiss
                  </button>
                </div>
              ))}

              <button
                onClick={actions.stop}
                className="mt-2.5 w-full rounded bg-white py-1.5 text-xs font-semibold text-black hover:bg-white/90">
                Stop
              </button>
            </div>
          )}

          {w.transcribing && (
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
          )}

          {!live && !w.transcribing && (
            <div className="px-2.5 py-2 text-[11px] text-white/25">Nothing running</div>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8 pb-28">
        {w.phase === 'preparing' ? (
          <PreparingPage onBack={actions.reset} />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">Library</h1>
              <button
                disabled={live}
                onClick={() => setSheet(true)}
                className="rounded-md bg-red-500/90 px-3 py-1.5 text-sm font-medium hover:bg-red-500 disabled:bg-white/10 disabled:text-white/30">
                New recording
              </button>
            </div>
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
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                      {r.state}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* ---------------- the sheet ---------------- */}
      {sheet && !live && w.phase === 'setup' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
          <div className="w-[30rem] rounded-2xl bg-ink-2 p-6 shadow-2xl ring-1 ring-white/10">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">New recording</h2>
                <p className="mt-0.5 text-[11px] text-white/40">
                  Check both meters are moving before you start.
                </p>
              </div>
              <button
                onClick={() => setSheet(false)}
                className="rounded px-2 text-white/40 hover:bg-white/10">
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {SOURCES.map(s => (
                <div key={s}>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => actions.toggleSource(s)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        w.enabled[s] ? 'bg-emerald-500' : 'bg-white/15'
                      }`}>
                      <span
                        className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
                          w.enabled[s] ? 'left-4.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{SOURCE_LABEL[s]}</div>
                      <div className="truncate text-[11px] text-white/40">
                        {sourceSublabel(w, s)}
                      </div>
                    </div>
                  </div>

                  {s === 'mic' && w.enabled.mic && (
                    <select
                      value={w.micDeviceId}
                      onChange={e => actions.setMicDevice(e.target.value)}
                      className="mt-2 w-full rounded-md bg-black/40 px-2 py-1.5 text-xs ring-1 ring-white/10">
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
                  {s === 'mic' && missing && (
                    <div className="mt-1.5 text-[11px] text-amber-300">
                      {missing.name} isn’t connected — {effectiveMicDevice(w).name} will
                      be used.
                    </div>
                  )}

                  {w.enabled[s] && (
                    <>
                      <div className="mt-2 rounded-md bg-black/40 px-2 py-1.5 ring-1 ring-white/10">
                        <History source={s} height={46} />
                      </div>
                      <SilenceLine source={s} />
                    </>
                  )}
                </div>
              ))}
            </div>

            <button
              disabled={!canStart(w)}
              onClick={() => {
                actions.start()
                setSheet(false)
              }}
              className="mt-6 w-full rounded-lg bg-red-500 py-2.5 text-sm font-semibold hover:bg-red-400 disabled:bg-white/10 disabled:text-white/30">
              Start recording
            </button>
            <p className="mt-2 text-center text-[10px] text-white/30">
              This closes — the recording lives in Activity, on the left.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * VARIANT D — "Fullscreen takeover"
 *
 * Capture takes the whole window: no sidebar, no library, nothing to click
 * past. Built on one premise from #23 — "this is the one place a wrong default
 * costs everything; a conversation can't be re-recorded" — so the meter is the
 * hero and the pre-flight check is an explicit, blocking-ish readiness line
 * rather than something you might notice.
 *
 * Stop leaves fullscreen and lands on #22's recording page.
 *
 * Meter: a wide bar with a real dB scale plus a large numeric readout, and a
 * per-source readiness verdict in words. Nothing subtle: at this size "dead"
 * and "quiet room" are two obviously different pictures.
 */
import {useState} from 'react'
import {
  METER_FLOOR_DB,
  SIGNAL_GATE_DB,
  SOURCES,
  SOURCE_LABEL,
  canStart,
  effectiveMicDevice,
  formatDuration,
  lin2db,
  meterFraction,
  pinnedButMissing,
  selectedSources,
  sourceSublabel,
  type SourceId,
} from '../capture'
import type {VariantProps} from '../types'
import {useFrame, useLevelVars} from '../useFrame'
import {PreparingPage} from './VariantA'

const FLOOR_PCT = ((SIGNAL_GATE_DB - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100

function BigMeter({source}: {source: SourceId}) {
  const ref = useLevelVars<HTMLDivElement>(w => ({
    level: meterFraction(w.level[source]),
    peak: meterFraction(w.peak[source]),
    signal: w.silentFor[source] > 6 ? 'dead' : 'live',
  }))
  const [db, setDb] = useState('—')
  useFrame(w => {
    const v = lin2db(w.level[source])
    const next = v < METER_FLOOR_DB ? '−∞' : `${Math.round(v)}`
    setDb(d => (d === next ? d : next))
  })

  return (
    <div ref={ref} className="group/m">
      <div className="flex items-end justify-between">
        <span className="text-[11px] tracking-wider text-white/30 uppercase">
          Input level
        </span>
        <span className="text-2xl font-semibold tabular-nums text-white/80 group-data-[signal=dead]/m:text-orange-300">
          {db}
          <span className="ml-0.5 text-xs text-white/30">dBFS</span>
        </span>
      </div>
      <div className="relative mt-2 h-8 w-full overflow-hidden rounded-md bg-black/60 ring-1 ring-white/10">
        <div
          className="absolute inset-y-0 left-0 bg-white/[0.06]"
          style={{width: `${FLOOR_PCT}%`}}
        />
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-300 group-data-[signal=dead]/m:from-orange-500 group-data-[signal=dead]/m:to-orange-400"
          style={{width: 'calc(var(--level, 0) * 100%)'}}
        />
        <div
          className="absolute inset-y-0 w-1 bg-white/80"
          style={{left: 'calc(var(--peak, 0) * 100%)'}}
        />
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(p => (
          <div
            key={p}
            className="absolute inset-y-0 w-px bg-white/10"
            style={{left: `${p}%`}}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/25">
        <span>−60</span>
        <span style={{marginLeft: `${FLOOR_PCT - 12}%`}}>↑ room tone</span>
        <span>0</span>
      </div>
    </div>
  )
}

function Verdict({source}: {source: SourceId}) {
  const [state, setState] = useState<'ok' | 'floor' | 'dead'>('ok')
  const [secs, setSecs] = useState(0)
  useFrame(w => {
    const s = w.silentFor[source]
    const next = s > 6 ? 'dead' : s > 0.5 ? 'floor' : 'ok'
    setState(p => (p === next ? p : next))
    setSecs(p => (Math.round(s) === p ? p : Math.round(s)))
  })

  if (state === 'dead')
    return (
      <div className="mt-3 rounded-lg bg-orange-500/15 p-3 ring-1 ring-orange-400/30">
        <div className="text-sm font-semibold text-orange-200">
          Nothing is arriving from {SOURCE_LABEL[source]} — {secs}s of digital
          silence
        </div>
        <div className="mt-1 text-[11px] leading-snug text-orange-100/70">
          {source === 'system'
            ? 'A denied audio-capture permission looks exactly like this: silence, no error. Check System Settings → Privacy & Security → Screen & System Audio Recording, then relaunch Recap.'
            : 'The device may be muted or in use by another app. Try another input above.'}
        </div>
      </div>
    )

  return (
    <div className="mt-3 flex items-center gap-2 text-[11px] text-white/45">
      <span
        className={`size-2 rounded-full ${state === 'ok' ? 'bg-emerald-400' : 'bg-white/30'}`}
      />
      {state === 'ok' ? 'Sound is arriving' : `Room tone only — quiet for ${secs}s`}
    </div>
  )
}

export function VariantD({world: w, actions}: VariantProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const missing = pinnedButMissing(w)
  const live = w.phase === 'capturing'
  const showCapture = fullscreen || live

  if (showCapture)
    return (
      <div className="flex h-full flex-col bg-ink px-10 py-8 pb-28">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-white/35 uppercase">
              {live ? 'Recording' : 'New recording'}
            </div>
            {live ? (
              <div className="mt-1 flex items-center gap-3">
                <span className="size-3 animate-pulse rounded-full bg-red-400" />
                <span className="text-5xl font-semibold tabular-nums">
                  {formatDuration(w.elapsed)}
                </span>
              </div>
            ) : (
              <div className="mt-1 text-2xl font-semibold">
                Check your sources before you start
              </div>
            )}
          </div>
          {!live && (
            <button
              onClick={() => setFullscreen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-white/40 hover:bg-white/5">
              Cancel
            </button>
          )}
        </div>

        {w.notices.map(n => (
          <div
            key={n.id}
            className="mt-5 flex items-start gap-3 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-400/25">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-200">{n.title}</div>
              <div className="mt-0.5 text-[11px] text-amber-100/70">{n.detail}</div>
            </div>
            <button
              onClick={() => actions.dismissNotice(n.id)}
              className="shrink-0 rounded px-1.5 text-amber-200/60 hover:bg-white/10">
              ×
            </button>
          </div>
        ))}

        <div className="mt-8 grid flex-1 grid-cols-2 gap-6">
          {SOURCES.map(s => {
            const on = w.enabled[s]
            if (live && !on) return null
            return (
              <section
                key={s}
                className={`flex flex-col rounded-2xl p-6 ring-1 ${
                  on ? 'bg-ink-2 ring-white/10' : 'bg-ink-2/30 ring-white/5'
                }`}>
                <div className="flex items-center gap-3">
                  {!live && (
                    <button
                      onClick={() => actions.toggleSource(s)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        on ? 'bg-emerald-500' : 'bg-white/15'
                      }`}>
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                          on ? 'left-5.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  )}
                  <div>
                    <div className="text-lg font-semibold">{SOURCE_LABEL[s]}</div>
                    <div className="text-xs text-white/40">{sourceSublabel(w, s)}</div>
                  </div>
                </div>

                {s === 'mic' && on && !live && (
                  <>
                    <select
                      value={w.micDeviceId}
                      onChange={e => actions.setMicDevice(e.target.value)}
                      className="mt-4 w-full rounded-lg bg-black/40 px-3 py-2 text-sm ring-1 ring-white/10">
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
                      <div className="mt-2 text-[11px] text-amber-300">
                        {missing.name} isn’t connected — recording will use{' '}
                        {effectiveMicDevice(w).name}.
                      </div>
                    )}
                  </>
                )}

                {on ? (
                  <div className="mt-auto pt-6">
                    <BigMeter source={s} />
                    <Verdict source={s} />
                  </div>
                ) : (
                  <div className="mt-auto pt-6 text-sm text-white/25">
                    Not being recorded
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <div className="mt-8 flex justify-center">
          {live ? (
            <button
              onClick={() => {
                actions.stop()
                setFullscreen(false)
              }}
              className="rounded-full bg-white px-12 py-4 text-base font-semibold text-black hover:bg-white/90">
              Stop
            </button>
          ) : (
            <button
              disabled={!canStart(w)}
              onClick={actions.start}
              className="rounded-full bg-red-500 px-12 py-4 text-base font-semibold hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
              {canStart(w)
                ? `Start recording · ${selectedSources(w).length} source${
                    selectedSources(w).length > 1 ? 's' : ''
                  }`
                : 'Pick at least one source'}
            </button>
          )}
        </div>
      </div>
    )

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
        <div className="mt-2 px-2">
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
      </aside>

      <main className="flex-1 overflow-y-auto p-8 pb-28">
        {w.phase === 'preparing' ? (
          <PreparingPage
            onBack={() => {
              actions.reset()
            }}
          />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">Library</h1>
              <button
                onClick={() => setFullscreen(true)}
                className="flex items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold hover:bg-red-400">
                <span className="size-2.5 rounded-full bg-white" />
                Record
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
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                    {r.state}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

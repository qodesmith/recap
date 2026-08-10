/**
 * VARIANT A — "Route, transforms in place"  (the ticket's working proposal)
 *
 * Capture is a real route reached from the sidebar. After Start the *same*
 * page becomes the live capture — nothing is dismissed, nothing moves. The
 * sidebar Activity row from #13 carries it only if you navigate away.
 *
 * Meter: a horizontal dBFS bar with the noise floor drawn as a distinct zone,
 * so "quiet room" is visibly *inside* the meter and "dead" is visibly off the
 * bottom of it. A freshness dot escalates only after a long silence, so a
 * genuine pause in conversation doesn't trip it.
 */
import {useState} from 'react'
import {
  SOURCES,
  SOURCE_LABEL,
  SIGNAL_GATE_DB,
  METER_FLOOR_DB,
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

/** Where the room-tone floor sits on the bar — everything below it is nothing. */
const FLOOR_PCT = ((SIGNAL_GATE_DB - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100

function Meter({source, big}: {source: SourceId; big?: boolean}) {
  const ref = useLevelVars<HTMLDivElement>(w => ({
    level: meterFraction(w.level[source]),
    peak: meterFraction(w.peak[source]),
    signal:
      w.silentFor[source] > 8 ? 'dead' : w.silentFor[source] > 0.4 ? 'floor' : 'live',
  }))

  return (
    <div ref={ref} className="group/meter">
      <div
        className={`relative w-full overflow-hidden rounded bg-black/50 ring-1 ring-white/10 ${
          big ? 'h-4' : 'h-2.5'
        }`}>
        {/* the noise-floor zone: signal here means "on, but nobody is talking" */}
        <div
          className="absolute inset-y-0 left-0 bg-white/[0.07]"
          style={{width: `${FLOOR_PCT}%`}}
        />
        <div
          className="absolute inset-y-0 left-0 bg-emerald-400 group-data-[signal=dead]/meter:bg-orange-400/60"
          style={{width: 'calc(var(--level, 0) * 100%)'}}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-white/70"
          style={{left: 'calc(var(--peak, 0) * 100%)'}}
        />
        <div
          className="absolute inset-y-0 w-px bg-white/25"
          style={{left: `${FLOOR_PCT}%`}}
        />
      </div>
      {big && (
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/25">
          <span>-60</span>
          <span>room tone</span>
          <span>-24</span>
          <span>0 dB</span>
        </div>
      )}
    </div>
  )
}

/** Escalates only on a long silence — a 6 s pause in a call is normal. */
function SignalWord({source}: {source: SourceId}) {
  const ref = useLevelVars<HTMLSpanElement>(w => ({
    level: 0,
    peak: 0,
    signal: w.silentFor[source] > 8 ? 'dead' : 'live',
  }))
  const [text, setText] = useState('')
  useFrame(w => {
    const s = w.silentFor[source]
    const db = lin2db(w.level[source])
    const next =
      s > 8
        ? 'No signal at all'
        : s > 0.4
          ? 'Room tone'
          : `${db > -6 ? 'Loud' : 'Hearing you'} · ${Math.round(db)} dB`
    setText(t => (t === next ? t : next))
  })

  return (
    <span
      ref={ref}
      className="flex items-center gap-1.5 text-[11px] text-white/45 data-[signal=dead]:text-orange-300">
      <span className="size-1.5 rounded-full bg-emerald-400 group-data-[signal=dead]:bg-orange-400" />
      {text}
    </span>
  )
}

function DeadWarning({source}: {source: SourceId}) {
  const [show, setShow] = useState(false)
  useFrame(w => {
    const next = w.enabled[source] && w.silentFor[source] > 8
    setShow(s => (s === next ? s : next))
  })
  if (!show) return null

  return (
    <div className="mt-2 rounded-md bg-orange-500/10 p-2 text-[11px] leading-snug text-orange-200 ring-1 ring-orange-400/20">
      Nothing has arrived from {SOURCE_LABEL[source]} — not even room tone.
      {source === 'system'
        ? ' macOS may have denied audio capture; granting it needs a relaunch.'
        : ' Check the device is not muted.'}
    </div>
  )
}

export function VariantA({world: w, actions}: VariantProps) {
  const missing = pinnedButMissing(w)

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-2">
        <div className="px-4 py-4 text-sm font-bold tracking-tight">Recap</div>
        <nav className="space-y-0.5 px-2">
          <button
            onClick={actions.reset}
            className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
              w.phase === 'preparing' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}>
            Library
          </button>
          <button
            className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
              w.phase !== 'preparing' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}>
            New recording
          </button>
        </nav>

        <div className="mt-6 px-4 text-[11px] font-semibold tracking-wider text-white/35 uppercase">
          Activity
        </div>
        <div className="mt-2 space-y-2 px-2">
          {w.phase === 'capturing' && (
            <div className="rounded-lg bg-red-500/10 p-2.5">
              <div className="flex items-center gap-2 text-xs font-medium text-red-300">
                <span className="size-2 animate-pulse rounded-full bg-red-400" />
                Recording
              </div>
              <div className="mt-1 text-xs tabular-nums text-white/60">
                {formatDuration(w.elapsed)}
              </div>
              <div className="mt-1.5 text-[10px] text-white/35">
                Open the recording screen to see the meters
              </div>
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
          {w.phase !== 'capturing' && !w.transcribing && (
            <div className="px-2.5 py-2 text-[11px] text-white/25">Nothing running</div>
          )}
        </div>

        <div className="mt-auto p-2">
          <button
            onClick={actions.reset}
            className="w-full rounded-md bg-red-500/90 py-2 text-sm font-medium hover:bg-red-500">
            Record
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8 pb-28">
        {w.phase === 'preparing' ? (
          <PreparingPage onBack={actions.reset} />
        ) : (
          <div className="mx-auto max-w-2xl">
            <h1 className="text-xl font-bold">
              {w.phase === 'capturing' ? 'Recording' : 'New recording'}
            </h1>
            <p className="mt-1 text-xs text-white/40">
              {w.phase === 'capturing'
                ? 'Sources are fixed for this recording.'
                : 'Pick what to record. Nothing is named yet — you can title it afterwards.'}
            </p>

            {/* the fallback notice lives at the top of the page and persists */}
            {w.notices.map(n => (
              <div
                key={n.id}
                className="mt-4 flex items-start gap-3 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-400/25">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-amber-200">{n.title}</div>
                  <div className="mt-0.5 text-[11px] text-amber-100/70">{n.detail}</div>
                </div>
                <button
                  onClick={() => actions.dismissNotice(n.id)}
                  className="shrink-0 rounded px-1.5 text-amber-200/60 hover:bg-white/10">
                  ×
                </button>
              </div>
            ))}

            {w.phase === 'capturing' && (
              <div className="mt-5 flex items-center gap-4 rounded-xl bg-red-500/10 p-4 ring-1 ring-red-400/20">
                <span className="size-3 animate-pulse rounded-full bg-red-400" />
                <span className="text-3xl font-semibold tabular-nums">
                  {formatDuration(w.elapsed)}
                </span>
                <button
                  onClick={actions.stop}
                  className="ml-auto rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90">
                  Stop
                </button>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {SOURCES.map(s => {
                const on = w.enabled[s]
                const shown = w.phase === 'capturing' ? on : true
                if (!shown) return null
                return (
                  <div
                    key={s}
                    className={`rounded-xl p-4 ring-1 transition-colors ${
                      on ? 'bg-ink-2 ring-white/10' : 'bg-ink-2/40 ring-white/5'
                    }`}>
                    <div className="flex items-center gap-3">
                      {w.phase !== 'capturing' && (
                        <button
                          onClick={() => actions.toggleSource(s)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            on ? 'bg-emerald-500' : 'bg-white/15'
                          }`}>
                          <span
                            className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
                              on ? 'left-4.5' : 'left-0.5'
                            }`}
                          />
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{SOURCE_LABEL[s]}</div>
                        <div className="truncate text-[11px] text-white/40">
                          {sourceSublabel(w, s)}
                        </div>
                      </div>
                      {on && <SignalWord source={s} />}
                    </div>

                    {s === 'mic' && on && w.phase !== 'capturing' && (
                      <select
                        value={w.micDeviceId}
                        onChange={e => actions.setMicDevice(e.target.value)}
                        className="mt-3 w-full rounded-md bg-black/40 px-2 py-1.5 text-xs ring-1 ring-white/10">
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

                    {s === 'mic' && missing && w.phase !== 'capturing' && (
                      <div className="mt-2 text-[11px] text-amber-300">
                        {missing.name} isn’t connected. This recording will use{' '}
                        {effectiveMicDevice(w).name}.
                      </div>
                    )}

                    {on && (
                      <>
                        <div className="mt-3">
                          <Meter source={s} big />
                        </div>
                        <DeadWarning source={s} />
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            {w.phase !== 'capturing' && (
              <button
                disabled={!canStart(w)}
                onClick={actions.start}
                className="mt-6 w-full rounded-lg bg-red-500 py-3 text-sm font-semibold hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
                {canStart(w)
                  ? `Start recording · ${selectedSources(w).length} source${
                      selectedSources(w).length > 1 ? 's' : ''
                    }`
                  : 'Pick at least one source'}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

/** #22's page, stubbed — where Stop lands you. */
export function PreparingPage({onBack}: {onBack: () => void}) {
  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={onBack} className="text-xs text-white/40 hover:text-white">
        ‹ Library
      </button>
      <h1 className="mt-3 text-xl font-bold">Aug 10, 2026 at 4:12 PM</h1>
      <div className="mt-1 text-xs text-white/40">Preparing audio…</div>
      <div className="mt-5 h-28 rounded-xl bg-ink-2 ring-1 ring-white/5" />
      <div className="mt-4 h-1.5 w-1/3 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-2/3 bg-sky-400" />
      </div>
      <p className="mt-6 text-xs text-white/35">
        #22 owns this page — waveform, Trim handles, Transcribe. Stubbed here only
        to show where Stop hands off.
      </p>
    </div>
  )
}

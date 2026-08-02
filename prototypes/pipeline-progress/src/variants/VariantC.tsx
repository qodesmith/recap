/**
 * VARIANT C — "Waveform sweep + floating dock"
 *
 * Recording page: progress is spatial. Each track is its waveform (#5 gives us
 * peaks anyway) and processing sweeps left-to-right across it, with the
 * transcript materialising underneath as the edge passes. Nothing is abstract:
 * the bar IS the audio.
 *
 * The rule bites hardest here and that is the point — during an unmeasurable
 * phase the sweep FREEZES and the edge pulses, with the label saying what is
 * happening. A frozen sweep over real audio is either honest or alarming;
 * this variant exists to find out which.
 *
 * Global indicator: a floating dock, bottom-right, collapsed to a pill.
 */
import {useState} from 'react'
import {
  activePhase,
  etaSeconds,
  formatDuration,
  phaseDetail,
  recordingProgress,
  type Recording,
  type Track,
} from '../pipeline'
import type {VariantProps} from '../types'

/** deterministic pseudo-waveform so a track always looks like itself */
function peaks(seed: string, n = 160): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    const base = 0.25 + 0.75 * ((h >> 8) % 1000) / 1000
    // speech-ish envelope: occasional quiet stretches
    const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 9) * Math.cos(i / 23))
    out.push(Math.min(1, base * env))
  }
  return out
}

/**
 * Progress that only advances on measurable work. An active spinner phase
 * contributes nothing, so the sweep visibly stops rather than inventing motion.
 */
function measuredProgress(t: Track): number {
  const total = t.phases.reduce((a, p) => a + p.durationSec, 0)
  if (total <= 0) return t.state === 'transcribed' ? 1 : 0
  const done = t.phases.reduce((a, p) => {
    if (p.status === 'done') return a + p.durationSec
    if (p.status === 'active' && p.kind === 'bar') return a + p.elapsed
    return a
  }, 0)
  return Math.min(1, done / total)
}

function Waveform({t}: {t: Track}) {
  const bars = peaks(t.id)
  const act = activePhase(t)
  const frozen = act?.kind === 'spinner'
  const p = t.state === 'transcribed' ? 1 : measuredProgress(t)
  const edge = Math.round(p * bars.length)
  const failed = t.state === 'failed'

  return (
    <div className="relative">
      <div className="flex h-16 items-center gap-px">
        {bars.map((v, i) => {
          const passed = i < edge
          return (
            <div
              key={i}
              className={`flex-1 rounded-full ${
                failed
                  ? 'bg-orange-400/25'
                  : passed
                    ? 'bg-emerald-400'
                    : 'bg-white/12'
              }`}
              style={{height: `${Math.max(6, v * 100)}%`}}
            />
          )
        })}
      </div>

      {!failed && t.state !== 'transcribed' && t.state !== 'pending' && (
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{left: `${p * 100}%`}}>
          <div
            className={`h-full w-0.5 ${
              frozen ? 'animate-pulse bg-fuchsia-400' : 'bg-emerald-300'
            }`}
          />
          <div
            className={`absolute top-1/2 left-2 flex -translate-y-1/2 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] whitespace-nowrap ${
              frozen
                ? 'bg-fuchsia-500/90 text-white'
                : 'bg-emerald-400/90 text-emerald-950'
            }`}>
            {frozen && (
              <span className="size-2.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {act?.label}
            {!frozen && act && (
              <span className="tabular-nums opacity-70">{phaseDetail(act)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FakeTranscript({t}: {t: Track}) {
  const p = measuredProgress(t)
  const lines = 8
  const shown = Math.floor(p * lines)
  return (
    <div className="mt-3 space-y-1.5">
      {Array.from({length: lines}).map((_, i) => (
        <div key={i} className="flex gap-3">
          <span
            className={`w-20 shrink-0 text-[11px] tabular-nums ${
              i < shown ? 'text-white/40' : 'text-white/10'
            }`}>
            {String(Math.floor((i * 4) / 60)).padStart(2, '0')}:
            {String((i * 4) % 60).padStart(2, '0')}
          </span>
          <div
            className={`h-3 rounded ${i < shown ? 'bg-white/25' : 'bg-white/[0.04]'}`}
            style={{width: `${45 + ((i * 37) % 45)}%`}}
          />
        </div>
      ))}
    </div>
  )
}

export function VariantC({world, view, navigate, actions}: VariantProps) {
  const [dockOpen, setDockOpen] = useState(false)
  const active = world.recordings.find(r => r.id === world.activeId) ?? null
  const queued = world.queue
    .map(id => world.recordings.find(r => r.id === id))
    .filter((r): r is Recording => !!r)
  const capturing = world.recordings.filter(r => r.state === 'capturing')
  const count = (active ? 1 : 0) + queued.length + capturing.length

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-white/5 bg-ink/90 px-6 py-3 backdrop-blur">
        <button
          onClick={() => navigate({kind: 'library'})}
          className="text-sm font-bold tracking-tight">
          Recap
        </button>
        <button
          onClick={() => navigate({kind: 'library'})}
          className="text-sm text-white/50 hover:text-white">
          Library
        </button>
        <button
          onClick={actions.startCapture}
          className="ml-auto rounded-full bg-red-500/90 px-4 py-1.5 text-sm font-medium hover:bg-red-500">
          Record
        </button>
      </header>

      <main className="mx-auto max-w-4xl p-8 pb-32">
        {view.kind === 'library' ? (
          <>
            <h1 className="text-2xl font-bold">Library</h1>
            <div className="mt-6 space-y-3">
              {world.recordings.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate({kind: 'recording', id: r.id})}
                  className="block w-full rounded-2xl bg-ink-2 p-5 text-left ring-1 ring-white/5 hover:ring-white/15">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-xs text-white/35">{r.when}</span>
                  </div>
                  <div className="mt-3 flex h-8 items-center gap-px opacity-70">
                    {peaks(r.id, 90).map((v, i) => {
                      const passed = i / 90 < recordingProgress(r)
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-full ${
                            passed ? 'bg-emerald-400/80' : 'bg-white/10'
                          }`}
                          style={{height: `${Math.max(8, v * 100)}%`}}
                        />
                      )
                    })}
                  </div>
                  <div className="mt-2 text-xs text-white/40">
                    {r.state === 'processing'
                      ? `Transcribing — ${Math.round(recordingProgress(r) * 100)}%`
                      : r.state === 'capturing'
                        ? `Recording — ${formatDuration(r.captureElapsedSec ?? 0)}`
                        : r.state}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          (() => {
            const r = world.recordings.find(x => x.id === view.id)!
            const busy = r.state === 'processing' || r.state === 'queued'
            const eta = etaSeconds(r, world.machine)
            return (
              <>
                <button
                  onClick={() => navigate({kind: 'library'})}
                  className="text-xs text-white/40 hover:text-white">
                  ‹ Library
                </button>
                <div className="mt-3 flex items-start justify-between gap-6">
                  <div>
                    <h1 className="text-2xl font-bold">{r.title}</h1>
                    <div className="mt-1 text-sm text-white/40">
                      {r.when} · {Math.round(r.durationMin)} min
                    </div>
                  </div>
                  {busy ? (
                    <button
                      onClick={() => actions.cancel(r.id)}
                      className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
                      Cancel
                    </button>
                  ) : r.state !== 'transcribed' ? (
                    <button
                      onClick={() => actions.transcribe(r.id)}
                      className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-300">
                      {r.state === 'partial' || r.state === 'needs-attention'
                        ? 'Transcribe the rest'
                        : 'Transcribe'}
                    </button>
                  ) : null}
                </div>

                {busy && (
                  <div className="mt-4 text-sm text-white/50">
                    {r.state === 'queued'
                      ? 'Waiting — another recording is transcribing'
                      : eta == null
                        ? 'Working — no time estimate for this step'
                        : `About ${formatDuration(eta)} left`}
                  </div>
                )}

                {r.state === 'needs-attention' && (
                  <div className="mt-4 rounded-2xl bg-orange-500/10 p-4 text-sm text-orange-200 ring-1 ring-orange-400/20">
                    {r.tracks.filter(t => t.state === 'failed').map(t => t.label).join(', ')}{' '}
                    couldn’t be transcribed — audio still plays.
                  </div>
                )}

                <div className="mt-8 space-y-8">
                  {r.tracks.map(t => (
                    <section key={t.id}>
                      <div className="mb-2 flex items-baseline justify-between">
                        <h2 className="text-sm font-semibold">{t.label}</h2>
                        <span className="text-xs text-white/35">
                          {t.state === 'failed' ? 'failed' : t.state}
                        </span>
                      </div>
                      <Waveform t={t} />
                      <FakeTranscript t={t} />
                    </section>
                  ))}
                </div>
              </>
            )
          })()
        )}
      </main>

      {/* ---------------- the global indicator: a floating dock ---------------- */}
      {count > 0 && (
        <div className="fixed right-5 bottom-5 z-50 w-80">
          {dockOpen && (
            <div className="mb-2 space-y-2 rounded-2xl bg-ink-3 p-3 shadow-2xl ring-1 ring-white/10">
              {capturing.map(r => (
                <div key={r.id} className="flex items-center gap-3 rounded-xl bg-red-500/10 p-3">
                  <span className="size-2 animate-pulse rounded-full bg-red-400" />
                  <span className="flex-1 truncate text-sm">Recording</span>
                  <span className="tabular-nums text-xs text-white/50">
                    {formatDuration(r.captureElapsedSec ?? 0)}
                  </span>
                  <button
                    onClick={() => actions.stopCapture(r.id)}
                    className="rounded-full bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20">
                    Stop
                  </button>
                </div>
              ))}
              {active && (
                <div className="rounded-xl bg-white/5 p-3">
                  <button
                    onClick={() => navigate({kind: 'recording', id: active.id})}
                    className="block w-full truncate text-left text-sm font-medium hover:underline">
                    {active.title}
                  </button>
                  <div className="mt-1 truncate text-xs text-white/50">
                    {activePhase(active.tracks.find(t => activePhase(t)) ?? active.tracks[0])
                      ?.label ?? 'Finishing up'}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-emerald-400"
                      style={{width: `${recordingProgress(active) * 100}%`}}
                    />
                  </div>
                  <button
                    onClick={() => actions.cancel(active.id)}
                    className="mt-2 text-xs text-white/40 hover:text-white">
                    Cancel
                  </button>
                </div>
              )}
              {queued.map((r, i) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-3 text-sm">
                  <span className="text-xs text-white/35">#{i + 1}</span>
                  <span className="flex-1 truncate text-white/70">{r.title}</span>
                  <button
                    onClick={() => actions.cancel(r.id)}
                    className="text-white/35 hover:text-white">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setDockOpen(o => !o)}
            className="flex w-full items-center gap-3 rounded-full bg-ink-3 px-4 py-3 shadow-2xl ring-1 ring-white/10 hover:ring-white/25">
            <span className="relative grid size-7 shrink-0 place-items-center">
              <svg viewBox="0 0 36 36" className="size-7 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke="rgba(255,255,255,.12)"
                  strokeWidth="4"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke="rgb(52,211,153)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${(active ? recordingProgress(active) : 0) * 94} 94`}
                />
              </svg>
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-xs font-medium">
                {active ? active.title : capturing.length ? 'Recording' : 'Idle'}
              </span>
              <span className="block truncate text-[11px] text-white/45">
                {active
                  ? (activePhase(
                      active.tracks.find(t => activePhase(t)) ?? active.tracks[0]
                    )?.label ?? 'Finishing up')
                  : `${count} active`}
              </span>
            </span>
            {queued.length > 0 && (
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                +{queued.length}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

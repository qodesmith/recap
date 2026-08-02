/**
 * VARIANT A — "Stepper + sidebar activity"
 *
 * Recording page: one card per track, each a vertical checklist of phases.
 * Done phases collapse to a ticked line, the active one shows its bar or
 * spinner, pending ones sit dimmed below. You can read the whole pipeline.
 * Global indicator: a permanent Activity section in the left sidebar.
 */
import {useState} from 'react'
import {
  activePhase,
  etaSeconds,
  formatDuration,
  phaseDetail,
  phaseProgress,
  recordingProgress,
  trackProgress,
  type PhaseRun,
  type Recording,
  type Track,
} from '../pipeline'
import type {VariantProps} from '../types'

const STATE_CHIP: Record<string, string> = {
  capturing: 'bg-red-500/15 text-red-300',
  unprocessed: 'bg-white/10 text-white/60',
  queued: 'bg-amber-500/15 text-amber-300',
  processing: 'bg-sky-500/15 text-sky-300',
  partial: 'bg-violet-500/15 text-violet-300',
  transcribed: 'bg-emerald-500/15 text-emerald-300',
  'needs-attention': 'bg-orange-500/15 text-orange-300',
}

const STATE_LABEL: Record<string, string> = {
  capturing: 'Recording',
  unprocessed: 'Not transcribed',
  queued: 'Waiting',
  processing: 'Transcribing',
  partial: 'Partly transcribed',
  transcribed: 'Transcribed',
  'needs-attention': 'Needs attention',
}

function Bar({value, tone = 'sky'}: {value: number; tone?: 'sky' | 'emerald'}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-[width] duration-150 ${
          tone === 'emerald' ? 'bg-emerald-400' : 'bg-sky-400'
        }`}
        style={{width: `${value * 100}%`}}
      />
    </div>
  )
}

function Indeterminate() {
  return (
    <div className="proto-indeterminate relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 text-violet-400" />
  )
}

function PhaseLine({p}: {p: PhaseRun}) {
  if (p.status === 'done')
    return (
      <li className="flex items-center gap-2 py-1 text-xs text-white/35">
        <span className="text-emerald-400">✓</span>
        <span className="line-through decoration-white/20">{p.label}</span>
      </li>
    )

  if (p.status === 'pending')
    return (
      <li className="flex items-center gap-2 py-1 text-xs text-white/25">
        <span className="grid size-3.5 place-items-center rounded-full border border-white/20" />
        {p.label}
      </li>
    )

  return (
    <li className="py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2 font-medium text-white">
          {p.kind === 'spinner' ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />
          ) : (
            <span className="size-3.5 rounded-full border-2 border-sky-400" />
          )}
          {p.label}
        </span>
        <span className="tabular-nums text-white/50">
          {p.kind === 'spinner' ? 'no estimate' : phaseDetail(p)}
        </span>
      </div>
      <div className="pl-5.5">
        {p.kind === 'spinner' ? <Indeterminate /> : <Bar value={phaseProgress(p)} />}
      </div>
    </li>
  )
}

function TrackCard({t}: {t: Track}) {
  const [open, setOpen] = useState(true)
  const act = activePhase(t)
  const pct = trackProgress(t)

  return (
    <div className="rounded-xl bg-ink-2 p-4 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{t.label}</div>
          <div className="mt-0.5 text-xs text-white/50">
            {t.state === 'failed' ? (
              <span className="text-orange-300">Failed — no transcript for this source</span>
            ) : t.state === 'transcribed' ? (
              'Transcribed'
            ) : act ? (
              act.label
            ) : (
              'Waiting'
            )}
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5">
          {open ? 'Hide steps' : 'Show steps'}
        </button>
      </div>

      <div className="mt-3">
        {t.state === 'failed' ? (
          <div className="h-1.5 w-full rounded-full bg-orange-500/30" />
        ) : act?.kind === 'spinner' ? (
          <Indeterminate />
        ) : (
          <Bar value={pct} tone={t.state === 'transcribed' ? 'emerald' : 'sky'} />
        )}
      </div>

      {open && (
        <ul className="mt-3 border-t border-white/5 pt-2">
          {t.phases.map(p => (
            <PhaseLine key={p.id} p={p} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function VariantA({world, view, navigate, actions}: VariantProps) {
  const active = world.recordings.find(r => r.id === world.activeId) ?? null
  const queued = world.queue
    .map(id => world.recordings.find(r => r.id === id))
    .filter((r): r is Recording => !!r)
  const capturing = world.recordings.filter(r => r.state === 'capturing')

  return (
    <div className="flex h-full">
      {/* ---------------- sidebar: nav + the global indicator ---------------- */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-2">
        <div className="px-4 py-4 text-sm font-bold tracking-tight">Recap</div>
        <nav className="px-2">
          <button
            onClick={() => navigate({kind: 'library'})}
            className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
              view.kind === 'library' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}>
            Library
          </button>
        </nav>

        <div className="mt-6 px-4 text-[11px] font-semibold tracking-wider text-white/35 uppercase">
          Activity
        </div>
        <div className="mt-2 space-y-2 px-2">
          {capturing.map(r => (
            <div key={r.id} className="rounded-lg bg-red-500/10 p-2.5">
              <div className="flex items-center gap-2 text-xs font-medium text-red-300">
                <span className="size-2 animate-pulse rounded-full bg-red-400" />
                Recording
              </div>
              <div className="mt-1 tabular-nums text-xs text-white/60">
                {formatDuration(r.captureElapsedSec ?? 0)}
              </div>
              <button
                onClick={() => actions.stopCapture(r.id)}
                className="mt-2 w-full rounded bg-white/10 py-1 text-xs hover:bg-white/20">
                Stop
              </button>
            </div>
          ))}

          {active && (
            <button
              onClick={() => navigate({kind: 'recording', id: active.id})}
              className="w-full rounded-lg bg-white/5 p-2.5 text-left hover:bg-white/10">
              <div className="truncate text-xs font-medium">{active.title}</div>
              <div className="mt-1 truncate text-[11px] text-white/50">
                {activePhase(active.tracks.find(t => activePhase(t)) ?? active.tracks[0])
                  ?.label ?? 'Finishing up'}
              </div>
              <div className="mt-2">
                <Bar value={recordingProgress(active)} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-white/40">
                <span>{Math.round(recordingProgress(active) * 100)}%</span>
                <span>
                  {(() => {
                    const e = etaSeconds(active, world.machine)
                    return e == null ? 'estimating…' : `${formatDuration(e)} left`
                  })()}
                </span>
              </div>
            </button>
          )}

          {queued.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-lg bg-white/[0.03] p-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs text-white/70">{r.title}</div>
                <div className="text-[11px] text-white/40">#{i + 1} in queue</div>
              </div>
              <button
                onClick={() => actions.cancel(r.id)}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-white/40 hover:bg-white/10">
                ×
              </button>
            </div>
          ))}

          {!active && !queued.length && !capturing.length && (
            <div className="px-2.5 py-2 text-[11px] text-white/25">Nothing running</div>
          )}
        </div>

        <div className="mt-auto p-2">
          <button
            onClick={actions.startCapture}
            className="w-full rounded-md bg-red-500/90 py-2 text-sm font-medium hover:bg-red-500">
            Record
          </button>
        </div>
      </aside>

      {/* ---------------- main ---------------- */}
      <main className="flex-1 overflow-y-auto p-8 pb-28">
        {view.kind === 'library' ? (
          <>
            <h1 className="text-xl font-bold">Library</h1>
            <div className="mt-5 space-y-2">
              {world.recordings.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate({kind: 'recording', id: r.id})}
                  className="flex w-full items-center gap-4 rounded-lg bg-ink-2 p-4 text-left ring-1 ring-white/5 hover:ring-white/15">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-white/40">
                      {r.when} · {r.tracks.length} track{r.tracks.length > 1 ? 's' : ''}
                    </div>
                  </div>
                  {r.state === 'processing' && (
                    <div className="w-40">
                      <Bar value={recordingProgress(r)} />
                    </div>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${STATE_CHIP[r.state]}`}>
                    {STATE_LABEL[r.state]}
                  </span>
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
                    <h1 className="text-xl font-bold">{r.title}</h1>
                    <div className="mt-1 text-xs text-white/40">
                      {r.when} · {Math.round(r.durationMin)} min ·{' '}
                      {r.tracks.length} tracks
                    </div>
                  </div>
                  {busy ? (
                    <button
                      onClick={() => actions.cancel(r.id)}
                      className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
                      Cancel
                    </button>
                  ) : r.state !== 'transcribed' ? (
                    <button
                      onClick={() => actions.transcribe(r.id)}
                      className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium hover:bg-sky-400">
                      {r.state === 'partial' || r.state === 'needs-attention'
                        ? 'Transcribe the rest'
                        : 'Transcribe'}
                    </button>
                  ) : null}
                </div>

                {r.state === 'needs-attention' && (
                  <div className="mt-4 rounded-lg bg-orange-500/10 p-3 text-xs text-orange-200 ring-1 ring-orange-400/20">
                    {r.tracks.filter(t => t.state === 'failed').map(t => t.label).join(', ')}{' '}
                    couldn’t be transcribed. The rest of this recording is fine and still
                    plays.
                  </div>
                )}

                {busy && (
                  <div className="mt-5 rounded-xl bg-ink-3 p-4 ring-1 ring-white/5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">
                        {r.state === 'queued'
                          ? 'Waiting — another recording is transcribing'
                          : `Transcribing · track ${
                              Math.min(
                                r.tracks.length,
                                r.tracks.filter(t => t.state === 'transcribed' || t.state === 'failed')
                                  .length + 1
                              )
                            } of ${r.tracks.length}`}
                      </span>
                      <span className="tabular-nums text-white/50">
                        {eta == null ? 'no estimate' : `${formatDuration(eta)} left`}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Bar value={recordingProgress(r)} />
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  {r.tracks.map(t => (
                    <TrackCard key={t.id} t={t} />
                  ))}
                  {r.recPhases.some(p => p.status !== 'pending') && (
                    <div className="rounded-xl bg-ink-2 p-4 ring-1 ring-white/5">
                      <div className="text-sm font-semibold">Playback assets</div>
                      <ul className="mt-2">
                        {r.recPhases.map(p => (
                          <PhaseLine key={p.id} p={p} />
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )
          })()
        )}
      </main>
    </div>
  )
}

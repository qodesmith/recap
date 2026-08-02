/**
 * VARIANT B — "Mission-control table + top strip"
 *
 * Recording page: a dense, monospace, log-like table. Every phase of every
 * track is a row, always visible, nothing hidden behind disclosure. Reads like
 * a build log; you can see the whole run's shape at once, including what has
 * not started.
 * Global indicator: a permanent one-line strip pinned to the top of the app,
 * which expands into a full-width panel holding the queue.
 */
import {useState} from 'react'
import {
  activePhase,
  etaSeconds,
  formatDuration,
  phaseDetail,
  phaseProgress,
  recordingProgress,
  type PhaseRun,
  type Recording,
} from '../pipeline'
import type {VariantProps} from '../types'

function MiniBar({value, wide}: {value: number; wide?: boolean}) {
  return (
    <div
      className={`h-1 overflow-hidden rounded-sm bg-white/10 ${wide ? 'w-full' : 'w-28'}`}>
      <div className="h-full bg-cyan-400" style={{width: `${value * 100}%`}} />
    </div>
  )
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="size-1 animate-bounce rounded-full bg-fuchsia-400"
          style={{animationDelay: `${i * 120}ms`}}
        />
      ))}
    </span>
  )
}

function PhaseRow({p, track}: {p: PhaseRun; track: string}) {
  const dim =
    p.status === 'pending' ? 'text-white/20' : p.status === 'done' ? 'text-white/40' : ''
  return (
    <tr className={`border-t border-white/5 ${dim}`}>
      <td className="py-1.5 pr-4 whitespace-nowrap">{track}</td>
      <td className="py-1.5 pr-4 whitespace-nowrap">
        {p.status === 'done' ? (
          <span className="text-emerald-400">done</span>
        ) : p.status === 'active' ? (
          <span className="text-cyan-300">run</span>
        ) : (
          <span>—</span>
        )}
      </td>
      <td className="py-1.5 pr-4">{p.label}</td>
      <td className="py-1.5 pr-4 whitespace-nowrap">
        {p.kind === 'spinner' ? (
          <span className="rounded bg-fuchsia-400/10 px-1 text-[10px] text-fuchsia-300">
            no % available
          </span>
        ) : (
          <span className="rounded bg-cyan-400/10 px-1 text-[10px] text-cyan-300">
            measurable
          </span>
        )}
      </td>
      <td className="w-40 py-1.5 pr-4">
        {p.status === 'active' &&
          (p.kind === 'spinner' ? <Dots /> : <MiniBar value={phaseProgress(p)} />)}
        {p.status === 'done' && <MiniBar value={1} />}
      </td>
      <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
        {p.status === 'pending' ? '' : p.kind === 'spinner' ? '' : phaseDetail(p)}
      </td>
    </tr>
  )
}

export function VariantB({world, view, navigate, actions}: VariantProps) {
  const [panel, setPanel] = useState(false)
  const active = world.recordings.find(r => r.id === world.activeId) ?? null
  const queued = world.queue
    .map(id => world.recordings.find(r => r.id === id))
    .filter((r): r is Recording => !!r)
  const capturing = world.recordings.filter(r => r.state === 'capturing')
  const busyPhase = active
    ? activePhase(active.tracks.find(t => activePhase(t)) ?? active.tracks[0])
    : null
  const anything = active || queued.length || capturing.length

  return (
    <div className="flex h-full flex-col font-mono text-[13px]">
      {/* ---------------- the global indicator: a top strip ---------------- */}
      <div className="shrink-0 border-b border-white/10 bg-ink-2">
        <button
          onClick={() => setPanel(p => !p)}
          className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5">
          {anything ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
              <span className="truncate">
                {capturing.length > 0 && (
                  <span className="mr-3 text-red-300">
                    ● REC {formatDuration(capturing[0].captureElapsedSec ?? 0)}
                  </span>
                )}
                {active ? (
                  <>
                    <span className="text-white/50">{active.title}</span>{' '}
                    <span className="text-white/30">›</span>{' '}
                    {busyPhase?.label ?? 'finishing up'}
                  </>
                ) : (
                  <span className="text-white/40">idle</span>
                )}
              </span>
              {active && <MiniBar value={recordingProgress(active)} />}
              {queued.length > 0 && (
                <span className="rounded bg-amber-400/15 px-1.5 text-[11px] text-amber-300">
                  +{queued.length} queued
                </span>
              )}
              <span className="ml-auto text-white/30">{panel ? '▲' : '▼'}</span>
            </>
          ) : (
            <span className="text-white/25">idle</span>
          )}
        </button>

        {panel && (
          <div className="border-t border-white/5 bg-ink-3 px-4 py-3">
            <div className="mb-2 text-[11px] tracking-wider text-white/35 uppercase">
              Queue
            </div>
            {!anything && <div className="text-white/25">nothing running</div>}
            {capturing.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-1">
                <span className="w-16 text-red-300">REC</span>
                <span className="flex-1 truncate">{r.title}</span>
                <span className="tabular-nums text-white/50">
                  {formatDuration(r.captureElapsedSec ?? 0)}
                </span>
                <button
                  onClick={() => actions.stopCapture(r.id)}
                  className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20">
                  stop
                </button>
              </div>
            ))}
            {active && (
              <div className="flex items-center gap-3 py-1">
                <span className="w-16 text-cyan-300">ACTIVE</span>
                <button
                  onClick={() => navigate({kind: 'recording', id: active.id})}
                  className="flex-1 truncate text-left hover:underline">
                  {active.title}
                </button>
                <span className="w-40">
                  <MiniBar value={recordingProgress(active)} wide />
                </span>
                <span className="w-20 text-right tabular-nums text-white/50">
                  {(() => {
                    const e = etaSeconds(active, world.machine)
                    return e == null ? '—' : formatDuration(e)
                  })()}
                </span>
                <button
                  onClick={() => actions.cancel(active.id)}
                  className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20">
                  cancel
                </button>
              </div>
            )}
            {queued.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 py-1 text-white/50">
                <span className="w-16">#{i + 1}</span>
                <span className="flex-1 truncate">{r.title}</span>
                <span className="w-40" />
                <span className="w-20" />
                <button
                  onClick={() => actions.cancel(r.id)}
                  className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20">
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 border-r border-white/5 p-3">
          <div className="mb-4 font-sans text-sm font-bold">Recap</div>
          <button
            onClick={() => navigate({kind: 'library'})}
            className={`w-full rounded px-2 py-1 text-left ${
              view.kind === 'library' ? 'bg-white/10' : 'hover:bg-white/5'
            }`}>
            library
          </button>
          <button
            onClick={actions.startCapture}
            className="mt-3 w-full rounded bg-red-500/80 px-2 py-1 hover:bg-red-500">
            record
          </button>
        </nav>

        <main className="flex-1 overflow-y-auto p-6 pb-28">
          {view.kind === 'library' ? (
            <table className="w-full text-left">
              <thead className="text-[11px] tracking-wider text-white/35 uppercase">
                <tr>
                  <th className="pb-2">recording</th>
                  <th className="pb-2">tracks</th>
                  <th className="pb-2">state</th>
                  <th className="pb-2 text-right">progress</th>
                </tr>
              </thead>
              <tbody>
                {world.recordings.map(r => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-2">
                      <button
                        onClick={() => navigate({kind: 'recording', id: r.id})}
                        className="hover:underline">
                        {r.title}
                      </button>
                      <div className="text-[11px] text-white/30">{r.when}</div>
                    </td>
                    <td className="py-2 text-white/50">{r.tracks.length}</td>
                    <td className="py-2 text-white/50">{r.state}</td>
                    <td className="py-2">
                      <div className="flex justify-end">
                        {r.state === 'processing' || r.state === 'partial' ? (
                          <MiniBar value={recordingProgress(r)} />
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            (() => {
              const r = world.recordings.find(x => x.id === view.id)!
              const busy = r.state === 'processing' || r.state === 'queued'
              return (
                <>
                  <button
                    onClick={() => navigate({kind: 'library'})}
                    className="text-white/40 hover:text-white">
                    ‹ library
                  </button>
                  <div className="mt-3 flex items-center justify-between">
                    <h1 className="font-sans text-lg font-bold">{r.title}</h1>
                    {busy ? (
                      <button
                        onClick={() => actions.cancel(r.id)}
                        className="rounded bg-white/10 px-3 py-1 hover:bg-white/20">
                        cancel
                      </button>
                    ) : r.state !== 'transcribed' ? (
                      <button
                        onClick={() => actions.transcribe(r.id)}
                        className="rounded bg-cyan-500 px-3 py-1 font-medium text-black hover:bg-cyan-400">
                        {r.state === 'partial' || r.state === 'needs-attention'
                          ? 'transcribe the rest'
                          : 'transcribe'}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11px] text-white/35">
                    {r.when} · {Math.round(r.durationMin)} min · {r.kind}
                  </div>

                  {r.state === 'needs-attention' && (
                    <div className="mt-4 border-l-2 border-orange-400 bg-orange-400/10 px-3 py-2 text-orange-200">
                      {r.tracks.filter(t => t.state === 'failed').map(t => t.label).join(', ')}{' '}
                      failed. other tracks are transcribed; audio still plays.
                    </div>
                  )}

                  <table className="mt-5 w-full text-left">
                    <thead className="text-[11px] tracking-wider text-white/35 uppercase">
                      <tr>
                        <th className="pb-2 pr-4">track</th>
                        <th className="pb-2 pr-4">st</th>
                        <th className="pb-2 pr-4">phase</th>
                        <th className="pb-2 pr-4">kind</th>
                        <th className="pb-2 pr-4">progress</th>
                        <th className="pb-2 text-right">detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.tracks.map(t =>
                        t.phases.map(p => <PhaseRow key={t.id + p.id} p={p} track={t.label} />)
                      )}
                      {r.recPhases.map(p => (
                        <PhaseRow key={p.id} p={p} track="(recording)" />
                      ))}
                    </tbody>
                  </table>
                </>
              )
            })()
          )}
        </main>
      </div>
    </div>
  )
}

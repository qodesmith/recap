/**
 * The backdrop. Not the design under test — but the modal cannot be judged in
 * a vacuum, and one of #25's sub-questions is literally "what does the backdrop
 * show?", so this has to be populated and it has to render the `capturing` row
 * (togglable from the prototype knobs) so the answer can be *looked* at.
 */
import {formatDuration, type World} from './capture'

export function Library({
  w,
  onNew,
  onOpen,
  inert,
}: {
  w: World
  onNew: () => void
  onOpen: () => void
  inert: boolean
}) {
  /*
   * NO `capturing` row. The bundle exists from Start (#23), but the library is
   * behind a modal for the whole capture, so a row there is drawn where nobody
   * is looking. The list's job is to be correct the moment the modal goes away
   * — the Recording shows up when it lands, as `preparing`.
   */
  const rows = w.recordings.filter(r => r.state !== 'capturing')

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/5 bg-ink-2">
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
          {/*
            NOTE: there is no capture row here, ever. #24 settled that Start does
            not dismiss the modal, so you can never be looking at the sidebar
            while a capture runs — which retires #23's "the Activity row names
            the source and says what happened". The row would be unreachable UI.
          */}
          {w.transcribing ? (
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="truncate text-xs font-medium">Call with Dana</div>
              <div className="mt-1 text-[11px] text-white/50">Transcribing · ASR</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-sky-400 transition-[width]"
                  style={{width: `${w.transcribeProgress * 100}%`}}
                />
              </div>
            </div>
          ) : (
            <div className="px-2.5 py-2 text-[11px] text-white/25">Nothing running</div>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Library</h1>
          <button
            onClick={onNew}
            disabled={inert}
            className="rounded-md bg-red-500/90 px-3 py-1.5 text-sm font-medium hover:bg-red-500 disabled:bg-white/10 disabled:text-white/30">
            New recording
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {rows.map(r => (
            <button
              key={r.id}
              onClick={onOpen}
              disabled={inert}
              className="flex w-full items-center gap-4 rounded-lg bg-ink-2 p-4 text-left ring-1 ring-white/5 enabled:hover:ring-white/15">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="text-xs text-white/40">
                  {r.when} · {r.tracks.join(', ')}
                </div>
              </div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                {r.state}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}

/** #22's page, stubbed — where Stop hands off. Out of scope here. */
export function PreparingPage({onBack}: {onBack: () => void}) {
  return (
    <div className="h-full overflow-y-auto p-8">
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
    </div>
  )
}

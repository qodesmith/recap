/**
 * THE CONFIRMATION — the one place #25 says variants are warranted.
 *
 * Three outcomes, one of them destructive, arrived at by reflex (Esc, ×). The
 * three variants disagree about WHERE it happens, which is really a disagreement
 * about whether you should still be able to see the meters while you decide.
 *
 * Everything except placement is held constant on purpose, so the comparison is
 * about shape and not about copy:
 *
 *   - "Keep recording" is the default action and takes the focus, because the
 *     most likely reason you are here is that you hit Esc without meaning to.
 *   - "Stop" is the expected action and reads as primary.
 *   - "Discard" is quiet, far from Cancel, and states its cost in the only unit
 *     the user has — seconds of their conversation. It gets NO second confirm:
 *     #25 names that as the failure mode, and a confirmation that has to be
 *     confirmed is an admission the first one didn't say enough.
 */
import {useEffect, useRef} from 'react'
import {formatDuration} from './capture'

export type ConfirmProps = {
  elapsed: number
  onStop: () => void
  onDiscard: () => void
  onCancel: () => void
}

export type ConfirmVariant = {
  key: string
  name: string
  /** where the modal has to render it — the actual difference between them */
  slot: 'footer' | 'overlay' | 'sheet'
  Component: (p: ConfirmProps) => React.ReactElement
}

/* ------------------------------------------------------------------ */
/* shared pieces — copy and semantics, never layout                    */
/* ------------------------------------------------------------------ */

function useAutoFocus() {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

function DiscardButton({
  elapsed,
  onDiscard,
  block,
}: {
  elapsed: number
  onDiscard: () => void
  block?: boolean
}) {
  return (
    <button
      onClick={onDiscard}
      className={`group rounded-md px-3 py-2 text-left text-sm text-red-300/80 hover:bg-red-500/10 hover:text-red-300 ${
        block ? 'w-full' : ''
      }`}>
      <span className="font-medium">Discard</span>
      <span className="ml-2 text-[11px] text-white/35 group-hover:text-red-200/60">
        throws away {formatDuration(elapsed)} · can’t be undone
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* A — in place, in the footer                                         */
/* ------------------------------------------------------------------ */

/**
 * No new layer at all: the footer stops being a Stop button and becomes the
 * question. Nothing is covered, both meters keep running in full view, and the
 * modal never stacks on itself.
 */
function FooterConfirm({elapsed, onStop, onDiscard, onCancel}: ConfirmProps) {
  const cancel = useAutoFocus()
  return (
    <div className="rounded-xl bg-ink-3 p-3 ring-1 ring-white/10">
      <div className="text-sm font-medium">
        Stop this recording?{' '}
        <span className="font-normal text-white/45">
          {formatDuration(elapsed)} captured.
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          ref={cancel}
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/5 focus:ring-2 focus:ring-white/60 focus:outline-none">
          Keep recording
        </button>
        <button
          onClick={onStop}
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90">
          Stop
        </button>
        <div className="ml-auto">
          <DiscardButton elapsed={elapsed} onDiscard={onDiscard} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* B — a second modal, stacked                                         */
/* ------------------------------------------------------------------ */

/**
 * The conventional answer: an alert over the sheet, its own backdrop, the
 * recording modal dimmed behind it. Maximum stop-and-read — at the cost of
 * covering the only surface that can tell you a source has gone flat, in an
 * app whose entire capture story is "watch the meter".
 */
function StackedConfirm({elapsed, onStop, onDiscard, onCancel}: ConfirmProps) {
  const cancel = useAutoFocus()
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-black/70 p-6">
      <div className="w-[22rem] rounded-xl bg-ink-3 p-5 shadow-2xl ring-1 ring-white/15">
        <div className="text-base font-semibold">Stop this recording?</div>
        <p className="mt-1 text-xs text-white/45">
          {formatDuration(elapsed)} captured. Stopping keeps it — you can trim and
          transcribe it next.
        </p>
        <div className="mt-4 space-y-2">
          <button
            onClick={onStop}
            className="w-full rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90">
            Stop
          </button>
          <button
            ref={cancel}
            onClick={onCancel}
            className="w-full rounded-md px-4 py-2 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/5 focus:ring-2 focus:ring-white/60 focus:outline-none">
            Keep recording
          </button>
        </div>
        <div className="mt-3 border-t border-white/10 pt-2">
          <DiscardButton elapsed={elapsed} onDiscard={onDiscard} block />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C — a sheet over the bottom of the modal                            */
/* ------------------------------------------------------------------ */

/**
 * Slides up from the modal's own bottom edge, covering the footer and stopping
 * short of the meters. Tries to have both: a distinct layer that clearly
 * interrupts, without blinding you to the thing you are recording.
 */
function SheetConfirm({elapsed, onStop, onDiscard, onCancel}: ConfirmProps) {
  const cancel = useAutoFocus()
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 rounded-b-2xl border-t border-white/10 bg-ink-3 p-4 shadow-[0_-12px_30px_rgba(0,0,0,0.5)] proto-slide-up">
      <div className="text-sm font-semibold">Stop this recording?</div>
      <p className="mt-0.5 text-xs text-white/45">
        {formatDuration(elapsed)} captured. The meters above are still live.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onStop}
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90">
          Stop
        </button>
        <button
          ref={cancel}
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/5 focus:ring-2 focus:ring-white/60 focus:outline-none">
          Keep recording
        </button>
        <div className="ml-auto">
          <DiscardButton elapsed={elapsed} onDiscard={onDiscard} />
        </div>
      </div>
    </div>
  )
}

export const CONFIRM_VARIANTS: ConfirmVariant[] = [
  {key: 'A', name: 'Confirm in place (footer becomes the question)', slot: 'footer', Component: FooterConfirm},
  {key: 'B', name: 'Confirm stacked (a second modal)', slot: 'overlay', Component: StackedConfirm},
  {key: 'C', name: 'Confirm as a sheet (slides over the footer)', slot: 'sheet', Component: SheetConfirm},
]

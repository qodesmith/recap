import {transport} from './transport'
import type {Segment} from './types'

/**
 * The word run. Shared by all three variants because the *mechanism* is not what
 * they disagree about: every word is a seek target and a highlight target, and an
 * edited Segment loses its word timings so it renders as plain text.
 */
export function Words({
  seg,
  wordClass = '',
  seekOnClick = true,
}: {
  seg: Segment
  wordClass?: string
  /** Variant B turns this off: in an always-editable document, a click is a caret. */
  seekOnClick?: boolean
}) {
  if (seg.edit) return <span>{seg.edit.text}</span>
  return (
    <>
      {seg.words.map((w, i) => (
        <span
          key={i}
          data-w={i}
          onClick={e => {
            if (!seekOnClick) return
            e.stopPropagation()
            transport.seek(w.s)
          }}
          className={`rounded-[3px] data-[playing]:bg-cyan-400/45 data-[playing]:text-black data-[playing]:font-medium ${
            seekOnClick ? 'cursor-text hover:bg-white/10' : ''
          } ${wordClass}`}>
          {w.w}
        </span>
      )).flatMap((el, i) => [el, <span key={`sp${i}`}> </span>])}
    </>
  )
}

import {paragraphs} from './data'
import {transport} from './transport'
import type {Segment, Word} from './types'

/**
 * The word run. Shared by every variant because the *mechanism* is not what they
 * disagree about: every word is a seek target and a highlight target, and an
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
  return <Run words={seg.words} offset={0} wordClass={wordClass} seekOnClick={seekOnClick} />
}

/**
 * Same words, broken into display paragraphs at speech pauses. Still one
 * Segment and one bubble — only whitespace changes.
 */
export function WordParagraphs({
  seg,
  wordClass = '',
}: {
  seg: Segment
  wordClass?: string
}) {
  if (seg.edit) return <span>{seg.edit.text}</span>
  const paras = paragraphs(seg)
  return (
    <>
      {paras.map((p, i) => (
        <p key={p.offset} className={i ? 'mt-3' : ''}>
          <Run words={p.words} offset={p.offset} wordClass={wordClass} seekOnClick />
        </p>
      ))}
    </>
  )
}

function Run({
  words,
  offset,
  wordClass,
  seekOnClick,
}: {
  words: Word[]
  offset: number
  wordClass: string
  seekOnClick: boolean
}) {
  return (
    <>
      {words.map((w, i) => (
        <span key={offset + i}>
          <span
            // Index stays global within the Segment — the highlighter looks words
            // up by position, and paragraphs must not renumber them.
            data-w={offset + i}
            onClick={e => {
              if (!seekOnClick) return
              e.stopPropagation()
              transport.seek(w.s)
            }}
            className={`rounded-[3px] data-[playing]:bg-cyan-400/45 data-[playing]:font-medium data-[playing]:text-black ${
              seekOnClick ? 'cursor-text hover:bg-white/10' : ''
            } ${wordClass}`}>
            {w.w}
          </span>{' '}
        </span>
      ))}
    </>
  )
}

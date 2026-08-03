import raw from './data/transcript.json'
import type {Fixture, Segment} from './types'

export const base = raw as unknown as Fixture

/**
 * Q9 — "how does a VERY long transcript behave". The real spike recording is
 * 34.5 min / 97 segments. Stress mode repeats it 12× on the timeline: 6.9 hours,
 * ~1,164 segments, ~74k words, every one of them a live highlight target.
 */
export function stressify(fix: Fixture, times: number): Fixture {
  const span = fix.recording.durationSeconds + 1.5
  const segments: Segment[] = []
  for (let i = 0; i < times; i++) {
    const off = span * i
    for (const s of fix.segments) {
      segments.push({
        ...s,
        id: i === 0 ? s.id : `${s.id}-r${i}`,
        start: s.start + off,
        end: s.end + off,
        words: s.words.map(w => ({...w, s: w.s + off, e: w.e + off})),
        edit: i === 0 ? s.edit : undefined,
      })
    }
  }
  return {
    ...fix,
    recording: {
      ...fix.recording,
      title: `${fix.recording.title} (stress ×${times})`,
      durationSeconds: span * times,
    },
    segments,
  }
}

/** Overlap is derived, never stored (CONTEXT.md): two segments on different tracks in the same span. */
export function computeOverlaps(segments: Segment[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]
      const b = segments[j]
      if (b.start >= a.end) break
      if (a.trackId === b.trackId) continue
      out.set(a.id, [...(out.get(a.id) ?? []), b.id])
      out.set(b.id, [...(out.get(b.id) ?? []), a.id])
    }
  }
  return out
}

/**
 * Of an overlapping pair, which one is the interruption? The one that starts
 * later and is shorter — the back-channel dropped into someone else's turn.
 * Returns the segment being talked over, or null if `seg` is itself the host.
 */
export function hostFor(
  seg: Segment,
  overlaps: Map<string, string[]>,
  byId: Map<string, Segment>
): Segment | null {
  for (const id of overlaps.get(seg.id) ?? []) {
    const o = byId.get(id)
    if (o && o.start <= seg.start && o.end - o.start > seg.end - seg.start) return o
  }
  return null
}

/**
 * Break a long Segment into display paragraphs. Purely presentational — the
 * Segment is still one Segment, one Speaker, one coloured block.
 *
 * No guessing and no extra model: both signals already exist in the pipeline
 * output. Parakeet punctuates (9.5% of words end a sentence), and the word
 * timings give the gap between any two words. Measured on the real spike
 * transcript, `gap >= 0.6s` (with a sentence-end fallback so a 60-word run
 * without a breath still breaks) yields a median 25-word paragraph, and splits
 * the worst 187-word segment into 65/26/54/16/26.
 */
export function paragraphs(
  s: Segment,
  {gap = 0.6, minWords = 60, floor = 8}: {gap?: number; minWords?: number; floor?: number} = {}
): Array<{offset: number; words: Segment['words']}> {
  const out: Array<{offset: number; words: Segment['words']}> = []
  let cur: Segment['words'] = []
  let offset = 0
  for (let i = 0; i < s.words.length; i++) {
    cur.push(s.words[i])
    const next = s.words[i + 1]
    if (!next) break
    const isSentenceEnd = /[.?!]$/.test(s.words[i].w)
    const breakHere = next.s - s.words[i].e >= gap || (isSentenceEnd && cur.length >= minWords)
    if (breakHere && cur.length >= floor) {
      out.push({offset, words: cur})
      offset += cur.length
      cur = []
    }
  }
  if (cur.length) out.push({offset, words: cur})
  return out
}

export function segmentText(s: Segment): string {
  return s.edit ? s.edit.text : s.words.map(w => w.w).join(' ')
}

export function fmt(t: number): string {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = Math.floor(t % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** Stable per-speaker colour. Prototype-only: real app should put this on the Speaker. */
const PALETTE = [
  {name: 'cyan', dot: '#22d3ee', soft: 'rgba(34,211,238,0.14)', text: '#a5f3fc'},
  {name: 'amber', dot: '#fbbf24', soft: 'rgba(251,191,36,0.14)', text: '#fde68a'},
  {name: 'violet', dot: '#a78bfa', soft: 'rgba(167,139,250,0.16)', text: '#ddd6fe'},
  {name: 'emerald', dot: '#34d399', soft: 'rgba(52,211,153,0.14)', text: '#a7f3d0'},
  {name: 'rose', dot: '#fb7185', soft: 'rgba(251,113,133,0.14)', text: '#fecdd3'},
]
export function colorFor(speakerIds: string[], id: string) {
  const i = Math.max(0, speakerIds.indexOf(id))
  return PALETTE[i % PALETTE.length]
}

/**
 * Synthetic waveform peaks. The real app precomputes these with the FFmpeg
 * sidecar (#4/#5) and hands them to wavesurfer; here they are faked from
 * segment coverage so the shape of the UI can be judged without real audio.
 */
export function peaksFor(segments: Segment[], duration: number, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const per = duration / buckets
  for (const s of segments) {
    const from = Math.max(0, Math.floor(s.start / per))
    const to = Math.min(buckets - 1, Math.ceil(s.end / per))
    for (let i = from; i <= to; i++) {
      const t = i * per
      const jitter = 0.45 + 0.55 * Math.abs(Math.sin(t * 3.7) * Math.cos(t * 1.31) + Math.sin(t * 11.1) * 0.4)
      out[i] = Math.max(out[i], Math.min(1, jitter))
    }
  }
  return out
}

export type Word = {w: string; s: number; e: number}

export type Segment = {
  id: string
  trackId: string
  speakerId: string
  start: number
  end: number
  words: Word[]
  /** Present iff the user changed the text. Its presence IS the stale-words flag (#12). */
  edit?: {text: string; editedAt: string}
}

export type Track = {
  id: string
  source: 'mic' | 'system' | 'import'
  label: string
  state: string
  attributedSpeakerId: string | null
  startOffsetMs: number
}

export type Speaker = {
  id: string
  name: string
  provenance: {trackId: string; diarizationLabel: string | null; attributed: boolean}
  /** Provenances folded in by a speaker merge — merges stay reversible (CONTEXT.md). */
  mergedFrom?: Array<{id: string; name: string; diarizationLabel: string | null}>
}

export type Recording = {
  id: string
  title: string
  createdAt: string
  durationSeconds: number
  state: string
}

export type Fixture = {
  recording: Recording
  tracks: Track[]
  speakers: Speaker[]
  segments: Segment[]
}

export type VariantProps = {
  data: Fixture
  /** Segment ids that overlap a segment on another track. */
  overlaps: Map<string, string[]>
}

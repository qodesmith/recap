// THROWAWAY (#14) — builds the prototype fixture from the REAL #10 spike output.
//
// Source of truth: branch `spike/asr-diarization-pipeline`
//   spike/asr-diarization/samples/asr_v3.json   (Parakeet TDT v3 word timings)
//   spike/asr-diarization/samples/diar_slim.json (VBx diarization segments)
//
// The spike recorded ONE track (a 34.5 min 2-person call captured on one mic).
// The transcript UI has to cope with a multi-track Recording, so this script
// re-shapes that real data into the two-track case the app will actually see:
//
//   Track 1 "Mic"          — every S1 word. Attributed track (speaker asserted up front).
//   Track 2 "System audio" — every S2 word, diarized, and deliberately OVER-SPLIT
//                            into two speakers (short turns land on a bogus third
//                            speaker) so the speaker-merge + reassignment
//                            affordances have something real to fix.
//
// Overlap is injected by sliding a handful of short back-channel turns
// ("Yeah", "Right") on Track 2 into the middle of a long Track 1 turn — which is
// exactly what a real two-source capture produces and a one-mic capture cannot.
//
// Usage: bun scripts/build-fixture.ts > src/data/transcript.json
import {execSync} from 'node:child_process'

type RawWord = {word: string; startTime: number; endTime: number}
type DiarSeg = {speakerId: string; startTimeSeconds: number; endTimeSeconds: number}

const BRANCH = 'spike/asr-diarization-pipeline'
const read = (p: string) =>
  JSON.parse(execSync(`git show ${BRANCH}:${p}`, {maxBuffer: 1 << 28}).toString())

const asr = read('spike/asr-diarization/samples/asr_v3.json')
const diar = read('spike/asr-diarization/samples/diar_slim.json')

const words: RawWord[] = asr.wordTimings
const diarSegs: DiarSeg[] = [...diar.segments].sort(
  (a, b) => a.startTimeSeconds - b.startTimeSeconds
)

function labelAt(t: number): string {
  let best = '?'
  let bestDist = Infinity
  for (const s of diarSegs) {
    if (t >= s.startTimeSeconds && t <= s.endTimeSeconds) return s.speakerId
    const d = t < s.startTimeSeconds ? s.startTimeSeconds - t : t - s.endTimeSeconds
    if (d < bestDist) {
      bestDist = d
      best = s.speakerId
    }
  }
  return best
}

// 1. Attribute every word, then group runs of one label into turns.
type Turn = {label: string; words: RawWord[]}
const turns: Turn[] = []
for (const w of words) {
  const label = labelAt((w.startTime + w.endTime) / 2)
  const last = turns[turns.length - 1]
  if (last && last.label === label) last.words.push(w)
  else turns.push({label, words: [w]})
}

// 2. Split onto two tracks. S1 -> mic, everything else -> system audio.
const MIC = 'track-mic'
const SYS = 'track-system'

type Seg = {
  id: string
  trackId: string
  speakerId: string
  start: number
  end: number
  words: Array<{w: string; s: number; e: number}>
  edit?: {text: string; editedAt: string}
}

const round = (n: number) => Math.round(n * 100) / 100
let n = 0
const segments: Seg[] = turns.map(t => {
  const onMic = t.label === 'S1'
  // Over-split: short system-audio turns get flung onto a bogus third speaker.
  const speakerId = onMic
    ? 'spk-you'
    : t.words.length <= 12
      ? 'spk-3'
      : 'spk-2'
  return {
    id: `seg-${String(++n).padStart(4, '0')}`,
    trackId: onMic ? MIC : SYS,
    speakerId,
    start: round(t.words[0].startTime),
    end: round(t.words[t.words.length - 1].endTime),
    words: t.words.map(w => ({w: w.word.trim(), s: round(w.startTime), e: round(w.endTime)})),
  }
})

// 3. Inject real overlap. The spike's single mic could not record two people at
//    once, so back-channels ("Yeah", "Right, right") arrive as their own
//    sequential turn. Carve the leading words off such a turn into a separate
//    Track-2 segment sitting INSIDE the long Track-1 turn that precedes it —
//    the shape a genuine two-source capture produces.
const injected: string[] = []
const extra: Seg[] = []
for (let i = 1; i < segments.length && injected.length < 10; i++) {
  const seg = segments[i]
  const prev = segments[i - 1]
  if (seg.trackId !== SYS || seg.words.length < 8) continue
  if (prev.trackId !== MIC || prev.end - prev.start < 25) continue
  const take = 1 + (i % 3) // 1–3 words of back-channel
  const carved = seg.words.slice(0, take)
  const rest = seg.words.slice(take)
  if (rest.length < 5) continue
  const at = round(prev.start + (prev.end - prev.start) * (0.4 + 0.05 * (i % 6)))
  const shift = round(at - carved[0].s)
  const moved = carved.map(w => ({...w, s: round(w.s + shift), e: round(w.e + shift)}))
  extra.push({
    id: `${seg.id}-bc`,
    trackId: SYS,
    speakerId: seg.speakerId,
    start: moved[0].s,
    end: moved[moved.length - 1].e,
    words: moved,
  })
  seg.words = rest
  seg.start = rest[0].s
  injected.push(seg.id)
}
segments.push(...extra)
segments.sort((a, b) => a.start - b.start)

// 4. One segment arrives pre-edited, so the "differs from model output" marker
//    has something to render on load.
const preEdited = segments.find(s => s.words.length > 25 && s.trackId === MIC)!
preEdited.edit = {
  text: preEdited.words.map(w => w.w).join(' ').replace(/\bum\b ?/gi, ''),
  editedAt: '2026-07-29T14:02:11Z',
}

const duration = round(Math.max(...segments.map(s => s.end)))

const fixture = {
  _source: `REAL output from spike #10 (${asr.modelVersion}), re-shaped into two tracks. See scripts/build-fixture.ts.`,
  recording: {
    id: 'rec-20260729-1032',
    title: 'Procurement intro call',
    createdAt: '2026-07-29T10:32:00Z',
    durationSeconds: duration,
    state: 'transcribed',
  },
  tracks: [
    {
      id: MIC,
      source: 'mic',
      label: 'Mic',
      state: 'transcribed',
      attributedSpeakerId: 'spk-you',
      startOffsetMs: 0,
    },
    {
      id: SYS,
      source: 'system',
      label: 'System audio (Zoom)',
      state: 'transcribed',
      attributedSpeakerId: null,
      startOffsetMs: 132, // #9: 54–168 ms start skew, already applied to timings
    },
  ],
  speakers: [
    {
      id: 'spk-you',
      name: 'You',
      provenance: {trackId: MIC, diarizationLabel: null, attributed: true},
    },
    {
      id: 'spk-2',
      name: 'Speaker 2',
      provenance: {trackId: SYS, diarizationLabel: 'S2', attributed: false},
    },
    {
      id: 'spk-3',
      name: 'Speaker 3',
      provenance: {trackId: SYS, diarizationLabel: 'S2-b', attributed: false},
    },
  ],
  segments,
}

process.stderr.write(
  `segments: ${segments.length}  words: ${words.length}  duration: ${duration}s  overlaps injected: ${injected.length}\n`
)
process.stdout.write(JSON.stringify(fixture))

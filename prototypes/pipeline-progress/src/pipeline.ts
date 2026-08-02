/**
 * PROTOTYPE — throwaway. Simulated Recap processing pipeline for issue #13.
 *
 * Not production code. It exists so the progress UI can be judged against
 * realistic timings instead of a lorem-ipsum spinner.
 *
 * TIMING PROVENANCE
 * -----------------
 * MEASURED (#10, spike/asr-diarization-pipeline, real 34.5 min 2-person audio):
 *   - ~79x realtime end-to-end for ASR + diarization on one track.
 * SOURCED (#17, docs/research/long-form-audio.md):
 *   - diarization ~= 3.5x the wall clock of ASR (published RTFx 207x vs 60x).
 *   - ASR chunk stride ~12.96 s  -> ~4.63 chunks per audio-minute.
 *   - diarization segmentation step 2 s -> ~30 windows per audio-minute.
 *   - ASR seam-gap repair: <=32 extra window decodes, ~20% over baseline.
 *   - clustering (embeddings -> AHC -> VBx -> reconstruction) emits NO progress.
 *
 * GUESSED — flagged because #13 should not pretend these are known:
 *   - the segmentation/clustering split inside diarization. #17 asked #10 to
 *     measure it; #10 did not. Assumed 50/50 here. If clustering is really 80%
 *     of diarization, the spinner phases dominate and the UI must survive that:
 *     use the CLUSTER_SHARE control to find out.
 *   - decode, mixdown and peaks throughput (FFmpeg, #4/#5). Nobody has timed
 *     these; they are the stages #13 forgot and they run either side of the
 *     fast part.
 */

export type PhaseId =
  | 'decode'
  | 'asr_chunks'
  | 'asr_seam'
  | 'diar_seg'
  | 'diar_embed'
  | 'diar_ahc'
  | 'diar_vbx'
  | 'diar_recon'
  | 'mixdown'
  | 'peaks'

export type PhaseKind = 'bar' | 'spinner'

/** Track state from CONTEXT.md. Segmentation has no state of its own. */
export type TrackState =
  | 'pending'
  | 'transcribing'
  | 'diarizing'
  | 'transcribed'
  | 'failed'

export type RecordingState =
  | 'capturing'
  | 'unprocessed'
  | 'queued'
  | 'processing'
  | 'transcribed'
  | 'partial'
  | 'needs-attention'

export type PhaseRun = {
  id: PhaseId
  label: string
  kind: PhaseKind
  /** n/N for countable bars; null for percentage bars and for spinners. */
  total: number | null
  durationSec: number
  elapsed: number
  status: 'pending' | 'active' | 'done'
}

export type Track = {
  id: string
  label: string
  source: 'mic' | 'system' | 'app' | 'file'
  state: TrackState
  phases: PhaseRun[]
  failed?: boolean
}

export type Recording = {
  id: string
  title: string
  when: string
  durationMin: number
  kind: 'capture' | 'import'
  state: RecordingState
  tracks: Track[]
  /** mixdown + peaks — recording level, after every track. */
  recPhases: PhaseRun[]
  captureElapsedSec?: number
  enqueuedAt?: number
  startedAt?: number
}

export type World = {
  recordings: Recording[]
  queue: string[]
  activeId: string | null
  /** 1 = the Mac #10 was measured on. 3 = slowest supported Mac. */
  machine: number
  /** wall-clock multiplier for the simulation. 1 = real time. */
  speed: number
  /** share of diarization spent in the unreportable clustering tail. GUESSED. */
  clusterShare: number
  /** set to a track id to make it emit track_failed (#11). */
  failTrackId: string | null
  clock: number
}

// ---------------------------------------------------------------------------
// Per-audio-minute cost model, in wall-clock seconds at machine = 1.
// Derived above; see TIMING PROVENANCE.
// ---------------------------------------------------------------------------

const TOTAL_INFERENCE_PER_MIN = 60 / 79 // ~0.759 s of compute per audio-minute
const ASR_SHARE = 1 / 4.5 // diarization is ~3.5x ASR
const SEAM_SHARE = 0.17 // of ASR, the silent seam-repair tail

const DECODE_PER_MIN = 0.3 // GUESSED (FFmpeg, import only)
const MIXDOWN_PER_MIN = 0.25 // GUESSED (FFmpeg)
const PEAKS_PER_MIN = 0.15 // GUESSED (FFmpeg)

const CHUNKS_PER_MIN = 4.63
const DIAR_WINDOWS_PER_MIN = 30

/** relative weights inside the clustering tail — all spinners, all unmeasured */
const CLUSTER_SPLIT = {embed: 0.45, ahc: 0.25, vbx: 0.2, recon: 0.1}

const LABELS: Record<PhaseId, string> = {
  decode: 'Decoding source file',
  asr_chunks: 'Transcribing audio',
  asr_seam: 'Repairing chunk seams',
  diar_seg: 'Scanning for speech',
  diar_embed: 'Extracting voice embeddings',
  diar_ahc: 'Grouping voices into speakers',
  diar_vbx: 'Refining speaker boundaries',
  diar_recon: 'Building speaker turns',
  mixdown: 'Mixing playback audio',
  peaks: 'Generating waveform',
}

/** Which Track state a phase belongs to — the caption above the bar. */
export const PHASE_STAGE: Partial<Record<PhaseId, TrackState>> = {
  decode: 'transcribing',
  asr_chunks: 'transcribing',
  asr_seam: 'transcribing',
  diar_seg: 'diarizing',
  diar_embed: 'diarizing',
  diar_ahc: 'diarizing',
  diar_vbx: 'diarizing',
  diar_recon: 'diarizing',
}

function phase(
  id: PhaseId,
  kind: PhaseKind,
  durationSec: number,
  total: number | null
): PhaseRun {
  return {
    id,
    label: LABELS[id],
    kind,
    total,
    durationSec,
    elapsed: 0,
    status: 'pending',
  }
}

function trackPhases(durationMin: number, isImport: boolean, clusterShare: number): PhaseRun[] {
  const inference = TOTAL_INFERENCE_PER_MIN * durationMin
  const asr = inference * ASR_SHARE
  const diar = inference * (1 - ASR_SHARE)
  const cluster = diar * clusterShare
  const seg = diar - cluster

  const out: PhaseRun[] = []
  if (isImport) {
    out.push(phase('decode', 'bar', DECODE_PER_MIN * durationMin, null))
  }
  out.push(
    phase('asr_chunks', 'bar', asr * (1 - SEAM_SHARE), Math.max(1, Math.round(CHUNKS_PER_MIN * durationMin))),
    // The sidecar is ours (#7), so the bounded seam-repair pass CAN be counted.
    phase('asr_seam', 'bar', asr * SEAM_SHARE, Math.min(32, Math.max(1, Math.round(durationMin * 0.4)))),
    phase('diar_seg', 'bar', seg, Math.max(1, Math.round(DIAR_WINDOWS_PER_MIN * durationMin))),
    // Everything below is a spinner: upstream emits nothing. We only know which
    // call we are inside because we own the call site.
    phase('diar_embed', 'spinner', cluster * CLUSTER_SPLIT.embed, null),
    phase('diar_ahc', 'spinner', cluster * CLUSTER_SPLIT.ahc, null),
    phase('diar_vbx', 'spinner', cluster * CLUSTER_SPLIT.vbx, null),
    phase('diar_recon', 'spinner', cluster * CLUSTER_SPLIT.recon, null)
  )
  return out
}

function recPhases(durationMin: number): PhaseRun[] {
  return [
    phase('mixdown', 'bar', MIXDOWN_PER_MIN * durationMin, null),
    phase('peaks', 'bar', PEAKS_PER_MIN * durationMin, null),
  ]
}

// ---------------------------------------------------------------------------
// Derived read helpers — the UI never recomputes these itself.
// ---------------------------------------------------------------------------

export function phaseProgress(p: PhaseRun): number {
  if (p.status === 'done') return 1
  if (p.durationSec <= 0) return 0
  return Math.min(1, p.elapsed / p.durationSec)
}

/** "142 / 556 chunks" style detail, or null when there is nothing honest to say. */
export function phaseDetail(p: PhaseRun): string | null {
  if (p.kind === 'spinner') return null
  if (p.total == null) return `${Math.round(phaseProgress(p) * 100)}%`
  const n = Math.min(p.total, Math.floor(phaseProgress(p) * p.total))
  return `${n} / ${p.total}`
}

export function activePhase(t: Track): PhaseRun | null {
  return t.phases.find(p => p.status === 'active') ?? null
}

/**
 * Fraction of a track's total compute that is done. Used only where a variant
 * wants a roll-up number; the phases themselves remain the source of truth.
 */
export function trackProgress(t: Track): number {
  const total = t.phases.reduce((a, p) => a + p.durationSec, 0)
  if (total <= 0) return t.state === 'transcribed' ? 1 : 0
  const done = t.phases.reduce(
    (a, p) => a + (p.status === 'done' ? p.durationSec : p.elapsed),
    0
  )
  return Math.min(1, done / total)
}

export function recordingProgress(r: Recording): number {
  const all = [...r.tracks.flatMap(t => t.phases), ...r.recPhases]
  const total = all.reduce((a, p) => a + p.durationSec, 0)
  if (total <= 0) return 0
  const done = all.reduce((a, p) => a + (p.status === 'done' ? p.durationSec : p.elapsed), 0)
  return Math.min(1, done / total)
}

/**
 * Seconds remaining, or null when we refuse to guess. We only project across
 * phases we can measure; if the remaining work is mostly spinner, an ETA would
 * be fabricated and we say so by returning null.
 */
export function etaSeconds(r: Recording, machine: number): number | null {
  const all = [...r.tracks.flatMap(t => t.phases), ...r.recPhases]
  const pending = all.filter(p => p.status !== 'done')
  if (!pending.length) return null
  const remaining = pending.reduce((a, p) => a + (p.durationSec - p.elapsed), 0)
  const spinnerRemaining = pending
    .filter(p => p.kind === 'spinner')
    .reduce((a, p) => a + (p.durationSec - p.elapsed), 0)
  if (remaining <= 0) return null
  // More than half the remaining work is unreportable -> no honest estimate.
  if (spinnerRemaining / remaining > 0.5) return null
  return remaining * machine
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------

let idc = 0
const nextId = (p: string) => `${p}-${++idc}`

export function makeRecording(opts: {
  title: string
  when: string
  durationMin: number
  kind: 'capture' | 'import'
  sources: Array<{label: string; source: Track['source']}>
  clusterShare: number
  state?: RecordingState
}): Recording {
  return {
    id: nextId('rec'),
    title: opts.title,
    when: opts.when,
    durationMin: opts.durationMin,
    kind: opts.kind,
    state: opts.state ?? 'unprocessed',
    tracks: opts.sources.map(s => ({
      id: nextId('trk'),
      label: s.label,
      source: s.source,
      state: 'pending' as TrackState,
      phases: trackPhases(opts.durationMin, opts.kind === 'import', opts.clusterShare),
    })),
    recPhases: recPhases(opts.durationMin),
  }
}

export function createWorld(): World {
  const clusterShare = 0.5
  const recordings = [
    makeRecording({
      title: 'Standup — engineering',
      when: 'Today, 9:02 AM',
      durationMin: 32,
      kind: 'capture',
      clusterShare,
      sources: [
        {label: 'Mic (MacBook Pro)', source: 'mic'},
        {label: 'System audio', source: 'system'},
        {label: 'Google Chrome', source: 'app'},
      ],
    }),
    makeRecording({
      title: 'Client call — Northwind',
      when: 'Yesterday, 2:15 PM',
      durationMin: 68,
      kind: 'capture',
      clusterShare,
      sources: [
        {label: 'Mic (MacBook Pro)', source: 'mic'},
        {label: 'System audio', source: 'system'},
      ],
    }),
    makeRecording({
      title: 'interview-raw.mkv',
      when: 'Imported Tuesday',
      durationMin: 121,
      kind: 'import',
      clusterShare,
      sources: [{label: 'interview-raw.mkv', source: 'file'}],
    }),
    makeRecording({
      title: 'Design review',
      when: 'Monday, 11:00 AM',
      durationMin: 47,
      kind: 'capture',
      clusterShare,
      state: 'transcribed',
      sources: [
        {label: 'Mic (MacBook Pro)', source: 'mic'},
        {label: 'System audio', source: 'system'},
      ],
    }),
  ]
  // The already-done one should look done.
  const done = recordings[3]
  done.tracks.forEach(t => {
    t.state = 'transcribed'
    t.phases.forEach(p => {
      p.status = 'done'
      p.elapsed = p.durationSec
    })
  })
  done.recPhases.forEach(p => {
    p.status = 'done'
    p.elapsed = p.durationSec
  })

  return {
    recordings,
    queue: [],
    activeId: null,
    machine: 1,
    speed: 1,
    clusterShare,
    failTrackId: null,
    clock: 0,
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Transcribe. On a partially-transcribed recording this means "do the rest" —
 * the shape forced by the cancel-keeps-what-finished decision.
 */
export function startTranscribe(w: World, recId: string): void {
  const r = w.recordings.find(x => x.id === recId)
  if (!r || w.queue.includes(recId) || w.activeId === recId) return
  r.tracks.forEach(t => {
    if (t.state === 'transcribed') return
    t.state = 'pending'
    t.failed = false
    // Rebuilt so the clustering-share control applies to the next run.
    t.phases = trackPhases(r.durationMin, r.kind === 'import', w.clusterShare)
  })
  r.recPhases = recPhases(r.durationMin)
  r.enqueuedAt = w.clock
  r.state = 'queued'
  w.queue.push(recId)
}

/** Cancel keeps every track that already emitted track_done. */
export function cancel(w: World, recId: string): void {
  const r = w.recordings.find(x => x.id === recId)
  if (!r) return
  w.queue = w.queue.filter(id => id !== recId)
  if (w.activeId === recId) w.activeId = null
  r.tracks.forEach(t => {
    if (t.state === 'transcribed' || t.state === 'failed') return
    t.state = 'pending'
    t.phases.forEach(p => {
      p.status = 'pending'
      p.elapsed = 0
    })
  })
  r.state = deriveState(r)
}

export function startCapture(w: World): string {
  const r = makeRecording({
    title: 'New recording',
    when: 'Now',
    durationMin: 0,
    kind: 'capture',
    clusterShare: w.clusterShare,
    state: 'capturing',
    sources: [
      {label: 'Mic (MacBook Pro)', source: 'mic'},
      {label: 'System audio', source: 'system'},
    ],
  })
  r.captureElapsedSec = 0
  w.recordings.unshift(r)
  return r.id
}

export function stopCapture(w: World, recId: string): void {
  const r = w.recordings.find(x => x.id === recId)
  if (!r || r.state !== 'capturing') return
  const mins = Math.max(0.5, (r.captureElapsedSec ?? 0) / 60)
  r.durationMin = mins
  r.title = 'Untitled recording'
  r.tracks.forEach(t => {
    t.phases = trackPhases(mins, false, w.clusterShare)
  })
  r.recPhases = recPhases(mins)
  r.state = 'unprocessed'
}

function deriveState(r: Recording): RecordingState {
  if (r.state === 'capturing') return 'capturing'
  const done = r.tracks.filter(t => t.state === 'transcribed').length
  const failed = r.tracks.filter(t => t.state === 'failed').length
  if (failed > 0) return 'needs-attention'
  if (done === r.tracks.length) return 'transcribed'
  if (done > 0) return 'partial'
  return 'unprocessed'
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export function tick(w: World, dtRealSec: number): void {
  const dt = dtRealSec * w.speed
  w.clock += dt

  // Captures advance regardless of inference — recording while transcribing.
  w.recordings.forEach(r => {
    if (r.state === 'capturing') r.captureElapsedSec = (r.captureElapsedSec ?? 0) + dt
  })

  if (!w.activeId) {
    const next = w.queue.shift()
    if (!next) return
    w.activeId = next
    const r = w.recordings.find(x => x.id === next)
    if (r) {
      r.state = 'processing'
      r.startedAt = w.clock
    }
  }

  const r = w.recordings.find(x => x.id === w.activeId)
  if (!r) {
    w.activeId = null
    return
  }

  // Machine speed stretches phase durations, so budget is dt / machine.
  let budget = dt / w.machine
  let guard = 0
  while (budget > 0 && guard++ < 200) {
    const track = r.tracks.find(t => t.state !== 'transcribed' && t.state !== 'failed')
    if (track) {
      const p = track.phases.find(x => x.status !== 'done')
      if (!p) {
        track.state = 'transcribed'
        continue
      }
      if (p.status === 'pending') p.status = 'active'
      track.state = PHASE_STAGE[p.id] ?? 'transcribing'

      const need = p.durationSec - p.elapsed
      if (budget >= need) {
        budget -= need
        p.elapsed = p.durationSec
        p.status = 'done'
        // Injected failure lands at the end of diarization — the sidecar emits
        // track_failed for a whole track (#11), never a partial track.
        if (w.failTrackId === track.id && p.id === 'diar_recon') {
          track.state = 'failed'
          track.failed = true
        }
      } else {
        p.elapsed += budget
        budget = 0
      }
      continue
    }

    // All tracks resolved -> recording-level mixdown + peaks.
    const p = r.recPhases.find(x => x.status !== 'done')
    if (!p) {
      r.state = deriveState(r)
      w.activeId = null
      break
    }
    if (p.status === 'pending') p.status = 'active'
    const need = p.durationSec - p.elapsed
    if (budget >= need) {
      budget -= need
      p.elapsed = p.durationSec
      p.status = 'done'
    } else {
      p.elapsed += budget
      budget = 0
    }
  }
}

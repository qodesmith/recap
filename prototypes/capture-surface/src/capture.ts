/**
 * PROTOTYPE — the simulated world behind Recap's capture surface (issue #24).
 *
 * Nothing here touches real hardware. It exists so the four variants can be
 * judged against the situations that actually decide the design:
 *
 *   - a source that is GRANTED BUT QUIET  (quiet room: a real noise floor)
 *   - a source that is DEAD               (denied tap or dead mic: digital zero)
 *   - a source that is TALKING            (with genuine multi-second pauses)
 *
 * #9 measured the thing that makes this the whole question: a denied audio tap
 * returns *pure silence, not an error*, and there is no preflight permission
 * API. So the only difference between "granted, nobody is talking" and
 * "silently denied" is the noise floor — which means the meter has to have
 * resolution down there, or it is decorative.
 *
 * Level provenance:
 *   MEASURED (#9)  — both sources arrive 48 kHz Float32; a denied tap is zeroes.
 *   GUESSED        — every dB figure below. Room floor ~-50 dBFS and speech
 *                    peaks ~-12 dBFS are textbook numbers, not Recap's.
 */

export type SourceId = 'mic' | 'system'
export type SignalMode = 'talking' | 'quiet' | 'dead'
export type Phase = 'setup' | 'capturing' | 'preparing'

export type Device = {id: string; name: string; available: boolean}

export type Notice = {
  id: string
  source: SourceId
  title: string
  detail: string
  at: number
}

export type Recording = {
  id: string
  title: string
  when: string
  tracks: string[]
  state: 'capturing' | 'preparing' | 'unprocessed' | 'processing' | 'transcribed'
}

/** Per-source signal simulation state — not part of the design, just the fake. */
type Sim = {
  value: number
  target: number
  speaking: boolean
  until: number
}

export type World = {
  /* ---- setup, per #23 (both on by default, remembered) ---- */
  enabled: Record<SourceId, boolean>
  micDeviceId: string
  devices: Device[]
  systemDefaultId: string

  /* ---- capture ---- */
  phase: Phase
  elapsed: number
  notices: Notice[]
  capturingId: string | null

  /* ---- live signal, written every frame ---- */
  level: Record<SourceId, number> // linear amplitude 0..1
  peak: Record<SourceId, number> // decaying peak hold, linear
  silentFor: Record<SourceId, number> // seconds since anything crossed the gate
  history: Record<SourceId, number[]> // ~12 s of meter fractions, newest last

  /* ---- prototype knobs ---- */
  speed: number
  signal: Record<SourceId, SignalMode>

  /* ---- backdrop so the surface butts against a populated app ---- */
  recordings: Recording[]
  transcribing: boolean
  transcribeProgress: number

  /* internal */
  t: number
  sim: Record<SourceId, Sim>
  rev: number
}

export const SOURCES: SourceId[] = ['mic', 'system']

export const SOURCE_LABEL: Record<SourceId, string> = {
  mic: 'Microphone',
  system: 'System audio',
}

/** dBFS floor the meters are drawn against. */
export const METER_FLOOR_DB = -60

/**
 * Above this, something is arriving. A quiet room sits ~10 dB above it; a
 * denied tap sits infinitely below it. This constant IS the design decision.
 */
export const SIGNAL_GATE_DB = -54

const ROOM_FLOOR = db2lin(-50)
/** ~12 s of frames — the window variant B draws its history against. */
const HISTORY_LEN = 12 * 60

export function db2lin(db: number) {
  return Math.pow(10, db / 20)
}

export function lin2db(v: number) {
  return 20 * Math.log10(Math.max(v, 1e-7))
}

/** 0..1 position on the meter for a linear amplitude. */
export function meterFraction(v: number) {
  const db = lin2db(v)
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

export function formatDuration(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return h
    ? `${h}:${mm}:${String(r).padStart(2, '0')}`
    : `${mm}:${String(r).padStart(2, '0')}`
}

export function createWorld(): World {
  const devices: Device[] = [
    {id: 'builtin', name: 'MacBook Pro Microphone', available: true},
    {id: 'airpods', name: 'AirPods Pro', available: true},
    {id: 'rode', name: 'RØDE NT-USB', available: true},
  ]

  return {
    enabled: {mic: true, system: true},
    micDeviceId: 'default',
    devices,
    systemDefaultId: 'builtin',

    phase: 'setup',
    elapsed: 0,
    notices: [],
    capturingId: null,

    level: {mic: 0, system: 0},
    peak: {mic: 0, system: 0},
    silentFor: {mic: 0, system: 0},
    history: {mic: [], system: []},

    speed: 1,
    signal: {mic: 'talking', system: 'talking'},

    recordings: [
      {
        id: 'r1',
        title: 'Standup — engineering',
        when: 'Yesterday, 9:32 AM',
        tracks: ['Microphone', 'System audio'],
        state: 'transcribed',
      },
      {
        id: 'r2',
        title: 'Call with Dana',
        when: 'Monday, 2:05 PM',
        tracks: ['Microphone', 'System audio'],
        state: 'processing',
      },
      {
        id: 'r3',
        title: 'interview-raw.m4a',
        when: 'Last week',
        tracks: ['Imported file'],
        state: 'unprocessed',
      },
    ],
    transcribing: true,
    transcribeProgress: 0.34,

    t: 0,
    sim: {
      mic: {value: 0, target: 0, speaking: false, until: 0},
      system: {value: 0, target: 0, speaking: false, until: 0},
    },
    rev: 0,
  }
}

/* ------------------------------------------------------------------ */
/* derived reads                                                       */
/* ------------------------------------------------------------------ */

export function deviceName(w: World, id: string) {
  return w.devices.find(d => d.id === id)?.name ?? 'Unknown device'
}

/** The device the mic Track would actually open right now. */
export function effectiveMicDevice(w: World): Device {
  if (w.micDeviceId === 'default') {
    return (
      w.devices.find(d => d.id === w.systemDefaultId) ??
      w.devices.find(d => d.available)!
    )
  }
  const pinned = w.devices.find(d => d.id === w.micDeviceId)
  if (pinned?.available) return pinned
  return (
    w.devices.find(d => d.id === w.systemDefaultId) ??
    w.devices.find(d => d.available)!
  )
}

/** A pinned-but-missing device — #23 says this is shown at setup and nowhere else. */
export function pinnedButMissing(w: World) {
  if (w.micDeviceId === 'default') return null
  const d = w.devices.find(x => x.id === w.micDeviceId)
  return d && !d.available ? d : null
}

export function selectedSources(w: World): SourceId[] {
  return SOURCES.filter(s => w.enabled[s])
}

export function canStart(w: World) {
  return selectedSources(w).length > 0
}

/** #23: a mic-only capture needs no tap at all, so it dodges #9's minefield. */
export function needsSystemTap(w: World) {
  return w.enabled.system
}

export function sourceSublabel(w: World, s: SourceId) {
  if (s === 'mic') return effectiveMicDevice(w).name
  return 'Everything your Mac is playing'
}

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

export function toggleSource(w: World, s: SourceId) {
  if (w.phase === 'capturing') return // #23: sources are fixed once running
  w.enabled[s] = !w.enabled[s]
  w.rev++
}

export function setMicDevice(w: World, id: string) {
  w.micDeviceId = id
  w.rev++
}

export function start(w: World) {
  if (!canStart(w) || w.phase !== 'setup') return
  w.phase = 'capturing'
  w.elapsed = 0
  w.capturingId = `cap-${Date.now()}`
  // #23: the bundle exists from Start, so the Recording exists from Start.
  w.recordings.unshift({
    id: w.capturingId,
    title: 'Aug 10, 2026 at 4:12 PM',
    when: 'Now',
    tracks: selectedSources(w).map(s => SOURCE_LABEL[s]),
    state: 'capturing',
  })
  w.rev++
}

export function stop(w: World) {
  if (w.phase !== 'capturing') return
  w.phase = 'preparing'
  const r = w.recordings.find(x => x.id === w.capturingId)
  if (r) {
    r.state = 'preparing'
    r.when = 'Just now'
  }
  w.rev++
}

/** Back to the top, as if you had navigated away from #22's recording page. */
export function reset(w: World) {
  w.phase = 'setup'
  w.elapsed = 0
  w.capturingId = null
  w.notices = []
  w.rev++
}

export function dismissNotice(w: World, id: string) {
  w.notices = w.notices.filter(n => n.id !== id)
  w.rev++
}

/**
 * The device the mic is on vanishes. #23: a capture NEVER stops on its own —
 * it falls back to the current system default and keeps going, even for a
 * deliberately pinned device. The surface must name the source and say what
 * happened, without a modal.
 */
export function yankMicDevice(w: World) {
  const gone = effectiveMicDevice(w)
  const dev = w.devices.find(d => d.id === gone.id)
  if (!dev || !dev.available) return
  dev.available = false

  const fallback = w.devices.find(d => d.available)
  if (fallback) w.systemDefaultId = fallback.id

  if (w.phase === 'capturing') {
    w.notices.unshift({
      id: `n-${Date.now()}`,
      source: 'mic',
      title: `${gone.name} disconnected`,
      detail: fallback
        ? `Still recording — the Microphone track switched to ${fallback.name} at ${formatDuration(w.elapsed)}.`
        : 'Still recording, but no input device is available.',
      at: w.elapsed,
    })
  }
  w.rev++
}

export function restoreDevices(w: World) {
  w.devices.forEach(d => (d.available = true))
  w.rev++
}

/* ------------------------------------------------------------------ */
/* the fake signal                                                     */
/* ------------------------------------------------------------------ */

function stepSim(w: World, s: SourceId, dt: number) {
  const sim = w.sim[s]
  const mode = w.signal[s]

  if (mode === 'dead') {
    // #9: a denied tap returns pure silence — digital zero, not an error.
    sim.target = 0
    sim.speaking = false
  } else if (mode === 'quiet') {
    sim.target = ROOM_FLOOR * (0.6 + Math.random() * 0.9)
    sim.speaking = false
  } else {
    if (w.t >= sim.until) {
      sim.speaking = !sim.speaking
      if (sim.speaking) {
        sim.until = w.t + 1.2 + Math.random() * 2.8
      } else {
        // One pause in five is a GENUINE long pause in the conversation —
        // the case a "no signal" warning must not cry wolf over.
        sim.until =
          w.t + (Math.random() < 0.2 ? 5 + Math.random() * 4 : 0.3 + Math.random() * 1.6)
      }
    }
    sim.target = sim.speaking
      ? db2lin(-26 + Math.random() * 16) * (0.7 + Math.random() * 0.6)
      : ROOM_FLOOR * (0.6 + Math.random() * 0.9)
  }

  // fast attack, slow release — how a real meter behaves
  const k = sim.target > sim.value ? 1 - Math.exp(-dt / 0.02) : 1 - Math.exp(-dt / 0.18)
  sim.value += (sim.target - sim.value) * k

  const live = w.phase === 'capturing' || w.phase === 'setup'
  const v = w.enabled[s] && live ? sim.value : 0
  w.level[s] = v

  w.peak[s] = Math.max(v, w.peak[s] - dt * 0.35)

  if (lin2db(v) > SIGNAL_GATE_DB) w.silentFor[s] = 0
  else w.silentFor[s] += dt

  const h = w.history[s]
  h.push(meterFraction(v))
  if (h.length > HISTORY_LEN) h.splice(0, h.length - HISTORY_LEN)
}

export function tick(w: World, dtReal: number) {
  const dt = dtReal * w.speed
  w.t += dt

  for (const s of SOURCES) stepSim(w, s, dt)

  if (w.phase === 'capturing') w.elapsed += dt
  if (w.transcribing) {
    w.transcribeProgress = Math.min(1, w.transcribeProgress + dt * 0.004)
  }
}

/* ------------------------------------------------------------------ */
/* frame subscription — meters are DOM-written, never React state (#5)  */
/* ------------------------------------------------------------------ */

const frameSubs = new Set<(w: World) => void>()

export function publishFrame(w: World) {
  frameSubs.forEach(cb => cb(w))
}

export function subscribeFrame(cb: (w: World) => void) {
  frameSubs.add(cb)
  return () => {
    frameSubs.delete(cb)
  }
}

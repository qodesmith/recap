/**
 * THE METER — #25's one genuine piece of invention.
 *
 * #24 ordered "both meters, they answer different questions": A's instantaneous
 * dBFS bar (room-tone band drawn in) AND B's rolling ~12 s history. Taken
 * literally that is four moving things on screen for two sources, plus a clock
 * — which is exactly the sub-question this ticket raises.
 *
 * UNIFIED (the proposal): they share one vertical dB axis. The history is the
 * left ~80 %, time running left→right, and the instantaneous bar is a column at
 * the right-hand end of the *same* axis — "now", continuing the line. The
 * room-tone band is a horizontal band across both, so it is marked once and
 * means the same thing in both readings. Two widgets, not four; one scale, not
 * two; and #24's "must be drawn on a dB scale with the room-tone band marked"
 * is satisfied by construction.
 *
 * SPLIT (the control): #24's two meters as literally described — a separate
 * horizontal bar above a separate history canvas. Flip between them with the
 * prototype knob; if unified isn't better, it should lose here.
 */
import {
  METER_FLOOR_DB,
  SIGNAL_GATE_DB,
  lin2db,
  meterFraction,
  subscribeFrame,
  type SourceId,
  type World,
} from './capture'
import {useEffect, useRef} from 'react'

/** Room tone lives in a band, not at a point — this is its top edge. */
const ROOM_TOP_DB = -42

const GREEN = '52,211,153'
const ORANGE = '251,146,60'

/** Seconds of flatline before the meter stops being green. #24: dead ≠ pause. */
const DEAD_AFTER = 8

function dbY(db: number, h: number) {
  const f = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB))
  return h - f * h
}

function paint(
  c: HTMLCanvasElement,
  w: World,
  source: SourceId,
  style: 'unified' | 'split'
) {
  const dpr = devicePixelRatio || 1
  const cw = Math.round(c.clientWidth * dpr)
  const ch = Math.round(c.clientHeight * dpr)
  if (!cw || !ch) return
  if (c.width !== cw || c.height !== ch) {
    c.width = cw
    c.height = ch
  }
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, cw, ch)

  const dead = w.silentFor[source] > DEAD_AFTER
  const rgb = dead ? ORANGE : GREEN

  /* --------- geometry: where history ends and "now" begins --------- */
  const gap = 6 * dpr
  const nowW = style === 'unified' ? Math.max(10 * dpr, cw * 0.06) : 0
  const barH = style === 'split' ? Math.max(8 * dpr, ch * 0.24) : 0
  const histX = 0
  const histY = 0
  const histH = style === 'split' ? ch - barH - gap : ch
  const histW = style === 'unified' ? cw - nowW - gap : cw

  /* --------- the room-tone band, drawn across everything ---------- */
  const bandTop = dbY(ROOM_TOP_DB, histH) + histY
  const bandBot = dbY(SIGNAL_GATE_DB, histH) + histY
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, bandTop, cw, bandBot - bandTop)

  // Below the gate is not quiet, it is *nothing* — #9's silently-denied tap.
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(0, bandBot, cw, ch - bandBot)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = dpr
  ctx.setLineDash([3 * dpr, 3 * dpr])
  ctx.beginPath()
  ctx.moveTo(0, bandBot + 0.5)
  ctx.lineTo(cw, bandBot + 0.5)
  ctx.stroke()
  ctx.setLineDash([])

  /* ------------------------- the history ------------------------- */
  const h = w.history[source]
  const slots = 12 * 60
  const step = histW / slots
  ctx.fillStyle = `rgba(${rgb},0.8)`
  for (let i = 0; i < h.length; i++) {
    const x = histX + histW - (h.length - i) * step
    if (x < histX - step) continue
    const bh = Math.max(dpr, h[i] * histH)
    ctx.fillRect(x, histY + histH - bh, Math.max(dpr, step * 0.9), bh)
  }

  /* --------------------------- "now" ----------------------------- */
  const level = meterFraction(w.level[source])
  const peak = meterFraction(w.peak[source])

  if (style === 'unified') {
    const x = cw - nowW
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(x, histY, nowW, histH)
    // the band continues through the now-column so the eye reads one axis
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(x, bandTop, nowW, bandBot - bandTop)
    ctx.fillStyle = `rgba(${rgb},1)`
    ctx.fillRect(x, histY + histH - level * histH, nowW, level * histH)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillRect(x, histY + histH - peak * histH - dpr, nowW, 1.5 * dpr)
  } else {
    // A separate HORIZONTAL bar, sitting UNDER its own history. Two readings,
    // two axes, stacked — the history answers "what has been arriving", the bar
    // answers "what is arriving now".
    const y = ch - barH
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, y, cw, barH)

    // the room-tone band, on the bar's own left-to-right scale
    const roomX = ((ROOM_TOP_DB - METER_FLOOR_DB) / -METER_FLOOR_DB) * cw
    const gateX = ((SIGNAL_GATE_DB - METER_FLOOR_DB) / -METER_FLOOR_DB) * cw
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.fillRect(gateX, y, roomX - gateX, barH)
    // below the gate is not quiet, it is nothing (#9's silently-denied tap)
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(0, y, gateX, barH)

    ctx.fillStyle = `rgba(${rgb},1)`
    ctx.fillRect(0, y, level * cw, barH)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillRect(peak * cw, y, 1.5 * dpr, barH)
    // the gate tick, so "nothing" has a visible edge on the bar too
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillRect(gateX, y, dpr, barH)
  }
}

export function Meter({
  source,
  height,
  style,
}: {
  source: SourceId
  height: number
  style: 'unified' | 'split'
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(
    () => subscribeFrame(w => ref.current && paint(ref.current, w, source, style)),
    [source, style]
  )

  // The axis has to line up with the pixels the canvas actually draws, or the
  // "room tone" label is decoration. Same geometry as paint(), in CSS px.
  // It labels the HISTORY only — in split mode the bar below has its own
  // left-to-right scale and shares no axis with it.
  const barH = style === 'split' ? Math.max(8, height * 0.24) : 0
  const histH = style === 'split' ? height - barH - 6 : height
  const at = (db: number) => (1 - (db + 60) / 60) * histH

  return (
    <div className="flex gap-1.5">
      {/* the axis, in DOM — a dB meter with no numbers is a light show */}
      <div className="relative w-8 shrink-0 text-right text-[9px] leading-none text-white/25 tabular-nums" style={{height}}>
        {[
          {db: 0, label: '0'},
          {db: -24, label: '-24'},
          {db: -48, label: 'room', tone: 'text-white/40'},
          {db: -60, label: '-60'},
        ].map(t => (
          <span
            key={t.label}
            className={`absolute right-0 ${t.tone ?? ''}`}
            style={{top: at(t.db), transform: 'translateY(-50%)'}}>
            {t.label}
          </span>
        ))}
      </div>
      <canvas ref={ref} className="min-w-0 flex-1 rounded" style={{height}} />
    </div>
  )
}

/**
 * The words under the meter. The meter shows the level; this says what the
 * level MEANS, which is the only thing that separates #9's denied tap from a
 * quiet room. Deliberately not React state at 60 Hz — it only sets state when
 * the sentence actually changes.
 */
export function SignalWord({source}: {source: SourceId}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      subscribeFrame(w => {
        const el = ref.current
        if (!el) return
        const s = w.silentFor[source]
        const db = lin2db(w.level[source])
        const dead = s > DEAD_AFTER
        const text = !w.enabled[source]
          ? 'Off'
          : dead
            ? `Nothing at all for ${Math.round(s)}s`
            : s > 0.4
              ? 'Room tone'
              : `${Math.round(db)} dB`
        if (el.textContent !== text) el.textContent = text
        const tone = dead ? 'dead' : s > 0.4 ? 'floor' : 'live'
        if (el.dataset.signal !== tone) el.dataset.signal = tone
      }),
    [source]
  )
  return (
    <span
      ref={ref}
      className="text-[11px] tabular-nums text-white/40 data-[signal=dead]:font-medium data-[signal=dead]:text-orange-300"
    />
  )
}

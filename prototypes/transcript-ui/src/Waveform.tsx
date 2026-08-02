/**
 * Waveform + scrubber over the single mixdown (#5: V1 plays one mixed file;
 * per-track playback sync is out of scope). Peaks are faked here — the real app
 * precomputes them with the FFmpeg sidecar and feeds wavesurfer.
 *
 * The playhead is a CSS var written by the rAF loop, never React state.
 */
import {useEffect, useRef} from 'react'
import {peaksFor} from './data'
import {transport, useFrame} from './transport'
import type {Segment, Speaker, Track} from './types'

export function Waveform({
  segments,
  duration,
  height = 44,
  className = '',
}: {
  segments: Segment[]
  duration: number
  height?: number
  className?: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current!
    const parent = wrap.current!
    const draw = () => {
      const w = parent.clientWidth
      const dpr = devicePixelRatio || 1
      el.width = w * dpr
      el.height = height * dpr
      const ctx = el.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, height)
      const buckets = Math.max(80, Math.floor(w / 2))
      const peaks = peaksFor(segments, duration, buckets)
      const bw = w / buckets
      ctx.fillStyle = '#3d4655'
      for (let i = 0; i < buckets; i++) {
        const h = Math.max(1.5, peaks[i] * (height - 6))
        ctx.fillRect(i * bw, (height - h) / 2, Math.max(1, bw - 0.5), h)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [segments, duration, height])

  useFrame(t => {
    wrap.current?.style.setProperty('--t-pct', String(t / (duration || 1)))
  })

  const seekFromEvent = (e: React.MouseEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    transport.seek(((e.clientX - r.left) / r.width) * duration)
  }

  return (
    <div
      ref={wrap}
      style={{height}}
      onMouseDown={e => {
        seekFromEvent(e)
        const move = (ev: MouseEvent) => {
          const r = wrap.current!.getBoundingClientRect()
          transport.seek(((ev.clientX - r.left) / r.width) * duration)
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
      className={`relative cursor-pointer select-none overflow-hidden ${className}`}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-white/10"
        style={{width: 'calc(var(--t-pct, 0) * 100%)'}}
      />
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white"
        style={{left: 'calc(var(--t-pct, 0) * 100%)'}}
      />
    </div>
  )
}

/**
 * One lane per Track, each Segment a block coloured by Speaker. Overlap is
 * simply two blocks in the same column on different lanes — the merge decision
 * (#11) made visible rather than annotated.
 */
export function TrackLanes({
  tracks,
  segments,
  speakers,
  duration,
  colorOf,
  selected,
  onPick,
  laneHeight = 26,
}: {
  tracks: Track[]
  segments: Segment[]
  speakers: Speaker[]
  duration: number
  colorOf: (speakerId: string) => {dot: string}
  selected: string[]
  onPick: (id: string, additive: boolean) => void
  laneHeight?: number
}) {
  const wrap = useRef<HTMLDivElement>(null)
  useFrame(t => wrap.current?.style.setProperty('--t-pct', String(t / (duration || 1))))
  const sel = new Set(selected)

  return (
    <div
      ref={wrap}
      className="relative select-none"
      onMouseDown={e => {
        if ((e.target as HTMLElement).dataset.block !== undefined) return
        const r = wrap.current!.getBoundingClientRect()
        transport.seek(((e.clientX - r.left) / r.width) * duration)
      }}>
      {tracks.map(track => (
        <div key={track.id} className="mb-1 flex items-center gap-2">
          <div className="w-36 shrink-0 truncate text-[11px] text-slate-400">{track.label}</div>
          <div
            className="relative flex-1 rounded bg-ink-3/70"
            style={{height: laneHeight}}>
            {segments
              .filter(s => s.trackId === track.id)
              .map(s => (
                <button
                  key={s.id}
                  data-seg={s.id}
                  data-block
                  title={`${s.words.length} words`}
                  onClick={e => {
                    onPick(s.id, e.metaKey || e.shiftKey)
                    transport.seek(s.start)
                  }}
                  className={`absolute top-0 h-full rounded-[3px] border transition-[filter] data-[playing]:brightness-150 ${
                    sel.has(s.id) ? 'border-white' : 'border-transparent'
                  }`}
                  style={{
                    left: `${(s.start / duration) * 100}%`,
                    width: `${Math.max(0.12, ((s.end - s.start) / duration) * 100)}%`,
                    background: colorOf(s.speakerId).dot,
                    opacity: 0.75,
                  }}
                />
              ))}
          </div>
        </div>
      ))}
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white"
        style={{left: `calc(9.5rem + var(--t-pct, 0) * (100% - 9.5rem))`}}
      />
      <div className="mt-1 flex gap-3 pl-[9.5rem] text-[10px] text-slate-500">
        {speakers.map(sp => (
          <span key={sp.id} className="flex items-center gap-1">
            <i className="size-2 rounded-full" style={{background: colorOf(sp.id).dot}} />
            {sp.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * A fake audio transport. The real app plays one mixdown file through
 * wavesurfer (#5); the prototype only needs a clock, because the question is
 * what the transcript does with the clock, not whether audio decodes.
 *
 * Deliberate: the ~60 Hz position is NOT React state. Subscribers get raw rAF
 * callbacks and write to the DOM directly — the technique #5 flagged as
 * ADR-worthy. Only play/pause/rate (rare, discrete) live in React.
 */
import {useEffect, useRef, useSyncExternalStore} from 'react'

type FrameCb = (t: number) => void

class Transport {
  duration = 0
  t = 0
  playing = false
  rate = 1
  private frameCbs = new Set<FrameCb>()
  private stateCbs = new Set<() => void>()
  private last = 0
  private raf = 0
  private snap = {playing: false, rate: 1}

  setDuration(d: number) {
    this.duration = d
  }

  subscribeFrame = (cb: FrameCb) => {
    this.frameCbs.add(cb)
    cb(this.t)
    return () => void this.frameCbs.delete(cb)
  }

  subscribeState = (cb: () => void) => {
    this.stateCbs.add(cb)
    return () => void this.stateCbs.delete(cb)
  }

  getState = () => this.snap

  private emitState() {
    this.snap = {playing: this.playing, rate: this.rate}
    this.stateCbs.forEach(cb => cb())
  }

  private emitFrame() {
    this.frameCbs.forEach(cb => cb(this.t))
  }

  private loop = (now: number) => {
    const dt = (now - this.last) / 1000
    this.last = now
    this.t = Math.min(this.duration, this.t + dt * this.rate)
    this.emitFrame()
    if (this.t >= this.duration) return this.pause()
    this.raf = requestAnimationFrame(this.loop)
  }

  play() {
    if (this.playing) return
    this.playing = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
    this.emitState()
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.emitState()
  }

  toggle() {
    this.playing ? this.pause() : this.play()
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t))
    this.emitFrame()
  }

  nudge(delta: number) {
    this.seek(this.t + delta)
  }

  setRate(r: number) {
    this.rate = r
    this.emitState()
  }
}

export const transport = new Transport()
// Prototype convenience: poke the clock from the console.
;(window as unknown as {transport: Transport}).transport = transport

export function useTransportState() {
  return useSyncExternalStore(transport.subscribeState, transport.getState)
}

export function useFrame(cb: FrameCb) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => transport.subscribeFrame(t => ref.current(t)), [])
}

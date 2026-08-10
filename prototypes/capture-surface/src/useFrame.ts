/**
 * Shared PLUMBING for the meters — deliberately not shared *looks*.
 *
 * What a meter looks like is one of #24's open questions, so every variant
 * draws its own. What they share is the subscription: a per-frame callback
 * that writes straight to the DOM, never through React state. That is #5's
 * cross-cutting inference (the ~60 Hz playback cursor is not React state)
 * applied to the second push channel #23 asked for.
 */
import {useEffect, useRef} from 'react'
import {subscribeFrame, type World} from './capture'

export function useFrame(cb: (w: World) => void) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => subscribeFrame(w => ref.current(w)), [])
}

/**
 * Attach to any element: it gets `--level` (0..1 meter position), `--peak`,
 * and a `data-signal` of `live` | `floor` | `dead` every frame.
 */
export function useLevelVars<T extends HTMLElement>(
  read: (w: World) => {level: number; peak: number; signal: string}
) {
  const ref = useRef<T>(null)
  useFrame(w => {
    const el = ref.current
    if (!el) return
    const {level, peak, signal} = read(w)
    el.style.setProperty('--level', String(level))
    el.style.setProperty('--peak', String(peak))
    if (el.dataset.signal !== signal) el.dataset.signal = signal
  })
  return ref
}

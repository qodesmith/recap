/**
 * Playback highlighting, done entirely outside React (the #5 inference).
 *
 * Every frame this hook finds the active Segment(s) and the active Word, then
 * flips `data-playing` attributes straight on the DOM. Variants opt in simply by
 * rendering `data-seg={id}` on a segment node and `data-w={i}` on word nodes;
 * CSS does the rest. React re-renders only when the *segment* changes, and only
 * for variants that ask for it.
 *
 * Domain rule made visible: an edited Segment's words are stale, so it gets
 * segment-level highlight only — never word-level (CONTEXT.md, Edit).
 */
import {useEffect, useRef} from 'react'
import {transport} from './transport'
import type {Segment} from './types'

type Opts = {
  /** Called when the primary (latest-started) active segment changes. */
  onSegment?: (id: string | null, index: number) => void
  /** Element that gets `--t-pct` (0–1 playhead ratio) written to it each frame. */
  cursorTarget?: React.RefObject<HTMLElement | null>
}

export function usePlayhead(segments: Segment[], opts: Opts = {}) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    const marked = new Set<string>()
    const cache = new Map<string, HTMLElement[]>()
    let lastPrimary: string | null = null
    let lastWordEl: HTMLElement | null = null

    const clear = (id: string) => {
      document
        .querySelectorAll<HTMLElement>(`[data-seg="${CSS.escape(id)}"]`)
        .forEach(el => delete el.dataset.playing)
      cache.delete(id)
    }

    return transport.subscribeFrame(t => {
      // Binary search for the last segment that has started, then walk back a
      // few to pick up overlapping segments on the other track.
      let lo = 0
      let hi = segments.length - 1
      let idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (segments[mid].start <= t) {
          idx = mid
          lo = mid + 1
        } else hi = mid - 1
      }

      const active: Segment[] = []
      for (let i = idx; i >= 0 && i > idx - 8; i--) {
        const s = segments[i]
        if (s && t >= s.start && t < s.end) active.push(s)
      }

      const ids = new Set(active.map(s => s.id))
      for (const id of marked) {
        if (!ids.has(id)) {
          clear(id)
          marked.delete(id)
        }
      }
      for (const s of active) {
        // A virtualized list can mount the active segment long after it became
        // active (seek, then scroll), so keep re-querying until the node shows up
        // — but cache it, or a 74k-span document would pay for the lookup 60×/s.
        const cached = cache.get(s.id)
        if (cached?.length && cached.every(el => el.isConnected)) continue
        const els = [...document.querySelectorAll<HTMLElement>(`[data-seg="${CSS.escape(s.id)}"]`)]
        if (!els.length) {
          cache.delete(s.id)
          continue
        }
        els.forEach(el => (el.dataset.playing = ''))
        cache.set(s.id, els)
        marked.add(s.id)
      }

      const primary = active[0] ?? null
      if ((primary?.id ?? null) !== lastPrimary) {
        lastPrimary = primary?.id ?? null
        optsRef.current.onSegment?.(lastPrimary, idx)
      }

      // Word-level highlight, skipped on edited segments (words are stale).
      let wordEl: HTMLElement | null = null
      if (primary && !primary.edit) {
        let wi = -1
        for (let i = 0; i < primary.words.length; i++) {
          if (primary.words[i].s <= t) wi = i
          else break
        }
        // Scope the lookup to the cached segment node — a document-wide
        // `[data-w=...]` query would walk every word span on every frame.
        const scope = cache.get(primary.id)?.find(el => el.isConnected)
        if (wi >= 0 && scope) wordEl = scope.querySelector<HTMLElement>(`[data-w="${wi}"]`)
      }
      if (lastWordEl && !lastWordEl.isConnected) lastWordEl = null
      if (wordEl !== lastWordEl) {
        if (lastWordEl) delete lastWordEl.dataset.playing
        if (wordEl) wordEl.dataset.playing = ''
        lastWordEl = wordEl
      }

      const cursor = optsRef.current.cursorTarget?.current
      if (cursor) cursor.style.setProperty('--t-pct', String(t / (transport.duration || 1)))
    })
  }, [segments])
}

/** Read the clock without subscribing React to it. */
export const now = () => transport.t

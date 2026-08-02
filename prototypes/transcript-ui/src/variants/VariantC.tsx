/**
 * VARIANT C — "Studio"
 *
 * Timeline first. The Recording's Tracks are lanes across the top, every Segment
 * a block; the transcript below is a dense selectable table, not prose.
 *
 * Its answers to #14:
 *  - Layout: two panes — track lanes + a tight time/speaker/text table.
 *  - Sync: row highlight, word highlight inside the active row only. Follow is an
 *    explicit toggle, not a guess about your intent.
 *  - Seek: scrub the lanes anywhere, click a block, click a row's timestamp, click a word.
 *  - Edit: explicit. Double-click a row → editor with Save / Cancel. Nothing commits by accident.
 *  - Speakers: left panel with counts and talk time; rename inline; merge with one click.
 *  - Reassign: BULK. Select rows (click, ⌘-click, shift-click), then hit 1/2/3 or use the
 *    action bar. Fixing 40 mis-attributed segments is the design target.
 *  - Overlap: visible in the lanes as two blocks in the same column; rows carry a ⧉ badge.
 *  - Export: action bar exports exactly the selected rows.
 */
import {useVirtualizer} from '@tanstack/react-virtual'
import {useEffect, useMemo, useRef, useState} from 'react'
import {colorFor, fmt, segmentText} from '../data'
import {usePlayhead} from '../highlight'
import {store, useStore} from '../store'
import {transport, useFrame, useTransportState} from '../transport'
import type {VariantProps} from '../types'
import {TrackLanes} from '../Waveform'
import {Words} from '../Words'

export function VariantC({data, overlaps}: VariantProps) {
  const {selected} = useStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const speakerIds = data.speakers.map(s => s.id)
  const colorOf = (id: string) => colorFor(speakerIds, id)

  const virt = useVirtualizer({
    count: data.segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => 34 + Math.min(340, data.segments[i].words.length * 1.35),
    overscan: 8,
    getItemKey: i => data.segments[i].id,
  })

  usePlayhead(data.segments, {
    onSegment: (_id, idx) => {
      if (following && idx >= 0) virt.scrollToIndex(idx, {align: 'center', behavior: 'smooth'})
    },
  })

  // Bulk reassignment by number key — the point of the variant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable) return
      const n = Number(e.key)
      if (!n || n > data.speakers.length || !selected.length) return
      store.reassign(selected, data.speakers[n - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, data.speakers])

  const stats = useMemo(() => {
    const m = new Map<string, {secs: number; n: number}>()
    for (const s of data.segments) {
      const cur = m.get(s.speakerId) ?? {secs: 0, n: 0}
      m.set(s.speakerId, {secs: cur.secs + (s.end - s.start), n: cur.n + 1})
    }
    return m
  }, [data.segments])

  const pick = (id: string, additive: boolean) => {
    if (!additive) return store.select([id])
    store.toggleSelect(id, true)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-white/8 px-4 py-2">
        <Transport />
        <div className="min-w-0 truncate text-xs text-slate-400">{data.recording.title}</div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setFollowing(v => !v)}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
              following ? 'bg-cyan-400 text-black' : 'bg-white/10 text-slate-300'
            }`}>
            Follow playhead
          </button>
          <button className="rounded-md bg-white/10 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/15">
            Export {selected.length ? `selection (${selected.length})` : 'all'} ▾
          </button>
        </div>
      </header>

      <div className="border-b border-white/8 bg-ink-2/40 px-4 py-3">
        <TrackLanes
          tracks={data.tracks}
          segments={data.segments}
          speakers={data.speakers}
          duration={data.recording.durationSeconds}
          colorOf={colorOf}
          selected={selected}
          onPick={pick}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 border-r border-white/8 p-3">
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Speakers
          </div>
          {data.speakers.map((sp, i) => (
            <div key={sp.id} className="mt-2 rounded-lg bg-white/4 p-2">
              <div className="flex items-center gap-1.5">
                <span className="grid size-4 shrink-0 place-items-center rounded bg-white/10 font-mono text-[9px] text-slate-400">
                  {i + 1}
                </span>
                <i className="size-2 shrink-0 rounded-full" style={{background: colorOf(sp.id).dot}} />
                <input
                  defaultValue={sp.name}
                  key={sp.name}
                  onBlur={e => store.renameSpeaker(sp.id, e.target.value.trim() || sp.name)}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 text-[11px] font-semibold hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                />
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                {stats.get(sp.id)?.n ?? 0} segs · {fmt(stats.get(sp.id)?.secs ?? 0)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {data.speakers
                  .filter(o => o.id !== sp.id)
                  .map(o => (
                    <button
                      key={o.id}
                      onClick={() => store.mergeSpeakers(sp.id, o.id)}
                      className="rounded bg-white/8 px-1.5 py-0.5 text-[9px] text-slate-300 hover:bg-white/15">
                      → {o.name}
                    </button>
                  ))}
              </div>
              {sp.mergedFrom?.length ? (
                <div className="mt-1 text-[9px] text-emerald-300/80">
                  merged {sp.mergedFrom.map(m => m.name).join(', ')}
                </div>
              ) : null}
            </div>
          ))}
          <div className="mt-3 text-[10px] leading-relaxed text-slate-500">
            Select rows, then press <b className="text-slate-300">1</b>–
            <b className="text-slate-300">{data.speakers.length}</b> to reassign them.
          </div>
        </aside>

        <div ref={scrollRef} className="proto-scroll min-w-0 flex-1 overflow-y-auto">
          <div style={{height: virt.getTotalSize(), position: 'relative'}}>
            {virt.getVirtualItems().map(item => {
              const seg = data.segments[item.index]
              const sp = data.speakers.find(s => s.id === seg.speakerId)!
              const c = colorOf(seg.speakerId)
              const isSel = selected.includes(seg.id)
              const ov = overlaps.get(seg.id)
              return (
                <div
                  key={item.key}
                  ref={virt.measureElement}
                  data-index={item.index}
                  style={{position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)`}}>
                  <div
                    data-seg={seg.id}
                    onClick={e => pick(seg.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                    onDoubleClick={() => setEditing(seg.id)}
                    className={`flex gap-3 border-b border-white/5 px-3 py-2 text-[13px] data-[playing]:bg-white/6 ${
                      isSel ? 'bg-cyan-400/10 ring-1 ring-inset ring-cyan-400/50' : 'hover:bg-white/3'
                    }`}>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        transport.seek(seg.start)
                      }}
                      className="w-12 shrink-0 pt-0.5 text-left font-mono text-[10px] text-slate-500 hover:text-cyan-300">
                      {fmt(seg.start)}
                    </button>
                    <div className="w-24 shrink-0">
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{background: c.soft, color: c.text}}>
                        <i className="size-1.5 rounded-full" style={{background: c.dot}} />
                        {sp.name}
                      </span>
                      <div className="mt-0.5 text-[9px] text-slate-600">
                        {data.tracks.find(t => t.id === seg.trackId)!.label}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 leading-relaxed text-slate-200">
                      {editing === seg.id ? (
                        <Editor
                          initial={segmentText(seg)}
                          onCancel={() => setEditing(null)}
                          onSave={t => {
                            store.editSegment(seg.id, t)
                            setEditing(null)
                          }}
                        />
                      ) : (
                        <Words seg={seg} />
                      )}
                      <div className="mt-1 flex gap-2 text-[10px]">
                        {ov && (
                          <span className="text-amber-300/80" title={`overlaps ${ov.length} segment(s) on another track`}>
                            ⧉ overlap
                          </span>
                        )}
                        {seg.edit && (
                          <span className="text-amber-300/80">
                            ✎ edited · timings stale ·{' '}
                            <button
                              className="underline"
                              onClick={e => {
                                e.stopPropagation()
                                store.revertEdit(seg.id)
                              }}>
                              revert
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink-3 px-3 py-2 text-xs shadow-2xl ring-1 ring-white/15">
          <span className="font-semibold">{selected.length} selected</span>
          <span className="text-slate-500">reassign to</span>
          {data.speakers.map((sp, i) => (
            <button
              key={sp.id}
              onClick={() => store.reassign(selected, sp.id)}
              className="flex items-center gap-1 rounded-md bg-white/8 px-2 py-1 hover:bg-white/15">
              <i className="size-2 rounded-full" style={{background: colorOf(sp.id).dot}} />
              {sp.name}
              <kbd className="ml-1 text-[9px] text-slate-500">{i + 1}</kbd>
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/15" />
          <button className="rounded-md bg-white/8 px-2 py-1 hover:bg-white/15">Export</button>
          <button
            onClick={() => store.select([])}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10">
            clear
          </button>
        </div>
      )}
    </div>
  )
}

function Editor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (t: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial)
  return (
    <div onClick={e => e.stopPropagation()}>
      <textarea
        autoFocus
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(v)
        }}
        rows={Math.min(12, Math.ceil(v.length / 100) + 1)}
        className="w-full resize-none rounded bg-ink px-2 py-1.5 text-[13px] leading-relaxed outline-1 outline-cyan-400/60"
      />
      <div className="mt-1 flex gap-2">
        <button
          onClick={() => onSave(v)}
          className="rounded bg-cyan-400 px-2 py-0.5 text-[11px] font-semibold text-black">
          Save
        </button>
        <button onClick={onCancel} className="rounded bg-white/10 px-2 py-0.5 text-[11px]">
          Cancel
        </button>
        <span className="self-center text-[10px] text-slate-500">⌘↵ saves · esc cancels</span>
      </div>
    </div>
  )
}

function Transport() {
  const {playing, rate} = useTransportState()
  const timeRef = useRef<HTMLSpanElement>(null)
  useFrame(t => {
    if (timeRef.current) timeRef.current.textContent = fmt(t)
  })
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={() => transport.toggle()}
        className="grid size-8 place-items-center rounded-full bg-white text-black">
        {playing ? '❚❚' : '▶'}
      </button>
      <span ref={timeRef} className="w-12 font-mono text-[11px] text-slate-300">
        0:00
      </span>
      <select
        value={rate}
        onChange={e => transport.setRate(Number(e.target.value))}
        className="rounded bg-ink-3 px-1 py-1 text-[10px]">
        {[1, 1.5, 2, 8].map(r => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * VARIANT D — "Conversation + lanes" — the chosen mix from the first round.
 *
 * A's experience, with four changes the review asked for:
 *  1. The player-bar waveform is replaced by C's Segment-block lanes.
 *  2. Long Segments break into display paragraphs at speech pauses — still ONE
 *     Segment, one coloured bubble, just breathing room (see data.ts paragraphs()).
 *  3. The selection checkbox is a real checkbox, and SHIFT-clicking one selects
 *     the whole range from the last one clicked.
 *  4. Because a range selection now exists, the action bar can act on it:
 *     export it, or reassign all of it to one Speaker in a single click.
 */
import {useVirtualizer} from '@tanstack/react-virtual'
import {useEffect, useMemo, useRef, useState} from 'react'
import {colorFor, fmt, hostFor, segmentText} from '../data'
import {usePlayhead} from '../highlight'
import {store, useStore} from '../store'
import {transport, useFrame, useTransportState} from '../transport'
import type {VariantProps} from '../types'
import {SegmentScrubber} from '../Waveform'
import {WordParagraphs} from '../Words'

export function VariantD({data, overlaps}: VariantProps) {
  const {selected} = useStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<number | null>(null)
  const [following, setFollowing] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const speakerIds = data.speakers.map(s => s.id)
  const colorOf = (id: string) => colorFor(speakerIds, id)

  const virt = useVirtualizer({
    count: data.segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => 86 + Math.min(560, data.segments[i].words.length * 2.1),
    overscan: 6,
    getItemKey: i => data.segments[i].id,
  })

  usePlayhead(data.segments, {
    onSegment: (_id, idx) => {
      if (following && idx >= 0) virt.scrollToIndex(idx, {align: 'center', behavior: 'smooth'})
    },
  })

  useEffect(() => {
    const el = scrollRef.current!
    const off = () => setFollowing(false)
    el.addEventListener('wheel', off, {passive: true})
    el.addEventListener('touchmove', off, {passive: true})
    return () => {
      el.removeEventListener('wheel', off)
      el.removeEventListener('touchmove', off)
    }
  }, [])

  const byId = useMemo(() => new Map(data.segments.map(s => [s.id, s])), [data.segments])

  const talk = useMemo(() => {
    const m = new Map<string, {secs: number; n: number}>()
    for (const s of data.segments) {
      const cur = m.get(s.speakerId) ?? {secs: 0, n: 0}
      m.set(s.speakerId, {secs: cur.secs + (s.end - s.start), n: cur.n + 1})
    }
    return m
  }, [data.segments])

  /** Checkbox click: plain = toggle one, shift = select every segment back to the anchor. */
  const onCheck = (index: number, shift: boolean) => {
    const id = data.segments[index].id
    if (shift && anchorRef.current !== null) {
      const [from, to] = [anchorRef.current, index].sort((a, b) => a - b)
      const range = data.segments.slice(from, to + 1).map(s => s.id)
      store.select([...new Set([...selected, ...range])])
      return
    }
    anchorRef.current = index
    store.toggleSelect(id, true)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-white/8 px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data.recording.title}</div>
          <div className="text-[11px] text-slate-500">
            {fmt(data.recording.durationSeconds)} · {data.tracks.length} tracks ·{' '}
            {data.segments.length} segments
          </div>
        </div>
        <div className="relative ml-auto">
          <button
            onClick={() => setExportOpen(v => !v)}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/15">
            Export ▾
          </button>
          {exportOpen && (
            <div
              onMouseLeave={() => setExportOpen(false)}
              className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-white/10 bg-ink-2 p-1 text-xs shadow-2xl">
              {[
                selected.length
                  ? `Copy ${selected.length} selected segments`
                  : 'Copy whole transcript',
                selected.length ? `Export selection as text…` : 'Export as plain text…',
                selected.length ? `Export selection as JSON…` : 'Export as JSON…',
              ].map(l => (
                <button
                  key={l}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10">
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="proto-scroll relative min-w-0 flex-1 overflow-y-auto px-5">
          <div style={{height: virt.getTotalSize(), position: 'relative'}}>
            {virt.getVirtualItems().map(item => {
              const seg = data.segments[item.index]
              const prev = data.segments[item.index - 1]
              const sp = data.speakers.find(s => s.id === seg.speakerId)!
              const c = colorOf(seg.speakerId)
              const grouped = prev?.speakerId === seg.speakerId
              const host = hostFor(seg, overlaps, byId)
              const isSelected = selected.includes(seg.id)
              return (
                <div
                  key={item.key}
                  ref={virt.measureElement}
                  data-index={item.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                  className="pb-3">
                  <div className="group/row flex gap-3">
                    <div className="w-9 shrink-0 pt-1">
                      {!grouped && (
                        <div
                          className="grid size-8 place-items-center rounded-full text-[11px] font-bold text-black"
                          style={{background: c.dot}}>
                          {sp.name
                            .split(/\s+/)
                            .map(w => w[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Checkbox gutter — always reserved, so nothing shifts on hover. */}
                    <div className="w-6 shrink-0 pt-1.5">
                      <button
                        onClick={e => onCheck(item.index, e.shiftKey)}
                        title={
                          isSelected
                            ? 'Deselect (shift-click selects a range)'
                            : 'Select (shift-click selects a range)'
                        }
                        className={`grid size-5 place-items-center rounded border text-[12px] leading-none transition-opacity ${
                          isSelected
                            ? 'border-cyan-300 bg-cyan-400 text-black opacity-100'
                            : 'border-white/25 text-transparent opacity-0 group-hover/row:opacity-100'
                        } ${selected.length ? 'opacity-100' : ''}`}>
                        ✓
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-semibold" style={{color: c.text}}>
                            {sp.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {fmt(seg.start)} · {data.tracks.find(t => t.id === seg.trackId)!.label}
                          </span>
                        </div>
                      )}

                      {host && (
                        <div className="mb-1 flex items-center gap-1 text-[10px] text-amber-300/80">
                          <span>⇄</span> spoken over{' '}
                          {data.speakers.find(s => s.id === host.speakerId)!.name} at{' '}
                          {fmt(seg.start)}
                        </div>
                      )}

                      <div
                        draggable={!editing}
                        onDragStart={e => e.dataTransfer.setData('text/segment', seg.id)}
                        data-seg={seg.id}
                        onDoubleClick={() => setEditing(seg.id)}
                        className={`relative rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ring-1 ring-white/5 data-[playing]:ring-white/25 ${
                          isSelected ? 'outline outline-2 outline-cyan-400/70' : ''
                        }`}
                        style={{background: c.soft}}>
                        {editing === seg.id ? (
                          <EditBox
                            initial={segmentText(seg)}
                            onCancel={() => setEditing(null)}
                            onCommit={text => {
                              store.editSegment(seg.id, text)
                              setEditing(null)
                            }}
                          />
                        ) : (
                          <WordParagraphs seg={seg} />
                        )}

                        {seg.edit && (
                          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-amber-300/80">
                            <span className="rounded bg-amber-400/15 px-1.5 py-0.5">edited</span>
                            <span>word timings stale — highlight falls back to the whole bubble</span>
                            <button
                              className="underline hover:text-amber-200"
                              onClick={() => store.revertEdit(seg.id)}>
                              revert
                            </button>
                          </div>
                        )}

                        <div className="absolute -top-2 right-2 hidden items-center gap-1 group-hover/row:flex">
                          <button
                            onClick={() => setEditing(seg.id)}
                            className="rounded-md bg-ink-3 px-1.5 py-0.5 text-[10px] ring-1 ring-white/10 hover:bg-ink-2">
                            edit
                          </button>
                          <div className="relative">
                            <button
                              onClick={() => setMenuFor(menuFor === seg.id ? null : seg.id)}
                              className="rounded-md bg-ink-3 px-1.5 py-0.5 text-[10px] ring-1 ring-white/10 hover:bg-ink-2">
                              speaker ▾
                            </button>
                            {menuFor === seg.id && (
                              <div
                                onMouseLeave={() => setMenuFor(null)}
                                className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-white/10 bg-ink-2 p-1 text-[11px] shadow-2xl">
                                {data.speakers.map(s => (
                                  <button
                                    key={s.id}
                                    onClick={() => {
                                      store.reassign([seg.id], s.id)
                                      setMenuFor(null)
                                    }}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10">
                                    <i
                                      className="size-2 rounded-full"
                                      style={{background: colorOf(s.id).dot}}
                                    />
                                    {s.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {!following && (
            <button
              onClick={() => setFollowing(true)}
              className="sticky bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-black shadow-lg">
              ↓ Jump to playhead
            </button>
          )}
        </div>

        <aside className="w-64 shrink-0 border-l border-white/8 px-4 py-3">
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Speakers
          </div>
          <div className="mt-2 space-y-2">
            {data.speakers.map(sp => {
              const c = colorOf(sp.id)
              const t = talk.get(sp.id) ?? {secs: 0, n: 0}
              return (
                <div
                  key={sp.id}
                  onDragOver={e => {
                    e.preventDefault()
                    setDragOver(sp.id)
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => {
                    const id = e.dataTransfer.getData('text/segment')
                    if (id) store.reassign(selected.includes(id) ? selected : [id], sp.id)
                    setDragOver(null)
                  }}
                  className={`rounded-lg p-2 ring-1 ${
                    dragOver === sp.id ? 'bg-white/10 ring-white/40' : 'ring-white/8'
                  }`}>
                  <div className="flex items-center gap-2">
                    <i className="size-2.5 shrink-0 rounded-full" style={{background: c.dot}} />
                    <RenameField value={sp.name} onCommit={v => store.renameSpeaker(sp.id, v)} />
                  </div>
                  <div className="mt-1 pl-4.5 text-[10px] text-slate-500">
                    {t.n} segments · {fmt(t.secs)} ·{' '}
                    {sp.provenance.attributed
                      ? 'attributed'
                      : `diarized ${sp.provenance.diarizationLabel}`}
                  </div>
                  {sp.mergedFrom?.length ? (
                    <div className="mt-1 pl-4.5 text-[10px] text-emerald-300/80">
                      merged: {sp.mergedFrom.map(m => m.name).join(', ')}
                    </div>
                  ) : null}
                  <div className="mt-1.5 pl-4.5">
                    <select
                      value=""
                      onChange={e => e.target.value && store.mergeSpeakers(sp.id, e.target.value)}
                      className="w-full rounded bg-ink-3 px-1.5 py-1 text-[10px] text-slate-300">
                      <option value="">Merge into…</option>
                      {data.speakers
                        .filter(o => o.id !== sp.id)
                        .map(o => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 text-[10px] leading-relaxed text-slate-500">
            Check a segment, then shift-click another to take everything between them.
            Drag a bubble onto a speaker to reassign it.
          </div>
        </aside>
      </div>

      {selected.length > 0 && (
        <div className="absolute bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink-3 px-3 py-2 text-xs whitespace-nowrap shadow-2xl ring-1 ring-white/15">
          <span className="font-semibold">{selected.length} selected</span>
          <button className="rounded-md bg-white/8 px-2 py-1 hover:bg-white/15">Copy</button>
          <button className="rounded-md bg-white/8 px-2 py-1 hover:bg-white/15">Export…</button>
          <span className="mx-1 h-4 w-px bg-white/15" />
          <span className="text-slate-500">reassign to</span>
          {data.speakers.map(sp => (
            <button
              key={sp.id}
              onClick={() => store.reassign(selected, sp.id)}
              className="flex items-center gap-1 rounded-md bg-white/8 px-2 py-1 hover:bg-white/15">
              <i className="size-2 rounded-full" style={{background: colorOf(sp.id).dot}} />
              {sp.name}
            </button>
          ))}
          <button
            onClick={() => store.select([])}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10">
            clear
          </button>
        </div>
      )}

      <PlayerBar data={data} colorOf={colorOf} />
    </div>
  )
}

function EditBox({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (t: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial)
  return (
    <textarea
      autoFocus
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit(v)
      }}
      rows={Math.min(16, Math.ceil(v.length / 90) + 1)}
      className="w-full resize-none rounded-lg bg-ink px-2 py-1.5 text-[13px] leading-relaxed outline-1 outline-cyan-400/60"
    />
  )
}

function RenameField({value, onCommit}: {value: string; onCommit: (v: string) => void}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => onCommit(v.trim() || value)}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-semibold hover:bg-white/10 focus:bg-white/10 focus:outline-none"
    />
  )
}

function PlayerBar({
  data,
  colorOf,
}: {
  data: VariantProps['data']
  colorOf: (id: string) => {dot: string}
}) {
  const {playing, rate} = useTransportState()
  const timeRef = useRef<HTMLSpanElement>(null)
  useFrame(t => {
    if (timeRef.current) timeRef.current.textContent = fmt(t)
  })
  return (
    <div className="flex items-center gap-3 border-t border-white/8 bg-ink-2/70 px-5 py-2.5">
      <button
        onClick={() => transport.toggle()}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black">
        {playing ? '❚❚' : '▶'}
      </button>
      <span ref={timeRef} className="w-14 shrink-0 text-right font-mono text-xs text-slate-300">
        0:00
      </span>
      <SegmentScrubber
        tracks={data.tracks}
        segments={data.segments}
        duration={data.recording.durationSeconds}
        colorOf={colorOf}
        className="flex-1"
      />
      <span className="w-14 shrink-0 font-mono text-xs text-slate-500">
        {fmt(data.recording.durationSeconds)}
      </span>
      <select
        value={rate}
        onChange={e => transport.setRate(Number(e.target.value))}
        className="rounded bg-ink-3 px-1.5 py-1 text-[11px]">
        {[1, 1.25, 1.5, 2, 8].map(r => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  )
}

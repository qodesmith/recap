/**
 * VARIANT B — "Script"
 *
 * The transcript as a document you can read end to end: one column, screenplay
 * gutter (timestamp + speaker, printed only when the speaker changes), prose body.
 *
 * Its answers to #14:
 *  - Layout: continuous document with inline labels, no bubbles, no rail.
 *  - Sync: segment-level tint is primary, word underline secondary. Follow keeps
 *    the active line centred and switches itself off silently when you scroll.
 *  - Seek: click a word, or click the gutter timestamp, or scrub the toolbar waveform.
 *  - Edit: the document is ALWAYS editable — click and type. Blur commits, ⌘Z undoes.
 *    An edited paragraph gets a diff-style change bar in the gutter.
 *  - Speakers: no rail — the gutter name IS the control. Click to rename, ▾ to reassign.
 *  - Reassign: gutter dropdown, one segment at a time.
 *  - Overlap: the interrupting segment is indented under a rule, marked "over <name>".
 *  - Export: native text selection → floating Copy/Export button. Export a selection
 *    means literally what you highlighted, not a set of segments.
 *
 * DELIBERATE TRADE-OFF: this variant does NOT virtualize. Native cross-segment
 * selection and document-wide ⌘Z need every paragraph in the DOM. Flip the switcher
 * to `stress` (≈1,164 segments / 74k words) to feel exactly what that costs.
 */
import {useEffect, useMemo, useRef, useState} from 'react'
import {colorFor, fmt, hostFor} from '../data'
import {usePlayhead} from '../highlight'
import {store} from '../store'
import {transport, useFrame, useTransportState} from '../transport'
import type {VariantProps} from '../types'
import {Waveform} from '../Waveform'
import {Words} from '../Words'

export function VariantB({data, overlaps}: VariantProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [sel, setSel] = useState<{text: string; x: number; y: number} | null>(null)
  const speakerIds = data.speakers.map(s => s.id)
  const colorOf = (id: string) => colorFor(speakerIds, id)
  const byId = useMemo(() => new Map(data.segments.map(s => [s.id, s])), [data.segments])

  usePlayhead(data.segments, {
    onSegment: id => {
      if (!following || !id) return
      document
        .querySelector(`[data-seg="${CSS.escape(id)}"]`)
        ?.scrollIntoView({block: 'center', behavior: 'smooth'})
    },
  })

  useEffect(() => {
    const el = scrollRef.current!
    const off = () => setFollowing(false)
    el.addEventListener('wheel', off, {passive: true})
    return () => el.removeEventListener('wheel', off)
  }, [])

  useEffect(() => {
    const onUp = () => {
      const s = window.getSelection()
      const text = s?.toString() ?? ''
      if (!s || !text.trim() || s.isCollapsed) return setSel(null)
      const r = s.getRangeAt(0).getBoundingClientRect()
      setSel({text, x: r.left + r.width / 2, y: r.top})
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-white/8 px-6 py-2.5">
        <div className="flex items-center gap-3">
          <Transport />
          <Waveform
            segments={data.segments}
            duration={data.recording.durationSeconds}
            height={34}
            className="min-w-0 flex-1 rounded"
          />
          <button
            onClick={() => setFollowing(v => !v)}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
              following ? 'bg-cyan-400 text-black' : 'bg-white/10 text-slate-300'
            }`}>
            {following ? 'Following' : 'Follow'}
          </button>
          <button className="shrink-0 rounded-md bg-white/10 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/15">
            Export ▾
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-slate-500">{data.recording.title} ·</span>
          {data.speakers.map(sp => (
            <div key={sp.id} className="flex items-center gap-1">
              <span
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
                style={{background: colorOf(sp.id).soft, color: colorOf(sp.id).text}}>
                <i className="size-1.5 rounded-full" style={{background: colorOf(sp.id).dot}} />
                {sp.name}
              </span>
              <select
                value=""
                onChange={e => e.target.value && store.mergeSpeakers(sp.id, e.target.value)}
                className="rounded bg-transparent text-[10px] text-slate-500">
                <option value="">merge…</option>
                {data.speakers
                  .filter(o => o.id !== sp.id)
                  .map(o => (
                    <option key={o.id} value={o.id}>
                      into {o.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
          <span className="ml-auto text-[10px] text-slate-600">
            no virtualization — {data.segments.length} paragraphs in the DOM
          </span>
        </div>
      </header>

      <div ref={scrollRef} className="proto-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {data.segments.map((seg, i) => {
            const prev = data.segments[i - 1]
            const host = hostFor(seg, overlaps, byId)
            const grouped = prev?.speakerId === seg.speakerId && !host
            const sp = data.speakers.find(s => s.id === seg.speakerId)!
            const c = colorOf(seg.speakerId)
            return (
              <div
                key={seg.id}
                className={`flex gap-4 ${host ? 'my-1.5 ml-10 border-l-2 border-amber-400/40 pl-3' : ''}`}>
                <div className="w-28 shrink-0 pt-0.5 text-right">
                  {!grouped && (
                    <>
                      <button
                        onClick={() => transport.seek(seg.start)}
                        className="block w-full text-right font-mono text-[10px] text-slate-500 hover:text-slate-300">
                        {fmt(seg.start)}
                      </button>
                      <div className="flex items-center justify-end gap-0.5">
                        {renaming === sp.id ? (
                          <input
                            autoFocus
                            defaultValue={sp.name}
                            onBlur={e => {
                              store.renameSpeaker(sp.id, e.target.value.trim() || sp.name)
                              setRenaming(null)
                            }}
                            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                            className="w-20 rounded bg-white/10 px-1 text-right text-[11px] font-semibold outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => setRenaming(sp.id)}
                            title="Rename speaker"
                            className="text-[11px] font-semibold hover:underline"
                            style={{color: c.text}}>
                            {sp.name}
                          </button>
                        )}
                        <div className="relative">
                          <button
                            onClick={() => setMenuFor(menuFor === seg.id ? null : seg.id)}
                            title="Reassign this segment"
                            className="px-0.5 text-[9px] text-slate-500 hover:text-white">
                            ▾
                          </button>
                          {menuFor === seg.id && (
                            <div
                              onMouseLeave={() => setMenuFor(null)}
                              className="absolute right-0 z-30 mt-1 w-40 rounded-lg border border-white/10 bg-ink-2 p-1 text-left text-[11px] shadow-2xl">
                              <div className="px-2 py-1 text-[9px] tracking-wider text-slate-500 uppercase">
                                Reassign segment
                              </div>
                              {data.speakers.map(s => (
                                <button
                                  key={s.id}
                                  onClick={() => {
                                    store.reassign([seg.id], s.id)
                                    setMenuFor(null)
                                  }}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-white/10">
                                  <i className="size-2 rounded-full" style={{background: colorOf(s.id).dot}} />
                                  {s.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative min-w-0 flex-1">
                  {seg.edit && (
                    <div
                      title={`edited ${new Date(seg.edit.editedAt).toLocaleString()} — click to revert`}
                      onClick={() => store.revertEdit(seg.id)}
                      className="absolute -left-2.5 top-1 bottom-1 w-1 cursor-pointer rounded bg-amber-400/70 hover:bg-amber-300"
                    />
                  )}
                  {host && (
                    <div className="text-[10px] text-amber-300/70">
                      over {data.speakers.find(s => s.id === host.speakerId)!.name}
                    </div>
                  )}
                  <p
                    data-seg={seg.id}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={e => store.editSegment(seg.id, e.currentTarget.textContent ?? '')}
                    className="rounded px-1.5 py-1 text-[15px] leading-[1.75] text-slate-200 outline-none data-[playing]:bg-white/6 focus:bg-white/5">
                    <Words seg={seg} seekOnClick={false} wordClass="data-[playing]:underline data-[playing]:decoration-cyan-300 data-[playing]:decoration-2 data-[playing]:underline-offset-4" />
                  </p>
                </div>
              </div>
            )
          })}
          <div className="h-40" />
        </div>
      </div>

      {sel && (
        <div
          style={{left: sel.x, top: sel.y - 42}}
          className="fixed z-50 -translate-x-1/2 rounded-full bg-white px-1 py-1 text-[11px] font-semibold text-black shadow-xl">
          <button className="rounded-full px-2 py-1 hover:bg-black/10">Copy</button>
          <button className="rounded-full px-2 py-1 hover:bg-black/10">Export selection…</button>
          <span className="px-1 text-black/40">{sel.text.trim().split(/\s+/).length} words</span>
        </div>
      )}
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

/**
 * All mutations the transcript screen can make, shared by every variant — the
 * variants disagree about how you *reach* these, not about what they do.
 * In-memory only (prototype rule 3).
 */
import {useSyncExternalStore} from 'react'
import {base, computeOverlaps, stressify} from './data'
import {transport} from './transport'
import type {Fixture, Speaker} from './types'

export type Dataset = 'real' | 'stress'

type State = {
  dataset: Dataset
  data: Fixture
  overlaps: Map<string, string[]>
  /** Multi-select, used by the variants that support bulk reassignment. */
  selected: string[]
}

const listeners = new Set<() => void>()
let state: State = init('real')

function init(dataset: Dataset): State {
  const data = dataset === 'real' ? base : stressify(base, 12)
  transport.setDuration(data.recording.durationSeconds)
  return {dataset, data, overlaps: computeOverlaps(data.segments), selected: []}
}

function set(next: Partial<State>) {
  state = {...state, ...next}
  listeners.forEach(l => l())
}

function patchSegments(fn: (s: Fixture['segments'][number]) => Fixture['segments'][number]) {
  set({data: {...state.data, segments: state.data.segments.map(fn)}})
}

export const store = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  get: () => state,

  setDataset(dataset: Dataset) {
    transport.pause()
    transport.seek(0)
    set(init(dataset))
  },

  reset() {
    store.setDataset(state.dataset)
  },

  /** Edit preserves the model's words; its presence is the stale flag. */
  editSegment(id: string, text: string) {
    patchSegments(s =>
      s.id !== id
        ? s
        : text.trim() === s.words.map(w => w.w).join(' ')
          ? {...s, edit: undefined}
          : {...s, edit: {text: text.trim(), editedAt: new Date().toISOString()}}
    )
  },

  revertEdit(id: string) {
    patchSegments(s => (s.id === id ? {...s, edit: undefined} : s))
  },

  renameSpeaker(id: string, name: string) {
    set({
      data: {
        ...state.data,
        speakers: state.data.speakers.map(sp => (sp.id === id ? {...sp, name} : sp)),
      },
    })
  },

  reassign(segmentIds: string[], speakerId: string) {
    const ids = new Set(segmentIds)
    patchSegments(s => (ids.has(s.id) ? {...s, speakerId} : s))
  },

  /** Fold `fromId` into `intoId`. Reversible in principle — provenance is kept. */
  mergeSpeakers(fromId: string, intoId: string) {
    const from = state.data.speakers.find(s => s.id === fromId)
    if (!from || fromId === intoId) return
    const speakers: Speaker[] = state.data.speakers
      .filter(s => s.id !== fromId)
      .map(s =>
        s.id !== intoId
          ? s
          : {
              ...s,
              mergedFrom: [
                ...(s.mergedFrom ?? []),
                {id: from.id, name: from.name, diarizationLabel: from.provenance.diarizationLabel},
              ],
            }
      )
    set({
      data: {
        ...state.data,
        speakers,
        segments: state.data.segments.map(s =>
          s.speakerId === fromId ? {...s, speakerId: intoId} : s
        ),
      },
    })
  },

  select(ids: string[]) {
    set({selected: ids})
  },

  toggleSelect(id: string, additive: boolean) {
    const has = state.selected.includes(id)
    if (!additive) return set({selected: has && state.selected.length === 1 ? [] : [id]})
    set({selected: has ? state.selected.filter(x => x !== id) : [...state.selected, id]})
  },
}

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.get)
}

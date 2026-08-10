import type {SourceId, World} from './capture'

export type Actions = {
  toggleSource: (s: SourceId) => void
  setMicDevice: (id: string) => void
  start: () => void
  stop: () => void
  discard: () => void
  reset: () => void
  dismissNotice: (id: string) => void
}

export type VariantProps = {
  world: World
  actions: Actions
}

import type {World} from './pipeline'

export type View = {kind: 'library'} | {kind: 'recording'; id: string}

export type Actions = {
  transcribe: (id: string) => void
  cancel: (id: string) => void
  startCapture: () => void
  stopCapture: (id: string) => void
}

export type VariantProps = {
  world: World
  view: View
  navigate: (v: View) => void
  actions: Actions
}

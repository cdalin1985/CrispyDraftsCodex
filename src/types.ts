export type MarkKind = 'color' | 'custom-exact' | 'custom-gist'

export type Mark = {
  id: string
  start: number
  end: number
  label: string
  color: string
  kind: MarkKind
  replacement?: string
}

export type SelectionState = { start: number; end: number; x: number; y: number }

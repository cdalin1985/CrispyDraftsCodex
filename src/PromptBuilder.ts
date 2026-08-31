import type { Mark } from './types'

export function buildCodexPrompt(draft: string, marks: Mark[]) {
  const grouped = marks.filter((mark) => mark.kind === 'color').reduce<Record<string, Mark[]>>((groups, mark) => {
    ;(groups[mark.label] ??= []).push(mark)
    return groups
  }, {})
  const instructions = Object.entries(grouped).map(([label, entries]) =>
    `${label}:\n${entries.map((entry) => `- ${JSON.stringify(draft.slice(entry.start, entry.end))}`).join('\n')}`,
  )
  const exact = marks.filter((mark) => mark.kind === 'custom-exact').map((mark) =>
    `Custom-exact: Replace ${JSON.stringify(draft.slice(mark.start, mark.end))} with exactly: ${JSON.stringify(mark.replacement ?? '')}`,
  )
  const gist = marks.filter((mark) => mark.kind === 'custom-gist').map((mark) =>
    `Custom-gist: Original: ${JSON.stringify(draft.slice(mark.start, mark.end))} / Gist: ${JSON.stringify(mark.replacement ?? '')}`,
  )
  return ['Revise this draft using the marked instructions below. For custom-gist instructions, rewrite in context.', ...instructions, ...exact, ...gist, '', 'DRAFT:', draft, '', 'Return the complete revised draft.'].join('\n')
}

export function buildFollowUpPrompt(draft: string, direction: string) {
  return [
    'Revise the draft using this follow-up direction:',
    direction.trim(),
    '',
    'DRAFT:',
    draft,
    '',
    'Return the complete revised draft.',
  ].join('\n')
}

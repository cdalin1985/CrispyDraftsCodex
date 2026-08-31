import type { Mark, RevisionRequirement } from './types'

const markRules: Record<string, string> = {
  'Keep as is': 'Preserve this passage exactly.',
  'Reword this': 'Rewrite with noticeably different wording while preserving the meaning. A near-copy does not satisfy this mark.',
  'Wrong angle — rethink': 'Replace this with a different claim, reason, benefit, or emphasis. Do not paraphrase, synonym-swap, or preserve the core point. Rewrite the surrounding sentence when needed.',
  'Cut it': 'Remove this passage completely.',
  'Add more detail': 'Expand this passage with concrete, relevant detail. The replacement must be meaningfully longer.',
  'Move elsewhere': 'Relocate this passage to a more logical place in the draft. Do not leave it in its original position.',
  'Good but shorten': 'Keep the point but shorten the passage by at least 20%.',
  'Tone is off': 'Rewrite the passage so its tone fits the surrounding draft. The replacement must be materially different, not a near-copy.',
  'Flag for review': 'Preserve this passage for the writer to review.',
}

export function buildRevisionRequirements(draft: string, marks: Mark[]): RevisionRequirement[] {
  return marks.map((mark, index) => ({
    id: `M${index + 1}`,
    label: mark.label,
    kind: mark.kind,
    original: draft.slice(mark.start, mark.end),
    replacement: mark.replacement,
    start: mark.start,
    sourceLength: draft.length,
  }))
}

function ruleFor(requirement: RevisionRequirement) {
  if (requirement.kind === 'custom-exact') return 'Replace the original with the supplied replacement exactly, including its wording and punctuation.'
  if (requirement.kind === 'custom-gist') return 'Rewrite the original from the supplied direction so it reads naturally in context. A near-copy does not satisfy this mark.'
  return markRules[requirement.label] ?? 'Apply this instruction materially and in context.'
}

export function buildCodexPrompt(draft: string, marks: Mark[]) {
  const requirements = buildRevisionRequirements(draft, marks)
  const grouped = requirements.reduce<Record<string, RevisionRequirement[]>>((groups, requirement) => {
    const key = requirement.kind === 'color' ? requirement.label : requirement.kind
    ;(groups[key] ??= []).push(requirement)
    return groups
  }, {})
  const instructions = Object.values(grouped).map((entries) => {
    const first = entries[0]
    const title = first.kind === 'custom-exact' ? 'Custom exact' : first.kind === 'custom-gist' ? 'Custom gist' : first.label
    return [
      `${title} — ${ruleFor(first)}`,
      ...entries.map((entry) => `- [${entry.id}] Original: ${JSON.stringify(entry.original)}${entry.replacement !== undefined ? ` / Direction or replacement: ${JSON.stringify(entry.replacement)}` : ''}`),
    ].join('\n')
  })
  return [
    'Revise this draft using every marked requirement below. Requirements are mandatory, not suggestions.',
    ...instructions,
    '',
    'Before returning, verify that every [M#] requirement was actually applied. Unmarked writing should remain stable except for small contextual adjustments.',
    '',
    'DRAFT:',
    draft,
  ].join('\n')
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

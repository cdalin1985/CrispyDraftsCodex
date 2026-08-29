export const initialDraft = `Writing gets clearer when the feedback is specific. A good revision process does not ask you to fix everything at once; it helps you decide what already works, what needs another pass, and what no longer belongs.\n\nCrispyDrafts is a small place to make those decisions before you ask Codex to rewrite. Highlight a phrase, choose the kind of edit you want, and keep moving. The document stays readable while your instructions gather in the background.\n\nThe best notes are concrete. Keep a line when it earns its place. Reword it when the idea is right but the sentence is not. Cut it when it distracts from the point. Then send a clear map to Codex and get back a complete, revised draft.`

export const actions = [
  { label: 'Keep as is', color: 'green', emoji: '🟢' },
  { label: 'Reword this', color: 'yellow', emoji: '🟡' },
  { label: 'Wrong angle — rethink', color: 'orange', emoji: '🟠' },
  { label: 'Cut it', color: 'red', emoji: '🔴' },
  { label: 'Add more detail', color: 'blue', emoji: '🔵' },
  { label: 'Move elsewhere', color: 'purple', emoji: '🟣' },
  { label: 'Good but shorten', color: 'cyan', emoji: '🩵' },
  { label: 'Tone is off', color: 'pink', emoji: '🩷' },
  { label: 'Flag for review', color: 'black', emoji: '⚫' },
] as const

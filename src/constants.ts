export const initialDraft = ''

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

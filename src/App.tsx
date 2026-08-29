import { useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, Mic, RotateCcw, Send, Undo2, X } from 'lucide-react'
import { actions, initialDraft } from './constants'
import { buildCodexPrompt } from './PromptBuilder'
import type { Mark, SelectionState } from './types'

type SpeechWindow = Window & typeof globalThis & { webkitSpeechRecognition?: new () => SpeechRecognition; SpeechRecognition?: new () => SpeechRecognition }
interface SpeechRecognition extends EventTarget { continuous: boolean; interimResults: boolean; lang: string; start(): void; onresult: (event: SpeechRecognitionEvent) => void; onend: () => void }
interface SpeechRecognitionEvent { results: { [index: number]: { [index: number]: { transcript: string } } }; resultIndex: number }

function selectedOffsets(root: HTMLElement): SelectionState | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const before = range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  const text = range.toString()
  if (!text.trim()) return null
  const lastRect = Array.from(range.getClientRects()).at(-1) ?? range.getBoundingClientRect()
  return { start, end: start + text.length, x: lastRect.right, y: lastRect.bottom }
}

function MarkedDraft({ draft, marks }: { draft: string; marks: Mark[] }) {
  const points = [...new Set([0, draft.length, ...marks.flatMap((mark) => [mark.start, mark.end])])].sort((a, b) => a - b)
  return <>{points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]
    const mark = [...marks].reverse().find((item) => item.start <= start && item.end >= end)
    const text = draft.slice(start, end)
    return mark ? <mark key={`${start}-${end}`} className={`mark ${mark.color} ${mark.kind}`}>{text}</mark> : <span key={`${start}-${end}`}>{text}</span>
  })}</>
}

function ActionPopup({ selection, onApply, onClose }: { selection: SelectionState; onApply: (label: string, color: string, kind?: Mark['kind'], replacement?: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(false)
  const [direction, setDirection] = useState('')
  const [listening, setListening] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const maxX = Math.max(12, Math.min(selection.x, window.innerWidth - 340))
  const top = Math.max(78, selection.y + 10)
  const dictate = () => {
    const Recognition = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = false
    recognition.onresult = (event) => setDirection((value) => `${value}${value ? ' ' : ''}${event.results[event.resultIndex][0].transcript}`)
    recognition.onend = () => setListening(false)
    setListening(true); recognition.start()
  }
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose() }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [onClose])
  return <div className="popup" ref={ref} style={{ left: maxX, top }} role="dialog" aria-label="Mark selected text">
    <div className="popup-head"><span>Mark selection</span><button onClick={onClose} aria-label="Close"><X size={15} /></button></div>
    {!custom ? <div className="action-grid">{actions.map((action) => <button key={action.label} className="action" onClick={() => onApply(action.label, action.color)}><span>{action.emoji}</span>{action.label}</button>)}</div> : <div className="custom-form"><label htmlFor="direction">Your direction</label><div className="dictation"><input id="direction" autoFocus value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="e.g. Make this more direct" /><button onClick={dictate} className={listening ? 'listening' : ''} aria-label="Dictate direction"><Mic size={16} /></button></div><button className="apply exact" disabled={!direction.trim()} onClick={() => onApply('Custom edit', 'yellow', 'custom-exact', direction)}>Apply exactly as typed</button><button className="apply gist" disabled={!direction.trim()} onClick={() => onApply('Custom edit', 'purple', 'custom-gist', direction)}>Codex rewrites from gist</button></div>}
    {!custom && <button className="custom-toggle" onClick={() => setCustom(true)}><Eraser size={15} />Custom edit</button>}
  </div>
}

export default function App() {
  const [draft, setDraft] = useState(initialDraft)
  const [started, setStarted] = useState(false)
  const [marks, setMarks] = useState<Mark[]>([])
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const wordCount = useMemo(() => draft.trim() ? draft.trim().split(/\s+/).length : 0, [draft])
  const apply = (label: string, color: string, kind: Mark['kind'] = 'color', replacement?: string) => {
    if (!selection) return
    setMarks((items) => [...items, { id: crypto.randomUUID(), start: selection.start, end: selection.end, label, color, kind, replacement }])
    window.getSelection()?.removeAllRanges(); setSelection(null)
  }
  const send = () => {
    const prompt = buildCodexPrompt(draft, marks)
    window.open(`https://chatgpt.com/codex?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener,noreferrer')
  }
  if (!started) return <main className="landing"><section><div className="brand">CrispyDrafts</div><h1>Mark the draft.<br />Make the next pass count.</h1><p>Highlight the parts that need attention, then send Codex a precise map for the rewrite.</p><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Paste your draft here…" aria-label="Draft" /><div className="landing-footer"><span>{wordCount} words</span><button className="primary" onClick={() => setStarted(true)} disabled={!draft.trim()}>Start marking <Send size={16} /></button></div></section></main>
  return <div className="app-shell"><header className="toolbar"><button className="brand-btn" onClick={() => setStarted(false)}>CrispyDrafts</button><div className="toolbar-actions"><button onClick={() => setMarks((items) => items.slice(0, -1))} disabled={!marks.length}><Undo2 size={17} /> <span>Undo</span></button><button onClick={() => setMarks([])} disabled={!marks.length}><RotateCcw size={16} /> <span>Clear all</span></button><button className="primary send" onClick={send}><Send size={16} /> Send to Codex</button></div></header><main className="workspace"><article className="document"><div className="document-meta"><span>{wordCount} words</span><span>{draft.length.toLocaleString()} characters</span></div><div ref={editorRef} className="draft" onMouseUp={() => editorRef.current && setSelection(selectedOffsets(editorRef.current))} onKeyUp={() => editorRef.current && setSelection(selectedOffsets(editorRef.current))} role="textbox" aria-label="Marked draft"><MarkedDraft draft={draft} marks={marks} /></div></article></main>{selection && <ActionPopup selection={selection} onApply={apply} onClose={() => setSelection(null)} />}</div>
}

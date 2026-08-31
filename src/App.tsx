import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Eraser, LoaderCircle, Mic, Pencil, RotateCcw, Send, Sparkles, Undo2, X } from 'lucide-react'
import { actions, initialDraft } from './constants'
import { buildCodexPrompt, buildFollowUpPrompt, buildRevisionRequirements } from './PromptBuilder'
import type { Mark, RevisionRequirement, SelectionState } from './types'

type SpeechWindow = Window & typeof globalThis & { webkitSpeechRecognition?: new () => SpeechRecognition; SpeechRecognition?: new () => SpeechRecognition }
interface SpeechRecognition extends EventTarget { continuous: boolean; interimResults: boolean; lang: string; start(): void; onresult: (event: SpeechRecognitionEvent) => void; onend: () => void }
interface SpeechRecognitionEvent { results: { [index: number]: { [index: number]: { transcript: string } } }; resultIndex: number }
type RevisionState = { sourceDraft: string; text: string; history: string[] }

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
  const rects = Array.from(range.getClientRects())
  const lastRect = rects[rects.length - 1] ?? range.getBoundingClientRect()
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
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const ref = useRef<HTMLDivElement>(null)
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
  useLayoutEffect(() => {
    const popup = ref.current
    if (!popup) return
    const margin = 12
    const gap = 10
    const bounds = popup.getBoundingClientRect()
    const left = Math.max(margin, Math.min(selection.x, window.innerWidth - bounds.width - margin))
    const below = selection.y + gap
    const above = selection.y - bounds.height - gap
    const top = below + bounds.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, above)
    setPosition({
      left,
      top: Math.min(top, Math.max(margin, window.innerHeight - bounds.height - margin)),
    })
  }, [selection, custom])
  return <div className="popup" ref={ref} style={position} role="dialog" aria-label="Mark selected text">
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
  const [revision, setRevision] = useState<RevisionState | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [isRevising, setIsRevising] = useState(false)
  const [revisionError, setRevisionError] = useState('')
  const [copied, setCopied] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const wordCount = useMemo(() => draft.trim() ? draft.trim().split(/\s+/).length : 0, [draft])
  const updateDraft = (value: string) => {
    setDraft(value)
    setMarks([])
    setSelection(null)
    setRevision(null)
  }
  const apply = (label: string, color: string, kind: Mark['kind'] = 'color', replacement?: string) => {
    if (!selection) return
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setMarks((items) => [...items, { id, start: selection.start, end: selection.end, label, color, kind, replacement }])
    window.getSelection()?.removeAllRanges(); setSelection(null)
  }
  const runRevision = async (prompt: string, base: RevisionState, requirements: RevisionRequirement[] = []) => {
    if (isRevising) return
    const previousText = base.text
    const pendingState = {
      ...base,
      text: '',
      history: previousText ? [...base.history, previousText] : base.history,
    }
    setSelection(null)
    setRevisionError('')
    setIsRevising(true)
    setRevision(pendingState)

    try {
      const response = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, requirements }),
      })

      if (!response.ok) {
        const details = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(details?.error || 'Codex could not revise this draft.')
      }
      if (!response.body) throw new Error('Codex returned an empty response.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let nextText = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        nextText += decoder.decode(value, { stream: true })
        setRevision((current) => current ? { ...current, text: nextText } : current)
      }
      nextText += decoder.decode()
      if (!nextText.trim()) throw new Error('Codex did not return a revised draft. Please try again.')
      setRevision((current) => current ? { ...current, text: nextText } : current)
    } catch (error) {
      setRevision(base)
      setRevisionError(error instanceof Error ? error.message : 'Codex could not revise this draft.')
    } finally {
      setIsRevising(false)
    }
  }
  const startRevision = () => {
    void runRevision(buildCodexPrompt(draft, marks), { sourceDraft: draft, text: '', history: [] }, buildRevisionRequirements(draft, marks))
  }
  const reviseAgain = () => {
    if (!revision?.text.trim() || !followUp.trim()) return
    const prompt = buildFollowUpPrompt(revision.text, followUp)
    setFollowUp('')
    void runRevision(prompt, revision)
  }
  const useRevision = () => {
    if (!revision?.text.trim()) return
    updateDraft(revision.text)
    setStarted(true)
  }
  const copyRevision = async () => {
    if (!revision?.text) return
    await navigator.clipboard.writeText(revision.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  if (!started) return <main className="landing"><section><div className="brand">CrispyDrafts</div><h1>Mark the draft.<br />Make the next pass count.</h1><p>Paste or type your writing below, then highlight the parts that need attention.</p><textarea autoFocus value={draft} onChange={(event) => updateDraft(event.target.value)} placeholder="Paste or type your draft here…" aria-label="Draft" /><div className="landing-footer"><span>{wordCount} words</span><button className="primary" onClick={() => setStarted(true)} disabled={!draft.trim()}>Start marking <Send size={16} /></button></div></section></main>
  if (revision) return <div className="app-shell revision-shell">
    <header className="toolbar"><button className="brand-btn" onClick={() => setRevision(null)} disabled={isRevising}>CrispyDrafts</button><div className="toolbar-actions revision-actions"><button aria-label="Back to marks" onClick={() => setRevision(null)} disabled={isRevising}><Pencil size={16} /> <span>Back to marks</span></button><button aria-label="Undo revision" onClick={() => setRevision((current) => current?.history.length ? { ...current, text: current.history.at(-1) ?? '', history: current.history.slice(0, -1) } : current)} disabled={!revision.history.length || isRevising}><Undo2 size={17} /> <span>Undo revision</span></button><button aria-label={copied ? 'Copied' : 'Copy revised draft'} onClick={() => void copyRevision()} disabled={!revision.text || isRevising}>{copied ? <Check size={16} /> : <Clipboard size={16} />} <span>{copied ? 'Copied' : 'Copy'}</span></button><button aria-label="Use revision as draft" className="primary use-revision" onClick={useRevision} disabled={!revision.text.trim() || isRevising}><Check size={16} /> Use as draft</button></div></header>
    <main className="revision-workspace">
      <section className="revision-intro"><div><span className="eyebrow">In-page revision</span><h1>Your next pass, without leaving.</h1><p>Edit the result directly or give Codex another instruction below.</p></div><div className={`revision-status ${isRevising ? 'working' : ''}`}>{isRevising ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}<span>{isRevising ? (marks.length ? 'Revising and checking every mark…' : 'Revising…') : (marks.length ? 'Every mark checked' : 'Revision ready')}</span></div></section>
      <div className="revision-grid">
        <article className="revision-panel source-panel"><div className="panel-head"><span>Marked draft</span><span>{revision.sourceDraft.trim().split(/\s+/).length} words</span></div><div className="source-copy"><MarkedDraft draft={revision.sourceDraft} marks={marks} /></div></article>
        <section className="revision-panel result-panel"><div className="panel-head"><span>Revised draft</span><span>{revision.text.trim() ? revision.text.trim().split(/\s+/).length : 0} words</span></div><div className="result-editor-wrap">{isRevising && !revision.text && <div className="revision-placeholder"><LoaderCircle size={20} className="spin" /><span>Applying and checking every mark…</span></div>}<textarea className="revised-editor" value={revision.text} onChange={(event) => setRevision((current) => current ? { ...current, text: event.target.value } : current)} readOnly={isRevising} aria-label="Revised draft" placeholder={isRevising ? '' : 'The revised draft will appear here.'} /></div></section>
      </div>
      <section className="iteration-box"><div><span className="eyebrow">Another pass</span><h2>What should Codex change next?</h2><p>The current revised draft stays intact until the next version is ready.</p></div><div className="follow-up-control"><textarea value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="e.g. Make it warmer and cut about 15%" aria-label="Follow-up revision direction" disabled={isRevising || !revision.text} /><button className="primary" onClick={reviseAgain} disabled={isRevising || !revision.text || !followUp.trim()}>{isRevising ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} Revise again</button></div>{revisionError && <div className="revision-error" role="alert"><span>{revisionError}</span>{!revision.text && <button onClick={startRevision}>Try again</button>}</div>}</section>
    </main>
  </div>
  return <div className="app-shell"><header className="toolbar"><button className="brand-btn" onClick={() => setStarted(false)}>CrispyDrafts</button><div className="toolbar-actions"><button aria-label="Edit draft" onClick={() => { setSelection(null); setStarted(false) }}><Pencil size={16} /> <span>Edit draft</span></button><button aria-label="Undo last mark" onClick={() => setMarks((items) => items.slice(0, -1))} disabled={!marks.length}><Undo2 size={17} /> <span>Undo</span></button><button aria-label="Clear all marks" onClick={() => setMarks([])} disabled={!marks.length}><RotateCcw size={16} /> <span>Clear all</span></button><button aria-label="Revise here" className="primary send" onClick={startRevision} disabled={isRevising}><Sparkles size={16} /> Revise here</button></div></header><main className="workspace"><article className="document"><div className="document-meta"><span>{wordCount} words</span><span>{draft.length.toLocaleString()} characters</span></div><div ref={editorRef} className="draft" onMouseUp={() => editorRef.current && setSelection(selectedOffsets(editorRef.current))} onKeyUp={() => editorRef.current && setSelection(selectedOffsets(editorRef.current))} role="textbox" aria-label="Marked draft"><MarkedDraft draft={draft} marks={marks} /></div></article></main>{selection && <ActionPopup selection={selection} onApply={apply} onClose={() => setSelection(null)} />}</div>
}

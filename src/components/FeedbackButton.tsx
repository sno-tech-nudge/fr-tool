import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Bug, ChevronLeft, Lightbulb, MessageSquarePlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAccess } from '../lib/accessContext'
import { Button, Textarea, useToast } from './ui'

type Kind = 'bug' | 'feature'

const COPY: Record<Kind, { title: string; prompt: string }> = {
  bug: { title: 'Report a bug', prompt: 'What happened, and what did you expect to happen?' },
  feature: { title: 'Suggest a feature', prompt: 'What would you like to be able to do?' },
}

/**
 * A "Send feedback" item in the sidebar for the testing period: anyone signed in can report
 * a bug or suggest a feature without leaving the page. It saves to fr_feedback
 * (read by super admins under Configuration → Feedback) together with who sent
 * it and which page they were on, so reports arrive with their context.
 *
 * The panel opens beside the sidebar, fixed to the viewport, so the sidebar's
 * own scrolling cannot clip it and it never covers the page's buttons.
 *
 * Hide it for everyone by setting VITE_FEEDBACK_BUTTON=off at build time, or
 * remove the <FeedbackButton /> line from the sidebar.
 */
export function FeedbackButton() {
  const toast = useToast()
  const { email } = useAuth()
  const access = useAccess()
  const href = useRouterState({ select: (s) => s.location.href })
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // Where the panel sits: just right of the sidebar, its foot level with the button's.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  function openPanel() {
    const r = trigger.current?.getBoundingClientRect()
    const sidebar = trigger.current?.closest('.sidebar')?.getBoundingClientRect()
    if (r) setPos({ left: (sidebar?.right ?? r.right) + 12, bottom: Math.max(12, window.innerHeight - r.bottom) })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if ((import.meta.env as Record<string, string | undefined>).VITE_FEEDBACK_BUTTON === 'off') return null
  if (!email) return null

  function close() {
    setOpen(false)
    setKind(null)
    setMessage('')
  }

  async function send() {
    if (!kind) return
    if (!message.trim()) { toast.error('Add a few words first.'); return }
    setBusy(true)
    // No .select(): only super admins can read this table back, so asking for
    // the new row would fail for everyone else.
    const { error } = await supabase.from('fr_feedback').insert({
      employee_id: access.employeeId,
      email,
      kind,
      message: message.trim(),
      page: href,
      user_agent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
    })
    setBusy(false)
    if (error) { toast.error(`Could not send: ${error.message}`); return }
    toast.success('Thank you — your feedback was sent.')
    close()
  }

  return (
    <div className="feedback" ref={box}>
      {open ? (
        <div className="feedback__panel" role="dialog" aria-label="Send feedback" style={pos ?? undefined}>
          {kind === null ? (
            <>
              <div className="feedback__head">
                <span className="feedback__title">What is it?</span>
                <button type="button" className="feedback__x" aria-label="Close" onClick={close}><X size={15} /></button>
              </div>
              <button type="button" className="feedback__choice" onClick={() => setKind('bug')}>
                <Bug size={16} /> Report a bug
              </button>
              <button type="button" className="feedback__choice" onClick={() => setKind('feature')}>
                <Lightbulb size={16} /> Suggest a feature
              </button>
            </>
          ) : (
            <>
              <div className="feedback__head">
                <button type="button" className="feedback__back" onClick={() => setKind(null)}>
                  <ChevronLeft size={15} /> {COPY[kind].title}
                </button>
                <button type="button" className="feedback__x" aria-label="Close" onClick={close}><X size={15} /></button>
              </div>
              <Textarea
                rows={5}
                autoFocus
                aria-label={COPY[kind].title}
                placeholder={COPY[kind].prompt}
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
              />
              <p className="feedback__meta">Sent with your name, this page and your browser details.</p>
              <div className="feedback__actions">
                <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                <Button size="sm" onClick={() => void send()} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <button
        ref={trigger}
        type="button"
        className="navlink feedback__item"
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        title="Send feedback"
      >
        <MessageSquarePlus size={16} />
        <span>Send feedback</span>
      </button>
    </div>
  )
}

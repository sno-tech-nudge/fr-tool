import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Check, Mail, MessageSquare, Mic, Phone, StickyNote } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, EmptyState, Input, Select, Skeleton, Textarea, useToast,
} from './ui'
import { ACTIVITY_TYPES, type ActivityParentType } from '../lib/enums'
import { formatDateTime } from '../lib/format'
import { useAccess } from '../lib/accessContext'
import { useEmployees } from '../hooks/useEmployees'
import { useSpeechInput } from '../hooks/useSpeechInput'

type Activity = {
  id: string
  activity_type: string
  parent_type: string
  parent_id: string
  subject: string | null
  body: string | null
  activity_date: string
  assignee_user_id: string | null
  task_status: string | null
  created_by: string | null
}

const ICONS: Record<string, React.ReactNode> = {
  meeting: <CalendarDays size={14} />,
  call: <Phone size={14} />,
  email: <Mail size={14} />,
  note: <StickyNote size={14} />,
  task: <Check size={14} />,
}

/**
 * One polymorphic feed serving organisations, contacts, opportunities, grants
 * and leads, keyed on (parent_type, parent_id).
 *
 * Logging must stay under ~30 seconds (PRD G4), so the composer is a single
 * always-visible row rather than a modal.
 */
export function ActivityFeed({
  parentType, parentId,
}: {
  parentType: ActivityParentType
  parentId: string
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()

  const [items, setItems] = useState<Activity[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [type, setType] = useState('note')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)

  // The phrase being spoken right now. Shown in the field but deliberately
  // kept out of `body` — it rewrites itself until the recogniser settles.
  const [interim, setInterim] = useState('')

  // Dictated phrases append to whatever is already typed, so speaking and
  // typing can be mixed freely.
  const speech = useSpeechInput({
    onText: (text) => setBody((prev) => (prev ? `${prev.trimEnd()} ${text}` : text)),
    onInterim: setInterim,
  })
  const { error: speechError, clearError: clearSpeechError } = speech
  useEffect(() => {
    if (!speechError) return
    toast.error(speechError)
    clearSpeechError()
  }, [speechError, clearSpeechError, toast])

  function toggleDictation() {
    if (!speech.supported) {
      toast.error('Dictation needs Chrome or Edge — this browser has no speech recognition.')
      return
    }
    speech.toggle()
  }

  const load = useCallback(async () => {
    setItems(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_activities')
      .select('id, activity_type, parent_type, parent_id, subject, body, activity_date, assignee_user_id, task_status, created_by')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .is('deleted_at', null)
      .order('activity_date', { ascending: false })
      .limit(100)
    if (err) { setError(err.message); setItems([]); return }
    setItems((data ?? []) as Activity[])
  }, [parentType, parentId])

  useEffect(() => { void load() }, [load])

  async function log() {
    if (!subject.trim()) { toast.error('Add a subject.'); return }
    setBusy(true)
    // A phrase still being transcribed is on screen, so it has to be saved too.
    const written = interim ? (body ? `${body.trimEnd()} ${interim}` : interim) : body
    const payload: Record<string, unknown> = {
      activity_type: type,
      parent_type: parentType,
      parent_id: parentId,
      subject: subject.trim(),
      body: written.trim() || null,
      activity_date: new Date().toISOString(),
      created_by: access.employeeId,
      // task_status only applies to tasks; leave null otherwise.
      task_status: type === 'task' ? 'open' : null,
      assignee_user_id: type === 'task' ? (assignee || access.employeeId) : null,
    }
    const { data, error: err } = await supabase
      .from('fr_activities').insert(payload).select().single()
    setBusy(false)
    if (err) { toast.error(err.message); return }
    setItems((prev) => [data as Activity, ...(prev ?? [])])
    setSubject('')
    setBody('')
    setInterim('')
    setAssignee('')
    toast.success('Logged.')
  }

  async function toggleTask(a: Activity) {
    const next = a.task_status === 'done' ? 'open' : 'done'
    const { data, error: err } = await supabase
      .from('fr_activities').update({ task_status: next }).eq('id', a.id).select().single()
    if (err) { toast.error(err.message); return }
    setItems((prev) => (prev ?? []).map((x) => (x.id === a.id ? (data as Activity) : x)))
  }

  const nameOf = (id: string | null) =>
    id ? (employees.find((e) => e.id === id)?.name ?? null) : null

  return (
    <div className="stack">
      <div className="card stack">
        <div className="pillrow" role="radiogroup" aria-label="Activity type">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className="pill"
              data-active={type === t.value}
              aria-pressed={type === t.value}
              onClick={() => setType(t.value)}
            >
              {ICONS[t.value]}
              {t.label}
            </button>
          ))}
        </div>

        <Input
          placeholder="Subject"
          aria-label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void log() } }}
        />

        {type === 'task' ? (
          <Select label="Assignee" value={assignee} onChange={(e) => setAssignee(e.currentTarget.value)}>
            <option value="">Me</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        ) : null}

        <div className="dictate">
          <Textarea
            value={interim ? (body ? `${body.trimEnd()} ${interim}` : interim) : body}
            placeholder="Body (optional)"
            aria-label="Body"
            onChange={(e) => { setInterim(''); setBody(e.currentTarget.value) }}
          />
          <div
            className="dictate__halo"
            ref={speech.meterRef}
            data-listening={speech.listening}
            aria-hidden="true"
          >
            <span /><span /><span />
          </div>
          <button
            type="button"
            className="dictate__mic"
            data-listening={speech.listening}
            onClick={toggleDictation}
            aria-label={speech.listening ? 'Stop dictation' : 'Dictate the body'}
            title={speech.listening ? 'Stop dictation' : 'Dictate the body'}
          >
            <Mic size={14} />
          </button>
          <span className="sr-only" aria-live="polite">
            {speech.listening ? 'Listening' : ''}
          </span>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => void log()} disabled={busy}>{busy ? 'Saving…' : 'Log activity'}</Button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load activity"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : items === null ? (
        <div className="card stack">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={34} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="Nothing logged yet" body="Meetings, calls, emails and notes on this record will appear here." />
        </div>
      ) : (
        <div className="card">
          <div className="feed">
            {items.map((a) => (
              <article key={a.id} className="feeditem">
                <span className="feeditem__icon" aria-hidden="true">
                  {ICONS[a.activity_type] ?? <MessageSquare size={14} />}
                </span>
                <div>
                  <div className="feeditem__head">
                    <span className="feeditem__subject">{a.subject}</span>
                    {a.task_status ? (
                      <button
                        onClick={() => void toggleTask(a)}
                        style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}
                        aria-label={a.task_status === 'done' ? 'Reopen task' : 'Mark task done'}
                      >
                        <Badge tone={a.task_status === 'done' ? 'green' : 'amber'} dot>
                          {a.task_status}
                        </Badge>
                      </button>
                    ) : (
                      <Badge tone="outline">{a.activity_type}</Badge>
                    )}
                    <span className="feeditem__when tn-num">{formatDateTime(a.activity_date)}</span>
                    {nameOf(a.assignee_user_id) ? (
                      <span className="feeditem__when">· {nameOf(a.assignee_user_id)}</span>
                    ) : null}
                  </div>
                  {a.body ? <p className="feeditem__body">{a.body}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

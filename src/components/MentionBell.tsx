import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AtSign, Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAccess } from '../lib/accessContext'
import { timeAgo } from '../lib/format'

/**
 * The bell in the top right: notes where someone tagged you with "@". Kept
 * apart from the stage nudges on the home page, which are about deals going
 * quiet rather than about people asking for you.
 */

type Mention = {
  id: string
  title: string
  body: string | null
  parent_type: string | null
  parent_id: string | null
  external_ref: string | null
  created_at: string
  read_at: string | null
}

const POLL_MS = 60_000

/** Same untyped-search workaround as useUrlFilters. */
type LooseNavigate = (opts: { to: string; params?: Record<string, string>; search?: Record<string, string> }) => void

export function MentionBell() {
  const access = useAccess()
  const navigate = useNavigate() as unknown as LooseNavigate
  const [items, setItems] = useState<Mention[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!access.employeeId) return
    const { data } = await supabase
      .from('fr_notifications')
      .select('id, title, body, parent_type, parent_id, external_ref, created_at, read_at')
      .eq('recipient_user_id', access.employeeId)
      .eq('category', 'mention')
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(30)
    setItems((data ?? []) as Mention[])
  }, [access.employeeId])

  // Checked on load, every minute, and whenever the tab comes back into view.
  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), POLL_MS)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(id); window.removeEventListener('focus', onFocus) }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const unread = items.filter((m) => !m.read_at).length

  async function markRead(ids: string[]) {
    if (ids.length === 0) return
    const stamp = new Date().toISOString()
    setItems((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: m.read_at ?? stamp } : m)))
    await supabase.from('fr_notifications').update({ read_at: stamp }).in('id', ids)
  }

  function go(m: Mention) {
    void markRead(m.read_at ? [] : [m.id])
    setOpen(false)
    if (!m.parent_id) return
    const fromActivity = m.external_ref?.startsWith('mention:activity') ?? false
    const tab = fromActivity ? { tab: 'activity' } : undefined
    switch (m.parent_type) {
      case 'opportunity': navigate({ to: '/opportunities/$id', params: { id: m.parent_id }, search: tab }); break
      case 'grant': navigate({ to: '/grants/$id', params: { id: m.parent_id }, search: tab }); break
      case 'organisation': navigate({ to: '/organisations/$id', params: { id: m.parent_id }, search: tab }); break
      case 'contact': navigate({ to: '/contacts', search: { contact: m.parent_id } }); break
      case 'lead': navigate({ to: '/leads', search: { status: 'all', lead: m.parent_id } }); break
    }
  }

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="bell__button"
        aria-label={unread ? `Mentions, ${unread} unread` : 'Mentions'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={18} />
        {unread > 0 ? <span className="bell__count tn-num">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="bell__panel" role="dialog" aria-label="Mentions">
          <div className="bell__head">
            <span className="tn-micro">Mentions</span>
            {unread > 0 ? (
              <button type="button" className="bell__markall" onClick={() => void markRead(items.filter((m) => !m.read_at).map((m) => m.id))}>
                Mark all read
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="bell__empty">No mentions yet.</p>
          ) : (
            <ul className="bell__list">
              {items.map((m) => (
                <li key={m.id}>
                  <button type="button" className="bell__item" data-unread={!m.read_at || undefined} onClick={() => go(m)}>
                    <AtSign size={14} className="bell__icon" aria-hidden="true" />
                    <span className="bell__text">
                      <span className="bell__title">{m.title}</span>
                      {m.body ? <span className="bell__body">{m.body}</span> : null}
                      <span className="bell__when tn-num">{timeAgo(m.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

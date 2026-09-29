import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BellOff, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, Skeleton } from '../ui'
import { formatDateTime } from '../../lib/format'
import { severityTone } from '../../lib/notifications'
import { useAccess } from '../../lib/accessContext'
import { HomeCard } from './HomeCard'

/**
 * Everything waiting for this person, newest first.
 *
 * Rows are written by whatever raises the notification, not by this component
 * — it only reads, marks read, and dismisses. Nothing writes them yet, so an
 * empty rail is the correct state until the nudge job exists.
 */

type Notification = {
  id: string
  category: string
  severity: string | null
  title: string
  body: string | null
  parent_type: string | null
  parent_id: string | null
  created_at: string
  read_at: string | null
}

/** Only these three have a detail route worth jumping to. */
function target(n: Notification): { to: string; id: string } | null {
  if (!n.parent_id) return null
  if (n.parent_type === 'opportunity') return { to: '/opportunities/$id', id: n.parent_id }
  if (n.parent_type === 'grant') return { to: '/grants/$id', id: n.parent_id }
  if (n.parent_type === 'organisation') return { to: '/organisations/$id', id: n.parent_id }
  return null
}

export function NotificationsRail() {
  const access = useAccess()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!access.employeeId) return
    setItems(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_notifications')
      .select('id, category, severity, title, body, parent_type, parent_id, created_at, read_at')
      .eq('recipient_user_id', access.employeeId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(20)
    if (err) { setError(err.message); setItems([]); return }
    setItems((data ?? []) as Notification[])
  }, [access.employeeId])

  useEffect(() => { void load() }, [load])

  async function dismiss(id: string) {
    setItems((prev) => (prev ?? []).filter((n) => n.id !== id))
    const { error: err } = await supabase
      .from('fr_notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id)
    if (err) void load()
  }

  async function markAllRead() {
    const unread = (items ?? []).filter((n) => !n.read_at).map((n) => n.id)
    if (unread.length === 0) return
    const stamp = new Date().toISOString()
    setItems((prev) => (prev ?? []).map((n) => (n.read_at ? n : { ...n, read_at: stamp })))
    await supabase.from('fr_notifications').update({ read_at: stamp }).in('id', unread)
  }

  const unread = (items ?? []).filter((n) => !n.read_at).length

  return (
    <HomeCard
      title="Notifications"
      meta={unread > 0 ? <Badge tone="brown">{unread}</Badge> : null}
      action={unread > 0 ? (
        <Button size="sm" variant="ghost" iconLeft={<Check size={14} />} onClick={() => void markAllRead()}>
          Mark read
        </Button>
      ) : null}
      footer={
        <Link to="/admin/notifications" className="celllink" style={{ fontSize: 'var(--text-sm)' }}>
          Notification settings
        </Link>
      }
    >

      {items === null ? (
        <div className="stack">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={40} />)}
        </div>
      ) : error ? (
        <EmptyState
          title="Notifications are not switched on"
          body={`${error} — the fr_notifications table may not exist yet.`}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing needs you"
          body="Stage nudges, instalments and reports falling due will appear here."
        />
      ) : (
        <div className="feed">
          {items.map((n) => {
            const link = target(n)
            return (
              <article key={n.id} className="notif" data-unread={!n.read_at || undefined}>
                <div className="feeditem__head">
                  {link ? (
                    <Link to={link.to} params={{ id: link.id }} className="feeditem__subject celllink">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="feeditem__subject">{n.title}</span>
                  )}
                  {n.severity ? <Badge tone={severityTone(n.severity)}>{n.severity}</Badge> : null}
                </div>
                {n.body ? <p className="feeditem__body">{n.body}</p> : null}
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="feeditem__when tn-num">{formatDateTime(n.created_at)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<BellOff size={13} />}
                    onClick={() => void dismiss(n.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </HomeCard>
  )
}

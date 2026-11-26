import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BellOff, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, ConfirmDialog, EmptyState, Skeleton, useToast } from '../ui'
import { formatDateTime } from '../../lib/format'
import { severityTone } from '../../lib/notifications'
import { useAccess } from '../../lib/accessContext'
import { HomeSection } from './HomeSection'

/**
 * Everything waiting for this person, newest first.
 *
 * Rows are written by whatever raises the notification (the daily stage-nudge
 * job), not by this component — it only reads, marks read, and dismisses.
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

/** Where a notification leads: a record's page, or for a receipt, finance's queue. */
function target(n: Notification): { to: string; params?: { id: string }; search?: Record<string, string> } | null {
  if (n.category === 'receipt_to_confirm') return { to: '/grants', search: { view: 'receipts', receipt: 'awaiting' } }
  if (!n.parent_id) return null
  if (n.category === 'tranche_due' && n.parent_type === 'grant') return { to: '/grants/$id', params: { id: n.parent_id }, search: { tab: 'money' } }
  if (n.parent_type === 'opportunity') return { to: '/opportunities/$id', params: { id: n.parent_id } }
  if (n.parent_type === 'grant') return { to: '/grants/$id', params: { id: n.parent_id } }
  if (n.parent_type === 'organisation') return { to: '/organisations/$id', params: { id: n.parent_id } }
  return null
}

export function NotificationsRail() {
  const access = useAccess()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  // All open notifications, not just the 20 shown.
  const [total, setTotal] = useState(0)
  const [confirmAll, setConfirmAll] = useState(false)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    if (!access.employeeId) return
    setItems(null)
    setError(null)
    const { data, error: err, count } = await supabase
      .from('fr_notifications')
      .select('id, category, severity, title, body, parent_type, parent_id, created_at, read_at', { count: 'exact' })
      .eq('recipient_user_id', access.employeeId)
      // Mentions live in the bell, not here.
      .neq('category', 'mention')
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(20)
    if (err) { setError(err.message); setItems([]); return }
    setItems((data ?? []) as Notification[])
    setTotal(count ?? 0)
  }, [access.employeeId])

  useEffect(() => { void load() }, [load])

  async function dismiss(id: string) {
    setItems((prev) => (prev ?? []).filter((n) => n.id !== id))
    setTotal((t) => Math.max(0, t - 1))
    // A write that RLS blocks returns no error, just no rows, so read the row
    // back to know the dismiss really landed.
    const { data, error: err } = await supabase
      .from('fr_notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, dismissed_at')
    if (err || !data?.length || !data[0].dismissed_at) {
      toast.error(`Could not dismiss: ${err?.message ?? 'the change was not saved'}`)
      void load()
    }
  }

  async function dismissAll() {
    if (!access.employeeId) return
    setClearing(true)
    const { data, error: err } = await supabase
      .from('fr_notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('recipient_user_id', access.employeeId)
      .neq('category', 'mention')
      .is('dismissed_at', null)
      .select('id')
    setClearing(false)
    setConfirmAll(false)
    if (err) { toast.error(`Could not dismiss: ${err.message}`); return }
    toast.success(`Dismissed ${data?.length ?? 0}`)
    setItems([])
    setTotal(0)
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
    <HomeSection
      title="Reminders"
      meta={unread > 0 ? <Badge tone="brown">{unread}</Badge> : null}
      action={
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          {unread > 0 ? (
            <Button size="sm" variant="ghost" iconLeft={<Check size={14} />} onClick={() => void markAllRead()}>
              Mark read
            </Button>
          ) : null}
          {total > 0 ? (
            <Button size="sm" variant="ghost" iconLeft={<BellOff size={14} />} onClick={() => setConfirmAll(true)}>
              Dismiss all
            </Button>
          ) : null}
          <Link to="/admin/notifications" className="celllink" style={{ fontSize: 'var(--text-sm)' }}>
            Notification settings
          </Link>
        </div>
      }
    >
      <ConfirmDialog
        open={confirmAll}
        title={`Dismiss all ${total} reminders?`}
        confirmLabel="Dismiss all"
        busy={clearing}
        onConfirm={() => void dismissAll()}
        onCancel={() => setConfirmAll(false)}
      />
      {items === null ? (
        <div className="card stack">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={36} />)}
        </div>
      ) : error ? (
        <div className="card">
          <EmptyState
            title="Reminders are not switched on"
            body={`${error} — the fr_notifications table may not exist yet.`}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing needs you"
            body="Stage nudges, instalments and reports falling due will appear here."
          />
        </div>
      ) : (
        <div className="tablewrap homesec__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Reminder</th>
                <th>Details</th>
                <th style={{ width: '90px' }}>Level</th>
                <th style={{ width: '170px' }}>When</th>
                <th className="col-actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => {
                const link = target(n)
                return (
                  <tr key={n.id} data-unread={!n.read_at || undefined} data-read={n.read_at ? true : undefined}>
                    <td>
                      {link ? (
                        <Link to={link.to} params={link.params as never} search={link.search as never} className="celllink">{n.title}</Link>
                      ) : n.title}
                    </td>
                    <td className="muted">{n.body ?? '—'}</td>
                    <td>
                      {n.severity
                        ? <Badge tone={severityTone(n.severity)}>{n.severity}</Badge>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(n.created_at)}</td>
                    <td className="col-actions">
                      <Button size="sm" variant="ghost" iconLeft={<BellOff size={13} />} onClick={() => void dismiss(n.id)}>
                        Dismiss
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </HomeSection>
  )
}

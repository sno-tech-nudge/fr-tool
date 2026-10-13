import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, TableSkeleton, useToast } from '../ui'
import { formatDateTime } from '../../lib/format'

type Row = {
  id: string
  created_at: string
  email: string
  kind: 'bug' | 'feature'
  message: string
  page: string | null
  user_agent: string | null
  viewport: string | null
  employees: { name: string } | null
}

/**
 * What testers have sent through the floating Send feedback button. Marking a
 * report done deletes it, so the table only ever holds what is still open.
 */
export function FeedbackInbox() {
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_feedback')
      .select('id, created_at, email, kind, message, page, user_agent, viewport, employees(name)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as Row[])
  }, [])

  useEffect(() => { void load() }, [load])

  async function markDone(id: string) {
    // .select() so a delete the database refused shows up as zero rows rather
    // than silently doing nothing.
    const { data, error: err } = await supabase.from('fr_feedback').delete().eq('id', id).select('id')
    if (err) { toast.error(err.message); return }
    if (!data || data.length === 0) { toast.error('Could not delete it — are you a super admin?'); return }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id))
    toast.success('Marked done and deleted.')
  }

  return (
    <div className="stack">
      <div>
        <h2 className="page__title">Feedback</h2>
        <p className="page__sub">
          Bugs and ideas sent from the Send feedback button. Marking one done deletes it.
          {rows && rows.length > 0 ? ` ${rows.length} open.` : ''}
        </p>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load feedback"
            body={`${error} — the fr_feedback table may not exist yet.`}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={4} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Nothing open" body="Reports from testers appear here as they send them." />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '100px' }}>Type</th>
                <th>Message</th>
                <th style={{ width: '210px' }}>From</th>
                <th style={{ width: '170px' }}>Page</th>
                <th style={{ width: '170px' }}>When</th>
                <th className="col-actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Badge tone={r.kind === 'bug' ? 'red' : 'brown'}>{r.kind === 'bug' ? 'Bug' : 'Feature'}</Badge></td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{r.message}</td>
                  <td>
                    {r.employees?.name ?? r.email}
                    <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{r.email}</div>
                  </td>
                  <td
                    className="muted"
                    style={{ wordBreak: 'break-all', fontSize: 'var(--text-xs)' }}
                    title={`${r.user_agent ?? ''} ${r.viewport ?? ''}`}
                  >
                    {r.page ?? '—'}
                  </td>
                  <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</td>
                  <td className="col-actions">
                    <Button size="sm" variant="ghost" onClick={() => void markDone(r.id)}>Mark done</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

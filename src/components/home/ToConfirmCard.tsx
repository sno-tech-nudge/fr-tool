import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { Button, ConfirmDialog, EmptyState, Skeleton, useToast } from '../ui'
import { formatDate, formatMoney } from '../../lib/format'
import { useAccess } from '../../lib/accessContext'
import { confirmReceipt } from '../../lib/payments'
import { HomeSection } from './HomeSection'

/**
 * Finance's queue at a glance: the oldest receipts nobody has yet checked
 * against the bank, and how much is waiting. The full list, with filters and
 * confirming in bulk, is Grants → Receipts.
 */

type Row = {
  id: string
  grant_id: string
  org_name: string | null
  sequence_no: number | null
  received_date: string | null
  amount: number
  currency: string
  amount_inr: number
  bank_label: string | null
  reference_number: string | null
  recorded_by_name: string | null
}

const TOP = 5

export function ToConfirmCard() {
  const toast = useToast()
  const access = useAccess()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [waiting, setWaiting] = useState<{ count: number; sum: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Row | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    const unconfirmed = (cols: string) => supabase.from('v_fr_remittance_facts').select(cols).eq('confirmed_by_finance', false)
    const [list, agg] = await Promise.all([
      unconfirmed('id, grant_id, org_name, sequence_no, received_date, amount, currency, amount_inr, bank_label, reference_number, recorded_by_name')
        .order('received_date', { ascending: true })
        .limit(TOP),
      // Summed in the database: the queue can be longer than one read.
      unconfirmed('amount_inr.sum(), id.count()'),
    ])
    if (list.error) { setError(list.error.message); setRows([]); return }
    setRows((list.data ?? []) as unknown as Row[])
    const a = (agg.data as unknown as Array<{ sum: number | null; count: number }> | null)?.[0]
    setWaiting({ count: Number(a?.count ?? 0), sum: Number(a?.sum ?? 0) })
  }, [])

  useEffect(() => { void load() }, [load])

  async function confirm(r: Row) {
    setConfirming(null)
    setBusyId(r.id)
    const { error: err } = await confirmReceipt(r.id, access.employeeId)
    setBusyId(null)
    if (err) { toast.error(err.message); return }
    toast.success('Confirmed and locked.')
    void load()
  }


  return (
    <HomeSection
      title="Receipts to confirm"
      sub={waiting && waiting.count > 0 ? (
        <span className="tn-num">
          <strong>{formatMoney(waiting.sum)}</strong> across {waiting.count} {waiting.count === 1 ? 'receipt' : 'receipts'}
        </span>
      ) : null}
      action={
        <Link to="/grants" search={{ view: 'receipts', receipt: 'awaiting' } as never} className="celllink" style={{ fontSize: 'var(--text-sm)' }}>
          All receipts
        </Link>
      }
    >
      {error ? (
        <div className="card"><EmptyState title="Could not load receipts" body={error} /></div>
      ) : rows === null ? (
        <div className="card stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={32} />)}</div>
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="All receipts are confirmed" /></div>
      ) : (
        <div className="tablewrap homesec__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Donor</th>
                <th style={{ width: '110px' }}>Received</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Amount</th>
                <th style={{ width: '120px' }}>Into</th>
                <th style={{ width: '150px' }}>Reference</th>
                <th style={{ width: '140px' }}>Recorded by</th>
                <th className="col-actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to="/grants/$id" params={{ id: r.grant_id }} search={{ tab: 'money' } as never} className="celllink">
                      {r.org_name ?? 'Grant'}
                    </Link>
                    {r.sequence_no ? <span className="faint"> · instalment {r.sequence_no}</span> : null}
                  </td>
                  <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.received_date)}</td>
                  <td className="tn-num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatMoney(r.amount_inr)}
                    {r.currency !== 'INR' ? <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>{r.currency} {r.amount}</div> : null}
                  </td>
                  <td className="muted">{r.bank_label ?? '—'}</td>
                  <td className="muted">{r.reference_number ?? '—'}</td>
                  <td className="muted">{r.recorded_by_name ?? '—'}</td>
                  <td className="col-actions">
                    <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => setConfirming(r)}>
                      Confirm
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title="Confirm and lock this receipt?"
        body="Check it against the bank statement first. It becomes read-only; only a manager can unlock it, in the database."
        confirmLabel="Confirm and lock"
        onCancel={() => setConfirming(null)}
        onConfirm={() => { if (confirming) void confirm(confirming) }}
      />
    </HomeSection>
  )
}

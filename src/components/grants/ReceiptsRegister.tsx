import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, EmptyState, Pagination, SearchInput, Select, Skeleton, TableSkeleton, useToast,
} from '../ui'
import { ExportMenu } from '../ExportMenu'
import { RECEIPT_TYPES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney } from '../../lib/format'
import { downloadWorkbook, fileSlug, isoToDate, today } from '../../lib/export/workbook'
import { useAccess } from '../../lib/accessContext'
import { usePaymentAccess } from '../../lib/payments'
import { sanitizeSearch } from '../../lib/query'
import { useBankAccounts } from '../../hooks/useBankAccounts'
import { useUrlFilters } from '../../hooks/useUrlFilters'

/**
 * Every receipt across every grant, for reconciling against bank statements:
 * filter to one account and one month, tick what the statement shows, and
 * confirm them together. Everyone can read it; finance and managers confirm.
 */

const PAGE_SIZE = 50
const EXPORT_CAP = 5000

export const RECEIPT_DEFAULTS = { q: '', receipt: 'awaiting', account: '', month: '', fcra: '', page: '1' }

type Row = {
  id: string
  grant_id: string
  org_name: string | null
  sequence_no: number | null
  received_date: string | null
  amount: number
  currency: string
  fx_rate_to_inr: number
  amount_inr: number
  bank_label: string | null
  grant_is_fcra: boolean
  reference_number: string | null
  receipt_type: string | null
  recorded_by_name: string | null
  confirmed_by_finance: boolean
  confirmed_at: string | null
}

const COLS = 'id, grant_id, org_name, sequence_no, received_date, amount, currency, fx_rate_to_inr, amount_inr, '
  + 'bank_label, grant_is_fcra, reference_number, receipt_type, recorded_by_name, confirmed_by_finance, confirmed_at'

/** The last 18 months, newest first, as "YYYY-MM-01" — the view's received_month. */
function monthOptions(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < 18; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    out.push({ value, label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) })
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

export function ReceiptsRegister({ views }: { views: React.ReactNode }) {
  const toast = useToast()
  const access = useAccess()
  const { canConfirm } = usePaymentAccess()
  const { accounts } = useBankAccounts()
  const { filters, setFilter } = useUrlFilters(RECEIPT_DEFAULTS)
  const months = useMemo(monthOptions, [])

  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState<{ count: number; sum: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const page = Math.max(1, Number(filters.page) || 1)
  const awaiting = filters.receipt === 'awaiting'

  /** The same filters for the page, the total and the export. */
  const scoped = useCallback((cols: string, opts?: { count?: 'exact' }) => {
    let q = supabase.from('v_fr_remittance_facts').select(cols, opts)
    if (filters.receipt === 'awaiting') q = q.eq('confirmed_by_finance', false)
    if (filters.receipt === 'confirmed') q = q.eq('confirmed_by_finance', true)
    if (filters.account) q = q.eq('bank_account_id', filters.account)
    if (filters.month) q = q.eq('received_month', filters.month)
    if (filters.fcra) q = q.eq('grant_is_fcra', filters.fcra === 'yes')
    if (filters.q) q = q.ilike('org_name', `%${sanitizeSearch(filters.q)}%`)
    return q
  }, [filters.receipt, filters.account, filters.month, filters.fcra, filters.q])

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    setSelected(new Set())
    const [list, agg] = await Promise.all([
      scoped(COLS, { count: 'exact' })
        // A queue reads oldest first; history reads newest first.
        .order('received_date', { ascending: awaiting, nullsFirst: false })
        .order('created_at', { ascending: awaiting })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
      // Summed in the database: the matching receipts can outnumber one read.
      scoped('amount_inr.sum(), id.count()'),
    ])
    if (list.error) { setError(list.error.message); setRows([]); return }
    setRows((list.data ?? []) as unknown as Row[])
    const a = (agg.data as unknown as Array<{ sum: number | null; count: number }> | null)?.[0]
    setTotal({ count: list.count ?? Number(a?.count ?? 0), sum: Number(a?.sum ?? 0) })
  }, [scoped, awaiting, page])

  useEffect(() => { void load() }, [load])

  const pickable = (rows ?? []).filter((r) => !r.confirmed_by_finance)
  const picked = pickable.filter((r) => selected.has(r.id))
  const pickedSum = picked.reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
  const allPicked = pickable.length > 0 && picked.length === pickable.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function confirmSelected() {
    setConfirmOpen(false)
    const ids = picked.map((r) => r.id)
    if (ids.length === 0) return
    setBusy(true)
    // Who confirmed and when are stamped by the database, row by row.
    const { data, error: err } = await supabase
      .from('fr_remittances')
      .update({
        confirmed_by_finance: true,
        confirmed_by_user_id: access.employeeId,
        confirmed_at: new Date().toISOString(),
        is_locked: true,
        updated_by: access.employeeId,
      })
      .in('id', ids)
      .select('id')
    setBusy(false)
    if (err) { toast.error(err.message); return }
    const n = (data ?? []).length
    toast.success(`${n} ${n === 1 ? 'receipt' : 'receipts'} confirmed and locked.`)
    void load()
  }

  async function exportExcel() {
    const all: Row[] = []
    for (let from = 0; from < EXPORT_CAP; from += 1000) {
      const { data, error: err } = await scoped(COLS)
        .order('received_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .range(from, from + 999)
      if (err) throw new Error(err.message)
      all.push(...((data ?? []) as unknown as Row[]))
      if (!data || data.length < 1000) break
    }
    const label = filters.receipt === 'awaiting' ? 'awaiting' : filters.receipt === 'confirmed' ? 'confirmed' : 'all'
    await downloadWorkbook(`${fileSlug('receipts', label, today())}.xlsx`, [{
      name: 'Receipts',
      columns: [
        { header: 'Donor', width: 34 },
        { header: 'Instalment', kind: 'int', width: 11 },
        { header: 'Received', kind: 'date', width: 13 },
        { header: 'Amount', kind: 'int', width: 14 },
        { header: 'Currency', width: 9 },
        { header: 'FX rate', width: 10 },
        { header: 'Amount (INR)', kind: 'inr', width: 16 },
        { header: 'Received into', width: 14 },
        { header: 'FCRA', width: 9 },
        { header: 'Reference', width: 22 },
        { header: 'Receipt type', width: 16 },
        { header: 'Recorded by', width: 18 },
        { header: 'Status', width: 12 },
        { header: 'Confirmed on', kind: 'date', width: 13 },
      ],
      rows: all.map((r) => [
        r.org_name, r.sequence_no, isoToDate(r.received_date), Number(r.amount), r.currency,
        Number(r.fx_rate_to_inr), Number(r.amount_inr), r.bank_label, r.grant_is_fcra ? 'FCRA' : 'Domestic',
        r.reference_number, r.receipt_type ? labelOf(RECEIPT_TYPES, r.receipt_type) : null, r.recorded_by_name,
        r.confirmed_by_finance ? 'Confirmed' : 'Awaiting', isoToDate(r.confirmed_at),
      ]),
    }])
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Grants</h1>
          {total === null ? (
            <Skeleton height={14} width={260} />
          ) : (
            <p className="page__sub tn-num">
              {total.count} {total.count === 1 ? 'receipt' : 'receipts'} · {formatMoney(total.sum)}
            </p>
          )}
        </div>
        <ExportMenu size="md" onExcel={exportExcel} />
      </div>

      {views}

      <div className="filterbar">
        <SearchInput value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search by donor" />
        <Select label="Status" value={filters.receipt} onChange={(e) => setFilter('receipt', e.currentTarget.value)}>
          <option value="awaiting">Awaiting confirmation</option>
          <option value="confirmed">Confirmed</option>
          <option value="all">All</option>
        </Select>
        <Select label="Received into" value={filters.account} onChange={(e) => setFilter('account', e.currentTarget.value)}>
          <option value="">Any account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
        <Select label="Month" value={filters.month} onChange={(e) => setFilter('month', e.currentTarget.value)}>
          <option value="">Any month</option>
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        <Select label="FCRA" value={filters.fcra} onChange={(e) => setFilter('fcra', e.currentTarget.value)}>
          <option value="">All</option>
          <option value="yes">FCRA only</option>
          <option value="no">Domestic only</option>
        </Select>
      </div>

      {canConfirm && picked.length > 0 ? (
        <div className="selectbar">
          <span className="tn-num">
            {picked.length} selected · <strong>{formatMoney(pickedSum)}</strong>
          </span>
          <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={busy}>
            {busy ? 'Confirming…' : 'Confirm selected'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load receipts"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={8} cols={7} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title={awaiting ? 'Nothing awaiting confirmation' : 'No receipts match these filters'} />
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  {canConfirm ? (
                    <th style={{ width: '36px' }}>
                      <input
                        type="checkbox"
                        aria-label="Select every unconfirmed receipt on this page"
                        checked={allPicked}
                        disabled={pickable.length === 0}
                        onChange={() => setSelected(allPicked ? new Set() : new Set(pickable.map((r) => r.id)))}
                      />
                    </th>
                  ) : null}
                  <th>Donor</th>
                  <th style={{ width: '110px' }}>Received</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>Amount</th>
                  <th style={{ width: '110px' }}>Into</th>
                  <th style={{ width: '160px' }}>Reference</th>
                  <th style={{ width: '140px' }}>Recorded by</th>
                  <th style={{ width: '120px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-active={selected.has(r.id) || undefined}>
                    {canConfirm ? (
                      <td>
                        {r.confirmed_by_finance ? null : (
                          <input
                            type="checkbox"
                            aria-label={`Select receipt from ${r.org_name ?? 'grant'}`}
                            checked={selected.has(r.id)}
                            onChange={() => toggle(r.id)}
                          />
                        )}
                      </td>
                    ) : null}
                    <td>
                      <Link to="/grants/$id" params={{ id: r.grant_id }} search={{ tab: 'money' } as never} className="celllink">
                        {r.org_name ?? 'Grant'}
                      </Link>
                      {r.sequence_no ? <span className="faint"> · instalment {r.sequence_no}</span> : null}
                    </td>
                    <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.received_date)}</td>
                    <td className="tn-num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatMoney(r.amount_inr)}
                      {r.currency !== 'INR' ? (
                        <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>{r.currency} {r.amount}</div>
                      ) : null}
                    </td>
                    <td className="muted">{r.bank_label ?? '—'}</td>
                    <td className="muted">{r.reference_number ?? '—'}</td>
                    <td className="muted">{r.recorded_by_name ?? '—'}</td>
                    <td>
                      {r.confirmed_by_finance
                        ? <Badge tone="green"><Lock size={11} /> Confirmed</Badge>
                        : <Badge tone="amber">Awaiting</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total?.count ?? 0} onPage={(p) => setFilter('page', String(p))} />
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Confirm ${picked.length} ${picked.length === 1 ? 'receipt' : 'receipts'}?`}
        body={`${formatMoney(pickedSum)} in total. Check them against the bank statement first; once confirmed they are locked.`}
        confirmLabel="Confirm and lock"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmSelected()}
      />
    </div>
  )
}

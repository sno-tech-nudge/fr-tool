import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { Badge, EmptyState, Skeleton } from '../ui'
import { formatDate, formatMoney } from '../../lib/format'
import { useAccess } from '../../lib/accessContext'
import { HomeSection } from './HomeSection'
import { daysFromToday, statusBadge } from './due'

/**
 * Money still to come in on this person's grants: the five instalments to
 * chase next, and the total outstanding behind them.
 *
 * Reads the tranche facts view, which nets partial receipts off each
 * instalment and already drops deleted grants — so "remaining" means what is
 * genuinely still owed.
 */

type Row = {
  id: string
  grant_id: string
  org_name: string | null
  effective_due_date: string
  outstanding_inr: number
}

const TOP = 5

/**
 * The list starts 90 days back. Imported history still carries instalments
 * from years ago marked unpaid; sorted by date alone they would crowd out
 * everything live. The total above the list still counts all of it.
 */
const LOOKBACK_DAYS = 90

export function CollectionsCard() {
  const access = useAccess()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState<{ sum: number; count: number } | null>(null)

  const load = useCallback(async () => {
    const me = access.employeeId
    if (!me) return
    setRows(null)

    const open = (cols: string) => supabase
      .from('v_fr_tranche_facts')
      .select(cols)
      .eq('owner_user_id', me)
      .not('status', 'in', '(received,cancelled)')
      .gt('outstanding_inr', 0)

    const [top, agg] = await Promise.all([
      open('id, grant_id, org_name, effective_due_date, outstanding_inr')
        .gte('effective_due_date', daysFromToday(-LOOKBACK_DAYS))
        .order('effective_due_date')
        .limit(TOP),
      // Summed in the database — an owner can hold more instalments than one
      // read returns.
      open('outstanding_inr.sum(), id.count()'),
    ])

    setRows((top.data ?? []) as unknown as Row[])
    const a = (agg.data as unknown as Array<{ sum: number | null; count: number }> | null)?.[0]
    setTotal(a ? { sum: Number(a.sum ?? 0), count: Number(a.count ?? 0) } : null)
  }, [access.employeeId])

  useEffect(() => { void load() }, [load])

  return (
    <HomeSection
      title="Remaining collections"
      sub={total && total.count > 0 ? (
        <span className="tn-num">
          <strong>{formatMoney(total.sum)}</strong> still to collect across {total.count} {total.count === 1 ? 'instalment' : 'instalments'}
        </span>
      ) : null}
      action={<Link to="/grants" className="celllink" style={{ fontSize: 'var(--text-sm)' }}>All grants</Link>}
    >
      {rows === null ? (
        <div className="card stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={32} />)}</div>
      ) : !total || total.count === 0 ? (
        <div className="card">
          <EmptyState title="Nothing left to collect" body="Instalments still owed on the grants you own show here." />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            Nothing due from the last 90 days onward — the total is older instalments still marked unpaid.
          </p>
        </div>
      ) : (
        <div className="tablewrap homesec__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Donor</th>
                <th style={{ width: '140px' }}>Due</th>
                <th style={{ width: '140px' }}>Status</th>
                <th style={{ width: '150px', textAlign: 'right' }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = statusBadge(r.effective_due_date)
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to="/grants/$id" params={{ id: r.grant_id }} className="celllink">
                        {r.org_name ?? 'Grant'}
                      </Link>
                    </td>
                    <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.effective_due_date)}</td>
                    <td><Badge tone={status.tone}>{status.label}</Badge></td>
                    <td className="tn-num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(r.outstanding_inr)}</td>
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

import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { IndianRupee } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, EmptyState, Skeleton } from '../ui'
import { formatMoney } from '../../lib/format'
import { useAccess } from '../../lib/accessContext'
import { HomeCard } from './HomeCard'
import { dueBadge, daysFromToday } from './due'

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
    <HomeCard
      title="Remaining collections"
      footer={<Link to="/grants" className="celllink" style={{ fontSize: 'var(--text-sm)' }}>All grants</Link>}
    >
      {rows === null ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={32} />)}</div>
      ) : !total || total.count === 0 ? (
        <EmptyState title="Nothing left to collect" body="Instalments still owed on the grants you own show here." />
      ) : (
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <p className="tn-num" style={{ margin: 0 }}>
            <strong>{formatMoney(total.sum)}</strong>
            <span className="muted"> still to collect across {total.count} {total.count === 1 ? 'instalment' : 'instalments'}</span>
          </p>
          {rows.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              Nothing due from the last 90 days onward — the total is older instalments still marked unpaid.
            </p>
          ) : null}
          <div className="feed">
            {rows.map((r) => {
              const badge = dueBadge(r.effective_due_date)
              return (
                <article key={r.id} className="feeditem">
                  <span className="feeditem__icon" aria-hidden="true"><IndianRupee size={14} /></span>
                  <div className="feeditem__head">
                    <Link to="/grants/$id" params={{ id: r.grant_id }} className="feeditem__subject celllink">
                      {r.org_name ?? 'Grant'}
                    </Link>
                    <span className="tn-num">{formatMoney(r.outstanding_inr)}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </HomeCard>
  )
}

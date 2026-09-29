import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, Select, TableSkeleton } from '../ui'
import { ChartCard, GroupedHBar, Kpi, VBar, type Datum, type PairDatum } from '../charts'
import type { DashboardFilters } from '../../routes/_app.dashboards'
import { CAPITAL_CATEGORIES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney, formatPct } from '../../lib/format'
import { parseFyList } from '../../lib/fy'

type GrantRow = {
  id: string
  org_name: string | null
  total_value_inr: number
  received_inr: number
  outstanding_inr: number
  collection_pct: number
  is_fcra: boolean
  capital_category: string
  signed_fiscal_year: string | null
  owner_name: string | null
}

type OverdueRow = {
  id: string
  grant_id: string
  org_name: string | null
  sequence_no: number
  effective_due_date: string
  amount_inr_expected: number
  received_inr: number
  days_from_due: number | null
}

type BankRow = { label: string | null; is_fcra: boolean; value: number | null }

type Data = {
  committed: number
  received: number
  outstanding: number
  grantCount: number
  /** Kept in full (not just the top slice) so the group-by chart can re-cut it. */
  grants: GrantRow[]
  cashIn: Datum[]
  overdue: OverdueRow[]
  overdueTotal: number
  collection: GrantRow[]
  banks: BankRow[]
  fcraReceived: number
  domesticReceived: number
  mismatches: number
  unconfirmed: number
  unconfirmedValue: number
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Aging = 'all' | '0-30' | '31-90' | '90+'
const AGING_OPTIONS: Array<{ value: Aging; label: string }> = [
  { value: 'all', label: 'All overdue' },
  { value: '0-30', label: '0–30 days late' },
  { value: '31-90', label: '31–90 days late' },
  { value: '90+', label: '90+ days late' },
]

type GroupBy = 'category' | 'fy' | 'owner' | 'fcra'
const GROUP_OPTIONS: Array<{ key: GroupBy; label: string }> = [
  { key: 'category', label: 'Category' },
  { key: 'fy', label: 'FY' },
  { key: 'owner', label: 'Owner' },
  { key: 'fcra', label: 'FCRA' },
]

/** Next 12 months from the start of this one, so the calendar is stable. */
function monthWindow(): { from: string; to: string; keys: string[] } {
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const keys: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 12, 0)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(start), to: iso(end), keys }
}

function groupKey(g: GrantRow, by: GroupBy): string {
  switch (by) {
    case 'category': return labelOf(CAPITAL_CATEGORIES, g.capital_category)
    case 'fy': return g.signed_fiscal_year ?? 'Unknown'
    case 'owner': return g.owner_name ?? '—'
    case 'fcra': return g.is_fcra ? 'FCRA' : 'Domestic'
  }
}

export function MoneyDashboard({ filters }: { filters: DashboardFilters }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aging, setAging] = useState<Aging>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('category')

  const load = useCallback(async () => {
    setData(null)
    setError(null)

    const win = monthWindow()
    const fys = parseFyList(filters.fy)

    // `.match()` applies the shared filters in one call — threading a Supabase
    // query builder through a helper makes its generics recurse badly.
    const owner: Record<string, string> = filters.owner ? { owner_user_id: filters.owner } : {}
    const catFcra: Record<string, string | boolean> = {}
    if (filters.category) catFcra.capital_category = filters.category
    if (filters.fcra) catFcra.is_fcra = filters.fcra === 'yes'

    // Grants are scoped by the FY they were SIGNED in — the IA's definition of
    // secured — while money is scoped by when it was received or is due.
    const grantScope: Record<string, string | boolean> = { ...owner, ...catFcra }
    if (filters.status) grantScope.status = filters.status

    // Tranche facts carry the parent grant's status too, so the same three
    // filters narrow the calendar and overdue list without a second join.
    const trancheScope: Record<string, string | boolean> = { ...owner, ...catFcra }
    if (filters.status) trancheScope.grant_status = filters.status

    // Remittance facts have no grant_status column, so status does not reach
    // the FCRA/mismatch/unconfirmed panels — category and FCRA still do.
    const remittanceScope = { ...owner, ...catFcra }

    let grantsQ = supabase.from('v_fr_grant_facts')
      .select('id,org_name,total_value_inr,received_inr,outstanding_inr,collection_pct,is_fcra,capital_category,signed_fiscal_year,owner_name')
      .match(grantScope)
    if (fys.length) grantsQ = grantsQ.in('signed_fiscal_year', fys)

    const cashQ = supabase.from('v_fr_tranche_facts')
      .select('label:due_month,value:amount_inr_expected.sum()')
      .match(trancheScope)
      .gte('due_month', win.from)
      .lte('due_month', win.to)
      .neq('status', 'cancelled')

    let overdueQ = supabase.from('v_fr_tranche_facts')
      .select('id,grant_id,org_name,sequence_no,effective_due_date,amount_inr_expected,received_inr,days_from_due')
      .match(trancheScope)
      .eq('is_overdue', true)
    if (aging === '0-30') overdueQ = overdueQ.gte('days_from_due', 0).lte('days_from_due', 30)
    else if (aging === '31-90') overdueQ = overdueQ.gte('days_from_due', 31).lte('days_from_due', 90)
    else if (aging === '90+') overdueQ = overdueQ.gte('days_from_due', 91)
    overdueQ = overdueQ.order('effective_due_date').limit(100)

    let bankQ = supabase.from('v_fr_remittance_facts')
      .select('label:bank_label,is_fcra:bank_is_fcra,value:amount_inr.sum()')
      .match(remittanceScope)
    if (fys.length) bankQ = bankQ.in('received_fiscal_year', fys)

    const mismatchQ = supabase.from('v_fr_remittance_facts')
      .select('id', { count: 'exact', head: true })
      .match(remittanceScope)
      .eq('fcra_mismatch', true)

    const unconfirmedQ = supabase.from('v_fr_remittance_facts')
      .select('value:amount_inr.sum(),count:id.count()')
      .match(remittanceScope)
      .eq('confirmed_by_finance', false)

    const [grants, cash, overdue, banks, mismatch, unconfirmed] = await Promise.all([
      grantsQ, cashQ, overdueQ, bankQ, mismatchQ, unconfirmedQ.single(),
    ])

    const firstError = [grants, cash, overdue, banks, mismatch, unconfirmed]
      .find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return }

    const grantRows = (grants.data ?? []) as GrantRow[]
    const cashRows = (cash.data ?? []) as Array<{ label: string; value: number | null }>
    const bankRows = (banks.data ?? []) as BankRow[]
    const unc = (unconfirmed.data ?? {}) as { value: number | null; count: number }

    const byMonth = new Map(cashRows.map((r) => [r.label, Number(r.value ?? 0)]))

    setData({
      committed: grantRows.reduce((s, g) => s + Number(g.total_value_inr ?? 0), 0),
      received: grantRows.reduce((s, g) => s + Number(g.received_inr ?? 0), 0),
      outstanding: grantRows.reduce((s, g) => s + Number(g.outstanding_inr ?? 0), 0),
      grantCount: grantRows.length,
      grants: grantRows,
      // Every month in the window appears, including the empty ones — a gap in
      // the calendar is information, not something to compress away.
      cashIn: win.keys.map((k) => {
        const d = new Date(k)
        return { label: MONTH[d.getMonth()], value: byMonth.get(k) ?? 0 }
      }),
      overdue: (overdue.data ?? []) as OverdueRow[],
      overdueTotal: ((overdue.data ?? []) as OverdueRow[])
        .reduce((s, t) => s + (Number(t.amount_inr_expected ?? 0) - Number(t.received_inr ?? 0)), 0),
      collection: [...grantRows].sort((a, b) => b.outstanding_inr - a.outstanding_inr).slice(0, 15),
      banks: bankRows.filter((b) => Number(b.value ?? 0) > 0),
      fcraReceived: bankRows.filter((b) => b.is_fcra).reduce((s, b) => s + Number(b.value ?? 0), 0),
      domesticReceived: bankRows.filter((b) => !b.is_fcra).reduce((s, b) => s + Number(b.value ?? 0), 0),
      mismatches: mismatch.count ?? 0,
      unconfirmed: Number(unc.count ?? 0),
      unconfirmedValue: Number(unc.value ?? 0),
    })
  }, [filters.fy, filters.owner, filters.category, filters.status, filters.fcra, aging])

  useEffect(() => { void load() }, [load])

  // Re-cut from the full grant set already in memory — no extra round trip
  // when the toggle changes.
  const committedVsReceived = useMemo<PairDatum[] | null>(() => {
    if (!data) return null
    const map = new Map<string, PairDatum>()
    for (const g of data.grants) {
      const key = groupKey(g, groupBy)
      const cur = map.get(key) ?? { label: key, committed: 0, received: 0 }
      cur.committed += Number(g.total_value_inr ?? 0)
      cur.received += Number(g.received_inr ?? 0)
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.committed - a.committed).slice(0, 10)
  }, [data, groupBy])

  if (error) {
    return (
      <div className="card">
        <EmptyState
          title="Could not load the dashboard"
          body={error}
          action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
        />
      </div>
    )
  }

  const collectionPct = data && data.committed > 0
    ? Math.round((data.received / data.committed) * 100)
    : null

  return (
    <div className="stack">
      <div className="kpirow kpirow--compact">
        <Kpi
          compact
          label="Committed"
          value={formatMoney(data?.committed ?? 0)}
          note={data ? `${data.grantCount} grants` : undefined}
          loading={!data}
        />
        <Kpi compact label="Received" value={formatMoney(data?.received ?? 0)} loading={!data} />
        <Kpi compact label="Outstanding" value={formatMoney(data?.outstanding ?? 0)} loading={!data} />
        <Kpi
          compact
          label="Collection"
          value={collectionPct === null ? '—' : formatPct(collectionPct)}
          note="Received against committed"
          loading={!data}
        />
      </div>

      {data && (data.mismatches > 0 || data.unconfirmed > 0) ? (
        <div className="qualitystrip">
          <AlertTriangle size={15} />
          <span>
            {data.mismatches > 0 ? (
              <strong>
                {data.mismatches} receipt{data.mismatches === 1 ? '' : 's'} on the wrong side of the FCRA line.
              </strong>
            ) : null}
            {data.unconfirmed > 0 ? (
              <> {data.unconfirmed} receipt{data.unconfirmed === 1 ? '' : 's'} worth{' '}
                <span className="tn-num">{formatMoney(data.unconfirmedValue)}</span> still awaiting finance confirmation.
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      <ChartCard
        title="Cash in, next 12 months"
        subtitle="Scheduled instalments by month due, revised dates where a tranche has slipped"
        // Empty months are kept so gaps in the calendar stay visible — but if
        // every month is empty there is no calendar, just a bare axis.
        data={data ? (data.cashIn.some((m) => m.value > 0) ? data.cashIn : []) : null}
        emptyBody="No instalments are scheduled in the next 12 months."
        height={240}
      >
        <VBar data={data?.cashIn ?? []} valueLabel="due" />
      </ChartCard>

      <ChartCard
        title="Committed vs received"
        subtitle="Where collection is lagging"
        data={committedVsReceived}
        emptyBody="No grants match these filters."
        height={Math.min(320, Math.max(160, (committedVsReceived?.length ?? 0) * 42 + 40))}
        actions={
          <div className="viewswitch">
            {GROUP_OPTIONS.map((o) => (
              <button key={o.key} data-active={groupBy === o.key} onClick={() => setGroupBy(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        }
      >
        <GroupedHBar data={committedVsReceived ?? []} />
      </ChartCard>

      <div className="chartgrid">
        <section className="card stack">
          <div className="tn-micro">Collection by grant</div>
          <p className="chartsub">Most outstanding first</p>
          {!data ? (
            <TableSkeleton rows={5} cols={5} />
          ) : data.collection.length === 0 ? (
            <EmptyState
              title="No grants yet"
              body="Grants are created when an opportunity is won, and their money appears here."
            />
          ) : (
            // Fills whatever height the FCRA card sets for the row, then
            // scrolls — so neither half ever ends in empty space.
            <div className="fillscroll">
              <div className="tablewrap fillscroll__inner">
              <table className="table" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Donor</th>
                    <th style={{ width: '96px' }}>Committed</th>
                    <th style={{ width: '96px' }}>Received</th>
                    <th style={{ width: '104px' }}>Outstanding</th>
                    <th style={{ width: '104px' }}>Collection</th>
                  </tr>
                </thead>
                <tbody>
                  {data.collection.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <Link to="/grants/$id" params={{ id: g.id }} className="celllink">
                          {g.org_name ?? 'Grant'}
                        </Link>
                        {g.is_fcra ? <> <Badge tone="fcra">FCRA</Badge></> : null}
                      </td>
                      <td className="tn-num">{formatMoney(g.total_value_inr)}</td>
                      <td className="tn-num">{formatMoney(g.received_inr)}</td>
                      <td className="tn-num muted">{formatMoney(g.outstanding_inr)}</td>
                      <td>
                        <div className="progress" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, g.collection_pct)}%` }} />
                        </div>
                        <span className="tn-num muted" style={{ fontSize: 'var(--text-sm)' }}>
                          {Math.round(g.collection_pct)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </section>

        <section className="card stack">
          <div className="tn-micro">FCRA receipts</div>
          <p className="chartsub">Foreign contribution must land in TNF or NLF FCRA. Needed for FC-4.</p>
          {!data ? (
            <TableSkeleton rows={3} cols={2} />
          ) : data.banks.length === 0 ? (
            <EmptyState title="No receipts yet" body="Money received will be split by receiving entity here." />
          ) : (
            <>
              <div className="kpirow kpirow--compact" style={{ marginTop: 0 }}>
                <Kpi compact label="FCRA" value={formatMoney(data.fcraReceived)} />
                <Kpi compact label="Domestic" value={formatMoney(data.domesticReceived)} />
              </div>
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Receiving entity</th>
                      <th style={{ width: '84px' }}>Type</th>
                      <th style={{ width: '120px' }}>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.banks.map((b) => (
                      <tr key={b.label ?? 'unknown'}>
                        <td>{b.label ?? '—'}</td>
                        <td>
                          <Badge tone={b.is_fcra ? 'fcra' : 'domestic'}>
                            {b.is_fcra ? 'FCRA' : 'Domestic'}
                          </Badge>
                        </td>
                        <td className="tn-num">{formatMoney(b.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="tn-micro">Overdue instalments</div>
          <Select value={aging} onChange={(e) => setAging(e.currentTarget.value as Aging)}>
            {AGING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        {!data ? (
          <TableSkeleton rows={4} cols={4} />
        ) : data.overdue.length === 0 ? (
          <EmptyState
            title="Nothing here"
            body={aging === 'all'
              ? 'Every scheduled instalment is either received or still to come.'
              : 'No overdue instalments fall in this window.'}
          />
        ) : (
          <>
            <p className="chartsub tn-num">
              {formatMoney(data.overdueTotal)} outstanding across {data.overdue.length}
            </p>
            <div className="tablewrap" style={{ maxHeight: 480, overflow: 'hidden auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Donor</th>
                    <th style={{ width: '130px' }}>Due</th>
                    <th style={{ width: '130px' }}>Amount</th>
                    <th style={{ width: '110px' }}>Late by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overdue.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link to="/grants/$id" params={{ id: t.grant_id }} className="celllink">
                          {t.org_name ?? 'Grant'}
                        </Link>
                        <span className="faint tn-num"> #{t.sequence_no}</span>
                      </td>
                      <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>
                        {formatDate(t.effective_due_date)}
                      </td>
                      <td className="tn-num" style={{ whiteSpace: 'nowrap' }}>
                        {formatMoney(Number(t.amount_inr_expected ?? 0) - Number(t.received_inr ?? 0))}
                      </td>
                      <td>
                        <Badge tone={(t.days_from_due ?? 0) > 15 ? 'red' : 'amber'}>
                          {t.days_from_due ?? 0}d
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, RagBadge, Select, TableSkeleton } from '../ui'
import { ChartCard, GroupedHBar, HBar, Kpi, VBar, type Datum, type PairDatum } from '../charts'
import type { DashboardFilters } from '../../routes/_app.dashboards'
import { CAPITAL_CATEGORIES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney, formatPct } from '../../lib/format'
import { fiscalQuarter, parseFyList, shortFyLabel } from '../../lib/fy'
import { computeHealth } from '../../lib/grants'
import { isoToDate, type ExportRef, type SheetSpec } from '../../lib/export/workbook'

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
  signed_date: string | null
  owner_name: string | null
  status: string
}

/** What the facts view does not carry: the deal's name and the grant's health. */
type GrantExtra = { name: string | null; health: 'green' | 'amber' | 'red' }

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
type SumCount = { value: number | null; count: number }

type Data = {
  committed: number
  received: number
  outstanding: number
  grantCount: number
  /** Kept in full so the group-by chart and the collection table can re-cut it. */
  grants: GrantRow[]
  extras: Map<string, GrantExtra>
  cashIn: Datum[]
  overdue: OverdueRow[]
  overdueTotal: number
  overdueAll: { value: number; count: number }
  dueSoon: { value: number; count: number }
  banks: Datum[]
  fcraByFy: Datum[]
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

/** Every number on the page, as sheets — what the Excel export writes. */
function moneySheets(
  d: Data,
  ctx: { pairs: PairDatum[]; groupLabel: string; collection: GrantRow[]; agingLabel: string },
): SheetSpec[] {
  const win = monthWindow()
  const monthName = (key: string) => {
    const dt = new Date(key)
    return `${MONTH[dt.getMonth()]} ${dt.getFullYear()}`
  }
  const pct = (received: number, committed: number) => (committed > 0 ? Math.round((received / committed) * 1000) / 10 : null)
  return [
    {
      name: 'Summary',
      columns: [{ header: 'Measure', width: 34 }, { header: 'Value', width: 20 }],
      rows: [
        ['Committed (INR)', { value: d.committed, kind: 'inr' }],
        ['Grants', { value: d.grantCount, kind: 'int' }],
        ['Received (INR)', { value: d.received, kind: 'inr' }],
        ['Outstanding (INR)', { value: d.outstanding, kind: 'inr' }],
        ['Collection', { value: pct(d.received, d.committed), kind: 'pct' }],
        ['Overdue (INR)', { value: d.overdueAll.value, kind: 'inr' }],
        ['Overdue instalments', { value: d.overdueAll.count, kind: 'int' }],
        ['Due in the next 90 days (INR)', { value: d.dueSoon.value, kind: 'inr' }],
        ['Instalments due in the next 90 days', { value: d.dueSoon.count, kind: 'int' }],
        ['FCRA received (INR)', { value: d.fcraReceived, kind: 'inr' }],
        ['Domestic received (INR)', { value: d.domesticReceived, kind: 'inr' }],
        ['Receipts awaiting finance confirmation', { value: d.unconfirmed, kind: 'int' }],
        ['Value awaiting confirmation (INR)', { value: d.unconfirmedValue, kind: 'inr' }],
        ['Receipts on the wrong side of the FCRA line', { value: d.mismatches, kind: 'int' }],
      ],
    },
    {
      name: 'Cash in, 12 months',
      columns: [{ header: 'Month', width: 14 }, { header: 'Scheduled (INR)', kind: 'inr', width: 20 }],
      rows: win.keys.map((k, i) => [monthName(k), d.cashIn[i]?.value ?? 0]),
    },
    {
      name: 'Committed vs received',
      columns: [
        { header: ctx.groupLabel, width: 26 },
        { header: 'Committed (INR)', kind: 'inr', width: 20 },
        { header: 'Received (INR)', kind: 'inr', width: 20 },
        { header: 'Outstanding (INR)', kind: 'inr', width: 20 },
        { header: 'Collection', kind: 'pct' },
      ],
      rows: ctx.pairs.map((p) => [p.label, p.committed, p.received, p.committed - p.received, pct(p.received, p.committed)]),
    },
    {
      name: 'Collection by grant',
      columns: [
        { header: 'Agreement', width: 40 },
        { header: 'Organisation', width: 30 },
        { header: 'Category', width: 16 },
        { header: 'FCRA', width: 10 },
        { header: 'Status', width: 12 },
        { header: 'Health', width: 10 },
        { header: 'Committed (INR)', kind: 'inr', width: 18 },
        { header: 'Received (INR)', kind: 'inr', width: 18 },
        { header: 'Outstanding (INR)', kind: 'inr', width: 18 },
        { header: 'Collection', kind: 'pct' },
        { header: 'Signed', kind: 'date', width: 14 },
        { header: 'Signed in', width: 12 },
        { header: 'Owner', width: 22 },
      ],
      rows: ctx.collection.map((g) => {
        const extra = d.extras.get(g.id)
        return [
          extra?.name ?? g.org_name, g.org_name, labelOf(CAPITAL_CATEGORIES, g.capital_category),
          g.is_fcra ? 'FCRA' : 'Domestic', g.status, extra?.health ?? null,
          g.total_value_inr, g.received_inr, g.outstanding_inr, Math.round(Number(g.collection_pct ?? 0) * 10) / 10,
          isoToDate(g.signed_date), g.signed_fiscal_year, g.owner_name,
        ]
      }),
    },
    {
      name: 'FCRA by fiscal year',
      columns: [{ header: 'Year', width: 14 }, { header: 'Received (INR)', kind: 'inr', width: 20 }],
      rows: d.fcraByFy.map((r) => [r.label, r.value]),
    },
    {
      name: 'FCRA by bank',
      columns: [{ header: 'Receiving entity', width: 26 }, { header: 'Received (INR)', kind: 'inr', width: 20 }],
      rows: d.banks.map((r) => [r.label, r.value]),
    },
    {
      name: ctx.agingLabel ? `Overdue (${ctx.agingLabel})` : 'Overdue',
      columns: [
        { header: 'Donor', width: 32 },
        { header: 'Instalment', kind: 'int', width: 12 },
        { header: 'Due', kind: 'date', width: 14 },
        { header: 'Outstanding (INR)', kind: 'inr', width: 20 },
        { header: 'Days late', kind: 'int', width: 12 },
      ],
      rows: d.overdue.map((t) => [
        t.org_name, t.sequence_no, isoToDate(t.effective_due_date),
        Number(t.amount_inr_expected ?? 0) - Number(t.received_inr ?? 0), t.days_from_due,
      ]),
    },
  ]
}

function groupKey(g: GrantRow, by: GroupBy): string {
  switch (by) {
    case 'category': return labelOf(CAPITAL_CATEGORIES, g.capital_category)
    case 'fy': return g.signed_fiscal_year ?? 'Unknown'
    case 'owner': return g.owner_name ?? '—'
    case 'fcra': return g.is_fcra ? 'FCRA' : 'Domestic'
  }
}

/**
 * Deal names are joined with underscores (DBS Foundation_EIP_FY25), which give
 * a browser nowhere to wrap. A break opportunity after each underscore lets a
 * narrow column wrap them at the joins instead of mid-word.
 */
function breakable(name: string) {
  const parts = name.split('_')
  return parts.map((part, i) => (
    <Fragment key={i}>{part}{i < parts.length - 1 ? <>_<wbr /></> : null}</Fragment>
  ))
}

export function MoneyDashboard({ filters, exportRef }: { filters: DashboardFilters; exportRef?: ExportRef }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aging, setAging] = useState<Aging>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('category')

  const load = useCallback(async () => {
    setData(null)
    setError(null)

    const win = monthWindow()
    const fys = parseFyList(filters.fy)
    // Quarters follow the same scoping as years: grants by the quarter they
    // were signed in, receipts by the quarter they were received in.
    const quarters = parseFyList(filters.quarter)

    // `.match()` applies the shared filters in one call — threading a Supabase
    // query builder through a helper makes its generics recurse badly.
    const owner: Record<string, string> = filters.owner ? { owner_user_id: filters.owner } : {}
    const category: Record<string, string> = filters.category ? { capital_category: filters.category } : {}
    const fcra = filters.fcra ? filters.fcra === 'yes' : null

    // Grants are scoped by the FY they were SIGNED in — the IA's definition of
    // secured — while money is scoped by when it was received or is due.
    const grantScope: Record<string, string | boolean> = { ...owner, ...category }
    if (fcra !== null) grantScope.is_fcra = fcra
    if (filters.status) grantScope.status = filters.status

    // Tranche facts carry the parent grant's status too, so the same three
    // filters narrow the calendar and overdue list without a second join.
    const trancheScope: Record<string, string | boolean> = { ...owner, ...category }
    if (fcra !== null) trancheScope.is_fcra = fcra
    if (filters.status) trancheScope.grant_status = filters.status

    // Remittance facts name the grant's FCRA flag grant_is_fcra, and have no
    // grant_status column, so status does not reach the receipts panels.
    const remittanceScope: Record<string, string | boolean> = { ...owner, ...category }
    if (fcra !== null) remittanceScope.grant_is_fcra = fcra

    let grantsQ = supabase.from('v_fr_grant_facts')
      .select('id,org_name,total_value_inr,received_inr,outstanding_inr,collection_pct,is_fcra,capital_category,signed_fiscal_year,signed_date,owner_name,status')
      .match(grantScope)
    if (fys.length) grantsQ = grantsQ.in('signed_fiscal_year', fys)

    // Name and health are not on the facts view: the name is the deal's, and
    // health is computed from tranche and report dates (see computeHealth).
    const extrasQ = supabase.from('fr_grants')
      .select('id, fr_opportunities!fr_grants_opportunity_id_fkey(name), fr_tranches(due_date, status), fr_compliance_milestones(due_date, status)')
      .is('deleted_at', null)

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

    // Summed in the database — there can be more instalments than one read returns.
    const overdueAllQ = supabase.from('v_fr_tranche_facts')
      .select('value:outstanding_inr.sum(),count:id.count()')
      .match(trancheScope)
      .eq('is_overdue', true)
      .gt('outstanding_inr', 0)

    const dueSoonQ = supabase.from('v_fr_tranche_facts')
      .select('value:outstanding_inr.sum(),count:id.count()')
      .match(trancheScope)
      .eq('due_next_90d', true)
      .gt('outstanding_inr', 0)

    let bankQ = supabase.from('v_fr_remittance_facts')
      .select('label:bank_label,is_fcra:bank_is_fcra,value:amount_inr.sum()')
      .match(remittanceScope)
    if (fys.length) bankQ = bankQ.in('received_fiscal_year', fys)
    if (quarters.length) bankQ = bankQ.in('received_fiscal_quarter', quarters)

    let fcraFyQ = supabase.from('v_fr_remittance_facts')
      .select('label:received_fiscal_year,value:amount_inr.sum()')
      .match(remittanceScope)
      .eq('grant_is_fcra', true)
    if (fys.length) fcraFyQ = fcraFyQ.in('received_fiscal_year', fys)
    if (quarters.length) fcraFyQ = fcraFyQ.in('received_fiscal_quarter', quarters)

    const mismatchQ = supabase.from('v_fr_remittance_facts')
      .select('id', { count: 'exact', head: true })
      .match(remittanceScope)
      .eq('fcra_mismatch', true)

    const unconfirmedQ = supabase.from('v_fr_remittance_facts')
      .select('value:amount_inr.sum(),count:id.count()')
      .match(remittanceScope)
      .eq('confirmed_by_finance', false)

    const [grants, extras, cash, overdue, overdueAll, dueSoon, banks, fcraFy, mismatch, unconfirmed] = await Promise.all([
      grantsQ, extrasQ, cashQ, overdueQ, overdueAllQ.single(), dueSoonQ.single(), bankQ, fcraFyQ, mismatchQ,
      unconfirmedQ.single(),
    ])

    const firstError = [grants, extras, cash, overdue, overdueAll, dueSoon, banks, fcraFy, mismatch, unconfirmed]
      .find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return }

    // The grant view carries the signed date but no quarter, so the quarter is
    // applied here — every grant is already read whole (a few hundred rows).
    const grantRows = ((grants.data ?? []) as GrantRow[])
      .filter((g) => !quarters.length || quarters.includes(fiscalQuarter(g.signed_date) ?? ''))
    const cashRows = (cash.data ?? []) as Array<{ label: string; value: number | null }>
    const bankRows = ((banks.data ?? []) as BankRow[]).filter((b) => Number(b.value ?? 0) > 0)
    const unc = (unconfirmed.data ?? {}) as SumCount
    const od = (overdueAll.data ?? {}) as SumCount
    const ds = (dueSoon.data ?? {}) as SumCount

    type ExtraRow = {
      id: string
      fr_opportunities: { name: string } | null
      fr_tranches: Array<{ due_date: string | null; status: string | null }>
      fr_compliance_milestones: Array<{ due_date: string | null; status: string | null }>
    }
    const extraMap = new Map<string, GrantExtra>()
    for (const e of (extras.data ?? []) as unknown as ExtraRow[]) {
      extraMap.set(e.id, {
        name: e.fr_opportunities?.name ?? null,
        health: computeHealth([...(e.fr_tranches ?? []), ...(e.fr_compliance_milestones ?? [])]),
      })
    }

    const byMonth = new Map(cashRows.map((r) => [r.label, Number(r.value ?? 0)]))

    setData({
      committed: grantRows.reduce((s, g) => s + Number(g.total_value_inr ?? 0), 0),
      received: grantRows.reduce((s, g) => s + Number(g.received_inr ?? 0), 0),
      outstanding: grantRows.reduce((s, g) => s + Number(g.outstanding_inr ?? 0), 0),
      grantCount: grantRows.length,
      grants: grantRows,
      extras: extraMap,
      // Every month in the window appears, including the empty ones — a gap in
      // the calendar is information, not something to compress away.
      cashIn: win.keys.map((k) => {
        const d = new Date(k)
        return { label: MONTH[d.getMonth()], value: byMonth.get(k) ?? 0 }
      }),
      overdue: (overdue.data ?? []) as OverdueRow[],
      overdueTotal: ((overdue.data ?? []) as OverdueRow[])
        .reduce((s, t) => s + (Number(t.amount_inr_expected ?? 0) - Number(t.received_inr ?? 0)), 0),
      overdueAll: { value: Number(od.value ?? 0), count: Number(od.count ?? 0) },
      dueSoon: { value: Number(ds.value ?? 0), count: Number(ds.count ?? 0) },
      // The entity's FCRA status rides in the label, so the chart needs no
      // second colour to say which side of the line each bar is on.
      banks: bankRows
        .map((b) => {
          const name = b.label ?? '—'
          return { label: b.is_fcra && !/fcra/i.test(name) ? `${name} · FCRA` : name, value: Number(b.value ?? 0) }
        })
        .sort((a, b) => b.value - a.value),
      fcraByFy: ((fcraFy.data ?? []) as Array<{ label: string | null; value: number | null }>)
        .filter((r) => r.label && Number(r.value ?? 0) > 0)
        .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
        .map((r) => ({ label: shortFyLabel(r.label ?? ''), value: Number(r.value ?? 0) })),
      fcraReceived: bankRows.filter((b) => b.is_fcra).reduce((s, b) => s + Number(b.value ?? 0), 0),
      domesticReceived: bankRows.filter((b) => !b.is_fcra).reduce((s, b) => s + Number(b.value ?? 0), 0),
      mismatches: mismatch.count ?? 0,
      unconfirmed: Number(unc.count ?? 0),
      unconfirmedValue: Number(unc.value ?? 0),
    })
  }, [filters.fy, filters.quarter, filters.owner, filters.category, filters.status, filters.fcra, aging])

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

  const collection = useMemo(
    () => (data ? [...data.grants].sort((a, b) => b.outstanding_inr - a.outstanding_inr) : []),
    [data],
  )

  // Hands this page's numbers to the Export button; null while still loading.
  useEffect(() => {
    if (!exportRef) return
    exportRef.current = () => (data ? moneySheets(data, {
      pairs: committedVsReceived ?? [],
      groupLabel: GROUP_OPTIONS.find((o) => o.key === groupBy)?.label ?? 'Group',
      collection,
      agingLabel: aging === 'all' ? '' : AGING_OPTIONS.find((o) => o.value === aging)?.label.replace(/ days late/, 'd late') ?? '',
    }) : null)
    return () => { exportRef.current = null }
  }, [exportRef, data, committedVsReceived, groupBy, collection, aging])

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
      <div className="kpirow kpirow--compact kpirow--six">
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
        <Kpi
          compact
          alert={!!data && data.overdueAll.count > 0}
          label="Overdue"
          value={formatMoney(data?.overdueAll.value ?? 0)}
          note={data ? `${data.overdueAll.count} instalments` : undefined}
          loading={!data}
        />
        <Kpi
          compact
          label="Due next 90 days"
          value={formatMoney(data?.dueSoon.value ?? 0)}
          note={data ? `${data.dueSoon.count} instalments` : undefined}
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

      <section className="card stack">
        <div>
          <div className="tn-micro">Collection by grant</div>
          <p className="chartsub tn-num">
            {data
              ? `${data.grantCount} grants · ${formatMoney(data.outstanding)} outstanding · most outstanding first`
              : 'Most outstanding first'}
          </p>
        </div>
        {!data ? (
          <TableSkeleton rows={5} cols={8} />
        ) : collection.length === 0 ? (
          <EmptyState
            title="No grants yet"
            body="Grants are created when an opportunity is won, and their money appears here."
          />
        ) : (
          <div className="tablewrap tablescroll">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Agreement</th>
                  <th>Category</th>
                  <th>FCRA</th>
                  <th style={{ textAlign: 'right' }}>Committed</th>
                  <th style={{ textAlign: 'right' }}>Received</th>
                  <th style={{ textAlign: 'right' }}>Outstanding</th>
                  <th>Collection</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {collection.map((g) => {
                  const extra = data.extras.get(g.id)
                  return (
                    <tr key={g.id}>
                      {/* The organisation rides under the agreement name rather than in a
                          column of its own, which is what lets the table fit without a
                          sideways scroll. */}
                      <td className="cell-wrap">
                        <Link to="/grants/$id" params={{ id: g.id }} className="celllink">
                          {breakable(extra?.name ?? g.org_name ?? 'Grant')}
                        </Link>
                        {extra?.name && g.org_name ? <div className="cell-sub">{g.org_name}</div> : null}
                      </td>
                      <td className="muted">{labelOf(CAPITAL_CATEGORIES, g.capital_category)}</td>
                      <td>
                        <Badge tone={g.is_fcra ? 'fcra' : 'domestic'}>{g.is_fcra ? 'FCRA' : 'Domestic'}</Badge>
                      </td>
                      <td className="tn-num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(g.total_value_inr)}</td>
                      <td className="tn-num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(g.received_inr)}</td>
                      <td className="tn-num muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(g.outstanding_inr)}</td>
                      <td>
                        <div className="progress" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, g.collection_pct)}%` }} />
                        </div>
                        <span className="tn-num muted">{Math.round(g.collection_pct)}%</span>
                      </td>
                      <td><Badge tone="outline">{g.status}</Badge></td>
                      <td><RagBadge value={extra?.health ?? null} /></td>
                      <td className="muted">{g.owner_name ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="chartgrid">
        <ChartCard
          title="FCRA receipts by fiscal year"
          subtitle="Foreign contribution received, for the FC-4 annual return"
          data={data?.fcraByFy ?? null}
          emptyBody="No foreign contribution has been received yet."
        >
          <VBar data={data?.fcraByFy ?? []} valueLabel="received" />
        </ChartCard>

        <ChartCard
          title="FCRA receipts by bank"
          subtitle="Foreign contribution must land in TNF or NLF FCRA"
          data={data?.banks ?? null}
          emptyBody="Money received will be split by receiving entity here."
          actions={data ? (
            <span className="muted tn-num" style={{ fontSize: 'var(--text-xs)', textAlign: 'right' }}>
              FCRA {formatMoney(data.fcraReceived)} · Domestic {formatMoney(data.domesticReceived)}
            </span>
          ) : undefined}
        >
          <HBar data={data?.banks ?? []} valueLabel="received" />
        </ChartCard>
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

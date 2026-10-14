import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, TableSkeleton } from '../ui'
import { ChartCard, Donut, GroupedVBar, HBar, Kpi, type Datum } from '../charts'
import type { DashboardFilters } from '../../routes/_app.dashboards'
import { CAPITAL_CATEGORIES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney, formatPct } from '../../lib/format'
import { parseFyList, shortFyLabel } from '../../lib/fy'
import { isoToDate, type ExportRef, type SheetSpec } from '../../lib/export/workbook'

type Agg = { label: string | null; value: number | null; count: number }

type StageAgg = { label: string | null; sort: number; value: number | null; weighted: number | null; count: number }

type TopDeal = {
  id: string
  name: string
  org_name: string | null
  stage_label: string | null
  amount_inr: number | null
  weighted_inr: number | null
  owner_name: string | null
  expected_close_date: string | null
}

type FyRow = { label: string; open: number; won: number }
type WinRow = { label: string; won: number; lost: number }

type Data = {
  openCount: number
  openValue: number
  weighted: number
  wonCount: number
  wonValue: number
  lostCount: number
  stages: StageAgg[]
  byCategory: Datum[]
  byProgram: Datum[]
  byGeography: Datum[]
  byFy: FyRow[]
  winByCategory: WinRow[]
  top: TopDeal[]
}

type StageMeasure = 'count' | 'value' | 'weighted'
const STAGE_MEASURES: Array<{ key: StageMeasure; label: string }> = [
  { key: 'count', label: 'Count' },
  { key: 'value', label: 'Value' },
  { key: 'weighted', label: 'Weighted' },
]

/**
 * Each capital category keeps one colour whatever its size, so the donut never
 * repaints when a filter reorders the slices.
 */
const CATEGORY_COLOURS: Record<string, string> = {
  programmatic: 'var(--brown-700)',
  unrestricted: 'var(--brown-500)',
  corpus: 'var(--brown-300)',
}

const FY_SERIES = [
  { key: 'open', label: 'Open', color: 'var(--brown-400)' },
  { key: 'won', label: 'Won', color: 'var(--brown-700)' },
]

/** Every number on the page, as sheets — what the Excel export writes. */
function leadershipSheets(d: Data): SheetSpec[] {
  const n = (v: number | null | undefined) => Number(v ?? 0)
  const decided = d.wonCount + d.lostCount
  const valueSheet = (name: string, header: string, rows: Datum[]): SheetSpec => ({
    name,
    columns: [{ header, width: 26 }, { header: 'Open value (INR)', kind: 'inr', width: 20 }],
    rows: rows.map((r) => [r.label, r.value]),
  })
  return [
    {
      name: 'Summary',
      columns: [{ header: 'Measure', width: 30 }, { header: 'Value', width: 20 }],
      rows: [
        ['Open pipeline (INR)', { value: d.openValue, kind: 'inr' }],
        ['Open deals', { value: d.openCount, kind: 'int' }],
        ['Weighted pipeline (INR)', { value: d.weighted, kind: 'inr' }],
        ['Won (INR)', { value: d.wonValue, kind: 'inr' }],
        ['Won deals', { value: d.wonCount, kind: 'int' }],
        ['Lost deals', { value: d.lostCount, kind: 'int' }],
        ['Win rate', { value: decided > 0 ? Math.round((d.wonCount / decided) * 1000) / 10 : null, kind: 'pct' }],
      ],
    },
    {
      name: 'By stage',
      columns: [
        { header: 'Stage', width: 26 },
        { header: 'Deals', kind: 'int' },
        { header: 'Value (INR)', kind: 'inr', width: 18 },
        { header: 'Weighted (INR)', kind: 'inr', width: 18 },
      ],
      rows: [...d.stages].sort((a, b) => a.sort - b.sort)
        .map((s) => [s.label ?? '—', n(s.count), n(s.value), n(s.weighted)]),
    },
    valueSheet('By capital category', 'Category', d.byCategory),
    valueSheet('By program', 'Program', d.byProgram),
    valueSheet('By geography', 'Geography', d.byGeography),
    {
      name: 'By fiscal year',
      columns: [
        { header: 'Year', width: 14 },
        { header: 'Open (INR)', kind: 'inr', width: 18 },
        { header: 'Won (INR)', kind: 'inr', width: 18 },
      ],
      rows: d.byFy.map((r) => [r.label, r.open, r.won]),
    },
    {
      name: 'Win rate',
      columns: [
        { header: 'Category', width: 24 },
        { header: 'Won', kind: 'int' },
        { header: 'Lost', kind: 'int' },
        { header: 'Win rate', kind: 'pct' },
      ],
      rows: d.winByCategory.map((r) => [
        r.label, r.won, r.lost, r.won + r.lost > 0 ? Math.round((r.won / (r.won + r.lost)) * 1000) / 10 : null,
      ]),
    },
    {
      name: 'Largest open deals',
      columns: [
        { header: 'Deal', width: 36 },
        { header: 'Donor', width: 28 },
        { header: 'Stage', width: 22 },
        { header: 'Amount (INR)', kind: 'inr', width: 18 },
        { header: 'Weighted (INR)', kind: 'inr', width: 18 },
        { header: 'Expected close', kind: 'date', width: 16 },
        { header: 'Owner', width: 22 },
      ],
      rows: d.top.map((t) => [
        t.name, t.org_name, t.stage_label, t.amount_inr, t.weighted_inr, isoToDate(t.expected_close_date), t.owner_name,
      ]),
    },
  ]
}

/** Aggregates come back as one row per group; drop empty buckets. */
function toData(rows: Agg[] | null, fallback = '—'): Datum[] {
  return (rows ?? [])
    .map((r) => ({ label: r.label?.trim() || fallback, value: Number(r.value ?? 0) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
}

export function LeadershipDashboard({ filters, exportRef }: { filters: DashboardFilters; exportRef?: ExportRef }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<StageMeasure>('value')

  const load = useCallback(async () => {
    setData(null)
    setError(null)

    // Every cut shares the same global filters. `.match()` applies them all in
    // one call, which avoids threading a Supabase query builder through a
    // helper — its generics recurse badly when passed around.
    const scope: Record<string, string> = {}
    if (filters.owner) scope.owner_user_id = filters.owner
    if (filters.category) scope.capital_category = filters.category

    // Several FYs can be picked, which .match() cannot express, so years go
    // through .in(). The builder is cast rather than typed: Supabase's generics
    // recurse badly when a builder passes through a helper.
    const fys = parseFyList(filters.fy)
    const withFy = <Q,>(q: Q): Q => (fys.length
      ? (q as unknown as { in: (c: string, v: string[]) => Q }).in('fiscal_year', fys)
      : q)

    // Quarters narrow every cut that has a fiscal_quarter column.
    const quarters = parseFyList(filters.quarter)
    const withPeriod = <Q,>(q: Q): Q => (quarters.length
      ? (withFy(q) as unknown as { in: (c: string, v: string[]) => Q }).in('fiscal_quarter', quarters)
      : withFy(q))

    const F = <C extends string>(cols: C) => withPeriod(supabase.from('v_fr_opportunity_facts').select(cols))

    // The program view has no quarter column, so with a quarter picked the sums
    // are made here, from the deals that match it. (The view is small — a
    // couple of hundred rows — so reading it whole is cheap.)
    const programAgg = async (): Promise<{ data: Agg[] | null; error: { message: string } | null }> => {
      if (!quarters.length) {
        const r = await withFy(supabase.from('v_fr_opportunity_program_facts')
          .select('label:program_code,value:amount_inr.sum(),count:opportunity_id.count()'))
          .match(scope).eq('is_open', true)
        return { data: r.data as unknown as Agg[] | null, error: r.error }
      }
      const [ids, rows] = await Promise.all([
        F('id').match(scope).eq('is_open', true),
        withFy(supabase.from('v_fr_opportunity_program_facts')
          .select('program_code,amount_inr,opportunity_id')).match(scope).eq('is_open', true),
      ])
      if (ids.error || rows.error) return { data: null, error: ids.error ?? rows.error }
      const keep = new Set(((ids.data ?? []) as unknown as Array<{ id: string }>).map((d) => d.id))
      const sums = new Map<string, Agg>()
      for (const r of (rows.data ?? []) as unknown as Array<{ program_code: string | null; amount_inr: number | null; opportunity_id: string }>) {
        if (!keep.has(r.opportunity_id)) continue
        const key = r.program_code ?? '—'
        const cur = sums.get(key) ?? { label: key, value: 0, count: 0 }
        cur.value = Number(cur.value ?? 0) + Number(r.amount_inr ?? 0)
        cur.count += 1
        sums.set(key, cur)
      }
      return { data: [...sums.values()], error: null }
    }

    const [openAgg, closedAgg, stage, category, program, geography, fyOpen, fyWon, wins, top] = await Promise.all([
      F('value:amount_inr.sum(),weighted:weighted_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true).single(),
      F('label:terminal_type,value:amount_inr.sum(),count:id.count()')
        .match(scope).not('terminal_type', 'is', null),
      F('label:stage_label,sort:stage_sort_order.min(),value:amount_inr.sum(),weighted:weighted_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true),
      F('label:capital_category,value:amount_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true),
      // Program rollups live on their own view — one row per (deal, program).
      programAgg(),
      F('label:geography,value:amount_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true),
      F('label:fiscal_year,value:amount_inr.sum()')
        .match(scope).eq('is_open', true),
      F('label:fiscal_year,value:amount_inr.sum()')
        .match(scope).eq('terminal_type', 'won'),
      F('label:capital_category,terminal_type,count:id.count()')
        .match(scope).not('terminal_type', 'is', null),
      // nullsFirst:false matters — Postgres sorts NULLs first on DESC, so
      // without it the "largest" deals are the ones with no amount at all.
      F('id,name,org_name,stage_label,amount_inr,weighted_inr,owner_name,expected_close_date')
        .match(scope).eq('is_open', true)
        .not('amount_inr', 'is', null)
        .order('amount_inr', { ascending: false, nullsFirst: false })
        .limit(10),
    ])

    const firstError = [openAgg, closedAgg, stage, category, program, geography, fyOpen, fyWon, wins, top]
      .find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return }

    const closed = (closedAgg.data ?? []) as Agg[]
    const won = closed.find((c) => c.label === 'won')
    const lost = closed.find((c) => c.label === 'lost')
    const o = (openAgg.data ?? {}) as { value: number | null; weighted: number | null; count: number }

    // Open and won side by side per FY. Deals with no close date have no FY;
    // they are kept as their own column rather than silently dropped.
    const fyMap = new Map<string, FyRow>()
    const addFy = (rows: Agg[] | null, key: 'open' | 'won') => {
      for (const r of rows ?? []) {
        const label = r.label ?? 'No date'
        const row = fyMap.get(label) ?? { label, open: 0, won: 0 }
        row[key] += Number(r.value ?? 0)
        fyMap.set(label, row)
      }
    }
    addFy(fyOpen.data as Agg[], 'open')
    addFy(fyWon.data as Agg[], 'won')
    const byFy = [...fyMap.values()]
      .filter((r) => r.open > 0 || r.won > 0)
      .sort((a, b) => (a.label === 'No date' ? -1 : b.label === 'No date' ? 1 : a.label.localeCompare(b.label)))
      .map((r) => ({ ...r, label: shortFyLabel(r.label) }))

    const winMap = new Map<string, WinRow>()
    for (const r of (wins.data ?? []) as Array<{ label: string | null; terminal_type: string; count: number }>) {
      const label = labelOf(CAPITAL_CATEGORIES, r.label ?? '') || '—'
      const row = winMap.get(label) ?? { label, won: 0, lost: 0 }
      if (r.terminal_type === 'won') row.won += Number(r.count)
      if (r.terminal_type === 'lost') row.lost += Number(r.count)
      winMap.set(label, row)
    }

    setData({
      openCount: Number(o.count ?? 0),
      openValue: Number(o.value ?? 0),
      weighted: Number(o.weighted ?? 0),
      wonCount: Number(won?.count ?? 0),
      wonValue: Number(won?.value ?? 0),
      lostCount: Number(lost?.count ?? 0),
      stages: (stage.data ?? []) as StageAgg[],
      byCategory: toData(category.data as Agg[])
        .map((d) => ({
          ...d,
          color: CATEGORY_COLOURS[d.label] ?? 'var(--taupe-300)',
          label: labelOf(CAPITAL_CATEGORIES, d.label),
        })),
      byProgram: toData(program.data as Agg[]),
      byGeography: toData(geography.data as Agg[], 'Not recorded').slice(0, 8),
      byFy,
      winByCategory: [...winMap.values()].sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
      top: (top.data ?? []) as TopDeal[],
    })
  }, [filters.fy, filters.quarter, filters.owner, filters.category])

  useEffect(() => { void load() }, [load])

  // Hands this page's numbers to the Export button; null while still loading.
  useEffect(() => {
    if (!exportRef) return
    exportRef.current = () => (data ? leadershipSheets(data) : null)
    return () => { exportRef.current = null }
  }, [exportRef, data])

  // Stage keeps pipeline order rather than sorting by value — the shape of
  // the funnel is the point. The measure is re-cut from memory, no refetch.
  const byStage = useMemo<Datum[] | null>(() => {
    if (!data) return null
    return [...data.stages]
      .sort((a, b) => b.sort - a.sort)
      .map((r) => ({
        label: r.label ?? '—',
        value: Number((measure === 'count' ? r.count : measure === 'weighted' ? r.weighted : r.value) ?? 0),
      }))
  }, [data, measure])

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

  const decided = (data?.wonCount ?? 0) + (data?.lostCount ?? 0)
  const winRate = decided > 0 ? Math.round(((data?.wonCount ?? 0) / decided) * 100) : null

  // Most historical deals never recorded a program, so the chart states how
  // much of the pipeline it actually speaks for — without this it reads as if
  // it were the whole thing.
  const attributed = (data?.byProgram ?? []).reduce((s, d) => s + d.value, 0)
  const programCoverage = data
    ? `${formatMoney(attributed)} of ${formatMoney(data.openValue)} open pipeline has a program recorded`
    : undefined

  return (
    <div className="stack">
      <div className="kpirow kpirow--compact">
        <Kpi
          compact
          label="Open pipeline"
          value={formatMoney(data?.openValue ?? 0)}
          note={data ? `${data.openCount} deals` : undefined}
          loading={!data}
        />
        <Kpi
          compact
          label="Weighted pipeline"
          value={formatMoney(data?.weighted ?? 0)}
          note="By stage probability"
          loading={!data}
        />
        <Kpi
          compact
          label="Won"
          value={formatMoney(data?.wonValue ?? 0)}
          note={data ? `${data.wonCount} deals` : undefined}
          loading={!data}
        />
        <Kpi
          compact
          label="Win rate"
          value={winRate === null ? '—' : formatPct(winRate)}
          note={data ? `${data.wonCount} won of ${decided} decided` : undefined}
          loading={!data}
        />
      </div>

      <div className="chartgrid">
        <ChartCard
          title="Open pipeline by stage"
          subtitle="In pipeline order, latest stage at the top"
          data={byStage}
          emptyBody="No open deals match these filters."
          actions={
            <div className="viewswitch">
              {STAGE_MEASURES.map((m) => (
                <button key={m.key} data-active={measure === m.key} onClick={() => setMeasure(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          }
        >
          <HBar
            data={byStage ?? []}
            money={measure !== 'count'}
            valueLabel={measure === 'count' ? 'deals' : measure === 'weighted' ? 'weighted' : 'open'}
          />
        </ChartCard>

        <ChartCard
          title="Open pipeline by capital category"
          data={data?.byCategory ?? null}
          emptyBody="No open deals match these filters."
          fill
        >
          <Donut data={data?.byCategory ?? []} centerLabel="Open" />
        </ChartCard>

        <ChartCard
          title="Open pipeline by program"
          subtitle={programCoverage}
          data={data?.byProgram ?? null}
          emptyBody="No open deals have a program attached. Programs are set on an opportunity's Programs tab."
        >
          <HBar data={data?.byProgram ?? []} valueLabel="open" />
        </ChartCard>

        <ChartCard
          title="Open pipeline by geography"
          subtitle="Falls back to the donor's country when the deal has none"
          data={data?.byGeography ?? null}
          emptyBody="No open deals match these filters."
        >
          <HBar data={data?.byGeography ?? []} valueLabel="open" />
        </ChartCard>

        <ChartCard
          title="Pipeline by fiscal year"
          subtitle="Open against won, by expected close"
          data={data?.byFy ?? null}
          emptyBody="No deals match these filters."
        >
          <GroupedVBar data={data?.byFy ?? []} series={FY_SERIES} />
        </ChartCard>

        <section className="card stack">
          <div>
            <div className="tn-micro">Win rate by capital category</div>
            <p className="chartsub">Deals already won or lost</p>
          </div>
          {!data ? (
            <TableSkeleton rows={3} cols={4} />
          ) : data.winByCategory.length === 0 ? (
            <EmptyState title="Nothing decided yet" body="Win rate appears once deals are won or lost." />
          ) : (
            <div className="tablewrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Won</th>
                    <th style={{ textAlign: 'right' }}>Lost</th>
                    <th style={{ textAlign: 'right' }}>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.winByCategory.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="tn-num" style={{ textAlign: 'right' }}>{r.won}</td>
                      <td className="tn-num" style={{ textAlign: 'right' }}>{r.lost}</td>
                      <td className="tn-num" style={{ textAlign: 'right' }}>
                        {r.won + r.lost > 0 ? formatPct(Math.round((r.won / (r.won + r.lost)) * 1000) / 10) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card stack">
        <div className="tn-micro">Largest open opportunities</div>
        {!data ? (
          <TableSkeleton rows={5} cols={5} />
        ) : data.top.length === 0 ? (
          <EmptyState title="Nothing open" body="No open deals match these filters." />
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: '170px' }}>Donor</th>
                  <th style={{ width: '150px' }}>Stage</th>
                  <th style={{ width: '110px' }}>Amount</th>
                  <th style={{ width: '110px' }}>Weighted</th>
                  <th style={{ width: '112px' }}>Close</th>
                </tr>
              </thead>
              <tbody>
                {data.top.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to="/opportunities/$id" params={{ id: d.id }} className="celllink">
                        {d.name}
                      </Link>
                    </td>
                    <td className="muted">{d.org_name ?? '—'}</td>
                    <td><Badge tone="brown">{d.stage_label ?? '—'}</Badge></td>
                    <td className="tn-num">{formatMoney(d.amount_inr)}</td>
                    <td className="tn-num muted">{formatMoney(d.weighted_inr)}</td>
                    <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(d.expected_close_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

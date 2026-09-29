import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, TableSkeleton } from '../ui'
import { ChartCard, HBar, Kpi, type Datum } from '../charts'
import type { DashboardFilters } from '../../routes/_app.dashboards'
import { CAPITAL_CATEGORIES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney, formatPct } from '../../lib/format'
import { parseFyList } from '../../lib/fy'

type Agg = { label: string | null; value: number | null; count: number }

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

type Data = {
  openCount: number
  openValue: number
  weighted: number
  wonCount: number
  wonValue: number
  lostCount: number
  byStage: Datum[]
  byCategory: Datum[]
  byProgram: Datum[]
  byGeography: Datum[]
  top: TopDeal[]
}

/** Aggregates come back as one row per group; drop empty buckets. */
function toData(rows: Agg[] | null, fallback = '—'): Datum[] {
  return (rows ?? [])
    .map((r) => ({ label: r.label?.trim() || fallback, value: Number(r.value ?? 0) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
}

export function LeadershipDashboard({ filters }: { filters: DashboardFilters }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

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

    const F = <C extends string>(cols: C) => withFy(supabase.from('v_fr_opportunity_facts').select(cols))

    const [openAgg, closedAgg, stage, category, program, geography, top] = await Promise.all([
      F('value:amount_inr.sum(),weighted:weighted_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true).single(),
      F('label:terminal_type,value:amount_inr.sum(),count:id.count()')
        .match(scope).not('terminal_type', 'is', null),
      F('label:stage_label,sort:stage_sort_order.min(),value:amount_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true),
      F('label:capital_category,value:amount_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true),
      // Program rollups live on their own view — one row per (deal, program).
      withFy(supabase.from('v_fr_opportunity_program_facts')
        .select('label:program_code,value:amount_inr.sum(),count:opportunity_id.count()'))
        .match(scope).eq('is_open', true),
      F('label:geography,value:amount_inr.sum(),count:id.count()')
        .match(scope).eq('is_open', true),
      // nullsFirst:false matters — Postgres sorts NULLs first on DESC, so
      // without it the "largest" deals are the ones with no amount at all.
      F('id,name,org_name,stage_label,amount_inr,weighted_inr,owner_name,expected_close_date')
        .match(scope).eq('is_open', true)
        .not('amount_inr', 'is', null)
        .order('amount_inr', { ascending: false, nullsFirst: false })
        .limit(10),
    ])

    const firstError = [openAgg, closedAgg, stage, category, program, geography, top]
      .find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return }

    const closed = (closedAgg.data ?? []) as Agg[]
    const won = closed.find((c) => c.label === 'won')
    const lost = closed.find((c) => c.label === 'lost')
    const o = (openAgg.data ?? {}) as { value: number | null; weighted: number | null; count: number }

    // Stage keeps pipeline order rather than sorting by value — the shape of
    // the funnel is the point.
    const stageRows = ((stage.data ?? []) as Array<Agg & { sort: number }>)
      .map((r) => ({ label: r.label ?? '—', value: Number(r.value ?? 0), sort: r.sort }))
      .sort((a, b) => b.sort - a.sort)

    setData({
      openCount: Number(o.count ?? 0),
      openValue: Number(o.value ?? 0),
      weighted: Number(o.weighted ?? 0),
      wonCount: Number(won?.count ?? 0),
      wonValue: Number(won?.value ?? 0),
      lostCount: Number(lost?.count ?? 0),
      byStage: stageRows,
      byCategory: toData(category.data as Agg[])
        .map((d) => ({ ...d, label: labelOf(CAPITAL_CATEGORIES, d.label) })),
      byProgram: toData(program.data as Agg[]),
      byGeography: toData(geography.data as Agg[], 'Not recorded').slice(0, 8),
      top: (top.data ?? []) as TopDeal[],
    })
  }, [filters.fy, filters.owner, filters.category])

  useEffect(() => { void load() }, [load])

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
          data={data?.byStage ?? null}
          emptyBody="No open deals match these filters."
        >
          <HBar data={data?.byStage ?? []} valueLabel="open" />
        </ChartCard>

        <ChartCard
          title="Open pipeline by capital category"
          data={data?.byCategory ?? null}
          emptyBody="No open deals match these filters."
          height={200}
        >
          <HBar data={data?.byCategory ?? []} valueLabel="open" />
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

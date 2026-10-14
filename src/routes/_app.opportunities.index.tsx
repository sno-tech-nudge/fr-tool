import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, EmptyState, SearchInput, Select, Skeleton, TableSkeleton, useToast,
} from '../components/ui'
import { OpportunityForm } from '../components/opportunities/OpportunityForm'
import { WonWizard } from '../components/grants/WonWizard'
import { KanbanBoard, type BoardCard } from '../components/opportunities/KanbanBoard'
import { StageMoveDialog } from '../components/opportunities/StageMoveDialog'
import { moveOpportunityStage, stageMoveRequirement, type StageMoveExtras } from '../components/opportunities/stageMove'
import { CAPITAL_CATEGORIES, DEAL_CATEGORIES, labelOf } from '../lib/enums'
import { MultiSelect } from '../components/MultiSelect'
import { formatDate, formatMoney } from '../lib/format'
import { QUARTER_OPTIONS, fiscalYearOptions, joinFyList, parseFyList } from '../lib/fy'
import { ExportMenu } from '../components/ExportMenu'
import { downloadWorkbook, fileSlug, isoToDate, today, type SheetSpec } from '../lib/export/workbook'
import { useAccess } from '../lib/accessContext'
import { ANY_OWNER, effectiveOwner, ownerParam, ownerSelectValue } from '../lib/ownerFilter'
import { useEmployees } from '../hooks/useEmployees'
import { usePipelineStages, type Stage } from '../hooks/usePipelineStages'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { sanitizeSearch } from '../lib/query'

export const Route = createFileRoute('/_app/opportunities/')({ component: OpportunitiesPage })

const DEFAULTS = {
  view: 'board', q: '', owner: '', capital_category: '', deal_category: '',
  fy: '', quarter: '', open: '',
}

const SELECT_COLS = '*, fr_organisations(id, name)'

/** What the Excel export reads: the same deals, with the organisation's name. */
type ExportDeal = {
  id: string
  name: string
  capital_category: string
  deal_category: string | null
  stage_id: string
  amount: number | null
  currency: string
  amount_inr: number | null
  probability_pct: number | null
  expected_close_date: string | null
  fiscal_year: string | null
  fiscal_quarter: string | null
  owner_user_id: string
  geography: string | null
  next_step: string | null
  next_step_date: string | null
  source_detail: string | null
  created_at: string
  updated_at: string
  fr_organisations: { name: string } | null
}

/** The subset of an opportunity the won-wizard needs to prefill itself. */
type WonSubject = {
  id: string
  name: string
  organisation_id: string
  capital_category: string
  amount: number | null
  currency: string
  amount_inr: number | null
  owner_user_id: string
  expected_close_date: string | null
}

function OpportunitiesPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const access = useAccess()
  const { employees } = useEmployees()
  const { stages, loading: stagesLoading } = usePipelineStages()
  const { filters, setFilter } = useUrlFilters(DEFAULTS)

  const [cards, setCards] = useState<BoardCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const [pendingMove, setPendingMove] = useState<{ card: BoardCard; toStage: Stage } | null>(null)
  const [moving, setMoving] = useState(false)
  const [wonDeal, setWonDeal] = useState<WonSubject | null>(null)

  const isBoard = filters.view !== 'list'

  // The board defaults to open deals only (it's a working view) and the list
  // defaults to everything — but either can be overridden explicitly via the
  // Status select, which is why an unset filter resolves per-view rather than
  // a plain default value.
  const effectiveStatus = filters.open || (isBoard ? 'open' : 'all')
  const openOnly = effectiveStatus === 'open'

  /**
   * The pipeline query with every filter applied. The board and the Excel
   * export both start from it, so an export is exactly what the filters show.
   */
  const filteredQuery = useCallback((cols: string) => {
    let q = supabase.from('fr_opportunities').select(cols).is('deleted_at', null)

    if (filters.q) q = q.ilike('name', `%${sanitizeSearch(filters.q)}%`)
    const owner = effectiveOwner(filters.owner, access.employeeId)
    if (owner) q = q.eq('owner_user_id', owner)
    if (filters.capital_category) q = q.eq('capital_category', filters.capital_category)
    if (filters.deal_category) q = q.eq('deal_category', filters.deal_category)
    const fys = parseFyList(filters.fy)
    if (fys.length) q = q.in('fiscal_year', fys)
    const quarters = parseFyList(filters.quarter)
    if (quarters.length) q = q.in('fiscal_quarter', quarters)

    if (openOnly) {
      const terminal = stages.filter((s) => s.is_terminal).map((s) => s.id)
      if (terminal.length) q = q.not('stage_id', 'in', `(${terminal.join(',')})`)
    }
    return q
  }, [
    filters.q, filters.owner, filters.capital_category, filters.deal_category,
    filters.fy, filters.quarter, openOnly, stages, access.employeeId,
  ])

  const load = useCallback(async () => {
    setCards(null)
    setError(null)
    const { data, error: err } = await filteredQuery(SELECT_COLS)
      .order('updated_at', { ascending: false }).limit(500)
    if (err) { setError(err.message); setCards([]); return }
    setCards((data ?? []) as unknown as BoardCard[])
  }, [filteredQuery])

  useEffect(() => { if (!stagesLoading) void load() }, [load, stagesLoading])

  /* ---- export ---- */

  /** Every deal the current filters match — not just the 500 the board loads. */
  async function exportExcel() {
    const deals: ExportDeal[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error: err } = await filteredQuery('*, fr_organisations(name)')
        .order('id').range(from, from + 999)
      if (err) throw new Error(err.message)
      deals.push(...((data ?? []) as unknown as ExportDeal[]))
      if (!data || data.length < 1000) break
    }

    const stageOf = new Map(stages.map((s) => [s.id, s]))
    const ownerOf = new Map(employees.map((e) => [e.id, e.name]))
    const status = (s?: Stage) => (s?.terminal_type === 'won' ? 'Won' : s?.terminal_type === 'lost' ? 'Lost' : 'Open')
    const day = (iso: string | null) => isoToDate(iso?.slice(0, 10))

    deals.sort((a, b) =>
      (stageOf.get(a.stage_id)?.sort_order ?? 99) - (stageOf.get(b.stage_id)?.sort_order ?? 99)
      || a.name.localeCompare(b.name))

    const pipeline: SheetSpec = {
      name: 'Pipeline',
      columns: [
        { header: 'Deal', width: 38 },
        { header: 'Organisation', width: 30 },
        { header: 'Stage', width: 22 },
        { header: 'Status', width: 10 },
        { header: 'Capital category', width: 16 },
        { header: 'NBD / PM', width: 10 },
        { header: 'Amount', kind: 'inr', width: 16 },
        { header: 'Currency', width: 10 },
        { header: 'Amount (INR)', kind: 'inr', width: 18 },
        { header: 'Win %', kind: 'int', width: 8 },
        { header: 'Weighted (INR)', kind: 'inr', width: 18 },
        { header: 'Expected close', kind: 'date', width: 16 },
        { header: 'Fiscal year', width: 12 },
        { header: 'Quarter', width: 9 },
        { header: 'Owner', width: 22 },
        { header: 'Geography', width: 18 },
        { header: 'Next step', width: 30 },
        { header: 'Next step date', kind: 'date', width: 16 },
        { header: 'Source', width: 10 },
        { header: 'Created', kind: 'date', width: 14 },
        { header: 'Last updated', kind: 'date', width: 14 },
      ],
      rows: deals.map((d) => {
        const stage = stageOf.get(d.stage_id)
        const pct = d.probability_pct ?? stage?.probability_pct ?? null
        return [
          d.name, d.fr_organisations?.name ?? null, stage?.label ?? null, status(stage),
          labelOf(CAPITAL_CATEGORIES, d.capital_category), d.deal_category,
          d.amount, d.currency, d.amount_inr, pct,
          d.amount_inr != null && pct != null ? Math.round((d.amount_inr * pct) / 100) : null,
          isoToDate(d.expected_close_date), d.fiscal_year, d.fiscal_quarter,
          ownerOf.get(d.owner_user_id) ?? null, d.geography, d.next_step, isoToDate(d.next_step_date),
          d.source_detail === 'zoho' ? 'Zoho' : d.source_detail === 'sheet' ? 'Sheet' : 'Manual',
          day(d.created_at), day(d.updated_at),
        ]
      }),
    }

    const ownerId = effectiveOwner(filters.owner, access.employeeId)
    const fyText = parseFyList(filters.fy).join(', ')
    const quarterText = parseFyList(filters.quarter).join(', ')
    const applied: SheetSpec = {
      name: 'Filters',
      columns: [{ header: 'Filter', width: 22 }, { header: 'Applied', width: 40 }],
      rows: [
        ['Search', filters.q || 'None'],
        ['Owner', ownerId ? ownerOf.get(ownerId) ?? '—' : 'Anyone'],
        ['Capital category', filters.capital_category ? labelOf(CAPITAL_CATEGORIES, filters.capital_category) : 'All'],
        ['NBD / PM', filters.deal_category || 'All'],
        ['Financial year', fyText || 'All years'],
        ['Quarter', quarterText || 'All quarters'],
        ['Status', openOnly ? 'Open only' : 'Including closed'],
        ['Deals exported', { value: deals.length, kind: 'int' }],
        ['Exported by', access.employeeName ?? ''],
        ['Exported on', new Date().toLocaleString('en-GB')],
      ],
    }

    await downloadWorkbook(
      `${fileSlug('Pipeline', fyText || 'All-years', quarterText.replace(/, /g, '-'), today())}.xlsx`,
      [pipeline, applied],
    )
    toast.success(`${deals.length} ${deals.length === 1 ? 'deal' : 'deals'} exported.`)
  }

  /* ---- stage move ---- */

  function requestMove(card: BoardCard, toStage: Stage) {
    // Anything with a precondition opens the dialog; the rest moves straight away.
    if (stageMoveRequirement(toStage) !== null) {
      setPendingMove({ card, toStage })
      return
    }
    void commitMove(card, toStage, {})
  }

  async function commitMove(card: BoardCard, toStage: Stage, extras: StageMoveExtras) {
    setMoving(true)
    // Optimistic: the card jumps columns immediately, and is put back if the
    // write fails.
    const previous = card.stage_id
    setCards((prev) => (prev ?? []).map((c) => (c.id === card.id ? { ...c, stage_id: toStage.id } : c)))

    const res = await moveOpportunityStage({
      opportunity: card, toStage, employeeId: access.employeeId, extras,
    })
    setMoving(false)
    setPendingMove(null)

    if (res.error) {
      setCards((prev) => (prev ?? []).map((c) => (c.id === card.id ? { ...c, stage_id: previous } : c)))
      toast.error(res.error)
      return
    }

    setCards((prev) => (prev ?? []).map((c) => (
      c.id === card.id ? { ...(res.opportunity as BoardCard), fr_organisations: c.fr_organisations } : c
    )))

    if (!res.historyWritten) {
      toast.error('Moved, but the stage history entry could not be written.')
    } else if (toStage.terminal_type !== 'won') {
      toast.success(`Moved to ${toStage.label}.`)
    }

    // A won deal goes straight into the wizard, so the grant is never left as
    // a bare header row. Dismissing it still leaves the stage change intact.
    if (toStage.terminal_type === 'won') {
      setWonDeal(res.opportunity as WonSubject)
    }

    // Only refetch if the current filter would actually exclude the card now
    // (open-only) — with "Include closed" selected it already belongs where it is.
    if (toStage.is_terminal && openOnly) void load()
  }

  const ownerName = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'
  const stageOf = (id: string) => stages.find((s) => s.id === id)

  const weighted = (cards ?? []).reduce(
    (sum, c) => sum + ((c.amount_inr ?? 0) * (c.probability_pct ?? 0)) / 100, 0,
  )
  const total = (cards ?? []).reduce((sum, c) => sum + (c.amount_inr ?? 0), 0)

  return (
    <div className={isBoard ? 'page page--board' : 'page'}>
      <div className="page__head">
        <div>
          <h1 className="page__title">Pipeline</h1>
          {cards === null ? (
            <Skeleton height={14} width={280} />
          ) : (
            <p className="page__sub tn-num">
              {cards.length} {openOnly ? 'open' : 'shown'} · {formatMoney(total)} · {formatMoney(weighted)} weighted
            </p>
          )}
        </div>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <div className="viewswitch">
            <button data-active={isBoard} onClick={() => setFilter('view', 'board')}>Board</button>
            <button data-active={!isBoard} onClick={() => setFilter('view', 'list')}>List</button>
          </div>
          <ExportMenu size="md" onExcel={exportExcel} />
          <Button iconLeft={<Plus size={15} />} onClick={() => setFormOpen(true)}>Add opportunity</Button>
        </div>
      </div>

      <div className="filterbar filterbar--compact">
        <SearchInput value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search" />
        <Select label="Owner" style={{ width: 176 }} value={ownerSelectValue(filters.owner, access.employeeId)} onChange={(e) => setFilter('owner', ownerParam(e.currentTarget.value, access.employeeId))}>
          <option value={ANY_OWNER}>Anyone</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select label="Category" style={{ width: 150 }} value={filters.capital_category} onChange={(e) => setFilter('capital_category', e.currentTarget.value)}>
          <option value="">All</option>
          {CAPITAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="NBD / PM" style={{ width: 92 }} value={filters.deal_category} onChange={(e) => setFilter('deal_category', e.currentTarget.value)}>
          <option value="">All</option>
          {DEAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <MultiSelect
          label="FY"
          width={130}
          options={fiscalYearOptions().map((fy) => ({ value: fy, label: fy }))}
          value={parseFyList(filters.fy)}
          onChange={(list) => setFilter('fy', joinFyList(list))}
        />
        <MultiSelect
          label="Quarter"
          width={120}
          options={QUARTER_OPTIONS}
          value={parseFyList(filters.quarter)}
          onChange={(list) => setFilter('quarter', joinFyList(list))}
        />
        <Select label="Status" style={{ width: 130 }} value={effectiveStatus} onChange={(e) => setFilter('open', e.currentTarget.value)}>
          <option value="open">Open only</option>
          <option value="all">Include closed</option>
        </Select>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load the pipeline"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : cards === null || stagesLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : cards.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No opportunities yet"
            body="Every deal in the pipeline lives here. Convert a lead, or add one directly."
            action={<Button iconLeft={<Plus size={15} />} onClick={() => setFormOpen(true)}>Add opportunity</Button>}
          />
        </div>
      ) : isBoard ? (
        <KanbanBoard stages={stages} cards={cards} onMove={requestMove} />
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: '180px' }}>Organisation</th>
                <th style={{ width: '170px' }}>Stage</th>
                <th style={{ width: '130px' }}>Amount</th>
                <th style={{ width: '120px' }}>Close</th>
                <th style={{ width: '150px' }}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((o) => {
                const stage = stageOf(o.stage_id)
                return (
                  <tr
                    key={o.id}
                    className="is-clickable"
                    onClick={() => navigate({ to: '/opportunities/$id', params: { id: o.id } })}
                  >
                    <td>
                      <Link
                        to="/opportunities/$id"
                        params={{ id: o.id }}
                        className="celllink"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.name}
                      </Link>
                      {o.is_confidential ? <> <Badge tone="outline">Confidential</Badge></> : null}
                    </td>
                    <td className="muted">
                      {o.fr_organisations ? (
                        <Link
                          to="/organisations/$id"
                          params={{ id: o.fr_organisations.id }}
                          className="celllink"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {o.fr_organisations.name}
                        </Link>
                      ) : '—'}
                    </td>
                    <td>
                      <Badge
                        tone={stage?.terminal_type === 'won' ? 'green'
                          : stage?.terminal_type === 'lost' ? 'red' : 'brown'}
                      >
                        {stage?.label ?? '—'}
                      </Badge>
                    </td>
                    <td className="tn-num">{formatMoney(o.amount_inr)}</td>
                    <td className="tn-num muted">{formatDate(o.expected_close_date)}</td>
                    <td className="muted">{ownerName(o.owner_user_id)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <OpportunityForm
        open={formOpen}
        opportunity={null}
        onClose={() => setFormOpen(false)}
        onSaved={(opp) => navigate({ to: '/opportunities/$id', params: { id: opp.id } })}
      />

      <WonWizard
        open={wonDeal !== null}
        opportunity={wonDeal}
        onClose={() => setWonDeal(null)}
        onCreated={(grantId) => navigate({ to: '/grants/$id', params: { id: grantId } })}
      />

      <StageMoveDialog
        open={pendingMove !== null}
        toStage={pendingMove?.toStage ?? null}
        opportunityId={pendingMove?.card.id ?? null}
        opportunityName={pendingMove?.card.name ?? ''}
        busy={moving}
        onCancel={() => setPendingMove(null)}
        onConfirm={(extras) => {
          if (pendingMove) void commitMove(pendingMove.card, pendingMove.toStage, extras)
        }}
      />
    </div>
  )
}

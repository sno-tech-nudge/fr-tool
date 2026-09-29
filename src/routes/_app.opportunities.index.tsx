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
import { CAPITAL_CATEGORIES, DEAL_CATEGORIES } from '../lib/enums'
import { MultiSelect } from '../components/MultiSelect'
import { formatDate, formatMoney } from '../lib/format'
import { fiscalYearOptions, joinFyList, parseFyList } from '../lib/fy'
import { useAccess } from '../lib/accessContext'
import { ANY_OWNER, effectiveOwner, ownerParam, ownerSelectValue } from '../lib/ownerFilter'
import { useEmployees } from '../hooks/useEmployees'
import { usePipelineStages, type Stage } from '../hooks/usePipelineStages'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { sanitizeSearch } from '../lib/query'

export const Route = createFileRoute('/_app/opportunities/')({ component: OpportunitiesPage })

const DEFAULTS = {
  view: 'board', q: '', owner: '', capital_category: '', deal_category: '',
  fy: '', open: '',
}

const SELECT_COLS = '*, fr_organisations(id, name)'

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

  const load = useCallback(async () => {
    setCards(null)
    setError(null)

    let q = supabase.from('fr_opportunities').select(SELECT_COLS).is('deleted_at', null)

    if (filters.q) q = q.ilike('name', `%${sanitizeSearch(filters.q)}%`)
    const owner = effectiveOwner(filters.owner, access.employeeId)
    if (owner) q = q.eq('owner_user_id', owner)
    if (filters.capital_category) q = q.eq('capital_category', filters.capital_category)
    if (filters.deal_category) q = q.eq('deal_category', filters.deal_category)
    const fys = parseFyList(filters.fy)
    if (fys.length) q = q.in('fiscal_year', fys)

    if (openOnly) {
      const terminal = stages.filter((s) => s.is_terminal).map((s) => s.id)
      if (terminal.length) q = q.not('stage_id', 'in', `(${terminal.join(',')})`)
    }

    const { data, error: err } = await q.order('updated_at', { ascending: false }).limit(500)
    if (err) { setError(err.message); setCards([]); return }
    setCards((data ?? []) as unknown as BoardCard[])
  }, [
    filters.q, filters.owner, filters.capital_category, filters.deal_category,
    filters.fy, openOnly, stages, access.employeeId,
  ])

  useEffect(() => { if (!stagesLoading) void load() }, [load, stagesLoading])

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
          <Button iconLeft={<Plus size={15} />} onClick={() => setFormOpen(true)}>Add opportunity</Button>
        </div>
      </div>

      <div className="filterbar filterbar--compact">
        <SearchInput value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search by name" />
        <Select label="Owner" style={{ width: 180 }} value={ownerSelectValue(filters.owner, access.employeeId)} onChange={(e) => setFilter('owner', ownerParam(e.currentTarget.value, access.employeeId))}>
          <option value={ANY_OWNER}>Anyone</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select label="Category" style={{ width: 150 }} value={filters.capital_category} onChange={(e) => setFilter('capital_category', e.currentTarget.value)}>
          <option value="">All</option>
          {CAPITAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="NBD / PM" style={{ width: 100 }} value={filters.deal_category} onChange={(e) => setFilter('deal_category', e.currentTarget.value)}>
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

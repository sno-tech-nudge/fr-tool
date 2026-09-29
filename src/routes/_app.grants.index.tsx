import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, EmptyState, Pagination, RagBadge, SearchInput, Select, Skeleton, TableSkeleton,
} from '../components/ui'
import { GrantForm } from '../components/grants/GrantForm'
import {
  CAPITAL_CATEGORIES, GRANT_STATUSES, grantStatusTone, labelOf,
} from '../lib/enums'
import { formatDate, formatMoney } from '../lib/format'
import { collectionPct, computeHealth } from '../lib/grants'
import { fiscalYearOptions, fiscalYearRange } from '../lib/fy'
import { useAccess } from '../lib/accessContext'
import { ANY_OWNER, effectiveOwner, ownerParam, ownerSelectValue } from '../lib/ownerFilter'
import { useEmployees } from '../hooks/useEmployees'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { sanitizeSearch } from '../lib/query'

export const Route = createFileRoute('/_app/grants/')({ component: GrantsPage })

const PAGE_SIZE = 50
const DEFAULTS = {
  q: '', owner: '', status: 'active', capital_category: '', fcra: '', fy: '', page: '1',
}

/**
 * Received-to-date is not a column — it is summed from the remittances hanging
 * off each grant's tranches. Health is likewise computed, not stored (see
 * computeHealth). Embedding both keeps the directory to one round trip; it
 * stays sane because the page itself is capped at 50 grants. Milestones need
 * no deleted_at filter here — the RLS select policy already excludes them.
 */
const SELECT_COLS =
  'id, agreement_number, capital_category, total_value_inr, currency, is_fcra, ' +
  'signed_date, start_date, end_date, status, owner_user_id, is_confidential, ' +
  'fr_organisations(id, name), fr_tranches(id, due_date, status, fr_remittances(amount_inr)), ' +
  'fr_compliance_milestones(due_date, status)'

type GrantRow = {
  id: string
  agreement_number: string | null
  capital_category: string
  total_value_inr: number
  currency: string
  is_fcra: boolean
  signed_date: string
  start_date: string
  end_date: string
  status: string
  owner_user_id: string
  is_confidential: boolean
  fr_organisations: { id: string; name: string } | null
  fr_tranches: Array<{
    id: string
    due_date: string
    status: string
    fr_remittances: Array<{ amount_inr: number }>
  }>
  fr_compliance_milestones: Array<{ due_date: string; status: string }>
}

function receivedOf(g: GrantRow): number {
  return (g.fr_tranches ?? []).reduce(
    (sum, t) => sum + (t.fr_remittances ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0),
    0,
  )
}

function healthOf(g: GrantRow): 'green' | 'amber' | 'red' {
  return computeHealth([
    ...(g.fr_tranches ?? []).map((t) => ({ status: t.status, due_date: t.due_date })),
    ...(g.fr_compliance_milestones ?? []).map((m) => ({ status: m.status, due_date: m.due_date })),
  ])
}

function GrantsPage() {
  const navigate = useNavigate()
  const { employees } = useEmployees()
  const access = useAccess()
  const { filters, setFilter } = useUrlFilters(DEFAULTS)

  const [rows, setRows] = useState<GrantRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const page = Math.max(1, Number(filters.page) || 1)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)

    // Searching by donor name filters on the embedded organisation, which
    // requires an inner join — so the embed shape changes with the query.
    const cols = filters.q
      ? SELECT_COLS.replace('fr_organisations(', 'fr_organisations!inner(')
      : SELECT_COLS

    let q = supabase.from('fr_grants').select(cols, { count: 'exact' }).is('deleted_at', null)

    if (filters.q) q = q.ilike('fr_organisations.name', `%${sanitizeSearch(filters.q)}%`)
    const owner = effectiveOwner(filters.owner, access.employeeId)
    if (owner) q = q.eq('owner_user_id', owner)
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.capital_category) q = q.eq('capital_category', filters.capital_category)
    if (filters.fcra) q = q.eq('is_fcra', filters.fcra === 'yes')
    if (filters.fy) {
      const range = fiscalYearRange(filters.fy)
      // Secured-in-FY is defined on signed_date (IA §7.5), not the grant term.
      if (range) q = q.gte('signed_date', range.from).lte('signed_date', range.to)
    }

    const { data, error: err, count } = await q
      .order('signed_date', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as GrantRow[])
    setTotal(count ?? 0)
  }, [
    filters.q, filters.owner, filters.status, filters.capital_category,
    filters.fcra, filters.fy, page, access.employeeId,
  ])

  useEffect(() => { void load() }, [load])

  const ownerName = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'

  const committed = (rows ?? []).reduce((s, g) => s + Number(g.total_value_inr ?? 0), 0)
  const received = (rows ?? []).reduce((s, g) => s + receivedOf(g), 0)

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Grants</h1>
          {rows === null ? (
            <Skeleton height={14} width={300} />
          ) : (
            <p className="page__sub tn-num">
              {total} shown · {formatMoney(committed)} committed · {formatMoney(received)} received
            </p>
          )}
        </div>
        <Button iconLeft={<Plus size={15} />} onClick={() => setAddOpen(true)}>Add grant</Button>
      </div>

      <div className="filterbar">
        <SearchInput
          value={filters.q}
          onChange={(v) => setFilter('q', v)}
          placeholder="Search by donor"
        />
        <Select label="Status" value={filters.status} onChange={(e) => setFilter('status', e.currentTarget.value)}>
          <option value="">All</option>
          {GRANT_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="Owner" value={ownerSelectValue(filters.owner, access.employeeId)} onChange={(e) => setFilter('owner', ownerParam(e.currentTarget.value, access.employeeId))}>
          <option value={ANY_OWNER}>Anyone</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select label="Category" value={filters.capital_category} onChange={(e) => setFilter('capital_category', e.currentTarget.value)}>
          <option value="">All</option>
          {CAPITAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="FCRA" value={filters.fcra} onChange={(e) => setFilter('fcra', e.currentTarget.value)}>
          <option value="">All</option>
          <option value="yes">FCRA only</option>
          <option value="no">Domestic only</option>
        </Select>
        <Select label="Signed in" value={filters.fy} onChange={(e) => setFilter('fy', e.currentTarget.value)}>
          <option value="">Any year</option>
          {fiscalYearOptions().map((fy) => <option key={fy} value={fy}>{fy}</option>)}
        </Select>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load grants"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={8} cols={8} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No grants yet"
            body="A grant is created when an opportunity is won. Move a deal to Closed won to start one."
            action={
              <Button variant="secondary" onClick={() => navigate({ to: '/opportunities' })}>
                Go to pipeline
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th style={{ width: '120px' }}>Agreement</th>
                  <th style={{ width: '110px' }}>Committed</th>
                  <th style={{ width: '160px' }}>Received</th>
                  <th style={{ width: '186px' }}>Term</th>
                  <th style={{ width: '104px' }}>Status</th>
                  <th style={{ width: '96px' }}>Health</th>
                  <th style={{ width: '140px' }}>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const got = receivedOf(g)
                  const pct = collectionPct(got, Number(g.total_value_inr ?? 0))
                  return (
                    <tr
                      key={g.id}
                      className="is-clickable"
                      onClick={() => navigate({ to: '/grants/$id', params: { id: g.id } })}
                    >
                      <td>
                        <Link
                          to="/grants/$id"
                          params={{ id: g.id }}
                          className="celllink"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {g.fr_organisations?.name ?? 'Unlinked grant'}
                        </Link>
                        {g.is_fcra ? <> <Badge tone="fcra">FCRA</Badge></> : null}
                        {g.is_confidential ? <> <Badge tone="outline">Confidential</Badge></> : null}
                      </td>
                      <td className="muted">{g.agreement_number ?? '—'}</td>
                      <td className="tn-num">{formatMoney(g.total_value_inr)}</td>
                      <td>
                        <div className="progress" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <span className="tn-num muted" style={{ fontSize: 'var(--text-sm)' }}>
                          {formatMoney(got)} · {Math.round(pct)}%
                        </span>
                      </td>
                      <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>
                        {formatDate(g.start_date)} – {formatDate(g.end_date)}
                      </td>
                      <td>
                        <Badge tone={grantStatusTone(g.status)}>
                          {labelOf(GRANT_STATUSES, g.status)}
                        </Badge>
                      </td>
                      <td><RagBadge value={healthOf(g)} /></td>
                      <td className="muted">{ownerName(g.owner_user_id)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPage={(p) => setFilter('page', String(p))}
          />
        </>
      )}

      {/* A grant with no deal behind it — signed before the CRM, or money that
          simply arrived. Lands on the new grant so the schedule can be built. */}
      <GrantForm
        open={addOpen}
        grant={null}
        onClose={() => setAddOpen(false)}
        onSaved={(g) => navigate({ to: '/grants/$id', params: { id: g.id } })}
      />
    </div>
  )
}

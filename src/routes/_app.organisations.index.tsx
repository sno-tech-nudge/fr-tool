import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, EmptyState, Pagination, SearchInput, Select, TableSkeleton,
} from '../components/ui'
import { OrganisationForm, type Organisation } from '../components/organisations/OrganisationForm'
import { DONOR_TYPES, RELATIONSHIP_STATUSES, labelOf, relationshipTone } from '../lib/enums'
import { formatMoney } from '../lib/format'
import { useEmployees } from '../hooks/useEmployees'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { restoreFilters, useRememberFilters } from '../lib/rememberedFilters'
import { SearchSelect } from '../components/SearchSelect'

export const Route = createFileRoute('/_app/organisations/')({
  beforeLoad: (opts) => restoreFilters('companies', '/organisations', opts),
  component: OrganisationsPage,
})

const PAGE_SIZE = 50
const DEFAULTS = { q: '', donor_type: '', relationship_status: '', owner: '', page: '1' }

const SELECT_COLS =
  'id, name, normalized_name, website_domain, donor_type, segment, geography_city, ' +
  'geography_state, geography_country, csr_budget_annual_inr, csr_focus_areas, ' +
  'relationship_status, relationship_owner_user_id, relationship_owner_name, confidential, description, notes'

function OrganisationsPage() {
  useRememberFilters('companies')
  const navigate = useNavigate()
  const { employees } = useEmployees()
  const { filters, setFilter } = useUrlFilters(DEFAULTS)

  const [rows, setRows] = useState<Organisation[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const page = Math.max(1, Number(filters.page) || 1)

  // The owner filter is a name; a link saved before names holds a person's id.
  const ownerFilter = /^[0-9a-f-]{36}$/i.test(filters.owner)
    ? employees.find((e) => e.id === filters.owner)?.name ?? ''
    : filters.owner
  const [ownerNames, setOwnerNames] = useState<string[]>([])
  useEffect(() => {
    void supabase.from('fr_org_owner_names').select('name').then(({ data }) =>
      setOwnerNames(((data ?? []) as Array<{ name: string }>).map((r) => r.name)))
  }, [])
  const ownerOptions = useMemo(() => {
    const team = employees.map((e) => e.name)
    const seen = new Set(team.map((n) => n.toLowerCase()))
    const others = ownerNames.filter((n) => !seen.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b))
    return [{ value: '', label: 'Anyone' }, ...[...team, ...others].map((n) => ({ value: n, label: n }))]
  }, [employees, ownerNames])

  const load = useCallback(async () => {
    setRows(null)
    setError(null)

    let q = supabase
      .from('fr_organisations')
      .select(SELECT_COLS, { count: 'exact' })
      .is('deleted_at', null)

    if (filters.q) q = q.ilike('name', `%${filters.q}%`)
    if (filters.donor_type) q = q.eq('donor_type', filters.donor_type)
    if (filters.relationship_status) q = q.eq('relationship_status', filters.relationship_status)
    if (ownerFilter) q = q.eq('relationship_owner_name', ownerFilter)

    // Explicit range, never an unbounded read — PostgREST silently caps at 1,000.
    const { data, error: err, count } = await q
      .order('name')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as Organisation[])
    setTotal(count ?? 0)
  }, [filters.q, filters.donor_type, filters.relationship_status, ownerFilter, page])

  useEffect(() => { void load() }, [load])

  const ownerName = (o: Organisation) =>
    o.relationship_owner_name || employees.find((e) => e.id === o.relationship_owner_user_id)?.name || '—'

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Companies</h1>
        <Button iconLeft={<Plus size={15} />} onClick={() => setFormOpen(true)}>Add company</Button>
      </div>

      <div className="filterbar">
        <SearchInput
          value={filters.q}
          onChange={(v) => setFilter('q', v)}
          placeholder="Search by name"
        />
        <Select label="Donor type" value={filters.donor_type} onChange={(e) => setFilter('donor_type', e.currentTarget.value)}>
          <option value="">All</option>
          {DONOR_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="Status" value={filters.relationship_status} onChange={(e) => setFilter('relationship_status', e.currentTarget.value)}>
          <option value="">All</option>
          {RELATIONSHIP_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <SearchSelect
          label="Owner"
          width={190}
          value={ownerFilter}
          options={ownerOptions}
          onChange={(v) => setFilter('owner', v)}
        />
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load companies"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={8} cols={6} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No companies found"
            body="Every donor, corporate and foundation lives here. Adjust the filters or add the first one."
            action={<Button iconLeft={<Plus size={15} />} onClick={() => setFormOpen(true)}>Add company</Button>}
          />
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: '160px' }}>Donor type</th>
                  <th style={{ width: '150px' }}>Status</th>
                  <th style={{ width: '170px' }}>Owner</th>
                  <th style={{ width: '150px' }}>CSR budget</th>
                  <th style={{ width: '140px' }}>Location</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    className="is-clickable"
                    onClick={() => navigate({ to: '/organisations/$id', params: { id: o.id } })}
                  >
                    <td>
                      <Link
                        to="/organisations/$id"
                        params={{ id: o.id }}
                        className="celllink"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.name}
                      </Link>
                      {o.confidential ? <> <Badge tone="outline">Confidential</Badge></> : null}
                    </td>
                    <td>{labelOf(DONOR_TYPES, o.donor_type)}</td>
                    <td>
                      <Badge tone={relationshipTone(o.relationship_status)}>
                        {labelOf(RELATIONSHIP_STATUSES, o.relationship_status)}
                      </Badge>
                    </td>
                    <td className="muted">{ownerName(o)}</td>
                    <td className="tn-num">
                      {o.csr_budget_annual_inr ? formatMoney(o.csr_budget_annual_inr) : <span className="faint">—</span>}
                    </td>
                    <td className="muted">
                      {o.geography_city || o.geography_state || o.geography_country || '—'}
                    </td>
                  </tr>
                ))}
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

      <OrganisationForm
        open={formOpen}
        organisation={null}
        onClose={() => setFormOpen(false)}
        onSaved={(org) => navigate({ to: '/organisations/$id', params: { id: org.id } })}
      />
    </div>
  )
}

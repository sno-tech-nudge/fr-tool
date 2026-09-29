import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Select } from '../components/ui'
import { LeadershipDashboard } from '../components/dashboards/LeadershipDashboard'
import { MoneyDashboard } from '../components/dashboards/MoneyDashboard'
import { CAPITAL_CATEGORIES, GRANT_STATUSES } from '../lib/enums'
import { fiscalYearOptions, joinFyList, parseFyList, shortFyLabel } from '../lib/fy'
import { useAccess } from '../lib/accessContext'
import { ANY_OWNER, effectiveOwner, ownerParam, ownerSelectValue } from '../lib/ownerFilter'
import { useEmployees } from '../hooks/useEmployees'
import { useUrlFilters } from '../hooks/useUrlFilters'

export const Route = createFileRoute('/_app/dashboards')({ component: DashboardsPage })

const DEFAULTS = {
  view: 'leadership', fy: '', owner: '', category: '', status: '', fcra: '',
}

export type DashboardFilters = {
  /** Comma-separated FY labels; empty means every year. See parseFyList. */
  fy: string
  owner: string
  category: string
  /** Money dashboard only — Leadership has no notion of grant status/FCRA. */
  status: string
  fcra: string
}

const TABS = [
  { key: 'leadership', label: 'Leadership' },
  { key: 'money', label: 'Grants & money' },
]

/** Same untyped-search workaround as useUrlFilters — see its own comment. */
type LooseNavigate = (opts: {
  to?: string
  search?: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)
  replace?: boolean
}) => void

/**
 * Pills where several can be on at once. "All" clears the lot; picking a
 * year again takes it back off.
 */
function MultiPillGroup({
  label, options, value, onChange, allLabel = 'All',
}: {
  label: string
  options: Array<{ value: string; label: string }>
  value: string[]
  onChange: (v: string[]) => void
  allLabel?: string
}) {
  function toggle(v: string) {
    const picked = value.includes(v) ? value.filter((x) => x !== v) : [...value, v]
    onChange(options.filter((o) => picked.includes(o.value)).map((o) => o.value))
  }
  return (
    <div className="filtergroup">
      <span className="filtergroup__label">{label}</span>
      <div className="pillrow">
        <button className="pill pill--sm" data-active={value.length === 0} onClick={() => onChange([])}>
          {allLabel}
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            className="pill pill--sm"
            data-active={value.includes(o.value)}
            aria-pressed={value.includes(o.value)}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One row of small pill toggles under a caption label. */
function PillGroup({
  label, options, value, onChange, allLabel = 'All',
}: {
  label: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
  allLabel?: string
}) {
  return (
    <div className="filtergroup">
      <span className="filtergroup__label">{label}</span>
      <div className="pillrow">
        <button className="pill pill--sm" data-active={!value} onClick={() => onChange('')}>
          {allLabel}
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            className="pill pill--sm"
            data-active={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function DashboardsPage() {
  const { employees } = useEmployees()
  const access = useAccess()
  const { filters, setFilter } = useUrlFilters(DEFAULTS)
  const navigate = useNavigate() as unknown as LooseNavigate

  const isMoney = filters.view === 'money'
  const active: DashboardFilters = {
    fy: filters.fy,
    owner: effectiveOwner(filters.owner, access.employeeId),
    category: filters.category,
    status: filters.status,
    fcra: filters.fcra,
  }

  const fyOptions = fiscalYearOptions().map((fy) => ({ value: fy, label: shortFyLabel(fy) }))

  // Clears every money filter in one navigation (not the shared hook's own
  // reset() — that drops `view` too and would bounce back to Leadership).
  function resetMoneyFilters() {
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev, fy: undefined, owner: undefined, category: undefined,
        status: undefined, fcra: undefined, page: undefined,
      }),
      replace: true,
    })
  }
  const moneyFiltersActive = Boolean(
    filters.fy || filters.owner || filters.category || filters.status || filters.fcra,
  )

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Dashboards</h1>
          <p className="page__sub">
            {parseFyList(filters.fy).join(' · ') || 'All years'}
          </p>
        </div>
      </div>

      <div className="filterpanel">
        <MultiPillGroup
          label="FY"
          allLabel="All years"
          options={fyOptions}
          value={parseFyList(filters.fy)}
          onChange={(list) => setFilter('fy', joinFyList(list))}
        />
        <PillGroup
          label="Capital category"
          options={CAPITAL_CATEGORIES}
          value={filters.category}
          onChange={(v) => setFilter('category', v)}
        />

        {isMoney ? (
          <PillGroup
            label="Status"
            options={GRANT_STATUSES}
            value={filters.status}
            onChange={(v) => setFilter('status', v)}
          />
        ) : null}

        {isMoney ? (
          <PillGroup
            label="FCRA"
            options={[{ value: 'yes', label: 'FCRA only' }, { value: 'no', label: 'Domestic only' }]}
            value={filters.fcra}
            onChange={(v) => setFilter('fcra', v)}
          />
        ) : null}

        <div className="filtergroup">
          <span className="filtergroup__label">Owner</span>
          <Select value={ownerSelectValue(filters.owner, access.employeeId)} onChange={(e) => setFilter('owner', ownerParam(e.currentTarget.value, access.employeeId))}>
            <option value={ANY_OWNER}>Anyone</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </div>

        {isMoney && moneyFiltersActive ? (
          <Button variant="ghost" size="sm" onClick={resetMoneyFilters}>Reset</Button>
        ) : null}
      </div>

      <nav className="tabs" aria-label="Dashboards">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="tab"
            data-active={filters.view === t.key}
            onClick={() => setFilter('view', t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {isMoney
        ? <MoneyDashboard filters={active} />
        : <LeadershipDashboard filters={active} />}
    </div>
  )
}

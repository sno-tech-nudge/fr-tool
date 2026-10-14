import { useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Select, useToast } from '../components/ui'
import { ExportMenu } from '../components/ExportMenu'
import { LeadershipDashboard } from '../components/dashboards/LeadershipDashboard'
import { MoneyDashboard } from '../components/dashboards/MoneyDashboard'
import { CAPITAL_CATEGORIES, GRANT_STATUSES, labelOf } from '../lib/enums'
import { QUARTER_OPTIONS, fiscalYearOptions, joinFyList, parseFyList, shortFyLabel } from '../lib/fy'
import { useAccess } from '../lib/accessContext'
import { ANY_OWNER, effectiveOwner, ownerParam, ownerSelectValue } from '../lib/ownerFilter'
import { useEmployees } from '../hooks/useEmployees'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { downloadPagePdf } from '../lib/export/pagePdf'
import { downloadWorkbook, fileSlug, today, type ExportRef, type SheetSpec } from '../lib/export/workbook'

export const Route = createFileRoute('/_app/dashboards')({ component: DashboardsPage })

const DEFAULTS = {
  view: 'leadership', fy: '', quarter: '', owner: '', category: '', status: '', fcra: '',
}

export type DashboardFilters = {
  /** Comma-separated FY labels; empty means every year. See parseFyList. */
  fy: string
  /** Comma-separated Q1–Q4, applied alongside the year(s); empty means all. */
  quarter: string
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
  options: Array<{ value: string; label: string; title?: string }>
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
            title={o.title}
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
  const toast = useToast()
  const pageRef = useRef<HTMLDivElement>(null)
  const exportRef: ExportRef = useRef<(() => SheetSpec[] | null) | null>(null)
  const { filters, setFilter } = useUrlFilters(DEFAULTS)
  const navigate = useNavigate() as unknown as LooseNavigate

  const isMoney = filters.view === 'money'
  const active: DashboardFilters = {
    fy: filters.fy,
    quarter: filters.quarter,
    owner: effectiveOwner(filters.owner, access.employeeId),
    category: filters.category,
    status: filters.status,
    fcra: filters.fcra,
  }

  // What the export is called, and what it says was filtered, are built from
  // the same filters the page is showing.
  const fyText = parseFyList(filters.fy).join(', ')
  const quarterText = parseFyList(filters.quarter).join(', ')
  const dashboardName = isMoney ? 'Grants and money' : 'Leadership'
  const ownerText = (() => {
    const id = effectiveOwner(filters.owner, access.employeeId)
    return id ? employees.find((e) => e.id === id)?.name ?? '—' : 'Anyone'
  })()

  function filtersSheet(): SheetSpec {
    const rows: SheetSpec['rows'] = [
      ['Dashboard', dashboardName],
      ['Financial year', fyText || 'All years'],
      ['Quarter', quarterText || 'All quarters'],
      ['Capital category', filters.category ? labelOf(CAPITAL_CATEGORIES, filters.category) : 'All'],
    ]
    if (isMoney) {
      rows.push(['Grant status', filters.status ? labelOf(GRANT_STATUSES, filters.status) : 'All'])
      rows.push(['FCRA', filters.fcra === 'yes' ? 'FCRA only' : filters.fcra === 'no' ? 'Domestic only' : 'All'])
    }
    rows.push(['Owner', ownerText], ['Exported by', access.employeeName ?? ''], ['Exported on', new Date().toLocaleString('en-GB')])
    return { name: 'Filters', columns: [{ header: 'Filter', width: 22 }, { header: 'Applied', width: 40 }], rows }
  }

  const exportName = fileSlug(dashboardName, 'dashboard', fyText || 'All-years', quarterText.replace(/, /g, '-'), today())

  async function exportExcel() {
    const sheets = exportRef.current?.()
    if (!sheets) { toast.error('The dashboard is still loading — try again in a moment.'); return }
    await downloadWorkbook(`${exportName}.xlsx`, [filtersSheet(), ...sheets])
    toast.success('Excel file downloaded.')
  }

  async function exportPdf() {
    const root = pageRef.current
    if (!root) return
    const footer = ['The/Nudge Fundraising', `${dashboardName} dashboard`, fyText || 'All years', quarterText, today()]
      .filter(Boolean).join('  -  ')
    await downloadPagePdf(root, `${exportName}.pdf`, footer)
    toast.success('PDF downloaded.')
  }

  const fyOptions = fiscalYearOptions().map((fy) => ({ value: fy, label: shortFyLabel(fy) }))

  // Clears every money filter in one navigation (not the shared hook's own
  // reset() — that drops `view` too and would bounce back to Leadership).
  function resetMoneyFilters() {
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev, fy: undefined, quarter: undefined, owner: undefined, category: undefined,
        status: undefined, fcra: undefined, page: undefined,
      }),
      replace: true,
    })
  }
  const moneyFiltersActive = Boolean(
    filters.fy || filters.quarter || filters.owner || filters.category || filters.status || filters.fcra,
  )

  return (
    <div className="page" ref={pageRef}>
      <div className="page__head">
        <div>
          <h1 className="page__title">Dashboards</h1>
          <p className="page__sub">
            {[parseFyList(filters.fy).join(' · ') || 'All years', parseFyList(filters.quarter).join(', ')]
              .filter(Boolean).join(' · ')}
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
        <MultiPillGroup
          label="Quarter"
          options={QUARTER_OPTIONS}
          value={parseFyList(filters.quarter)}
          onChange={(list) => setFilter('quarter', joinFyList(list))}
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

        <ExportMenu onPdf={exportPdf} onExcel={exportExcel} />
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

      <div data-export-content>
        {isMoney
          ? <MoneyDashboard filters={active} exportRef={exportRef} />
          : <LeadershipDashboard filters={active} exportRef={exportRef} />}
      </div>
    </div>
  )
}

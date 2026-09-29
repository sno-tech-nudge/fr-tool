import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, Pencil, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, DetailList, EmptyState, Skeleton, TableSkeleton,
} from '../components/ui'
import { OrganisationForm, type Organisation } from '../components/organisations/OrganisationForm'
import { ContactForm, type Contact } from '../components/contacts/ContactForm'
import { ActivityFeed } from '../components/ActivityFeed'
import { OrgNewsTab } from '../components/organisations/OrgNewsTab'
import {
  CAPITAL_CATEGORIES, DONOR_TYPES, GRANT_STATUSES, RELATIONSHIP_STATUSES, SENIORITIES,
  grantStatusTone, labelOf, relationshipTone,
} from '../lib/enums'
import { formatDate, formatMoney } from '../lib/format'
import { collectionPct } from '../lib/grants'
import { useEmployees } from '../hooks/useEmployees'

export const Route = createFileRoute('/_app/organisations/$id')({ component: OrganisationDetail })

type Tab = 'overview' | 'contacts' | 'opportunities' | 'grants' | 'activity' | 'news'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'grants', label: 'Grants' },
  { key: 'activity', label: 'Activity' },
  { key: 'news', label: 'News' },
]

/**
 * The three header figures. Open pipeline and secured both come from
 * opportunities rather than grants: a won deal is secured the moment it is
 * won, and most of the migrated history has no grant record behind it yet.
 */
type Summary = {
  openPipeline: number
  secured: number
  contacts: number
}

function OrganisationDetail() {
  const { id } = Route.useParams()
  const { employees } = useEmployees()

  const [org, setOrg] = useState<Organisation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)

  const loadSummary = useCallback(async () => {
    const [opps, contactCount] = await Promise.all([
      supabase
        .from('fr_opportunities')
        .select('amount_inr, fr_pipeline_stages(terminal_type)')
        .eq('organisation_id', id)
        .is('deleted_at', null),
      supabase
        .from('fr_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', id)
        .is('deleted_at', null),
    ])

    const rows = (opps.data ?? []) as unknown as Array<{
      amount_inr: number | null
      fr_pipeline_stages: { terminal_type: string | null } | null
    }>

    setSummary({
      openPipeline: rows
        .filter((o) => !o.fr_pipeline_stages?.terminal_type)
        .reduce((s, o) => s + Number(o.amount_inr ?? 0), 0),
      secured: rows
        .filter((o) => o.fr_pipeline_stages?.terminal_type === 'won')
        .reduce((s, o) => s + Number(o.amount_inr ?? 0), 0),
      contacts: contactCount.count ?? 0,
    })
  }, [id])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_organisations')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    setLoading(false)
    if (err) { setError(err.message); return }
    if (!data) { setError('not-found'); return }
    setOrg(data as Organisation)
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadSummary() }, [loadSummary])

  if (loading) {
    return (
      <div className="page stack">
        <Skeleton height={14} width={120} />
        <Skeleton height={28} width="35%" />
        <Skeleton height={160} />
      </div>
    )
  }

  if (error || !org) {
    return (
      <div className="page">
        <Link to="/organisations" className="backlink"><ArrowLeft size={14} /> Organisations</Link>
        <div className="card">
          <EmptyState
            title={error === 'not-found' ? 'Organisation not found' : 'Could not load this organisation'}
            body={
              error === 'not-found'
                ? 'It may have been deleted, or it is confidential and owned by someone else.'
                : error ?? undefined
            }
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      </div>
    )
  }

  const ownerName = org.relationship_owner_user_id
    ? employees.find((e) => e.id === org.relationship_owner_user_id)?.name ?? '—'
    : '—'

  return (
    <div className="page">
      <Link to="/organisations" className="backlink"><ArrowLeft size={14} /> Organisations</Link>

      <header className="rechead">
        <div className="rechead__top">
          <div>
            <div role="heading" aria-level={1} className="rechead__name">{org.name}</div>
            <div className="rechead__meta">
              <Badge tone={relationshipTone(org.relationship_status)}>
                {labelOf(RELATIONSHIP_STATUSES, org.relationship_status)}
              </Badge>
              <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {labelOf(DONOR_TYPES, org.donor_type)}
              </span>
              <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>{ownerName}</span>
              {org.confidential ? <Badge tone="outline">Confidential</Badge> : null}
              {org.website_domain ? (
                <a
                  href={`https://${org.website_domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="row"
                  style={{ gap: 4, fontSize: 'var(--text-sm)' }}
                >
                  {org.website_domain} <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
          </div>
          <Button variant="secondary" iconLeft={<Pencil size={15} />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </div>

        <div className="kpirow">
          <div className="kpi">
            <div className="kpi__label">Open pipeline</div>
            <div className="kpi__value tn-num">
              {summary ? formatMoney(summary.openPipeline) : <Skeleton height={20} width={90} />}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Secured</div>
            <div className="kpi__value tn-num">
              {summary ? formatMoney(summary.secured) : <Skeleton height={20} width={90} />}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Contacts</div>
            <div className="kpi__value tn-num">
              {summary ? summary.contacts : <Skeleton height={20} width={40} />}
            </div>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Organisation sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="tab"
            data-active={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className="card">
          <DetailList
            items={[
              { label: 'Donor type', value: labelOf(DONOR_TYPES, org.donor_type) },
              { label: 'Sector', value: org.segment },
              { label: 'Relationship owner', value: ownerName },
              {
                label: 'Location',
                value: [org.geography_city, org.geography_state, org.geography_country]
                  .filter(Boolean).join(', ') || null,
              },
              {
                label: 'Annual CSR budget',
                value: org.csr_budget_annual_inr
                  ? <span className="tn-num">{formatMoney(org.csr_budget_annual_inr)}</span>
                  : null,
              },
              {
                label: 'CSR focus areas',
                value: org.csr_focus_areas?.length ? org.csr_focus_areas.join(', ') : null,
              },
              { label: 'Description', value: org.description },
              { label: 'Notes', value: org.notes },
            ]}
          />
        </div>
      ) : null}

      {tab === 'contacts' ? <OrgContacts organisationId={org.id} orgName={org.name} /> : null}
      {tab === 'opportunities' ? <OrgOpportunities organisationId={org.id} /> : null}
      {tab === 'grants' ? <OrgGrants organisationId={org.id} /> : null}
      {tab === 'activity' ? <ActivityFeed parentType="organisation" parentId={org.id} /> : null}
      {tab === 'news' ? <OrgNewsTab organisationId={org.id} /> : null}

      <OrganisationForm
        open={editOpen}
        organisation={org}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => setOrg(next)}
      />
    </div>
  )
}

/* ---------- Contacts tab ---------- */

function OrgContacts({ organisationId, orgName }: { organisationId: string; orgName: string }) {
  const [rows, setRows] = useState<Contact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_contacts')
      .select('*')
      .eq('organisation_id', organisationId)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('full_name')
    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as Contact[])
  }, [organisationId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button
          size="sm"
          iconLeft={<Plus size={14} />}
          onClick={() => { setEditing(null); setFormOpen(true) }}
        >
          Add contact
        </Button>
      </div>

      {error ? (
        <div className="card">
          <EmptyState title="Could not load contacts" body={error} />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={4} cols={4} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No contacts yet"
            body={`Add the people you deal with at ${orgName}.`}
            action={
              <Button iconLeft={<Plus size={15} />} onClick={() => { setEditing(null); setFormOpen(true) }}>
                Add contact
              </Button>
            }
          />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Designation</th>
                <th style={{ width: '170px' }}>Seniority</th>
                <th style={{ width: '220px' }}>Email</th>
                <th style={{ width: '140px' }}>Phone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="is-clickable"
                  onClick={() => { setEditing(c); setFormOpen(true) }}
                >
                  <td>
                    <Link
                      to="/contacts"
                      search={{ contact: c.id }}
                      className="celllink"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.full_name}
                    </Link>
                    {c.is_primary ? <> <Badge tone="brown">Primary</Badge></> : null}
                  </td>
                  <td className="muted">{c.designation ?? '—'}</td>
                  <td>{labelOf(SENIORITIES, c.seniority)}</td>
                  <td className="muted">{c.email ?? '—'}</td>
                  <td className="muted tn-num">{c.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContactForm
        open={formOpen}
        contact={editing}
        lockedOrganisationId={organisationId}
        onClose={() => setFormOpen(false)}
        onSaved={(saved, isNew) => {
          setRows((prev) => (isNew
            ? [...(prev ?? []), saved]
            : (prev ?? []).map((r) => (r.id === saved.id ? saved : r))))
        }}
        onDeleted={(deletedId) => setRows((prev) => (prev ?? []).filter((r) => r.id !== deletedId))}
      />
    </div>
  )
}

/* ---------- Opportunities tab ---------- */

type OrgOpportunity = {
  id: string
  name: string
  capital_category: string
  amount_inr: number | null
  probability_pct: number | null
  expected_close_date: string | null
  owner_user_id: string
  fr_pipeline_stages: { label: string; terminal_type: string | null } | null
}

/**
 * Every deal for this donor, open and closed — the org page is a relationship
 * history, so a won or lost deal belongs here as much as a live one. Filtering
 * down to what is still in play is the pipeline board's job.
 */
function OrgOpportunities({ organisationId }: { organisationId: string }) {
  const navigate = useNavigate()
  const { employees } = useEmployees()
  const [rows, setRows] = useState<OrgOpportunity[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_opportunities')
      .select('id, name, capital_category, amount_inr, probability_pct, expected_close_date, '
        + 'owner_user_id, fr_pipeline_stages(label, terminal_type)')
      .eq('organisation_id', organisationId)
      .is('deleted_at', null)
      .order('expected_close_date', { ascending: false })
    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as OrgOpportunity[])
  }, [organisationId])

  useEffect(() => { void load() }, [load])

  const ownerName = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'

  if (error) {
    return <div className="card"><EmptyState title="Could not load opportunities" body={error} /></div>
  }
  if (rows === null) return <TableSkeleton rows={4} cols={6} />
  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No opportunities yet"
          body="Deals with this donor appear here once one is added to the pipeline."
          action={
            <Button variant="secondary" onClick={() => navigate({ to: '/opportunities' })}>
              Go to pipeline
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: '156px' }}>Stage</th>
            <th style={{ width: '116px' }}>Category</th>
            <th style={{ width: '106px' }}>Amount</th>
            <th style={{ width: '116px' }}>Weighted</th>
            <th style={{ width: '112px' }}>Close</th>
            <th style={{ width: '132px' }}>Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const terminal = o.fr_pipeline_stages?.terminal_type
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
                </td>
                <td>
                  <Badge tone={terminal === 'won' ? 'green' : terminal === 'lost' ? 'red' : 'brown'}>
                    {o.fr_pipeline_stages?.label ?? '—'}
                  </Badge>
                </td>
                <td className="muted">{labelOf(CAPITAL_CATEGORIES, o.capital_category)}</td>
                <td className="tn-num">{formatMoney(o.amount_inr)}</td>
                <td className="tn-num muted">
                  {formatMoney(((o.amount_inr ?? 0) * (o.probability_pct ?? 0)) / 100)}
                </td>
                <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(o.expected_close_date)}
                </td>
                <td className="muted">{ownerName(o.owner_user_id)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Grants tab ---------- */

type OrgGrant = {
  id: string
  agreement_number: string | null
  total_value_inr: number
  is_fcra: boolean
  start_date: string
  end_date: string
  status: string
  owner_user_id: string
  fr_tranches: Array<{ fr_remittances: Array<{ amount_inr: number }> }>
}

function OrgGrants({ organisationId }: { organisationId: string }) {
  const navigate = useNavigate()
  const { employees } = useEmployees()
  const [rows, setRows] = useState<OrgGrant[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_grants')
      .select('id, agreement_number, total_value_inr, is_fcra, start_date, end_date, status, '
        + 'owner_user_id, fr_tranches(fr_remittances(amount_inr))')
      .eq('organisation_id', organisationId)
      .is('deleted_at', null)
      .order('signed_date', { ascending: false })
    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as OrgGrant[])
  }, [organisationId])

  useEffect(() => { void load() }, [load])

  const ownerName = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'

  if (error) {
    return <div className="card"><EmptyState title="Could not load grants" body={error} /></div>
  }
  if (rows === null) return <TableSkeleton rows={3} cols={5} />
  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No grants yet"
          body="A grant appears here once one of this donor's opportunities is won."
        />
      </div>
    )
  }

  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th>Agreement</th>
            <th style={{ width: '110px' }}>Committed</th>
            <th style={{ width: '160px' }}>Received</th>
            <th style={{ width: '186px' }}>Term</th>
            <th style={{ width: '104px' }}>Status</th>
            <th style={{ width: '132px' }}>Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const got = (g.fr_tranches ?? []).reduce(
              (sum, t) => sum + (t.fr_remittances ?? [])
                .reduce((s, r) => s + Number(r.amount_inr ?? 0), 0),
              0,
            )
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
                    {g.agreement_number ?? 'Grant'}
                  </Link>
                  {g.is_fcra ? <> <Badge tone="fcra">FCRA</Badge></> : null}
                </td>
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
                  <Badge tone={grantStatusTone(g.status)}>{labelOf(GRANT_STATUSES, g.status)}</Badge>
                </td>
                <td className="muted">{ownerName(g.owner_user_id)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

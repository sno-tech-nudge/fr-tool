import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, ConfirmDialog, DetailList, EmptyState, RagBadge, Skeleton, useToast,
} from '../components/ui'
import { ContractSummaryCard } from '../components/grants/ContractSummaryCard'
import { useAccess } from '../lib/accessContext'
import { ActivityFeed } from '../components/ActivityFeed'
import { AgreementCell } from '../components/grants/AgreementCell'
import { GrantForm, type Grant } from '../components/grants/GrantForm'
import { AllocationsTab } from '../components/grants/AllocationsTab'
import { TranchesTab } from '../components/grants/TranchesTab'
import { ComplianceTab } from '../components/grants/ComplianceTab'
import {
  CAPITAL_CATEGORIES, GRANT_STATUSES, grantStatusTone, labelOf,
} from '../lib/enums'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { collectionPct, computeHealth } from '../lib/grants'
import { fiscalYear } from '../lib/fy'
import { useEmployees } from '../hooks/useEmployees'
import { useBankAccounts } from '../hooks/useBankAccounts'

export const Route = createFileRoute('/_app/grants/$id')({ component: GrantDetail })

type Tab = 'overview' | 'allocations' | 'money' | 'compliance' | 'activity'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'allocations', label: 'Allocations' },
  { key: 'money', label: 'Tranches & money' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'activity', label: 'Activity' },
]

/** Everything the header needs that is summed rather than stored. */
type Money = {
  received: number
  health: 'green' | 'amber' | 'red'
}

function GrantDetail() {
  const { id } = Route.useParams()
  const { employees } = useEmployees()
  const { accounts } = useBankAccounts()

  const [grant, setGrant] = useState<Grant | null>(null)
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null)
  const [money, setMoney] = useState<Money | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const access = useAccess()

  /**
   * Soft delete, like everything else in the app — the row stays and can be
   * restored with SQL. Every dashboard view filters deleted grants, so its
   * committed and received money leave the totals the moment this lands, and
   * its tranches, remittances and milestones go with it.
   */
  async function deleteGrant() {
    if (!grant) return
    setDeleting(true)
    const { error: err } = await supabase
      .from('fr_grants')
      .update({ deleted_at: new Date().toISOString(), updated_by: access.employeeId })
      .eq('id', grant.id)
    setDeleting(false)
    if (err) { toast.error(err.message); return }
    toast.success('Grant deleted.')
    void navigate({ to: '/grants' })
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_grants')
      .select('*, fr_organisations(id, name)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    setLoading(false)
    if (err) { setError(err.message); return }
    if (!data) { setError('not-found'); return }
    const { fr_organisations: o, ...rest } = data as Grant & {
      fr_organisations: { id: string; name: string } | null
    }
    setGrant(rest as Grant)
    setOrg(o)
  }, [id])

  /**
   * Received-to-date and health both fall out of the tranche/remittance tree,
   * so they refresh together whenever a tab writes money. Health is recomputed
   * here rather than read from the stored column — no nightly job runs yet.
   */
  const loadMoney = useCallback(async () => {
    const [{ data: tranches }, { data: milestones }] = await Promise.all([
      supabase
        .from('fr_tranches')
        .select('id, due_date, status, fr_remittances(amount_inr)')
        .eq('grant_id', id),
      supabase
        .from('fr_compliance_milestones')
        .select('due_date, status')
        .eq('grant_id', id)
        .is('deleted_at', null),
    ])

    const rows = (tranches ?? []) as Array<{
      due_date: string
      status: string
      fr_remittances: Array<{ amount_inr: number }>
    }>
    const received = rows.reduce(
      (sum, t) => sum + (t.fr_remittances ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0),
      0,
    )
    setMoney({
      received,
      health: computeHealth([
        ...rows.map((t) => ({ status: t.status, due_date: t.due_date })),
        ...((milestones ?? []) as Array<{ due_date: string; status: string }>),
      ]),
    })
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadMoney() }, [loadMoney])

  if (loading) {
    return (
      <div className="page stack">
        <Skeleton height={14} width={120} />
        <Skeleton height={28} width="35%" />
        <Skeleton height={160} />
      </div>
    )
  }

  if (error || !grant) {
    return (
      <div className="page">
        <Link to="/grants" className="backlink"><ArrowLeft size={14} /> Grants</Link>
        <div className="card">
          <EmptyState
            title={error === 'not-found' ? 'Grant not found' : 'Could not load this grant'}
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

  const committed = Number(grant.total_value_inr ?? 0)
  const received = money?.received ?? 0
  const pct = collectionPct(received, committed)
  const ownerName = employees.find((e) => e.id === grant.owner_user_id)?.name ?? '—'
  const bank = accounts.find((a) => a.id === grant.bank_account_id)

  return (
    <div className="page">
      <Link to="/grants" className="backlink"><ArrowLeft size={14} /> Grants</Link>

      <header className="rechead">
        <div className="rechead__top">
          <div>
            <div role="heading" aria-level={1} className="rechead__name">
              {org ? (
                <Link to="/organisations/$id" params={{ id: org.id }} className="celllink">
                  {org.name}
                </Link>
              ) : 'Unlinked grant'}
            </div>
            <div className="rechead__meta">
              <Badge tone={grantStatusTone(grant.status)}>
                {labelOf(GRANT_STATUSES, grant.status)}
              </Badge>
              <Badge tone={grant.is_fcra ? 'fcra' : 'domestic'}>
                {grant.is_fcra ? 'FCRA' : 'Domestic'}
              </Badge>
              {money ? <RagBadge value={money.health} /> : null}
              {grant.agreement_number ? (
                <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {grant.agreement_number}
                </span>
              ) : null}
              <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>{ownerName}</span>
              {grant.is_confidential ? <Badge tone="outline">Confidential</Badge> : null}
            </div>
          </div>
          <Button variant="secondary" iconLeft={<Pencil size={15} />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </div>

        <div className="moneybar">
          <div className="moneybar__figures tn-num">
            <strong>{formatMoney(received)}</strong>
            <span className="muted"> received of {formatMoney(committed)}</span>
            <span className="faint"> · {Math.round(pct)}%</span>
          </div>
          <div
            className="progress"
            data-tone={money?.health}
            role="img"
            aria-label={`${Math.round(pct)} percent of the committed value received`}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Grant sections">
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
              { label: 'Capital category', value: labelOf(CAPITAL_CATEGORIES, grant.capital_category) },
              {
                label: 'Committed value',
                value: (
                  <span className="tn-num">
                    {formatAmount(grant.total_value, grant.currency)}
                    {grant.currency !== 'INR'
                      ? ` · ${formatMoney(grant.total_value_inr)} at ${grant.fx_rate_at_signing}`
                      : ''}
                  </span>
                ),
              },
              { label: 'Signed', value: <span className="tn-num">{formatDate(grant.signed_date)}</span> },
              {
                label: 'Term',
                value: (
                  <span className="tn-num">
                    {formatDate(grant.start_date)} – {formatDate(grant.end_date)}
                    {grant.is_multi_year ? ' · multi-year' : ''}
                  </span>
                ),
              },
              { label: 'Signed in', value: fiscalYear(grant.signed_date) },
              { label: 'Receiving entity', value: bank ? bank.label : null },
              { label: 'Owner', value: ownerName },
              {
                label: 'Agreement',
                value: <AgreementCell grant={grant} onSaved={setGrant} />,
              },
              { label: 'Notes', value: grant.notes },
            ]}
          />
        </div>
      ) : null}

      {tab === 'overview' ? (
        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <ContractSummaryCard grant={grant} onSaved={setGrant} />
          {/* Deleting money records is a manager's call, not everyone's. */}
          {access.isManager ? (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <Button variant="ghost" iconLeft={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>
                Delete grant
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'allocations' ? (
        <AllocationsTab grantId={grant.id} committedInr={committed} currency={grant.currency} />
      ) : null}

      {tab === 'money' ? (
        <TranchesTab
          grantId={grant.id}
          grantIsFcra={grant.is_fcra}
          currency={grant.currency}
          committedInr={committed}
          fxRate={grant.fx_rate_at_signing}
          defaultBankAccountId={grant.bank_account_id}
          startDate={grant.start_date}
          endDate={grant.end_date}
          onChanged={() => void loadMoney()}
        />
      ) : null}

      {tab === 'compliance' ? (
        <ComplianceTab
          grantId={grant.id}
          capitalCategory={grant.capital_category}
          startDate={grant.start_date}
          endDate={grant.end_date}
          onChanged={() => void loadMoney()}
        />
      ) : null}

      {tab === 'activity' ? <ActivityFeed parentType="grant" parentId={grant.id} /> : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this grant?"
        body={received > 0
          ? `${formatMoney(received)} has been received against it. The grant, its schedule and its receipts all leave every dashboard. It can be restored with SQL.`
          : 'It leaves the grants list and every dashboard, with its schedule and reporting. It can be restored with SQL.'}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void deleteGrant()}
        onCancel={() => setConfirmDelete(false)}
      />

      <GrantForm
        open={editOpen}
        grant={grant}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => { setGrant(next); void loadMoney() }}
      />
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, DetailList, EmptyState, Input, Select, Skeleton, TableSkeleton, useToast,
} from '../components/ui'
import { OpportunityForm, type Opportunity } from '../components/opportunities/OpportunityForm'
import { StageMoveDialog } from '../components/opportunities/StageMoveDialog'
import { WonWizard } from '../components/grants/WonWizard'
import { moveOpportunityStage, stageMoveRequirement, type StageMoveExtras } from '../components/opportunities/stageMove'
import { ActivityFeed } from '../components/ActivityFeed'
import {
  CAPITAL_CATEGORIES, OPPORTUNITY_TYPES, PROPOSAL_STATUSES, PROPOSAL_TYPES, labelOf,
} from '../lib/enums'
import { formatAmount, formatDate, formatDateTime, formatMoney } from '../lib/format'
import { useAccess } from '../lib/accessContext'
import { useEmployees } from '../hooks/useEmployees'
import { usePipelineStages, type Stage } from '../hooks/usePipelineStages'

export const Route = createFileRoute('/_app/opportunities/$id')({ component: OpportunityDetail })

type Tab = 'overview' | 'programs' | 'activity' | 'history' | 'proposals' | 'collaborators'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'programs', label: 'Programs' },
  { key: 'activity', label: 'Activity' },
  { key: 'history', label: 'Stage history' },
  { key: 'proposals', label: 'Proposals' },
  { key: 'collaborators', label: 'Collaborators' },
]

type OppWithOrg = Opportunity & { fr_organisations: { id: string; name: string } | null }

function OpportunityDetail() {
  const { id } = Route.useParams()
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()
  const { stages } = usePipelineStages()
  const navigate = useNavigate()

  const [opp, setOpp] = useState<OppWithOrg | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [pendingStage, setPendingStage] = useState<Stage | null>(null)
  const [moving, setMoving] = useState(false)
  const [wonOpen, setWonOpen] = useState(false)
  // undefined = not looked yet, null = looked and there is none.
  const [linkedGrantId, setLinkedGrantId] = useState<string | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_opportunities')
      .select('*, fr_organisations(id, name)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    setLoading(false)
    if (err) { setError(err.message); return }
    if (!data) { setError('not-found'); return }
    setOpp(data as unknown as OppWithOrg)
  }, [id])

  useEffect(() => { void load() }, [load])

  /**
   * A won deal should always have a grant behind it, but "Finish later" in the
   * wizard leaves one without — and the wizard only fires on a stage
   * transition, so re-picking Closed won cannot bring it back. This looks for
   * the grant itself rather than trusting opp.won_grant_id, because the wizard
   * writes that link last and reports it separately when it fails.
   */
  const stageNow = stages.find((s) => s.id === opp?.stage_id)
  const isWon = stageNow?.terminal_type === 'won'

  const checkGrant = useCallback(async () => {
    if (!opp || !isWon) { setLinkedGrantId(undefined); return }
    const { data } = await supabase
      .from('fr_grants')
      .select('id')
      .eq('opportunity_id', opp.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    setLinkedGrantId((data as { id: string } | null)?.id ?? null)
  }, [opp, isWon])

  useEffect(() => { void checkGrant() }, [checkGrant])

  async function commitMove(toStage: Stage, extras: StageMoveExtras) {
    if (!opp) return
    setMoving(true)
    const res = await moveOpportunityStage({
      opportunity: opp, toStage, employeeId: access.employeeId, extras,
    })
    setMoving(false)
    setPendingStage(null)
    if (res.error) { toast.error(res.error); return }
    setOpp({ ...(res.opportunity as OppWithOrg), fr_organisations: opp.fr_organisations })
    if (!res.historyWritten) toast.error('Moved, but the stage history entry could not be written.')
    else if (toStage.terminal_type !== 'won') toast.success(`Moved to ${toStage.label}.`)

    // Winning opens the wizard rather than just confirming the move — the
    // grant, its schedule and its reporting obligations are created there.
    if (toStage.terminal_type === 'won') setWonOpen(true)
  }

  function requestStage(stageId: string) {
    const toStage = stages.find((s) => s.id === stageId)
    if (!toStage || !opp || toStage.id === opp.stage_id) return
    if (stageMoveRequirement(toStage) !== null) { setPendingStage(toStage); return }
    void commitMove(toStage, {})
  }

  if (loading) {
    return (
      <div className="page stack">
        <Skeleton height={14} width={120} />
        <Skeleton height={28} width="40%" />
        <Skeleton height={180} />
      </div>
    )
  }

  if (error || !opp) {
    return (
      <div className="page">
        <Link to="/opportunities" className="backlink"><ArrowLeft size={14} /> Pipeline</Link>
        <div className="card">
          <EmptyState
            title={error === 'not-found' ? 'Opportunity not found' : 'Could not load this opportunity'}
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

  const ownerName = employees.find((e) => e.id === opp.owner_user_id)?.name ?? '—'
  const weighted = ((opp.amount_inr ?? 0) * (opp.probability_pct ?? 0)) / 100

  return (
    <div className="page">
      <Link to="/opportunities" className="backlink"><ArrowLeft size={14} /> Pipeline</Link>

      <header className="rechead">
        <div className="rechead__top">
          <div>
            <div role="heading" aria-level={1} className="rechead__name">{opp.name}</div>
            <div className="rechead__meta">
              {opp.fr_organisations ? (
                <Link to="/organisations/$id" params={{ id: opp.fr_organisations.id }} style={{ fontSize: 'var(--text-sm)' }}>
                  {opp.fr_organisations.name}
                </Link>
              ) : null}
              <span className="tn-num" style={{ fontSize: 'var(--text-sm)' }}>
                {formatAmount(opp.amount, opp.currency)}
              </span>
              {opp.currency !== 'INR' ? (
                <span className="faint tn-num" style={{ fontSize: 'var(--text-sm)' }}>
                  {formatMoney(opp.amount_inr)}
                </span>
              ) : null}
              <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>{ownerName}</span>
              {opp.is_confidential ? <Badge tone="outline">Confidential</Badge> : null}
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 190 }}>
              <Select
                label="Stage"
                value={opp.stage_id}
                onChange={(e) => requestStage(e.currentTarget.value)}
                disabled={moving}
              >
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </div>
            <Button variant="secondary" iconLeft={<Pencil size={15} />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          </div>
        </div>
      </header>

      {isWon && linkedGrantId === null ? (
        <div className="qualitystrip" style={{ marginBottom: 'var(--space-5)' }}>
          <AlertTriangle size={16} />
          <span>
            This deal is won but has no grant yet, so its money is missing from the grants
            dashboard. Picking up where the wizard left off will create it.
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <Button size="sm" onClick={() => setWonOpen(true)}>Create grant</Button>
          </span>
        </div>
      ) : null}

      <nav className="tabs" aria-label="Opportunity sections">
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
              { label: 'Stage', value: stageNow?.label },
              { label: 'Win probability', value: opp.probability_pct != null ? `${opp.probability_pct}%` : null },
              { label: 'Weighted value', value: <span className="tn-num">{formatMoney(weighted)}</span> },
              { label: 'Capital category', value: labelOf(CAPITAL_CATEGORIES, opp.capital_category) },
              { label: 'Type', value: labelOf(OPPORTUNITY_TYPES, opp.opportunity_type) },
              { label: 'NBD / PM', value: opp.deal_category },
              { label: 'Expected close', value: <span className="tn-num">{formatDate(opp.expected_close_date)}</span> },
              { label: 'Fiscal year', value: opp.fiscal_year ? `${opp.fiscal_year} ${opp.fiscal_quarter ?? ''}`.trim() : null },
              { label: 'Owner', value: ownerName },
              { label: 'Geography', value: opp.geography },
              {
                label: 'Next step',
                value: opp.next_step
                  ? `${opp.next_step}${opp.next_step_date ? ` · ${formatDate(opp.next_step_date)}` : ''}`
                  : null,
              },
              { label: 'Source', value: opp.source_detail },
              { label: 'Notes', value: opp.notes },
            ]}
          />
        </div>
      ) : null}

      {tab === 'programs' ? <ProgramsTab opportunityId={opp.id} /> : null}
      {tab === 'activity' ? <ActivityFeed parentType="opportunity" parentId={opp.id} /> : null}
      {tab === 'history' ? <HistoryTab opportunityId={opp.id} /> : null}
      {tab === 'proposals' ? <ProposalsTab opportunityId={opp.id} /> : null}
      {tab === 'collaborators' ? <CollaboratorsTab opportunityId={opp.id} /> : null}

      <OpportunityForm
        open={editOpen}
        opportunity={opp}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => setOpp({ ...(next as OppWithOrg), fr_organisations: opp.fr_organisations })}
      />

      <StageMoveDialog
        open={pendingStage !== null}
        toStage={pendingStage}
        opportunityId={opp.id}
        opportunityName={opp.name}
        busy={moving}
        onCancel={() => setPendingStage(null)}
        onConfirm={(extras) => { if (pendingStage) void commitMove(pendingStage, extras) }}
      />

      <WonWizard
        open={wonOpen}
        opportunity={opp}
        onClose={() => setWonOpen(false)}
        onCreated={(grantId) => navigate({ to: '/grants/$id', params: { id: grantId } })}
      />
    </div>
  )
}

/* ---------- Programs ---------- */

type OppProgram = {
  id: string
  program_id: string
  project_id: string | null
  indicative_amount_inr: number | null
  notes: string | null
  fr_programs: { id: string; code: string; name: string } | null
  fr_projects: { id: string; code: string; name: string } | null
}

function ProgramsTab({ opportunityId }: { opportunityId: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<OppProgram[] | null>(null)
  const [programs, setPrograms] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string; program_id: string }>>([])
  const [adding, setAdding] = useState(false)
  const [programId, setProgramId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setRows(null)
    const { data } = await supabase
      .from('fr_opportunity_programs')
      .select('*, fr_programs(id, code, name), fr_projects(id, code, name)')
      .eq('opportunity_id', opportunityId)
    setRows((data ?? []) as unknown as OppProgram[])
  }, [opportunityId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let active = true
    ;(async () => {
      const [p, pr] = await Promise.all([
        supabase.from('fr_programs').select('id, code, name').eq('is_active', true).order('sort_order'),
        supabase.from('fr_projects').select('id, code, name, program_id').eq('is_active', true).order('code'),
      ])
      if (!active) return
      setPrograms((p.data ?? []) as Array<{ id: string; code: string; name: string }>)
      setProjects((pr.data ?? []) as Array<{ id: string; code: string; name: string; program_id: string }>)
    })()
    return () => { active = false }
  }, [])

  async function add() {
    if (!programId) { toast.error('Pick a program.'); return }
    setBusy(true)
    const { data, error } = await supabase
      .from('fr_opportunity_programs')
      .insert({
        opportunity_id: opportunityId,
        program_id: programId,
        project_id: projectId || null,
        indicative_amount_inr: amount ? Number(amount) : null,
      })
      .select('*, fr_programs(id, code, name), fr_projects(id, code, name)')
      .single()
    setBusy(false)
    if (error) {
      toast.error(
        error.message.includes('duplicate key')
          ? 'That program is already linked to this opportunity.'
          : error.message,
      )
      return
    }
    setRows((prev) => [...(prev ?? []), data as unknown as OppProgram])
    setAdding(false)
    setProgramId(''); setProjectId(''); setAmount('')
    toast.success('Program linked.')
  }

  async function remove(rowId: string) {
    const { error } = await supabase.from('fr_opportunity_programs').delete().eq('id', rowId)
    if (error) { toast.error(error.message); return }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== rowId))
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!adding ? (
          <Button size="sm" iconLeft={<Plus size={14} />} onClick={() => setAdding(true)}>Link program</Button>
        ) : null}
      </div>

      {adding ? (
        <div className="card">
          <div className="row row--wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-4)' }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <Select label="Program" value={programId} onChange={(e) => { setProgramId(e.currentTarget.value); setProjectId('') }}>
                <option value="">Select</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </Select>
            </div>
            <div style={{ minWidth: 180 }}>
              <Select label="Project" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)}>
                <option value="">—</option>
                {projects.filter((p) => p.program_id === programId).map((p) => (
                  <option key={p.id} value={p.id}>{p.code}</option>
                ))}
              </Select>
            </div>
            <div style={{ minWidth: 150 }}>
              <Input label="Indicative ₹" type="number" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
            </div>
            <Button onClick={() => void add()} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {rows === null ? <TableSkeleton rows={3} cols={4} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No programs linked" body="Which programs would this money fund?" />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Program</th>
                <th style={{ width: '140px' }}>Project</th>
                <th style={{ width: '160px' }}>Indicative</th>
                <th className="col-actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.fr_programs ? `${r.fr_programs.code} · ${r.fr_programs.name}` : '—'}</td>
                  <td className="muted">{r.fr_projects?.code ?? '—'}</td>
                  <td className="tn-num">{formatMoney(r.indicative_amount_inr)}</td>
                  <td className="col-actions">
                    <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => void remove(r.id)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ---------- Stage history ---------- */

type HistoryRow = {
  id: string
  changed_at: string
  changed_by: string | null
  note: string | null
  from_stage_id: string | null
  to_stage_id: string
}

function HistoryTab({ opportunityId }: { opportunityId: string }) {
  const { employees } = useEmployees()
  const { stages } = usePipelineStages()
  const [rows, setRows] = useState<HistoryRow[] | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_opportunity_stage_history')
        .select('id, changed_at, changed_by, note, from_stage_id, to_stage_id')
        .eq('opportunity_id', opportunityId)
        .order('changed_at', { ascending: false })
      if (active) setRows((data ?? []) as HistoryRow[])
    })()
    return () => { active = false }
  }, [opportunityId])

  const stageLabel = (id: string | null) => (id ? stages.find((s) => s.id === id)?.label ?? '—' : '—')

  if (rows === null) return <TableSkeleton rows={4} cols={4} />
  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState title="No stage changes yet" body="Every move through the pipeline is recorded here." />
      </div>
    )
  }

  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: '180px' }}>When</th>
            <th style={{ width: '170px' }}>From</th>
            <th style={{ width: '170px' }}>To</th>
            <th style={{ width: '160px' }}>By</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="tn-num muted">{formatDateTime(r.changed_at)}</td>
              <td className="muted">{r.from_stage_id ? stageLabel(r.from_stage_id) : <span className="faint">Created</span>}</td>
              <td>{stageLabel(r.to_stage_id)}</td>
              <td className="muted">{employees.find((e) => e.id === r.changed_by)?.name ?? '—'}</td>
              <td className="muted">{r.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Proposals ---------- */

type Proposal = {
  id: string
  version: number
  title: string | null
  proposal_type: string | null
  value: number | null
  currency: string | null
  submitted_on: string | null
  status: string | null
  document_url: string | null
  notes: string | null
}

function ProposalsTab({ opportunityId }: { opportunityId: string }) {
  const toast = useToast()
  const access = useAccess()
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('concept_note')
  const [value, setValue] = useState('')
  const [status, setStatus] = useState('draft')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setRows(null)
    const { data } = await supabase
      .from('fr_proposals')
      .select('id, version, title, proposal_type, value, currency, submitted_on, status, document_url, notes')
      .eq('opportunity_id', opportunityId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
    setRows((data ?? []) as Proposal[])
  }, [opportunityId])

  useEffect(() => { void load() }, [load])

  async function add() {
    if (!title.trim()) { toast.error('Title is required.'); return }
    setBusy(true)
    // Version numbers restart per opportunity, so they're assigned here
    // rather than by a shared database sequence.
    const nextVersion = (rows ?? []).reduce((max, r) => Math.max(max, r.version), 0) + 1
    const { data, error } = await supabase
      .from('fr_proposals')
      .insert({
        opportunity_id: opportunityId,
        version: nextVersion,
        title: title.trim(),
        proposal_type: type,
        value: value ? Number(value) : null,
        currency: 'INR',
        status,
        document_url: url.trim() || null,
        created_by: access.employeeId,
      })
      .select()
      .single()
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setRows((prev) => [data as Proposal, ...(prev ?? [])])
    setAdding(false)
    setTitle(''); setValue(''); setUrl(''); setType('concept_note'); setStatus('draft')
    toast.success(`Version ${nextVersion} added.`)
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!adding ? (
          <Button size="sm" iconLeft={<Plus size={14} />} onClick={() => setAdding(true)}>Add proposal</Button>
        ) : null}
      </div>

      {adding ? (
        <div className="card stack">
          <div className="row row--wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-4)' }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <Input label="Title" required value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select label="Type" value={type} onChange={(e) => setType(e.currentTarget.value)}>
                {PROPOSAL_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <div style={{ minWidth: 140 }}>
              <Input label="Value ₹" type="number" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
            </div>
            <div style={{ minWidth: 140 }}>
              <Select label="Status" value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
                {PROPOSAL_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>
          <Input label="Document link" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void add()} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
          </div>
        </div>
      ) : null}

      {rows === null ? <TableSkeleton rows={3} cols={5} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No proposals yet" body="Concept notes, full proposals and budgets are versioned here." />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '60px' }}>v</th>
                <th>Title</th>
                <th style={{ width: '150px' }}>Type</th>
                <th style={{ width: '130px' }}>Value</th>
                <th style={{ width: '130px' }}>Status</th>
                <th style={{ width: '120px' }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="tn-num">{p.version}</td>
                  <td>{p.title}</td>
                  <td className="muted">{labelOf(PROPOSAL_TYPES, p.proposal_type)}</td>
                  <td className="tn-num">{formatMoney(p.value)}</td>
                  <td><Badge tone="outline">{labelOf(PROPOSAL_STATUSES, p.status)}</Badge></td>
                  <td>
                    {p.document_url ? (
                      <a href={p.document_url} target="_blank" rel="noreferrer noopener" className="celllink">Open</a>
                    ) : <span className="faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ---------- Collaborators ---------- */

type Collaborator = {
  id: string
  user_id: string
  role: string | null
  added_at: string
  employees: { id: string; name: string; email: string } | null
}

function CollaboratorsTab({ opportunityId }: { opportunityId: string }) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()
  const [rows, setRows] = useState<Collaborator[] | null>(null)
  const [userId, setUserId] = useState('')
  const [busy, setBusy] = useState(false)

  // Two FKs point at employees (user_id and added_by), so the embed has to
  // name the column or PostgREST cannot tell them apart.
  const SELECT = 'id, user_id, role, added_at, employees!user_id(id, name, email)'

  const load = useCallback(async () => {
    setRows(null)
    const { data } = await supabase
      .from('fr_opportunity_collaborators')
      .select(SELECT)
      .eq('opportunity_id', opportunityId)
      .order('added_at')
    setRows((data ?? []) as unknown as Collaborator[])
  }, [opportunityId])

  useEffect(() => { void load() }, [load])

  async function add() {
    if (!userId) { toast.error('Pick someone.'); return }
    setBusy(true)
    const { data, error } = await supabase
      .from('fr_opportunity_collaborators')
      .insert({ opportunity_id: opportunityId, user_id: userId, added_by: access.employeeId })
      .select(SELECT)
      .single()
    setBusy(false)
    if (error) {
      toast.error(error.message.includes('duplicate key') ? 'Already a collaborator.' : error.message)
      return
    }
    setRows((prev) => [...(prev ?? []), data as unknown as Collaborator])
    setUserId('')
    toast.success('Collaborator added.')
  }

  async function remove(rowId: string) {
    const { error } = await supabase.from('fr_opportunity_collaborators').delete().eq('id', rowId)
    if (error) { toast.error(error.message); return }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== rowId))
  }

  const taken = new Set((rows ?? []).map((r) => r.user_id))

  return (
    <div className="stack">
      <div className="card">
        <div className="row row--wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-4)' }}>
          <div className="grow" style={{ minWidth: 220 }}>
            <Select label="Add collaborator" value={userId} onChange={(e) => setUserId(e.currentTarget.value)}>
              <option value="">Select someone</option>
              {employees.filter((e) => !taken.has(e.id)).map((e) => (
                <option key={e.id} value={e.id}>{e.name} · {e.email}</option>
              ))}
            </Select>
          </div>
          <Button onClick={() => void add()} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
        </div>
      </div>

      {rows === null ? <TableSkeleton rows={2} cols={3} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No collaborators"
            body="Collaborators can see and work on this deal alongside its owner."
          />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: '240px' }}>Email</th>
                <th style={{ width: '140px' }}>Added</th>
                <th className="col-actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employees?.name ?? '—'}</td>
                  <td className="muted">{r.employees?.email ?? '—'}</td>
                  <td className="tn-num muted">{formatDate(r.added_at)}</td>
                  <td className="col-actions">
                    <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => void remove(r.id)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

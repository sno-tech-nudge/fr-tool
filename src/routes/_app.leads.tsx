import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, EmptyState, Pagination, SearchInput, Select, TableSkeleton, Textarea, useToast,
} from '../components/ui'
import { Drawer } from '../components/ui'
import { LeadQuickAdd, type Lead, type LeadSource } from '../components/leads/LeadQuickAdd'
import { LeadConvertWizard } from '../components/leads/LeadConvertWizard'
import { LEAD_REJECTION_REASONS, LEAD_STATUSES, labelOf } from '../lib/enums'
import { formatDate } from '../lib/format'
import { useAccess } from '../lib/accessContext'
import { useEmployees } from '../hooks/useEmployees'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { sanitizeSearch } from '../lib/query'

export const Route = createFileRoute('/_app/leads')({ component: LeadsPage })

const PAGE_SIZE = 50
// Default to the open queue — triage is the point of this screen.
const DEFAULTS = { q: '', status: 'open', owner: '', page: '1' }

function statusTone(status: string) {
  switch (status) {
    case 'new': return 'amber' as const
    case 'assigned': return 'brown' as const
    case 'qualified_converted': return 'green' as const
    default: return 'outline' as const
  }
}

function LeadsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const access = useAccess()
  const { employees } = useEmployees()
  const { filters, setFilter } = useUrlFilters(DEFAULTS)

  const [rows, setRows] = useState<Lead[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<LeadSource[]>([])

  const [addOpen, setAddOpen] = useState(false)
  const [converting, setConverting] = useState<Lead | null>(null)
  const [rejecting, setRejecting] = useState<Lead | null>(null)
  const [rejectReason, setRejectReason] = useState('not_a_fit')
  const [rejectNote, setRejectNote] = useState('')
  const [busy, setBusy] = useState(false)

  const page = Math.max(1, Number(filters.page) || 1)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.from('fr_lead_sources').select('id, key, label')
      if (active) setSources((data ?? []) as LeadSource[])
    })()
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    setRows(null)
    setError(null)

    let q = supabase
      .from('fr_leads')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)

    if (filters.q) {
      const s = sanitizeSearch(filters.q)
      q = q.or(`full_name.ilike.%${s}%,org_name.ilike.%${s}%,email.ilike.%${s}%`)
    }
    if (filters.status === 'open') q = q.in('status', ['new', 'assigned'])
    else if (filters.status) q = q.eq('status', filters.status)
    if (filters.owner) q = q.eq('owner_user_id', filters.owner)

    const { data, error: err, count } = await q
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as Lead[])
    setTotal(count ?? 0)
  }, [filters.q, filters.status, filters.owner, page])

  useEffect(() => { void load() }, [load])

  async function assign(lead: Lead, userId: string) {
    const { data, error: err } = await supabase
      .from('fr_leads')
      .update({
        owner_user_id: userId || null,
        // Assigning an owner moves a new lead out of the untriaged state.
        status: userId && lead.status === 'new' ? 'assigned' : lead.status,
        updated_by: access.employeeId,
      })
      .eq('id', lead.id)
      .select()
      .single()
    if (err) { toast.error(err.message); return }
    setRows((prev) => (prev ?? []).map((r) => (r.id === lead.id ? (data as Lead) : r)))
  }

  async function reject() {
    if (!rejecting) return
    setBusy(true)
    const { error: err } = await supabase
      .from('fr_leads')
      .update({
        status: 'rejected',
        rejection_reason: rejectReason,
        notes: rejectNote.trim()
          ? [rejecting.notes, `Rejected: ${rejectNote.trim()}`].filter(Boolean).join('\n')
          : rejecting.notes,
        updated_by: access.employeeId,
      })
      .eq('id', rejecting.id)
    setBusy(false)
    if (err) { toast.error(err.message); return }
    toast.success('Lead rejected.')
    setRejecting(null)
    setRejectNote('')
    void load()
  }

  const sourceLabel = (id: string | null) =>
    id ? (sources.find((s) => s.id === id)?.label ?? '—') : '—'

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Leads</h1>
          <p className="page__sub">New prospects awaiting triage. Convert a lead to create the organisation and contact.</p>
        </div>
        <Button iconLeft={<Plus size={15} />} onClick={() => setAddOpen(true)}>Capture lead</Button>
      </div>

      <div className="filterbar">
        <SearchInput value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search name, org or email" />
        <Select label="Status" value={filters.status} onChange={(e) => setFilter('status', e.currentTarget.value)}>
          <option value="open">Open queue</option>
          <option value="">All</option>
          {LEAD_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="Owner" value={filters.owner} onChange={(e) => setFilter('owner', e.currentTarget.value)}>
          <option value="">Anyone</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load leads"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={8} cols={6} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="The queue is clear"
            body="Leads captured at events, from references, LinkedIn or databases land here for triage."
            action={<Button iconLeft={<Plus size={15} />} onClick={() => setAddOpen(true)}>Capture lead</Button>}
          />
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: '190px' }}>Organisation</th>
                  <th style={{ width: '130px' }}>Source</th>
                  <th style={{ width: '180px' }}>Owner</th>
                  <th style={{ width: '130px' }}>Status</th>
                  <th style={{ width: '110px' }}>Captured</th>
                  <th className="col-actions">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const open = l.status === 'new' || l.status === 'assigned'
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.full_name}
                        <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                          {l.email || l.phone || ''}
                        </div>
                      </td>
                      <td className="muted">{l.org_name ?? '—'}</td>
                      <td className="muted">{sourceLabel(l.source_key)}</td>
                      <td>
                        <Select
                          value={l.owner_user_id ?? ''}
                          aria-label="Owner"
                          onChange={(e) => void assign(l, e.currentTarget.value)}
                          disabled={!open}
                        >
                          <option value="">Unassigned</option>
                          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </Select>
                      </td>
                      <td>
                        <Badge tone={statusTone(l.status)} dot>
                          {labelOf(LEAD_STATUSES, l.status)}
                        </Badge>
                      </td>
                      <td className="tn-num muted">{formatDate(l.created_at)}</td>
                      <td className="col-actions">
                        <span className="rowactions">
                          {open ? (
                            <>
                              <Button size="sm" onClick={() => setConverting(l)}>Convert</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRejecting(l)}>Reject</Button>
                            </>
                          ) : l.converted_organisation_id ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate({
                                to: '/organisations/$id',
                                params: { id: l.converted_organisation_id! },
                              })}
                            >
                              View org
                            </Button>
                          ) : (
                            <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                              {labelOf(LEAD_REJECTION_REASONS, l.rejection_reason)}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setFilter('page', String(p))} />
        </>
      )}

      <LeadQuickAdd
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => void load()}
      />

      <LeadConvertWizard
        open={converting !== null}
        lead={converting}
        onClose={() => setConverting(null)}
        onConverted={() => void load()}
      />

      {/* Rejection needs a reason (IA 3.1) — an in-app drawer, never a browser prompt. */}
      <Drawer
        open={rejecting !== null}
        title="Reject lead"
        onClose={() => setRejecting(null)}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => void reject()} disabled={busy}>
              {busy ? 'Rejecting…' : 'Reject'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Select
            label="Reason"
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.currentTarget.value)}
          >
            {LEAD_REJECTION_REASONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Textarea
            label="Note"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.currentTarget.value)}
          />
        </div>
      </Drawer>
    </div>
  )
}

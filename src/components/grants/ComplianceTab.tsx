import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, Drawer, EmptyState, Input, Select, Skeleton, Textarea, useToast,
} from '../ui'
import { MILESTONE_STATUSES, REPORTING_FREQUENCIES, labelOf } from '../../lib/enums'
import { formatDate, toISODate } from '../../lib/format'
import { daysUntil, isEffectivelyOverdue } from '../../lib/grants'
import { fiscalYear } from '../../lib/fy'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'

type Period = {
  id: string
  period_key: string
  period_label: string
  period_start_date: string | null
  period_end_date: string | null
  due_date: string | null
  submission_date: string | null
  overall_status: string
  uc_stage: string | null
  notes: string | null
}

type Milestone = {
  id: string
  milestone_type_id: string | null
  report_period_id: string | null
  title: string
  due_date: string
  owner_user_id: string | null
  status: string
  submitted_on: string | null
  document_url: string | null
  notes: string | null
}

type MilestoneType = { id: string; key: string; label: string }

function addMonths(d: Date, n: number) {
  const out = new Date(d)
  out.setMonth(out.getMonth() + n)
  return out
}

function addDays(d: Date, n: number) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

const iso = toISODate

/**
 * The start of the fiscal window containing `d`. Windows are counted from
 * April, so a quarterly grant reports on Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar
 * whatever month it happened to be signed in.
 */
function windowStart(d: Date, step: number): Date {
  const monthsFromApril = (d.getMonth() - 3 + 12) % 12
  const offset = Math.floor(monthsFromApril / step) * step
  const fyStartYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return new Date(fyStartYear, 3 + offset, 1)
}

/** JAS for Jul–Sep, H2 for Oct–Mar, FY for a full year. */
function windowLabel(start: Date, step: number): string {
  if (step === 12) return 'FY'
  if (step === 6) return start.getMonth() === 3 ? 'H1' : 'H2'
  switch (start.getMonth()) {
    case 3: return 'AMJ'
    case 6: return 'JAS'
    case 9: return 'OND'
    default: return 'JFM'
  }
}

/**
 * Reporting windows across the grant term, aligned to the fiscal calendar and
 * named the way the team already does on paper — JAS_FY26 for Jul–Sep of
 * FY 2026-27. Reports fall due 30 days after their window closes.
 *
 * Grants rarely start on a quarter boundary, so the first window is clipped to
 * the signing date. A clipped stub shorter than half a period would mean, say,
 * a two-week utilisation certificate — so it is absorbed into the window that
 * follows instead of being reported on its own.
 */
function buildPeriods(frequency: string, start: string, end: string) {
  const step = frequency === 'quarterly' ? 3
    : frequency === 'half_yearly' || frequency === 'bi_annually' ? 6
      : 12
  const startAt = new Date(start)
  const endAt = new Date(end)

  const bounds: Date[] = []
  let cursor = windowStart(startAt, step)
  let guard = 0
  while (cursor <= endAt && guard++ < 40) {
    bounds.push(cursor)
    cursor = addMonths(cursor, step)
  }
  if (bounds.length === 0) return []

  // Absorb a too-short opening stub into the next window, if there is one.
  const firstClose = addDays(addMonths(bounds[0], step), -1)
  const stubDays = (firstClose.getTime() - startAt.getTime()) / 86_400_000
  if (bounds.length > 1 && stubDays < (step * 30) / 2) bounds.shift()

  return bounds.map((from, i) => {
    const close = addDays(addMonths(from, step), -1)
    const windowEnd = close > endAt ? endAt : close
    // The opening window begins when the money does, not at the boundary.
    const windowFrom = i === 0 && startAt > from ? startAt : from
    const fy = fiscalYear(from) ?? ''
    const label = windowLabel(from, step)
    return {
      key: `${label}_FY${fy.replace('FY ', '').slice(0, 4)}`,
      label: `${label} ${fy}`,
      from: iso(windowFrom),
      to: iso(windowEnd),
      due: iso(addDays(windowEnd, 30)),
    }
  })
}

export function ComplianceTab({
  grantId, capitalCategory, startDate, endDate, onChanged,
}: {
  grantId: string
  capitalCategory: string
  startDate: string
  endDate: string
  onChanged: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()

  const [periods, setPeriods] = useState<Period[] | null>(null)
  const [milestones, setMilestones] = useState<Milestone[] | null>(null)
  const [types, setTypes] = useState<MilestoneType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [frequency, setFrequency] = useState('quarterly')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Milestone | null>(null)
  const [confirmDeletePeriod, setConfirmDeletePeriod] = useState<Period | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const [p, m] = await Promise.all([
      supabase.from('fr_compliance_report_periods')
        .select('*').eq('grant_id', grantId).is('deleted_at', null).order('due_date'),
      supabase.from('fr_compliance_milestones')
        .select('*').eq('grant_id', grantId).is('deleted_at', null).order('due_date'),
    ])
    if (p.error || m.error) { setError((p.error ?? m.error)!.message); return }
    setPeriods((p.data ?? []) as Period[])
    setMilestones((m.data ?? []) as Milestone[])
  }, [grantId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_milestone_types').select('id, key, label').eq('is_active', true).order('label')
      if (active) setTypes((data ?? []) as MilestoneType[])
    })()
    return () => { active = false }
  }, [])

  async function generatePeriods() {
    if (periods && periods.length > 0) { toast.error('Periods already exist for this grant.'); return }
    setBusy(true)
    const built = buildPeriods(frequency, startDate, endDate)
    // Upsert rather than insert: a previously removed period is soft-deleted,
    // so its (grant_id, period_key) still occupies the unique constraint and a
    // plain insert would collide. Regenerating revives the row instead. This is
    // also the one fr_ table where ON CONFLICT works — its unique index is a
    // real constraint, not the usual partial one.
    const { error: err } = await supabase.from('fr_compliance_report_periods').upsert(
      built.map((b) => ({
        grant_id: grantId,
        period_key: b.key,
        period_label: b.label,
        period_start_date: b.from,
        period_end_date: b.to,
        due_date: b.due,
        reporting_frequency: frequency,
        overall_status: 'green',
        deleted_at: null,
        created_by: access.employeeId,
      })),
      { onConflict: 'grant_id,period_key' },
    )
    setBusy(false)
    setGenOpen(false)
    if (err) { toast.error(err.message); return }
    toast.success(`${built.length} reporting periods created.`)
    void load()
  }

  async function removePeriod(p: Period) {
    setConfirmDeletePeriod(null)
    const { error: err } = await supabase
      .from('fr_compliance_report_periods')
      .update({ deleted_at: new Date().toISOString(), updated_by: access.employeeId })
      .eq('id', p.id)
    if (err) { toast.error(err.message); return }
    setPeriods((prev) => (prev ?? []).filter((x) => x.id !== p.id))
    // Milestones outlive their period — they simply stop being bundled.
    setMilestones((prev) => (prev ?? []).map((m) => (
      m.report_period_id === p.id ? { ...m, report_period_id: null } : m
    )))
    toast.success('Reporting period removed.')
  }

  async function removeMilestone(m: Milestone) {
    setConfirmDelete(null)
    const { error: err } = await supabase
      .from('fr_compliance_milestones')
      .update({ deleted_at: new Date().toISOString(), updated_by: access.employeeId })
      .eq('id', m.id)
    if (err) { toast.error(err.message); return }
    setMilestones((prev) => (prev ?? []).filter((x) => x.id !== m.id))
    toast.success('Milestone removed.')
    onChanged()
  }

  const ownerName = (id: string | null) =>
    (id ? employees.find((e) => e.id === id)?.name : null) ?? '—'

  function milestoneRow(m: Milestone) {
    const late = isEffectivelyOverdue(m.status, m.due_date)
    const days = daysUntil(m.due_date)
    return (
      <tr key={m.id} className="is-clickable" onClick={() => setEditing(m)}>
        <td>{m.title}</td>
        <td className="tn-num">
          {formatDate(m.due_date)}
          {late ? (
            <div style={{ color: 'var(--rag-red)', fontSize: 'var(--text-sm)' }}>
              {Math.abs(days ?? 0)} days overdue
            </div>
          ) : null}
        </td>
        <td>
          {/* `overdue` here is computed, never written back to the record. */}
          <Badge tone={late ? 'red' : m.status === 'accepted' ? 'green' : 'brown'}>
            {late && m.status !== 'overdue' ? 'Overdue' : labelOf(MILESTONE_STATUSES, m.status)}
          </Badge>
        </td>
        <td className="muted">{ownerName(m.owner_user_id)}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Trash2 size={14} />}
            onClick={() => setConfirmDelete(m)}
            aria-label="Remove milestone"
          />
        </td>
      </tr>
    )
  }

  const standalone = (milestones ?? []).filter((m) => !m.report_period_id)

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Wand2 size={14} />}
          onClick={() => setGenOpen(true)}
        >
          Generate periods
        </Button>
        <Button size="sm" iconLeft={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          Add milestone
        </Button>
      </div>

      {error ? (
        <div className="card"><EmptyState title="Could not load compliance" body={error} /></div>
      ) : periods === null || milestones === null ? (
        <Skeleton height={140} />
      ) : periods.length === 0 && milestones.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing to report yet"
            body="Generate the reporting periods for this grant's term, then hang the utilisation certificates and narrative reports off them."
            action={
              <Button iconLeft={<Wand2 size={15} />} onClick={() => setGenOpen(true)}>
                Generate periods
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {periods.map((p) => {
            const own = (milestones ?? []).filter((m) => m.report_period_id === p.id)
            const late = isEffectivelyOverdue(
              p.submission_date ? 'submitted' : 'upcoming', p.due_date,
            )
            return (
              <div key={p.id} className="card stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{p.period_label}</strong>
                    <span className="faint tn-num" style={{ marginLeft: 'var(--space-3)' }}>
                      {formatDate(p.period_start_date)} – {formatDate(p.period_end_date)}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 'var(--space-3)' }}>
                    <span className="muted tn-num" style={{ fontSize: 'var(--text-sm)' }}>
                      Due {formatDate(p.due_date)}
                    </span>
                    <Badge tone={p.submission_date ? 'green' : late ? 'red' : 'brown'}>
                      {p.submission_date ? 'Submitted' : late ? 'Overdue' : 'Upcoming'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Trash2 size={14} />}
                      onClick={() => setConfirmDeletePeriod(p)}
                      aria-label={`Remove ${p.period_label}`}
                    />
                  </div>
                </div>

                {own.length > 0 ? (
                  <div className="tablewrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Milestone</th>
                          <th style={{ width: '150px' }}>Due</th>
                          <th style={{ width: '130px' }}>Status</th>
                          <th style={{ width: '150px' }}>Owner</th>
                          <th style={{ width: '60px' }}>&nbsp;</th>
                        </tr>
                      </thead>
                      <tbody>{own.map(milestoneRow)}</tbody>
                    </table>
                  </div>
                ) : (
                  <p className="faint">No milestones attached to this period.</p>
                )}
              </div>
            )
          })}

          {standalone.length > 0 ? (
            <div className="card stack">
              <div className="tn-micro">Not tied to a period</div>
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Milestone</th>
                      <th style={{ width: '150px' }}>Due</th>
                      <th style={{ width: '130px' }}>Status</th>
                      <th style={{ width: '150px' }}>Owner</th>
                      <th style={{ width: '60px' }}>&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>{standalone.map(milestoneRow)}</tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}

      <MilestoneDrawer
        open={addOpen || editing !== null}
        milestone={editing}
        grantId={grantId}
        capitalCategory={capitalCategory}
        types={types}
        periods={periods ?? []}
        onClose={() => { setAddOpen(false); setEditing(null) }}
        onSaved={() => { void load(); onChanged() }}
      />

      <Drawer
        open={genOpen}
        title="Generate reporting periods"
        onClose={() => setGenOpen(false)}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void generatePeriods()} disabled={busy}>
              {busy ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Select
            label="Reporting frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.currentTarget.value)}
            help={`Across ${formatDate(startDate)} – ${formatDate(endDate)}. Each report falls due 30 days after its window closes.`}
          >
            {REPORTING_FREQUENCIES.filter((f) => f.value !== 'ad_hoc')
              .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDeletePeriod !== null}
        title={`Remove ${confirmDeletePeriod?.period_label ?? 'this period'}?`}
        body="Milestones attached to it are kept — they just stop being bundled under a period."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmDeletePeriod(null)}
        onConfirm={() => { if (confirmDeletePeriod) void removePeriod(confirmDeletePeriod) }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remove this milestone?"
        body="It is soft-deleted, so it stops appearing but the record is kept."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void removeMilestone(confirmDelete) }}
      />
    </div>
  )
}

/* ---------- add / edit one milestone ---------- */

const EMPTY = {
  title: '', milestone_type_id: '', report_period_id: '', due_date: '',
  owner_user_id: '', status: 'upcoming', submitted_on: '', document_url: '', notes: '',
}

function MilestoneDrawer({
  open, milestone, grantId, capitalCategory, types, periods, onClose, onSaved,
}: {
  open: boolean
  milestone: Milestone | null
  grantId: string
  capitalCategory: string
  types: MilestoneType[]
  periods: Period[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(milestone
      ? {
        title: milestone.title ?? '',
        milestone_type_id: milestone.milestone_type_id ?? '',
        report_period_id: milestone.report_period_id ?? '',
        due_date: milestone.due_date ?? '',
        owner_user_id: milestone.owner_user_id ?? '',
        status: milestone.status ?? 'upcoming',
        submitted_on: milestone.submitted_on ?? '',
        document_url: milestone.document_url ?? '',
        notes: milestone.notes ?? '',
      }
      : { ...EMPTY, owner_user_id: access.employeeId ?? '' })
  }, [open, milestone, access.employeeId])

  const set = <K extends keyof typeof EMPTY>(k: K, v: string) => setDraft((d) => ({ ...d, [k]: v }))

  // Picking a type with no title yet fills the title from the type's label.
  function setType(id: string) {
    const t = types.find((x) => x.id === id)
    setDraft((d) => ({ ...d, milestone_type_id: id, title: d.title || (t?.label ?? '') }))
  }

  async function save() {
    if (!draft.title.trim()) { toast.error('A title is required.'); return }
    if (!draft.due_date) { toast.error('A due date is required.'); return }

    setBusy(true)
    const payload = {
      grant_id: grantId,
      milestone_type_id: draft.milestone_type_id || null,
      report_period_id: draft.report_period_id || null,
      title: draft.title.trim(),
      due_date: draft.due_date,
      owner_user_id: draft.owner_user_id || null,
      status: draft.status,
      submitted_on: draft.submitted_on || null,
      document_url: draft.document_url.trim() || null,
      notes: draft.notes.trim() || null,
      updated_by: access.employeeId,
    }
    const res = milestone
      ? await supabase.from('fr_compliance_milestones')
        .update(payload).eq('id', milestone.id).select().single()
      : await supabase.from('fr_compliance_milestones')
        .insert({ ...payload, created_by: access.employeeId }).select().single()
    setBusy(false)
    if (res.error) { toast.error(res.error.message); return }
    toast.success(milestone ? 'Saved.' : 'Milestone added.')
    onSaved()
    onClose()
  }

  return (
    <Drawer
      open={open}
      title={milestone ? 'Edit milestone' : 'Add milestone'}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Type"
          value={draft.milestone_type_id}
          onChange={(e) => setType(e.currentTarget.value)}
          help={`Suggested for ${capitalCategory} grants.`}
        >
          <option value="">—</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>

        <Input
          label="Title"
          required
          value={draft.title}
          onChange={(e) => set('title', e.currentTarget.value)}
        />

        <Select
          label="Reporting period"
          value={draft.report_period_id}
          onChange={(e) => set('report_period_id', e.currentTarget.value)}
          help="Leave blank for a one-off that is not part of a reporting bundle."
        >
          <option value="">—</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.period_label}</option>)}
        </Select>

        <Input
          label="Due date"
          type="date"
          required
          value={draft.due_date}
          onChange={(e) => set('due_date', e.currentTarget.value)}
        />

        <Select
          label="Owner"
          value={draft.owner_user_id}
          onChange={(e) => set('owner_user_id', e.currentTarget.value)}
        >
          <option value="">—</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>

        <Select label="Status" value={draft.status} onChange={(e) => set('status', e.currentTarget.value)}>
          {MILESTONE_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        {draft.status === 'submitted' || draft.status === 'accepted' ? (
          <Input
            label="Submitted on"
            type="date"
            value={draft.submitted_on}
            onChange={(e) => set('submitted_on', e.currentTarget.value)}
          />
        ) : null}

        <Input
          label="Document URL"
          value={draft.document_url}
          onChange={(e) => set('document_url', e.currentTarget.value)}
        />

        <Textarea
          label="Notes"
          rows={3}
          value={draft.notes}
          onChange={(e) => set('notes', e.currentTarget.value)}
        />
      </div>
    </Drawer>
  )
}

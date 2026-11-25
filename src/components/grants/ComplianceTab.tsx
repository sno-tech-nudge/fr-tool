import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarPlus, FileText, Pencil, RefreshCw, Upload, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, Drawer, EmptyState, Input, Select, Skeleton, useToast,
} from '../ui'
import { MILESTONE_STATUSES, labelOf } from '../../lib/enums'
import { formatDate, toISODate } from '../../lib/format'
import { daysUntil, isEffectivelyOverdue } from '../../lib/grants'
import { fiscalYear } from '../../lib/fy'
import { useAccess } from '../../lib/accessContext'
import { DictationTextarea } from '../DictationTextarea'
import { notifyMentions, useFrPeople } from '../../lib/mentions'
import { useEmployees } from '../../hooks/useEmployees'
import { documentUrl, readableSize } from '../../lib/documents'
import { checkFile, uploadDealDocument } from '../../lib/dealDocuments'

/**
 * The grant's report timeline. Each row is one report due: its period
 * (From–To), due date, status and file. Rows come from the MoU's reporting
 * dates, from "Generate report timeline", or from "Add custom timeline".
 *
 * Underneath, a row is a milestone, normally in its own period; older grants
 * can have several reports in one period, and each still gets its own row.
 * Uploading a file stores it once as a Report document on the deal (so it
 * also shows on the Documents tab), names the report after the file and
 * marks it submitted that day.
 */

type Period = {
  id: string
  period_key: string
  period_label: string
  period_start_date: string | null
  period_end_date: string | null
  due_date: string | null
  submission_date: string | null
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
type ReportFile = {
  id: string; name: string; file_path: string; size_bytes: number | null; milestone_id: string
  /** Whoever uploaded it — shown as "Added by". */
  added_by_name: string | null
}

/** One line of the timeline: a report, an empty period, or both. */
type Row = { key: string; milestone: Milestone | null; period: Period | null }

const REPORT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'zip']
const REPORT_ACCEPT = REPORT_EXTENSIONS.map((e) => `.${e}`).join(',')

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly', step: 1, noun: 'Month' },
  { value: 'bi_monthly', label: 'Every 2 months', step: 2, noun: 'Period' },
  { value: 'quarterly', label: 'Quarterly', step: 3, noun: 'Quarter' },
  { value: 'half_yearly', label: 'Half-yearly', step: 6, noun: 'Half-year' },
  { value: 'annually', label: 'Yearly', step: 12, noun: 'Year' },
] as const

const iso = toISODate
const today = () => new Date().toLocaleDateString('en-CA')
const stripExt = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, '')

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

type Window = { key: string; label: string; from: string; to: string; due: string }

/** Windows counted from the MoU start date: 15 Aug – 14 Nov, 15 Nov – 14 Feb… */
function windowsFromStart(step: number, noun: string, start: string, end: string): Window[] {
  const startAt = new Date(start)
  const endAt = new Date(end)
  const out: Window[] = []
  for (let i = 0; i < 120; i++) {
    const from = addMonths(startAt, i * step)
    if (from > endAt) break
    const close = addDays(addMonths(startAt, (i + 1) * step), -1)
    const to = close > endAt ? endAt : close
    out.push({
      key: `S${step}_${iso(from)}`,
      label: `${noun} ${i + 1}`,
      from: iso(from),
      to: iso(to),
      due: iso(addDays(to, 30)),
    })
  }
  return out
}

/** The start of the financial-year window containing `d` (windows count from April). */
function fyWindowStart(d: Date, step: number): Date {
  const monthsFromApril = (d.getMonth() - 3 + 12) % 12
  const offset = Math.floor(monthsFromApril / step) * step
  const fyStartYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return new Date(fyStartYear, 3 + offset, 1)
}

/** JAS for Jul–Sep, H2 for Oct–Mar, FY for a full year. */
function fyWindowLabel(start: Date, step: number): string {
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
 * Windows on the financial-year calendar, named the way the team does
 * (JAS FY 2026-27). The first is clipped to the start date; a stub shorter
 * than half a window is folded into the next one.
 */
function windowsOnFy(step: number, start: string, end: string): Window[] {
  const startAt = new Date(start)
  const endAt = new Date(end)
  const bounds: Date[] = []
  let cursor = fyWindowStart(startAt, step)
  for (let guard = 0; cursor <= endAt && guard < 40; guard++) {
    bounds.push(cursor)
    cursor = addMonths(cursor, step)
  }
  if (bounds.length === 0) return []
  const firstClose = addDays(addMonths(bounds[0], step), -1)
  const stubDays = (firstClose.getTime() - startAt.getTime()) / 86_400_000
  if (bounds.length > 1 && stubDays < (step * 30) / 2) bounds.shift()

  return bounds.map((from, i) => {
    const close = addDays(addMonths(from, step), -1)
    const to = close > endAt ? endAt : close
    const windowFrom = i === 0 && startAt > from ? startAt : from
    const fy = fiscalYear(from) ?? ''
    const label = fyWindowLabel(from, step)
    return {
      key: `${label}_FY${fy.replace('FY ', '').slice(0, 4)}`,
      label: `${label} ${fy}`,
      from: iso(windowFrom),
      to: iso(to),
      due: iso(addDays(to, 30)),
    }
  })
}

export function ComplianceTab({
  grantId, startDate, endDate, onChanged,
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
  const [files, setFiles] = useState<ReportFile[]>([])
  const [types, setTypes] = useState<MilestoneType[]>([])
  const [dealId, setDealId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [genOpen, setGenOpen] = useState(false)
  const [frequency, setFrequency] = useState<string>('quarterly')
  const [countFrom, setCountFrom] = useState<'start' | 'fy'>('start')
  const [customOpen, setCustomOpen] = useState(false)
  const [cTitle, setCTitle] = useState('')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const [cDue, setCDue] = useState('')
  const [busy, setBusy] = useState(false)

  const [uploadFor, setUploadFor] = useState<Row | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const [p, m, f, g] = await Promise.all([
      supabase.from('fr_compliance_report_periods')
        .select('id, period_key, period_label, period_start_date, period_end_date, due_date, submission_date')
        .eq('grant_id', grantId).is('deleted_at', null),
      supabase.from('fr_compliance_milestones')
        .select('*').eq('grant_id', grantId).is('deleted_at', null),
      supabase.from('fr_documents')
        .select('id, name, file_path, size_bytes, milestone_id, added_by_name')
        .eq('grant_id', grantId).not('milestone_id', 'is', null).is('deleted_at', null),
      supabase.from('fr_grants').select('opportunity_id').eq('id', grantId).maybeSingle(),
    ])
    if (p.error || m.error) { setError((p.error ?? m.error)!.message); return }
    setPeriods((p.data ?? []) as Period[])
    setMilestones((m.data ?? []) as Milestone[])
    setFiles((f.data ?? []) as ReportFile[])
    setDealId((g.data as { opportunity_id: string | null } | null)?.opportunity_id ?? null)
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

  const periodOf = (id: string | null) => (periods ?? []).find((p) => p.id === id) ?? null
  const rows: Row[] = [
    ...(milestones ?? []).map((m) => ({ key: m.id, milestone: m, period: periodOf(m.report_period_id) })),
    ...(periods ?? [])
      .filter((p) => !(milestones ?? []).some((m) => m.report_period_id === p.id))
      .map((p) => ({ key: p.id, milestone: null, period: p })),
  ].sort((a, b) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999'))

  /** Creates periods with one report each. */
  async function createTimeline(windows: Window[], freq: string) {
    if (windows.length === 0) { toast.error('The grant has no start and end dates to build from.'); return false }
    // Upsert: a removed period keeps its key, so recreating it revives it.
    const { data: made, error: pErr } = await supabase.from('fr_compliance_report_periods').upsert(
      windows.map((w) => ({
        grant_id: grantId,
        period_key: w.key,
        period_label: w.label,
        period_start_date: w.from,
        period_end_date: w.to,
        due_date: w.due,
        reporting_frequency: freq,
        overall_status: 'green',
        deleted_at: null,
        created_by: access.employeeId,
      })),
      { onConflict: 'grant_id,period_key' },
    ).select('id, period_key, period_label, due_date')
    if (pErr) { toast.error(pErr.message); return false }
    const { error: mErr } = await supabase.from('fr_compliance_milestones').insert(
      ((made ?? []) as Array<{ id: string; period_label: string; due_date: string }>).map((p) => ({
        grant_id: grantId,
        report_period_id: p.id,
        title: `${p.period_label} report`,
        due_date: p.due_date,
        status: 'upcoming',
        created_by: access.employeeId,
      })),
    )
    if (mErr) { toast.error(mErr.message); return false }
    return true
  }

  async function generate() {
    const f = FREQUENCIES.find((x) => x.value === frequency)!
    const onFy = countFrom === 'fy' && f.step >= 3
    const windows = onFy ? windowsOnFy(f.step, startDate, endDate) : windowsFromStart(f.step, f.noun, startDate, endDate)
    setBusy(true)
    const ok = await createTimeline(windows, frequency)
    setBusy(false)
    if (!ok) return
    setGenOpen(false)
    toast.success(`${windows.length} reports added to the timeline.`)
    void load()
    onChanged()
  }

  async function addCustom() {
    if (!cFrom || !cTo) { toast.error('Pick the from and to dates.'); return }
    if (cTo < cFrom) { toast.error('It cannot end before it starts.'); return }
    const due = cDue || iso(addDays(new Date(cTo), 30))
    setBusy(true)
    const ok = await createTimeline([{
      key: `CUSTOM_${cFrom}_${cTo}`,
      label: cTitle.trim() || `${formatDate(cFrom)} – ${formatDate(cTo)}`,
      from: cFrom,
      to: cTo,
      due,
    }], 'ad_hoc')
    setBusy(false)
    if (!ok) return
    setCustomOpen(false)
    setCTitle(''); setCFrom(''); setCTo(''); setCDue('')
    toast.success('Added to the timeline.')
    void load()
    onChanged()
  }

  async function openFile(f: { file_path: string }) {
    const tab = window.open('', '_blank')
    try {
      const url = await documentUrl(f.file_path)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (e) {
      tab?.close()
      toast.error(e instanceof Error ? e.message : 'Could not open that file.')
    }
  }

  const fileOf = (r: Row) => (r.milestone ? files.find((f) => f.milestone_id === r.milestone!.id) ?? null : null)
  const ownerName = (id: string | null) => (id ? employees.find((e) => e.id === id)?.name : null) ?? '—'
  const typeName = (id: string | null) => (id ? types.find((t) => t.id === id)?.label : null) ?? null

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        {rows.length === 0 ? (
          <Button variant="secondary" size="sm" iconLeft={<Wand2 size={14} />} onClick={() => setGenOpen(true)}>
            Generate report timeline
          </Button>
        ) : null}
        <Button size="sm" iconLeft={<CalendarPlus size={14} />} onClick={() => setCustomOpen(true)}>
          Add custom timeline
        </Button>
      </div>

      {error ? (
        <div className="card"><EmptyState title="Could not load reports" body={error} /></div>
      ) : periods === null || milestones === null ? (
        <Skeleton height={140} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No report timeline yet"
            action={
              <Button iconLeft={<Wand2 size={15} />} onClick={() => setGenOpen(true)}>
                Generate report timeline
              </Button>
            }
          />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Report</th>
                <th style={{ width: '150px' }}>Type</th>
                <th style={{ width: '200px' }}>Period</th>
                <th style={{ width: '140px' }}>Due</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '230px' }}>File</th>
                <th className="col-actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.milestone
                // A period with no report record carries its own submitted date (imported grants).
                const status = m?.status ?? (r.period?.submission_date ? 'submitted' : 'upcoming')
                const submittedOn = m ? m.submitted_on : r.period?.submission_date ?? null
                const due = dueOf(r)
                const late = due ? isEffectivelyOverdue(status, due) : false
                const done = status === 'submitted' || status === 'accepted'
                const file = fileOf(r)
                return (
                  <tr key={r.key}>
                    <td>{m?.title ?? r.period?.period_label ?? '—'}</td>
                    <td className="muted">{typeName(m?.milestone_type_id ?? null) ?? '—'}</td>
                    <td className="tn-num muted" style={{ whiteSpace: 'nowrap' }}>
                      {r.period?.period_start_date && r.period.period_end_date
                        ? `${formatDate(r.period.period_start_date)} – ${formatDate(r.period.period_end_date)}`
                        : '—'}
                    </td>
                    <td className="tn-num" style={{ whiteSpace: 'nowrap' }}>
                      {due ? formatDate(due) : '—'}
                      {late ? (
                        <div style={{ color: 'var(--rag-red)', fontSize: 'var(--text-xs)' }}>
                          {Math.abs(daysUntil(due) ?? 0)} days overdue
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {/* "Overdue" is worked out on screen, never saved. */}
                      <Badge tone={late ? 'red' : done ? 'green' : 'brown'}>
                        {late ? 'Overdue' : labelOf(MILESTONE_STATUSES, status)}
                      </Badge>
                      {done && submittedOn ? (
                        <div className="faint tn-num" style={{ fontSize: 'var(--text-xs)' }}>{formatDate(submittedOn)}</div>
                      ) : null}
                    </td>
                    <td>
                      {file ? (
                        <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center', minWidth: 0 }}>
                          <button type="button" className="doclink" onClick={() => void openFile(file)} title={file.name} style={{ minWidth: 0 }}>
                            <FileText size={14} aria-hidden="true" />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{file.name}</span>
                          </button>
                          <Button size="sm" variant="ghost" iconLeft={<RefreshCw size={13} />} onClick={() => setUploadFor(r)} title="Replace file" aria-label={`Replace ${file.name}`} />
                        </div>
                      ) : null}
                      {file?.added_by_name ? (
                        <div className="faint" style={{ fontSize: 'var(--text-xs)' }}>Added by {file.added_by_name}</div>
                      ) : null}
                      {file ? null : (
                        <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                          {m?.document_url && /^https?:\/\//i.test(m.document_url) ? (
                            <a href={m.document_url} target="_blank" rel="noreferrer noopener" className="celllink">Open</a>
                          ) : null}
                          <Button size="sm" variant="secondary" iconLeft={<Upload size={13} />} onClick={() => setUploadFor(r)}>
                            Upload report
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="col-actions">
                      <Button size="sm" variant="ghost" iconLeft={<Pencil size={14} />} onClick={() => setEditing(r)} aria-label="Edit report" title="Edit" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <UploadReportDialog
        row={uploadFor}
        grantId={grantId}
        dealId={dealId}
        types={types}
        existing={uploadFor ? fileOf(uploadFor) : null}
        onClose={() => setUploadFor(null)}
        onDone={() => { setUploadFor(null); void load(); onChanged() }}
      />

      <ReportDrawer
        row={editing}
        grantId={grantId}
        types={types}
        ownerName={ownerName}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); onChanged() }}
      />

      <Drawer
        open={genOpen}
        title="Generate report timeline"
        onClose={() => setGenOpen(false)}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void generate()} disabled={busy}>{busy ? 'Generating…' : 'Generate'}</Button>
          </>
        }
      >
        <div className="stack">
          <Select
            label="How often"
            value={frequency}
            onChange={(e) => setFrequency(e.currentTarget.value)}
            help={`${formatDate(startDate)} – ${formatDate(endDate)}`}
          >
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
          {(FREQUENCIES.find((f) => f.value === frequency)?.step ?? 0) >= 3 ? (
            <Select label="Count periods from" value={countFrom} onChange={(e) => setCountFrom(e.currentTarget.value as 'start' | 'fy')}>
              <option value="start">MoU start date</option>
              <option value="fy">Financial year (Apr–Mar)</option>
            </Select>
          ) : null}
        </div>
      </Drawer>

      <Drawer
        open={customOpen}
        title="Add custom timeline"
        onClose={() => setCustomOpen(false)}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCustomOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void addCustom()} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
          </>
        }
      >
        <div className="stack">
          <Input label="Name" value={cTitle} placeholder={cFrom && cTo ? `${formatDate(cFrom)} – ${formatDate(cTo)}` : 'Year 1 report'} onChange={(e) => setCTitle(e.currentTarget.value)} />
          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="grow"><Input label="From" type="date" required value={cFrom} onChange={(e) => setCFrom(e.currentTarget.value)} /></div>
            <div className="grow"><Input label="To" type="date" required value={cTo} onChange={(e) => setCTo(e.currentTarget.value)} /></div>
          </div>
          <Input
            label="Due on"
            type="date"
            value={cDue}
            help={cTo && !cDue ? `Blank means ${formatDate(iso(addDays(new Date(cTo), 30)))}` : undefined}
            onChange={(e) => setCDue(e.currentTarget.value)}
          />
        </div>
      </Drawer>
    </div>
  )
}

function dueOf(r: Row): string | null {
  return r.milestone?.due_date ?? r.period?.due_date ?? null
}

/* ---------- upload or replace a report's file ---------- */

function UploadReportDialog({
  row, grantId, dealId, types, existing, onClose, onDone,
}: {
  row: Row | null
  grantId: string
  dealId: string | null
  types: MilestoneType[]
  existing: ReportFile | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const pickRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [typeId, setTypeId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!row) return
    setFile(null)
    setTypeId(row.milestone?.milestone_type_id ?? '')
  }, [row])

  if (!row) return null

  function pick(list: FileList | null) {
    const f = list?.[0]
    if (pickRef.current) pickRef.current.value = ''
    if (!f) return
    const problem = checkFile(f, REPORT_EXTENSIONS)
    if (problem) { toast.error(problem); return }
    setFile(f)
  }

  async function upload() {
    if (!row || !file) { toast.error('Choose the report file.'); return }
    if (!dealId) { toast.error('This grant is not linked to a deal, so its files have nowhere to go.'); return }
    setBusy(true)
    try {
      // An empty period gets its report record first.
      let milestoneId = row.milestone?.id ?? null
      if (!milestoneId) {
        const p = row.period!
        const { data, error } = await supabase.from('fr_compliance_milestones').insert({
          grant_id: grantId,
          report_period_id: p.id,
          title: p.period_label,
          due_date: p.due_date ?? p.period_end_date ?? today(),
          status: 'upcoming',
          created_by: access.employeeId,
        }).select('id').single()
        if (error) throw new Error(error.message)
        milestoneId = (data as { id: string }).id
      }

      const doc = await uploadDealDocument({
        opportunityId: dealId,
        docType: 'Report',
        file,
        employeeId: access.employeeId,
        employeeName: access.employeeName,
        links: { grant_id: grantId, report_period_id: row.period?.id ?? null, milestone_id: milestoneId },
      })

      // Replacing: the old file leaves the report (and the Documents tab).
      if (existing) {
        await supabase.from('fr_documents')
          .update({ deleted_at: new Date().toISOString(), updated_by: access.employeeId })
          .eq('id', existing.id)
      }

      const { error } = await supabase.from('fr_compliance_milestones').update({
        title: stripExt(file.name),
        milestone_type_id: typeId || null,
        status: 'submitted',
        submitted_on: today(),
        document_url: doc.file_path,
        // The person who uploads the report is the one who added it.
        owner_user_id: access.employeeId,
        updated_by: access.employeeId,
      }).eq('id', milestoneId).select('id').single()
      if (error) throw new Error(error.message)

      toast.success(existing ? 'Report replaced.' : 'Report uploaded.')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the report.')
    } finally {
      setBusy(false)
    }
  }

  const name = row.milestone?.title ?? row.period?.period_label ?? 'Report'

  return (
    <div className="scrim" role="presentation" onClick={() => { if (!busy) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Upload report" onClick={(e) => e.stopPropagation()}>
        <p className="dialog__title">{existing ? 'Replace report' : 'Upload report'}</p>
        <p className="dialog__body">{name}</p>

        <div className="stack" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="field">
            <span className="field__label">File<span className="field__req"> *</span></span>
            <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center', minWidth: 0 }}>
              {file ? (
                <>
                  <FileText size={16} style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</span>
                  <span className="faint tn-num" style={{ flexShrink: 0 }}>{readableSize(file.size)}</span>
                </>
              ) : null}
              <Button size="sm" variant="secondary" iconLeft={<Upload size={14} />} onClick={() => pickRef.current?.click()} disabled={busy}>
                {file ? 'Change' : 'Choose file'}
              </Button>
            </div>
            <input ref={pickRef} type="file" accept={REPORT_ACCEPT} hidden onChange={(e) => pick(e.currentTarget.files)} />
          </div>

          <Select label="Type" value={typeId} onChange={(e) => setTypeId(e.currentTarget.value)} disabled={busy}>
            <option value="">—</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </div>

        <div className="dialog__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void upload()} disabled={busy || !file}>
            {busy ? 'Uploading…' : existing ? 'Replace' : 'Upload'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- edit one row: report details and its period dates ---------- */

const EMPTY = {
  title: '', milestone_type_id: '', from: '', to: '', due_date: '',
  owner_user_id: '', status: 'upcoming', submitted_on: '', notes: '',
}

function ReportDrawer({
  row, grantId, types, onClose, onSaved,
}: {
  row: Row | null
  grantId: string
  types: MilestoneType[]
  ownerName: (id: string | null) => string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const people = useFrPeople()
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!row) return
    const m = row.milestone
    const p = row.period
    setDraft({
      title: m?.title ?? p?.period_label ?? '',
      milestone_type_id: m?.milestone_type_id ?? '',
      from: p?.period_start_date ?? '',
      to: p?.period_end_date ?? '',
      due_date: m?.due_date ?? p?.due_date ?? '',
      owner_user_id: m?.owner_user_id ?? '',
      status: m?.status ?? 'upcoming',
      submitted_on: m?.submitted_on ?? '',
      notes: m?.notes ?? '',
    })
  }, [row])

  const set = <K extends keyof typeof EMPTY>(k: K, v: string) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    if (!row) return
    if (!draft.title.trim()) { toast.error('A title is required.'); return }
    if (!draft.due_date) { toast.error('A due date is required.'); return }
    if (draft.from && draft.to && draft.to < draft.from) { toast.error('The period cannot end before it starts.'); return }

    setBusy(true)
    try {
      // The period's dates.
      let periodId = row.period?.id ?? null
      if (periodId) {
        const { error } = await supabase.from('fr_compliance_report_periods').update({
          period_start_date: draft.from || null,
          period_end_date: draft.to || null,
          updated_by: access.employeeId,
        }).eq('id', periodId).select('id').single()
        if (error) throw new Error(error.message)
      } else if (draft.from && draft.to) {
        const { data, error } = await supabase.from('fr_compliance_report_periods').upsert({
          grant_id: grantId,
          period_key: `CUSTOM_${draft.from}_${draft.to}`,
          period_label: draft.title.trim(),
          period_start_date: draft.from,
          period_end_date: draft.to,
          due_date: draft.due_date,
          reporting_frequency: 'ad_hoc',
          overall_status: 'green',
          deleted_at: null,
          created_by: access.employeeId,
        }, { onConflict: 'grant_id,period_key' }).select('id').single()
        if (error) throw new Error(error.message)
        periodId = (data as { id: string }).id
      }

      const payload = {
        grant_id: grantId,
        report_period_id: periodId,
        milestone_type_id: draft.milestone_type_id || null,
        title: draft.title.trim(),
        due_date: draft.due_date,
        status: draft.status,
        submitted_on: draft.status === 'submitted' || draft.status === 'accepted' ? (draft.submitted_on || today()) : null,
        notes: draft.notes.trim() || null,
        updated_by: access.employeeId,
      }
      const res = row.milestone
        ? await supabase.from('fr_compliance_milestones').update(payload).eq('id', row.milestone.id).select('id').single()
        : await supabase.from('fr_compliance_milestones').insert({ ...payload, created_by: access.employeeId }).select('id').single()
      if (res.error) throw new Error(res.error.message)

      void notifyMentions({
        before: row.milestone?.notes, after: draft.notes, people,
        parentType: 'grant', parentId: grantId, selfId: access.employeeId,
      })
      toast.success('Saved.')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  /** Soft-deletes the report, and its period when nothing else sits in it. */
  async function remove() {
    if (!row) return
    setConfirmRemove(false)
    setBusy(true)
    const stamp = new Date().toISOString()
    if (row.milestone) {
      const { error } = await supabase.from('fr_compliance_milestones')
        .update({ deleted_at: stamp, updated_by: access.employeeId }).eq('id', row.milestone.id)
      if (error) { setBusy(false); toast.error(error.message); return }
    }
    if (row.period) {
      const { count } = await supabase.from('fr_compliance_milestones')
        .select('id', { count: 'exact', head: true })
        .eq('report_period_id', row.period.id).is('deleted_at', null)
      if (!count) {
        await supabase.from('fr_compliance_report_periods')
          .update({ deleted_at: stamp, updated_by: access.employeeId }).eq('id', row.period.id)
      }
    }
    setBusy(false)
    toast.success('Removed from the timeline.')
    onSaved()
  }

  return (
    <Drawer
      open={row !== null}
      title="Edit report"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={busy} style={{ marginRight: 'auto' }}>Remove</Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="stack">
        <Input label="Title" required value={draft.title} onChange={(e) => set('title', e.currentTarget.value)} />

        <Select label="Type" value={draft.milestone_type_id} onChange={(e) => set('milestone_type_id', e.currentTarget.value)}>
          <option value="">—</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow"><Input label="From" type="date" value={draft.from} onChange={(e) => set('from', e.currentTarget.value)} /></div>
          <div className="grow"><Input label="To" type="date" value={draft.to} onChange={(e) => set('to', e.currentTarget.value)} /></div>
        </div>

        <Input label="Due on" type="date" required value={draft.due_date} onChange={(e) => set('due_date', e.currentTarget.value)} />

        <Select label="Status" value={draft.status} onChange={(e) => set('status', e.currentTarget.value)}>
          {MILESTONE_STATUSES.filter((o) => o.value !== 'overdue').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        {draft.status === 'submitted' || draft.status === 'accepted' ? (
          <Input label="Submitted on" type="date" value={draft.submitted_on} onChange={(e) => set('submitted_on', e.currentTarget.value)} />
        ) : null}

        <DictationTextarea label="Notes" rows={3} mentions value={draft.notes} onChange={(v) => set('notes', v)} />
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${draft.title || 'this report'}?`}
        body="It leaves the timeline. Its file stays on the deal's Documents tab."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
      />
    </Drawer>
  )
}

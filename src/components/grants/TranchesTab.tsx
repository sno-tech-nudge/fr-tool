import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, Drawer, EmptyState, Input, Select, TableSkeleton, Textarea, useToast,
} from '../ui'
import { RemittanceDrawer, type Remittance } from './RemittanceDrawer'
import { TRANCHE_STATUSES, TRANCHE_TRIGGERS, labelOf, trancheTone } from '../../lib/enums'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { daysUntil, isTrancheOverdue } from '../../lib/grants'
import { useAccess } from '../../lib/accessContext'

export type Tranche = {
  id: string
  grant_id: string
  sequence_no: number
  due_date: string
  amount: number
  currency: string
  amount_inr_expected: number | null
  trigger_type: string
  condition_note: string | null
  status: string
  revised_expected_date: string | null
  reason_for_delay: string | null
  delay_rag: string | null
  notes: string | null
  fr_remittances: Remittance[]
}

const SELECT_COLS = '*, fr_remittances(*)'

function receivedOf(t: Tranche): number {
  return (t.fr_remittances ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Old rows can carry a zero or missing rate; dividing by that ruins a schedule. */
const safeRate = (rate: number) => (Number(rate) > 0 ? Number(rate) : 1)

/** Evenly spaced due dates across the grant term, amounts split to the paisa. */
function buildSchedule(count: number, totalInr: number, start: string, end: string) {
  const from = new Date(start).getTime()
  const to = new Date(end).getTime()
  const step = count > 1 ? (to - from) / (count - 1) : 0
  const each = Math.round((totalInr / count) * 100) / 100
  return Array.from({ length: count }, (_, i) => ({
    due_date: toISODate(new Date(from + step * i)),
    // The last instalment absorbs the rounding so the schedule sums exactly.
    amount: i === count - 1 ? Math.round((totalInr - each * (count - 1)) * 100) / 100 : each,
  }))
}

export function TranchesTab({
  grantId, grantIsFcra, currency, committedInr, fxRate, defaultBankAccountId, startDate, endDate,
  onChanged,
}: {
  grantId: string
  grantIsFcra: boolean
  currency: string
  committedInr: number
  /** The grant's rate at signing, so the schedule sums to its committed INR. */
  fxRate: number
  defaultBankAccountId: string | null
  startDate: string
  endDate: string
  onChanged: () => void
}) {
  const toast = useToast()
  const access = useAccess()

  const [rows, setRows] = useState<Tranche[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Tranche | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [genCount, setGenCount] = useState('4')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Tranche | null>(null)
  const [receiving, setReceiving] = useState<Tranche | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_tranches')
      .select(SELECT_COLS)
      .eq('grant_id', grantId)
      .order('sequence_no')
    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as Tranche[])
  }, [grantId])

  useEffect(() => { void load() }, [load])

  async function generate() {
    const count = Number(genCount)
    if (!count || count < 1 || count > 24) { toast.error('Pick between 1 and 24 instalments.'); return }
    if (rows && rows.length > 0) { toast.error('Clear the existing schedule first.'); return }

    setBusy(true)
    const payload = buildSchedule(count, committedInr, startDate, endDate).map((t, i) => ({
      grant_id: grantId,
      sequence_no: i + 1,
      due_date: t.due_date,
      // The schedule is split in rupees, so `amount` is converted back into the
      // grant's own currency rather than carrying the rupee figure.
      amount: round2(t.amount / safeRate(fxRate)),
      currency,
      amount_inr_expected: t.amount,
      trigger_type: 'date_based',
      status: 'pending',
      created_by: access.employeeId,
    }))
    const { error: err } = await supabase.from('fr_tranches').insert(payload)
    setBusy(false)
    setGenOpen(false)
    if (err) { toast.error(err.message); return }
    toast.success(`${count} instalments scheduled.`)
    void load()
    onChanged()
  }

  async function remove(t: Tranche) {
    setConfirmDelete(null)
    const { error: err } = await supabase.from('fr_tranches').delete().eq('id', t.id)
    if (err) { toast.error(err.message); return }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== t.id))
    toast.success('Instalment removed.')
    onChanged()
  }

  const scheduled = (rows ?? []).reduce((s, t) => s + Number(t.amount_inr_expected ?? t.amount ?? 0), 0)
  const received = (rows ?? []).reduce((s, t) => s + receivedOf(t), 0)
  const unscheduled = committedInr - scheduled

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Wand2 size={14} />}
          onClick={() => setGenOpen(true)}
        >
          Generate schedule
        </Button>
        <Button size="sm" iconLeft={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          Add instalment
        </Button>
      </div>

      {error ? (
        <div className="card"><EmptyState title="Could not load the schedule" body={error} /></div>
      ) : rows === null ? (
        <TableSkeleton rows={4} cols={6} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No instalments scheduled"
            body="Generate an even schedule across the grant term, or add instalments one at a time."
            action={
              <Button iconLeft={<Wand2 size={15} />} onClick={() => setGenOpen(true)}>
                Generate schedule
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
                  <th style={{ width: '36px' }}>#</th>
                  <th style={{ width: '106px' }}>Due</th>
                  <th style={{ width: '96px' }}>Expected</th>
                  <th style={{ width: '96px' }}>Received</th>
                  <th style={{ width: '96px' }}>Status</th>
                  <th>Condition</th>
                  <th style={{ width: '150px' }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const got = receivedOf(t)
                  const late = isTrancheOverdue(t.status, t.due_date)
                  const days = daysUntil(t.due_date)
                  return (
                    <tr key={t.id} className="is-clickable" onClick={() => setEditing(t)}>
                      <td className="tn-num muted">{t.sequence_no}</td>
                      <td className="tn-num" style={{ whiteSpace: 'nowrap' }}>
                        {formatDate(t.revised_expected_date ?? t.due_date)}
                        {late ? (
                          <div style={{ color: 'var(--rag-red)', fontSize: 'var(--text-sm)' }}>
                            {Math.abs(days ?? 0)} days overdue
                          </div>
                        ) : null}
                      </td>
                      <td className="tn-num">{formatMoney(t.amount_inr_expected ?? t.amount)}</td>
                      <td className="tn-num">{got ? formatMoney(got) : <span className="faint">—</span>}</td>
                      <td>
                        <Badge tone={late ? 'red' : trancheTone(t.status)}>
                          {late && t.status !== 'delayed' ? 'Overdue' : labelOf(TRANCHE_STATUSES, t.status)}
                        </Badge>
                      </td>
                      <td className="muted">{t.condition_note ?? '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ gap: 'var(--space-2)' }}>
                          <Button size="sm" variant="secondary" onClick={() => setReceiving(t)}>
                            Record receipt
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            iconLeft={<Trash2 size={14} />}
                            onClick={() => setConfirmDelete(t)}
                            aria-label="Remove instalment"
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="card row" style={{ justifyContent: 'space-between' }}>
            <span className="tn-num">
              {formatMoney(scheduled)} scheduled · {formatMoney(received)} received
            </span>
            <span
              className="tn-num"
              style={{ color: Math.abs(unscheduled) < 1 ? 'var(--rag-green)' : 'var(--rag-amber)' }}
            >
              {Math.abs(unscheduled) < 1
                ? 'Schedule matches the committed value'
                : unscheduled > 0
                  ? `${formatMoney(unscheduled)} not yet scheduled`
                  : `${formatMoney(Math.abs(unscheduled))} over the committed value`}
            </span>
          </div>
        </>
      )}

      <TrancheDrawer
        open={addOpen || editing !== null}
        tranche={editing}
        grantId={grantId}
        currency={currency}
        fxRate={fxRate}
        nextSequence={(rows ?? []).reduce((m, t) => Math.max(m, t.sequence_no), 0) + 1}
        onClose={() => { setAddOpen(false); setEditing(null) }}
        onSaved={() => { void load(); onChanged() }}
      />

      <RemittanceDrawer
        open={receiving !== null}
        tranche={receiving}
        grantIsFcra={grantIsFcra}
        defaultBankAccountId={defaultBankAccountId}
        onClose={() => setReceiving(null)}
        onSaved={() => { void load(); onChanged() }}
      />

      <Drawer
        open={genOpen}
        title="Generate schedule"
        onClose={() => setGenOpen(false)}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void generate()} disabled={busy}>
              {busy ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Input
            label="Number of instalments"
            type="number"
            min={1}
            max={24}
            value={genCount}
            onChange={(e) => setGenCount(e.currentTarget.value)}
            help={`${formatMoney(committedInr)} split evenly between ${formatDate(startDate)} and ${formatDate(endDate)}.`}
          />
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remove this instalment?"
        body="Any receipts recorded against it are removed too. This cannot be undone."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete) }}
      />
    </div>
  )
}

/* ---------- add / edit one instalment ---------- */

const EMPTY = {
  sequence_no: '', due_date: '', amount: '', trigger_type: 'date_based', condition_note: '',
  status: 'pending', revised_expected_date: '', reason_for_delay: '', delay_rag: '', notes: '',
}

function TrancheDrawer({
  open, tranche, grantId, currency, fxRate, nextSequence, onClose, onSaved,
}: {
  open: boolean
  tranche: Tranche | null
  grantId: string
  currency: string
  fxRate: number
  nextSequence: number
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(tranche
      ? {
        sequence_no: String(tranche.sequence_no),
        due_date: tranche.due_date ?? '',
        amount: String(tranche.amount ?? ''),
        trigger_type: tranche.trigger_type ?? 'date_based',
        condition_note: tranche.condition_note ?? '',
        status: tranche.status ?? 'pending',
        revised_expected_date: tranche.revised_expected_date ?? '',
        reason_for_delay: tranche.reason_for_delay ?? '',
        delay_rag: tranche.delay_rag ?? '',
        notes: tranche.notes ?? '',
      }
      : { ...EMPTY, sequence_no: String(nextSequence) })
  }, [open, tranche, nextSequence])

  const set = <K extends keyof typeof EMPTY>(k: K, v: string) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    if (!draft.due_date) { toast.error('A due date is required.'); return }
    if (!draft.amount) { toast.error('An amount is required.'); return }

    setBusy(true)
    const amount = Number(draft.amount)
    const payload = {
      grant_id: grantId,
      sequence_no: Number(draft.sequence_no) || nextSequence,
      due_date: draft.due_date,
      amount,
      currency,
      // The figure typed is in the grant's currency, so the INR column is a
      // conversion of it, not a copy.
      amount_inr_expected: round2(amount * safeRate(fxRate)),
      trigger_type: draft.trigger_type,
      condition_note: draft.condition_note.trim() || null,
      status: draft.status,
      revised_expected_date: draft.revised_expected_date || null,
      reason_for_delay: draft.reason_for_delay.trim() || null,
      delay_rag: draft.delay_rag || null,
      notes: draft.notes.trim() || null,
      updated_by: access.employeeId,
    }

    const res = tranche
      ? await supabase.from('fr_tranches').update(payload).eq('id', tranche.id).select().single()
      : await supabase.from('fr_tranches')
        .insert({ ...payload, created_by: access.employeeId }).select().single()
    setBusy(false)
    if (res.error) {
      toast.error(res.error.message.includes('duplicate key')
        ? 'That instalment number is already used on this grant.'
        : res.error.message)
      return
    }
    toast.success(tranche ? 'Saved.' : 'Instalment added.')
    onSaved()
    onClose()
  }

  return (
    <Drawer
      open={open}
      title={tranche ? `Instalment ${tranche.sequence_no}` : 'Add instalment'}
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
        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <Input
            label="Number"
            type="number"
            value={draft.sequence_no}
            onChange={(e) => set('sequence_no', e.currentTarget.value)}
          />
          <div className="grow">
            <Input
              label="Due date"
              type="date"
              required
              value={draft.due_date}
              onChange={(e) => set('due_date', e.currentTarget.value)}
            />
          </div>
        </div>

        <Input
          label={`Amount (${currency})`}
          type="number"
          required
          value={draft.amount}
          onChange={(e) => set('amount', e.currentTarget.value)}
        />

        <Select
          label="Trigger"
          value={draft.trigger_type}
          onChange={(e) => set('trigger_type', e.currentTarget.value)}
        >
          {TRANCHE_TRIGGERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        <Input
          label="Condition"
          value={draft.condition_note}
          onChange={(e) => set('condition_note', e.currentTarget.value)}
          help={draft.trigger_type === 'milestone_based' ? 'What has to happen before this is invoiced.' : undefined}
        />

        <Select label="Status" value={draft.status} onChange={(e) => set('status', e.currentTarget.value)}>
          {TRANCHE_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        {draft.status === 'delayed' ? (
          <>
            <Input
              label="Revised expected date"
              type="date"
              value={draft.revised_expected_date}
              onChange={(e) => set('revised_expected_date', e.currentTarget.value)}
            />
            <Input
              label="Reason for delay"
              value={draft.reason_for_delay}
              onChange={(e) => set('reason_for_delay', e.currentTarget.value)}
            />
            <Select
              label="Delay severity"
              value={draft.delay_rag}
              onChange={(e) => set('delay_rag', e.currentTarget.value)}
            >
              <option value="">—</option>
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="red">Red</option>
            </Select>
          </>
        ) : null}

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

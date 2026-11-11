import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, Drawer, Input, Select, Skeleton, useToast,
} from '../ui'
import { RECEIPT_TYPES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { rateToInrOn } from '../../lib/fx'
import { useAccess } from '../../lib/accessContext'
import { confirmReceipt, usePaymentAccess } from '../../lib/payments'
import { useBankAccounts, accountsFor } from '../../hooks/useBankAccounts'

export type Remittance = {
  id: string
  tranche_id: string
  received_date: string | null
  amount: number
  currency: string
  fx_rate_to_inr: number
  amount_inr: number
  bank_account_id: string
  reference_number: string | null
  receipt_type: string | null
  confirmed_by_finance: boolean
  confirmed_at: string | null
  is_locked: boolean
  notes: string | null
}

type TrancheLite = {
  id: string
  sequence_no: number
  amount: number
  currency: string
  amount_inr_expected: number | null
  status?: string | null
}

/**
 * Receipts against one instalment: recorded by the team, corrected or removed
 * while unconfirmed, then confirmed and locked by finance.
 *
 * Guardrails: the bank-account list is filtered to the grant's FCRA side (the
 * database rejects a mismatch anyway); a confirmed receipt is locked, and
 * unlocking is a manual SQL step by a manager, so the UI offers no way back.
 * Removing a receipt is a soft delete — it leaves every total but stays on file.
 */
export function RemittanceDrawer({
  open, tranche, grantIsFcra, defaultBankAccountId, editOnOpen = false, onClose, onSaved,
}: {
  open: boolean
  tranche: TrancheLite | null
  grantIsFcra: boolean
  defaultBankAccountId: string | null
  /** Open straight into correcting the receipt, when there is exactly one unconfirmed. */
  editOnOpen?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { accounts } = useBankAccounts()

  const [rows, setRows] = useState<Remittance[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<Remittance | null>(null)
  const [removing, setRemoving] = useState<Remittance | null>(null)
  // The receipt being corrected; null while recording a new one.
  const [editing, setEditing] = useState<Remittance | null>(null)

  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('1')
  // Once someone types a rate, a date change no longer overwrites it.
  const [rateTouched, setRateTouched] = useState(false)
  const [bankAccountId, setBankAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [receiptType, setReceiptType] = useState('')
  // A reference already used elsewhere is flagged once; saving again proceeds.
  const [warnedRef, setWarnedRef] = useState<string | null>(null)

  const currency = tranche?.currency ?? 'INR'
  const legalAccounts = accountsFor(accounts, grantIsFcra)
  // Both are enforced in the database too; this only hides what would be refused.
  const { canConfirm, canEnter } = usePaymentAccess()

  const load = useCallback(async () => {
    if (!tranche) return
    setRows(null)
    const { data } = await supabase
      .from('fr_remittances')
      .select('*')
      .eq('tranche_id', tranche.id)
      .is('deleted_at', null)
      .order('received_date')
    setRows((data ?? []) as Remittance[])
  }, [tranche])

  useEffect(() => { if (open) void load() }, [open, load])

  const startNew = useCallback(() => {
    if (!tranche) return
    setEditing(null)
    setDate(toISODate(new Date()))
    setAmount(String(tranche.amount ?? ''))
    setReference('')
    setReceiptType('')
    setRateTouched(false)
    setWarnedRef(null)
    const preset = accounts.find((a) => a.id === defaultBankAccountId)
    setBankAccountId(preset && preset.is_fcra === grantIsFcra ? preset.id : '')
  }, [tranche, accounts, defaultBankAccountId, grantIsFcra])

  // Reset the composer each time the drawer opens, pre-filling what we know:
  // the instalment's own amount, today's date, and the grant's usual account.
  useEffect(() => { if (open) startNew() }, [open, startNew])

  // The suggested rate is the one for the received date, not today's.
  useEffect(() => {
    if (!open || rateTouched || currency === 'INR') return
    let active = true
    void rateToInrOn(currency, date || null).then((r) => { if (active) setRate(r != null ? String(r) : '1') })
    return () => { active = false }
  }, [open, date, currency, rateTouched])

  // Opened from "Edit receipt": once this instalment's receipts are in, go
  // straight to correcting the one unconfirmed receipt. Several → the list.
  const autoEdited = useRef(false)
  useEffect(() => { if (open) autoEdited.current = false }, [open])
  useEffect(() => {
    if (!open || !editOnOpen || !canEnter || autoEdited.current || !rows || !tranche) return
    // The list can still hold the previous instalment's receipts for a moment.
    if (rows.some((r) => r.tranche_id !== tranche.id)) return
    autoEdited.current = true
    const unlocked = rows.filter((r) => !r.is_locked)
    if (unlocked.length === 1) startEdit(unlocked[0])
    // startEdit only sets form state; leaving it out keeps this to one run per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editOnOpen, canEnter, rows, tranche])

  function startEdit(r: Remittance) {
    setEditing(r)
    setDate(r.received_date ?? '')
    setAmount(String(r.amount))
    setRate(String(r.fx_rate_to_inr))
    setRateTouched(true) // keep the rate it was recorded at unless changed
    setBankAccountId(r.bank_account_id)
    setReference(r.reference_number ?? '')
    setReceiptType(r.receipt_type ?? '')
    setWarnedRef(null)
  }

  // The instalment's status follows confirmed money, and the database moves
  // it when a receipt is confirmed — recording or correcting one changes nothing.
  function settle(next: Remittance[]) {
    setRows(next)
    onSaved()
  }

  async function save() {
    if (!tranche) return
    if (!date) { toast.error('A received date is required.'); return }
    if (date > toISODate(new Date())) { toast.error('The received date cannot be in the future.'); return }
    if (!amount || !(Number(amount) > 0)) { toast.error('Enter the amount received.'); return }
    if (!bankAccountId) { toast.error('Pick the receiving account.'); return }

    const ref = reference.trim()
    if (ref && warnedRef !== ref) {
      let dup = supabase.from('fr_remittances').select('id', { count: 'exact', head: true })
        .eq('reference_number', ref).is('deleted_at', null)
      if (editing) dup = dup.neq('id', editing.id)
      const { count } = await dup
      if (count) {
        setWarnedRef(ref)
        toast.error('That reference is already on another receipt. Save again to record it anyway.')
        return
      }
    }

    const value = Number(amount)
    const fx = Number(rate) || 1
    const fields = {
      received_date: date,
      amount: value,
      currency,
      fx_rate_to_inr: fx,
      amount_inr: Math.round(value * fx * 100) / 100,
      bank_account_id: bankAccountId,
      reference_number: ref || null,
      receipt_type: receiptType || null,
      updated_by: access.employeeId,
    }

    setBusy(true)
    const res = editing
      ? await supabase.from('fr_remittances').update(fields).eq('id', editing.id).select().single()
      : await supabase.from('fr_remittances')
          .insert({ ...fields, tranche_id: tranche.id, created_by: access.employeeId })
          .select()
          .single()
    setBusy(false)

    if (res.error) {
      toast.error(res.error.message.includes('FCRA routing violation')
        ? 'That account is on the wrong side of the FCRA line for this grant.'
        : res.error.message)
      return
    }

    const saved = res.data as Remittance
    const next = editing
      ? (rows ?? []).map((r) => (r.id === saved.id ? saved : r))
      : [...(rows ?? []), saved]
    toast.success(editing ? 'Receipt updated.' : 'Receipt recorded.')
    startNew()
    settle(next)
  }

  async function remove(r: Remittance) {
    setRemoving(null)
    const { error } = await supabase
      .from('fr_remittances')
      .update({ deleted_at: new Date().toISOString(), deleted_by: access.employeeId, updated_by: access.employeeId })
      .eq('id', r.id)
      .select()
      .single()
    if (error) { toast.error(error.message); return }
    if (editing?.id === r.id) startNew()
    toast.success('Receipt removed.')
    settle((rows ?? []).filter((x) => x.id !== r.id))
  }

  async function confirmAndLock(r: Remittance) {
    setConfirming(null)
    const { data, error } = await confirmReceipt(r.id, access.employeeId)
    if (error) { toast.error(error.message); return }
    if (editing?.id === r.id) startNew()
    setRows((prev) => (prev ?? []).map((x) => (x.id === r.id ? (data as Remittance) : x)))
    toast.success('Confirmed and locked.')
    onSaved()
  }

  // Received is confirmed money; recorded-but-unconfirmed is shown apart.
  const received = (rows ?? []).filter((r) => r.confirmed_by_finance).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
  const awaiting = (rows ?? []).filter((r) => !r.confirmed_by_finance).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
  const expected = Number(tranche?.amount_inr_expected ?? tranche?.amount ?? 0)

  return (
    <Drawer
      open={open}
      title={tranche ? `Receipts · instalment ${tranche.sequence_no}` : 'Receipts'}
      onClose={onClose}
      width={560}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div className="stack">
        {canEnter ? (
          <div className="card stack">
            <div className="tn-micro">{editing ? 'Correct this receipt' : 'Record a receipt'}</div>

            <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Input
                  label="Received on"
                  type="date"
                  required
                  max={toISODate(new Date())}
                  value={date}
                  onChange={(e) => setDate(e.currentTarget.value)}
                />
              </div>
              <div className="grow">
                <Input
                  label={`Amount (${currency})`}
                  type="number"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.currentTarget.value)}
                />
              </div>
            </div>

            {currency !== 'INR' ? (
              <Input
                label="FX rate (INR per 1 unit)"
                type="number"
                value={rate}
                onChange={(e) => { setRate(e.currentTarget.value); setRateTouched(true) }}
                help={amount ? `${formatMoney(Number(amount) * (Number(rate) || 1))} at this rate.` : undefined}
              />
            ) : null}

            <Select
              label="Received into"
              required
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.currentTarget.value)}
            >
              <option value="">—</option>
              {legalAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </Select>

            <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Input
                  label="Reference number"
                  value={reference}
                  onChange={(e) => setReference(e.currentTarget.value)}
                />
              </div>
              <Select
                label="Receipt type"
                value={receiptType}
                onChange={(e) => setReceiptType(e.currentTarget.value)}
              >
                <option value="">—</option>
                {RECEIPT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              {editing ? <Button variant="ghost" onClick={startNew} disabled={busy}>Cancel</Button> : null}
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Record receipt'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="tn-micro">
          {rows === null
            ? 'Receipts'
            : `${formatMoney(received)} of ${formatMoney(expected)} received${awaiting ? ` · ${formatMoney(awaiting)} awaiting finance` : ''}`}
        </div>

        {rows === null ? (
          <Skeleton height={60} />
        ) : rows.length === 0 ? (
          <p className="muted">Nothing received against this instalment yet.</p>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Date</th>
                  <th style={{ width: '120px' }}>Amount</th>
                  <th>Reference</th>
                  <th style={{ width: '170px' }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-active={editing?.id === r.id || undefined}>
                    <td className="tn-num">{formatDate(r.received_date)}</td>
                    <td className="tn-num">
                      {formatMoney(r.amount_inr)}
                      {r.currency !== 'INR' ? (
                        <div className="faint" style={{ fontSize: 'var(--text-sm)' }}>
                          {r.currency} {r.amount}
                        </div>
                      ) : null}
                    </td>
                    <td className="muted">
                      {r.reference_number ?? '—'}
                      {r.receipt_type ? (
                        <div className="faint" style={{ fontSize: 'var(--text-sm)' }}>
                          {labelOf(RECEIPT_TYPES, r.receipt_type)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {r.is_locked ? (
                        <Badge tone="green"><Lock size={11} /> Confirmed</Badge>
                      ) : (
                        <div className="row" style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                          {canConfirm ? (
                            <Button size="sm" variant="secondary" onClick={() => setConfirming(r)}>Confirm</Button>
                          ) : (
                            <span className="faint" style={{ marginRight: 'auto' }}>Awaiting finance</span>
                          )}
                          {canEnter ? (
                            <>
                              <Button size="sm" variant="ghost" aria-label="Correct receipt" onClick={() => startEdit(r)}>
                                <Pencil size={13} />
                              </Button>
                              <Button size="sm" variant="ghost" aria-label="Remove receipt" onClick={() => setRemoving(r)}>
                                <Trash2 size={13} />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title="Confirm and lock this receipt?"
        body="Check it against the bank statement first. It becomes read-only; only a manager can unlock it, in the database."
        confirmLabel="Confirm and lock"
        onCancel={() => setConfirming(null)}
        onConfirm={() => { if (confirming) void confirmAndLock(confirming) }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Remove this receipt?"
        body="It leaves the totals for this instalment and grant. The record is kept and can be restored in the database."
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) void remove(removing) }}
      />
    </Drawer>
  )
}

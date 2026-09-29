import { useCallback, useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, Drawer, Input, Select, Skeleton, useToast,
} from '../ui'
import { RECEIPT_TYPES, labelOf } from '../../lib/enums'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { latestRateToInr } from '../../lib/fx'
import { useAccess } from '../../lib/accessContext'
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
}

/**
 * Receipts against one instalment.
 *
 * Two guardrails live here. The bank-account list is filtered to the grant's
 * FCRA side — the database trigger rejects a mismatch, so offering the illegal
 * option would only produce a slower error. And a confirmed receipt is locked:
 * the UPDATE policy blocks edits server-side, and unlocking is deliberately a
 * manual SQL step by a manager, so the UI offers no way back.
 */
export function RemittanceDrawer({
  open, tranche, grantIsFcra, defaultBankAccountId, onClose, onSaved,
}: {
  open: boolean
  tranche: TrancheLite | null
  grantIsFcra: boolean
  defaultBankAccountId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { accounts } = useBankAccounts()

  const [rows, setRows] = useState<Remittance[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<Remittance | null>(null)

  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('1')
  const [bankAccountId, setBankAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [receiptType, setReceiptType] = useState('')

  const currency = tranche?.currency ?? 'INR'
  const legalAccounts = accountsFor(accounts, grantIsFcra)
  const canConfirm = access.isManager || access.frSubRole === 'finance'

  const load = useCallback(async () => {
    if (!tranche) return
    setRows(null)
    const { data } = await supabase
      .from('fr_remittances')
      .select('*')
      .eq('tranche_id', tranche.id)
      .order('received_date')
    setRows((data ?? []) as Remittance[])
  }, [tranche])

  useEffect(() => { if (open) void load() }, [open, load])

  // Reset the composer each time the drawer opens, pre-filling what we know:
  // the instalment's own amount, today's date, and the grant's usual account.
  useEffect(() => {
    if (!open || !tranche) return
    setDate(toISODate(new Date()))
    setAmount(String(tranche.amount ?? ''))
    setReference('')
    setReceiptType('')
    const preset = accounts.find((a) => a.id === defaultBankAccountId)
    setBankAccountId(preset && preset.is_fcra === grantIsFcra ? preset.id : '')
    void (async () => {
      const r = await latestRateToInr(currency)
      setRate(r != null ? String(r) : '1')
    })()
  }, [open, tranche, accounts, defaultBankAccountId, grantIsFcra, currency])

  async function save() {
    if (!tranche) return
    if (!date) { toast.error('A received date is required.'); return }
    if (!amount) { toast.error('An amount is required.'); return }
    if (!bankAccountId) { toast.error('Pick the receiving account.'); return }

    const value = Number(amount)
    const fx = Number(rate) || 1

    setBusy(true)
    const { data, error } = await supabase
      .from('fr_remittances')
      .insert({
        tranche_id: tranche.id,
        received_date: date,
        amount: value,
        currency,
        fx_rate_to_inr: fx,
        amount_inr: Math.round(value * fx * 100) / 100,
        bank_account_id: bankAccountId,
        reference_number: reference.trim() || null,
        receipt_type: receiptType || null,
        created_by: access.employeeId,
      })
      .select()
      .single()

    if (error) {
      setBusy(false)
      toast.error(error.message.includes('FCRA routing violation')
        ? 'That account is on the wrong side of the FCRA line for this grant.'
        : error.message)
      return
    }

    const next = [...(rows ?? []), data as Remittance]
    setRows(next)

    // Once the instalment is fully covered it stops being outstanding. Partial
    // receipts leave the status alone — it is still owed.
    const total = next.reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
    const expected = Number(tranche.amount_inr_expected ?? tranche.amount ?? 0)
    if (expected > 0 && total >= expected) {
      await supabase.from('fr_tranches')
        .update({ status: 'received', updated_by: access.employeeId })
        .eq('id', tranche.id)
    }

    setBusy(false)
    setAmount('')
    setReference('')
    toast.success('Receipt recorded.')
    onSaved()
  }

  async function confirmAndLock(r: Remittance) {
    setConfirming(null)
    const { data, error } = await supabase
      .from('fr_remittances')
      .update({
        confirmed_by_finance: true,
        confirmed_by_user_id: access.employeeId,
        confirmed_at: new Date().toISOString(),
        is_locked: true,
        updated_by: access.employeeId,
      })
      .eq('id', r.id)
      .select()
      .single()
    if (error) { toast.error(error.message); return }
    setRows((prev) => (prev ?? []).map((x) => (x.id === r.id ? (data as Remittance) : x)))
    toast.success('Confirmed and locked.')
    onSaved()
  }

  const received = (rows ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
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
        <div className="card stack">
          <div className="tn-micro">Record a receipt</div>

          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="grow">
              <Input
                label="Received on"
                type="date"
                required
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
              onChange={(e) => setRate(e.currentTarget.value)}
              help={amount ? `${formatMoney(Number(amount) * (Number(rate) || 1))} at this rate.` : undefined}
            />
          ) : null}

          <Select
            label="Received into"
            required
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.currentTarget.value)}
            help={grantIsFcra
              ? 'This is a foreign contribution, so only FCRA accounts are valid.'
              : 'This is domestic money, so FCRA accounts are not valid.'}
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

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Record receipt'}
            </Button>
          </div>
        </div>

        <div className="tn-micro">
          {rows === null ? 'Receipts' : `${formatMoney(received)} of ${formatMoney(expected)} received`}
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
                  <th style={{ width: '120px' }}>Date</th>
                  <th style={{ width: '130px' }}>Amount</th>
                  <th>Reference</th>
                  <th style={{ width: '150px' }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
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
                        <Badge tone="green"><Lock size={11} /> Locked</Badge>
                      ) : canConfirm ? (
                        <Button size="sm" variant="secondary" onClick={() => setConfirming(r)}>
                          Confirm
                        </Button>
                      ) : (
                        <span className="faint">Awaiting finance</span>
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
        body="It becomes permanently read-only. Only a manager can unlock it afterwards, directly in the database."
        confirmLabel="Confirm and lock"
        onCancel={() => setConfirming(null)}
        onConfirm={() => { if (confirming) void confirmAndLock(confirming) }}
      />
    </Drawer>
  )
}

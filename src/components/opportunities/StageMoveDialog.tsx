import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Input, Select, Skeleton, Textarea } from '../ui'
import type { Stage } from '../../hooks/usePipelineStages'
import { usePipelineStages } from '../../hooks/usePipelineStages'
import { useEmployees } from '../../hooks/useEmployees'
import { useBankAccounts } from '../../hooks/useBankAccounts'
import type { StageMoveExtras } from './stageMove'
import { stageMoveRequirement } from './stageMove'
import { gateFieldsFor, type GateField } from './stageRequirements'

type LossReason = { id: string; key: string; label: string }
type Gate = GateField & { satisfied: boolean }

/**
 * Collects whatever a stage transition requires before it is allowed through:
 * the stage's own minimum fields, a loss reason when closing lost, a next step
 * when moving to any open stage. Rendered as an in-app dialog — never a
 * browser prompt.
 *
 * It loads the deal itself rather than taking it as a prop, because the board
 * only holds a card's worth of columns and the gate needs the rest.
 */
export function StageMoveDialog({
  open, toStage, opportunityId, opportunityName, busy, onConfirm, onCancel,
}: {
  open: boolean
  toStage: Stage | null
  opportunityId: string | null
  opportunityName: string
  busy: boolean
  onConfirm: (extras: StageMoveExtras) => void
  onCancel: () => void
}) {
  const { stages } = usePipelineStages()
  const { employees } = useEmployees()
  const { accounts } = useBankAccounts()

  const [lossReasons, setLossReasons] = useState<LossReason[]>([])
  const [lossReasonId, setLossReasonId] = useState('')
  const [lossNote, setLossNote] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [nextStepDate, setNextStepDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [gates, setGates] = useState<Gate[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})

  const requirement = stageMoveRequirement(toStage ?? undefined)

  const loadGates = useCallback(async () => {
    if (!open || !toStage || !opportunityId || stages.length === 0) return
    setGates(null)

    const { data: opp } = await supabase
      .from('fr_opportunities')
      .select('*, fr_organisations(id, donor_type)')
      .eq('id', opportunityId)
      .maybeSingle()
    if (!opp) { setGates([]); return }

    const row = opp as Record<string, unknown> & {
      fr_organisations: { id: string; donor_type: string | null } | null
    }

    // A proposal is a separate record, so its presence is what counts rather
    // than a column on the deal.
    const { data: proposals } = await supabase
      .from('fr_proposals')
      .select('document_url')
      .eq('opportunity_id', opportunityId)
      .is('deleted_at', null)
      .limit(1)

    const current: Record<string, unknown> = {
      ...row,
      donor_type: row.fr_organisations?.donor_type ?? null,
      document_url: proposals?.[0]?.document_url ?? null,
    }

    const found = gateFieldsFor(toStage, stages, current)
    setGates(found)
    setValues(Object.fromEntries(found.map((f) => {
      const v = current[f.key]
      return [f.key, v === null || v === undefined ? '' : String(v)]
    })))
    setNextStep(typeof row.next_step === 'string' ? row.next_step : '')
  }, [open, toStage, opportunityId, stages])

  useEffect(() => {
    if (!open) return
    setLossReasonId('')
    setLossNote('')
    setNextStepDate('')
    setNote('')
    setError(null)
    void loadGates()
  }, [open, loadGates])

  useEffect(() => {
    if (requirement !== 'loss' || lossReasons.length > 0) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_loss_reasons').select('id, key, label').eq('is_active', true).order('sort_order')
      if (active) setLossReasons((data ?? []) as LossReason[])
    })()
    return () => { active = false }
  }, [requirement, lossReasons.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || !toStage) return null

  const missing = (gates ?? []).filter((g) => !values[g.key]?.trim())

  function confirm() {
    if (requirement === 'loss' && !lossReasonId) {
      setError('A loss reason is required.')
      return
    }
    if (missing.length > 0) {
      setError(`Still needed: ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`)
      return
    }
    if (requirement === 'next_step' && !nextStep.trim()) {
      setError('An open opportunity needs a next step.')
      return
    }
    onConfirm({
      lossReasonId: lossReasonId || null,
      lossNote,
      nextStep,
      nextStepDate,
      // A lost move already has its own note field, and asking for a second
      // one describing the same thing would be noise — so it doubles as the
      // history entry rather than sitting beside a near-identical box.
      note: requirement === 'loss' ? lossNote : note,
      fields: Object.fromEntries((gates ?? []).map((g) => [g.key, { on: g.on, value: values[g.key] }])),
    })
  }

  const set = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  function renderGate(g: Gate) {
    const value = values[g.key] ?? ''
    const common = { label: g.label, help: g.help, required: true, value }

    if (g.type === 'select') {
      return (
        <Select key={g.key} {...common} onChange={(e) => set(g.key, e.currentTarget.value)}>
          <option value="">—</option>
          {(g.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
    }
    if (g.type === 'employee') {
      return (
        <Select key={g.key} {...common} onChange={(e) => set(g.key, e.currentTarget.value)}>
          <option value="">—</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
      )
    }
    if (g.type === 'bank_account') {
      return (
        <Select key={g.key} {...common} onChange={(e) => set(g.key, e.currentTarget.value)}>
          <option value="">—</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
      )
    }
    return (
      <Input
        key={g.key}
        {...common}
        type={g.type === 'number' ? 'number' : g.type === 'date' ? 'date' : 'text'}
        onChange={(e) => set(g.key, e.currentTarget.value)}
      />
    )
  }

  return (
    <div className="scrim" role="presentation" onClick={onCancel}>
      <div
        className="dialog dialog--tall"
        role="dialog"
        aria-modal="true"
        aria-label={`Move to ${toStage.label}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="dialog__title">Move to {toStage.label}</p>
        <p className="dialog__body">{opportunityName}</p>

        <div className="stack" style={{ marginBottom: 'var(--space-5)' }}>
          {gates === null ? (
            <Skeleton height={120} />
          ) : gates.length > 0 ? (
            <>
              <p className="chartsub" style={{ margin: 0 }}>
                {missing.length === 0
                  ? `Everything ${toStage.label} needs is already on file — check it and move.`
                  : `${toStage.label} needs ${missing.length} more ${missing.length === 1 ? 'detail' : 'details'}.`}
              </p>
              {gates.map(renderGate)}
            </>
          ) : null}

          {requirement === 'loss' ? (
            <>
              <Select
                label="Loss reason"
                required
                value={lossReasonId}
                onChange={(e) => { setLossReasonId(e.currentTarget.value); setError(null) }}
              >
                <option value="">Select a reason</option>
                {lossReasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
              <Textarea label="Note" value={lossNote} onChange={(e) => setLossNote(e.currentTarget.value)} />
            </>
          ) : null}

          {requirement === 'next_step' ? (
            <>
              <Input
                label="Next step"
                required
                value={nextStep}
                onChange={(e) => { setNextStep(e.currentTarget.value); setError(null) }}
              />
              <Input
                label="Next step date"
                type="date"
                value={nextStepDate}
                onChange={(e) => setNextStepDate(e.currentTarget.value)}
              />
              {/* Kept on the history row, not the opportunity — it records why
                  this particular move happened, so it stays true even after
                  the deal moves on again. */}
              <Textarea
                label="Notes"
                rows={2}
                help="Optional. Shows against this step in stage history."
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
            </>
          ) : null}

          {error ? <p className="field__error">{error}</p> : null}
        </div>

        <div className="dialog__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || gates === null}>
            {busy ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </div>
    </div>
  )
}

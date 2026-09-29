import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Checkbox, Drawer, Input, Select, Textarea, useToast } from '../ui'
import {
  CAPITAL_CATEGORIES, DEAL_CATEGORIES, OPPORTUNITY_TYPES,
} from '../../lib/enums'
import { latestRateToInr } from '../../lib/fx'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'
import { usePipelineStages } from '../../hooks/usePipelineStages'
import { OrganisationPicker } from '../organisations/OrganisationPicker'

export type Opportunity = {
  id: string
  name: string
  organisation_id: string
  primary_contact_id: string | null
  capital_category: string
  opportunity_type: string
  stage_id: string
  amount: number | null
  currency: string
  amount_inr: number | null
  probability_pct: number | null
  expected_close_date: string | null
  fiscal_year: string | null
  fiscal_quarter: string | null
  owner_user_id: string
  geography: string | null
  next_step: string | null
  next_step_date: string | null
  loss_reason_id: string | null
  loss_note: string | null
  is_stale: boolean
  is_confidential: boolean
  last_activity_at: string | null
  won_grant_id: string | null
  source_detail: string | null
  deal_category: string | null
  notes: string | null
}

type Currency = { code: string; name: string }

const EMPTY = {
  name: '', organisation_id: '', primary_contact_id: '', capital_category: 'programmatic',
  opportunity_type: 'new', stage_id: '', amount: '', currency: 'INR', probability_pct: '',
  expected_close_date: '', owner_user_id: '', geography: '', next_step: '', next_step_date: '',
  deal_category: 'NBD', is_confidential: false, notes: '',
}
type Draft = typeof EMPTY

function toDraft(o: Opportunity | null, defaults: { owner: string | null; stageId: string }): Draft {
  if (!o) return { ...EMPTY, owner_user_id: defaults.owner ?? '', stage_id: defaults.stageId }
  return {
    name: o.name ?? '',
    organisation_id: o.organisation_id ?? '',
    primary_contact_id: o.primary_contact_id ?? '',
    capital_category: o.capital_category ?? 'programmatic',
    opportunity_type: o.opportunity_type ?? 'new',
    stage_id: o.stage_id ?? '',
    amount: o.amount != null ? String(o.amount) : '',
    currency: o.currency ?? 'INR',
    probability_pct: o.probability_pct != null ? String(o.probability_pct) : '',
    expected_close_date: o.expected_close_date ?? '',
    owner_user_id: o.owner_user_id ?? '',
    geography: o.geography ?? '',
    next_step: o.next_step ?? '',
    next_step_date: o.next_step_date ?? '',
    deal_category: o.deal_category ?? 'NBD',
    is_confidential: o.is_confidential ?? false,
    notes: o.notes ?? '',
  }
}

/**
 * Add/edit an opportunity.
 *
 * `fiscal_year` / `fiscal_quarter` are NOT sent — a database trigger derives
 * them from expected_close_date. `amount_inr` is computed here from the FX
 * rate on file so the pipeline can be summed in one currency.
 */
export function OpportunityForm({
  open, opportunity, onClose, onSaved,
}: {
  open: boolean
  opportunity: Opportunity | null
  onClose: () => void
  onSaved: (opp: Opportunity, isNew: boolean) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()
  const { stages } = usePipelineStages()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [contacts, setContacts] = useState<Array<{ id: string; full_name: string }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(toDraft(opportunity, {
      owner: access.employeeId,
      stageId: stages[0]?.id ?? '',
    }))
  }, [open, opportunity, access.employeeId, stages])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_currencies').select('code, name').eq('is_active', true).order('sort_order')
      if (active) setCurrencies((data ?? []) as Currency[])
    })()
    return () => { active = false }
  }, [])

  // Contact picker is scoped to the chosen organisation.
  useEffect(() => {
    if (!draft.organisation_id) { setContacts([]); return }
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_contacts')
        .select('id, full_name')
        .eq('organisation_id', draft.organisation_id)
        .is('deleted_at', null)
        .order('full_name')
      if (active) setContacts((data ?? []) as Array<{ id: string; full_name: string }>)
    })()
    return () => { active = false }
  }, [draft.organisation_id])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  // Moving stage in the form pulls that stage's default win probability.
  function setStage(stageId: string) {
    const stage = stages.find((s) => s.id === stageId)
    setDraft((d) => ({
      ...d,
      stage_id: stageId,
      probability_pct: stage ? String(stage.probability_pct) : d.probability_pct,
    }))
  }

  async function save() {
    if (!draft.name.trim()) { toast.error('Name is required.'); return }
    if (!draft.organisation_id) { toast.error('Pick an organisation.'); return }
    if (!draft.owner_user_id) { toast.error('Pick an owner.'); return }
    if (!draft.stage_id) { toast.error('Pick a stage.'); return }

    setBusy(true)
    try {
      const amount = draft.amount ? Number(draft.amount) : null
      let amountInr: number | null = null
      if (amount != null) {
        const rate = await latestRateToInr(draft.currency)
        if (rate == null) {
          throw new Error(`No FX rate on file for ${draft.currency}. Add one under Configuration.`)
        }
        amountInr = Math.round(amount * rate * 100) / 100
      }

      const payload = {
        name: draft.name.trim(),
        organisation_id: draft.organisation_id,
        primary_contact_id: draft.primary_contact_id || null,
        capital_category: draft.capital_category,
        opportunity_type: draft.opportunity_type,
        stage_id: draft.stage_id,
        amount,
        currency: draft.currency,
        amount_inr: amountInr,
        probability_pct: draft.probability_pct ? Number(draft.probability_pct) : null,
        expected_close_date: draft.expected_close_date || null,
        owner_user_id: draft.owner_user_id,
        geography: draft.geography.trim() || null,
        next_step: draft.next_step.trim() || null,
        next_step_date: draft.next_step_date || null,
        deal_category: draft.deal_category || null,
        is_confidential: draft.is_confidential,
        notes: draft.notes.trim() || null,
        updated_by: access.employeeId,
      }

      const isNew = !opportunity
      const res = isNew
        ? await supabase.from('fr_opportunities')
            .insert({ ...payload, created_by: access.employeeId }).select().single()
        : await supabase.from('fr_opportunities')
            .update(payload).eq('id', opportunity.id).select().single()
      if (res.error) throw new Error(res.error.message)

      const saved = res.data as Opportunity

      // A new opportunity starts its audit trail at whatever stage it was
      // created in (from_stage_id null, per the append-only log's convention).
      if (isNew) {
        await supabase.from('fr_opportunity_stage_history').insert({
          opportunity_id: saved.id,
          from_stage_id: null,
          to_stage_id: saved.stage_id,
          changed_by: access.employeeId,
          note: 'Created',
        })
      }

      toast.success(isNew ? 'Opportunity added.' : 'Saved.')
      onSaved(saved, isNew)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      title={opportunity ? 'Edit opportunity' : 'Add opportunity'}
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="stack">
        <Input
          label="Name"
          required
          help="Convention: Organisation — Program/Purpose — FY"
          value={draft.name}
          onChange={(e) => set('name', e.currentTarget.value)}
        />

        <OrganisationPicker
          label="Organisation"
          required
          value={draft.organisation_id}
          onChange={(v) => { set('organisation_id', v); set('primary_contact_id', '') }}
        />

        <Select
          label="Primary contact"
          value={draft.primary_contact_id}
          onChange={(e) => set('primary_contact_id', e.currentTarget.value)}
          help={draft.organisation_id && contacts.length === 0 ? 'This organisation has no contacts yet.' : undefined}
        >
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </Select>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Select label="Stage" required value={draft.stage_id} onChange={(e) => setStage(e.currentTarget.value)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
          <div style={{ width: 120 }}>
            <Input
              label="Win %"
              type="number"
              value={draft.probability_pct}
              onChange={(e) => set('probability_pct', e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Amount"
              type="number"
              value={draft.amount}
              onChange={(e) => set('amount', e.currentTarget.value)}
            />
          </div>
          <div style={{ width: 130 }}>
            <Select label="Currency" value={draft.currency} onChange={(e) => set('currency', e.currentTarget.value)}>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </Select>
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Select
              label="Capital category"
              value={draft.capital_category}
              onChange={(e) => set('capital_category', e.currentTarget.value)}
            >
              {CAPITAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div className="grow">
            <Select
              label="Type"
              value={draft.opportunity_type}
              onChange={(e) => set('opportunity_type', e.currentTarget.value)}
            >
              {OPPORTUNITY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div style={{ width: 120 }}>
            <Select
              label="Category"
              value={draft.deal_category}
              onChange={(e) => set('deal_category', e.currentTarget.value)}
            >
              {DEAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Expected close"
              type="date"
              help="Fiscal year is derived from this."
              value={draft.expected_close_date}
              onChange={(e) => set('expected_close_date', e.currentTarget.value)}
            />
          </div>
          <div className="grow">
            <Select label="Owner" required value={draft.owner_user_id} onChange={(e) => set('owner_user_id', e.currentTarget.value)}>
              <option value="">Select an owner</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Next step"
              value={draft.next_step}
              onChange={(e) => set('next_step', e.currentTarget.value)}
            />
          </div>
          <div style={{ width: 170 }}>
            <Input
              label="Next step date"
              type="date"
              value={draft.next_step_date}
              onChange={(e) => set('next_step_date', e.currentTarget.value)}
            />
          </div>
        </div>

        <Input label="Geography" value={draft.geography} onChange={(e) => set('geography', e.currentTarget.value)} />
        <Textarea label="Notes" value={draft.notes} onChange={(e) => set('notes', e.currentTarget.value)} />

        <Checkbox
          label="Confidential"
          checked={draft.is_confidential}
          onChange={(v) => set('is_confidential', v)}
        />
      </div>
    </Drawer>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Trash2 } from 'lucide-react'
import { Button, Checkbox, Drawer, Input, Select, Textarea, useToast } from '../ui'
import { CAPITAL_CATEGORIES, GRANT_STATUSES } from '../../lib/enums'
import { formatMoney } from '../../lib/format'
import { latestRateToInr } from '../../lib/fx'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'
import { useBankAccounts, accountsFor } from '../../hooks/useBankAccounts'
import { OrganisationPicker } from '../organisations/OrganisationPicker'
import { ContractUpload } from './ContractUpload'
import type { ContractFields } from '../../lib/documents'
import { DictationTextarea } from '../DictationTextarea'
import {
  evenSchedule, expandTemplate, milestonesFromContractRows,
  type MilestoneDraft, type MilestoneTemplate, type ScheduleRow,
} from '../../lib/grantSchedule'

export type Grant = {
  id: string
  opportunity_id: string | null
  organisation_id: string | null
  agreement_number: string | null
  capital_category: string
  total_value: number
  currency: string
  total_value_inr: number
  fx_rate_at_signing: number
  is_fcra: boolean
  is_multi_year: boolean
  signed_date: string
  start_date: string
  end_date: string
  status: string
  health: string
  owner_user_id: string
  bank_account_id: string | null
  agreement_document_url: string | null
  agreement_document_path: string | null
  renewal_opportunity_id: string | null
  is_confidential: boolean
  social_media_mention: boolean
  contract_summary: string | null
  notes: string | null
}

type Currency = { code: string; name: string }

const EMPTY = {
  organisation_id: '',
  agreement_number: '', capital_category: 'programmatic', total_value: '', currency: 'INR',
  is_fcra: false, signed_date: '', start_date: '', end_date: '', status: 'active',
  owner_user_id: '', bank_account_id: '', agreement_document_url: '',
  is_confidential: false, social_media_mention: false, notes: '',
}
type Draft = typeof EMPTY

function toDraft(g: Grant | null, ownerFallback: string | null): Draft {
  if (!g) return { ...EMPTY, owner_user_id: ownerFallback ?? '' }
  return {
    organisation_id: g.organisation_id ?? '',
    agreement_number: g.agreement_number ?? '',
    capital_category: g.capital_category ?? 'programmatic',
    total_value: g.total_value != null ? String(g.total_value) : '',
    currency: g.currency ?? 'INR',
    is_fcra: g.is_fcra ?? false,
    signed_date: g.signed_date ?? '',
    start_date: g.start_date ?? '',
    end_date: g.end_date ?? '',
    status: g.status ?? 'active',
    owner_user_id: g.owner_user_id ?? '',
    bank_account_id: g.bank_account_id ?? '',
    agreement_document_url: g.agreement_document_url ?? '',
    is_confidential: g.is_confidential ?? false,
    social_media_mention: g.social_media_mention ?? false,
    notes: g.notes ?? '',
  }
}

/**
 * Add or edit a grant.
 *
 * The won-wizard remains the path for money that came through the pipeline —
 * it also lays down allocations, tranches and milestones. This covers the
 * grant that never was a deal: a renewal signed before the CRM existed, a
 * cheque that simply arrived. It writes the header only, and the Grant 360
 * tabs fill in the rest afterwards.
 *
 * `is_multi_year` is NOT sent — a trigger derives it from the date span. The
 * receiving-entity list is filtered to the grant's FCRA side, because the
 * remittance trigger will reject a mismatch anyway and a dropdown that offers
 * an illegal option is just a slower error.
 */
export function GrantForm({
  open, grant, onClose, onSaved,
}: {
  open: boolean
  grant: Grant | null
  onClose: () => void
  onSaved: (g: Grant) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()
  const { accounts } = useBankAccounts()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [contractPath, setContractPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only meaningful when creating: an existing grant's schedule and reporting
  // obligations already live on the Grant 360 tabs, which know how to change
  // them without disturbing remittances already recorded against them.
  const [trancheCount, setTrancheCount] = useState('4')
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[] | null>(null)
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([])
  const [milestonesFromContract, setMilestonesFromContract] = useState(false)
  const [templates, setTemplates] = useState<MilestoneTemplate[]>([])
  // Null until a contract is read — the box only exists once there is
  // something to summarise, and stays editable from then on.
  const [summary, setSummary] = useState<string | null>(null)

  const isNew = grant === null

  useEffect(() => {
    if (!open) return
    setDraft(toDraft(grant, access.employeeId))
    setContractPath(null)
    setTrancheCount('4')
    setScheduleRows(null)
    setMilestones([])
    setMilestonesFromContract(false)
    setSummary(null)
  }, [open, grant, access.employeeId])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_milestone_templates')
        .select('id, capital_category, milestone_type_id, name, recurrence, offset_months')
        .eq('is_active', true)
      if (active) setTemplates((data ?? []) as MilestoneTemplate[])
    })()
    return () => { active = false }
  }, [])

  const applyTemplateSuggestions = useCallback(() => {
    if (!draft.start_date || !draft.end_date) return
    const matching = templates.filter((t) => t.capital_category === draft.capital_category)
    setMilestones(matching.flatMap((t) => expandTemplate(t, draft.start_date, draft.end_date)))
    setMilestonesFromContract(false)
  }, [templates, draft.capital_category, draft.start_date, draft.end_date])

  // Keeps the reporting suggestions in step with the category and term, same
  // as the won-wizard — but never once the contract has supplied its own
  // timeline, which stays put until asked for the template instead.
  useEffect(() => {
    if (!isNew || milestonesFromContract || !draft.start_date || !draft.end_date) return
    applyTemplateSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, templates, draft.capital_category, draft.start_date, draft.end_date, milestonesFromContract])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_currencies').select('code, name').eq('is_active', true).order('sort_order')
      if (active) setCurrencies((data ?? []) as Currency[])
    })()
    return () => { active = false }
  }, [])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /** A date input silently rejects anything that is not yyyy-mm-dd. */
  const asDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')

  /** Only what the contract actually stated — a null means "not in the document". */
  function applyContract(f: ContractFields) {
    setDraft((d) => ({
      ...d,
      agreement_number: f.agreement_number || d.agreement_number,
      total_value: f.total_value != null && f.total_value > 0 ? String(f.total_value) : d.total_value,
      currency: f.currency && /^[A-Za-z]{3}$/.test(f.currency) ? f.currency.toUpperCase() : d.currency,
      is_fcra: f.is_foreign_contribution ?? d.is_fcra,
      // Only ever turned on by an explicit yes — silence in the document is
      // not consent to a social media mention.
      social_media_mention: f.social_media_mention === true ? true : d.social_media_mention,
      signed_date: asDate(f.signed_date) || d.signed_date,
      start_date: asDate(f.start_date) || d.start_date,
      end_date: asDate(f.end_date) || d.end_date,
    }))

    const rows = (f.tranches ?? []).filter((t) => t.amount != null || t.due_date)
    if (rows.length > 0) {
      setScheduleRows(rows.map((t) => ({
        due_date: asDate(t.due_date) || '',
        amount: t.amount != null ? String(t.amount) : '',
        condition_note: t.condition_note ?? '',
      })))
    }

    const reportRows = milestonesFromContractRows(f.reporting_milestones ?? [])
    if (reportRows.length > 0) {
      setMilestones(reportRows)
      setMilestonesFromContract(true)
    }

    // An empty string still opens the box: the read happened, the person can
    // write the summary themselves.
    setSummary(f.summary?.trim() ?? '')

    toast.success('Read from the contract. Check it before saving.')
  }

  function setScheduleRow(i: number, patch: Partial<ScheduleRow>) {
    setScheduleRows((prev) => (prev ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const valueNum = draft.total_value ? Number(draft.total_value) : 0
  const scheduled = (scheduleRows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const legalAccounts = accountsFor(accounts, draft.is_fcra)

  // Flipping the FCRA side invalidates an account from the other side.
  function setFcra(next: boolean) {
    setDraft((d) => ({
      ...d,
      is_fcra: next,
      bank_account_id: accounts.find((a) => a.id === d.bank_account_id)?.is_fcra === next
        ? d.bank_account_id
        : '',
    }))
  }

  async function save() {
    if (isNew && !draft.organisation_id) { toast.error('Pick the donor organisation.'); return }
    if (!draft.signed_date) { toast.error('Signed date is required.'); return }
    if (!draft.start_date || !draft.end_date) { toast.error('The grant term is required.'); return }
    if (draft.end_date < draft.start_date) { toast.error('The end date cannot precede the start date.'); return }
    if (!draft.owner_user_id) { toast.error('Pick an owner.'); return }

    setBusy(true)
    try {
      const value = draft.total_value ? Number(draft.total_value) : 0
      const rate = await latestRateToInr(draft.currency)
      if (rate == null) {
        throw new Error(`No FX rate on file for ${draft.currency}. Add one under Configuration.`)
      }

      const payload = {
        agreement_number: draft.agreement_number.trim() || null,
        capital_category: draft.capital_category,
        total_value: value,
        currency: draft.currency,
        total_value_inr: Math.round(value * rate * 100) / 100,
        fx_rate_at_signing: rate,
        is_fcra: draft.is_fcra,
        signed_date: draft.signed_date,
        start_date: draft.start_date,
        end_date: draft.end_date,
        status: draft.status,
        owner_user_id: draft.owner_user_id,
        bank_account_id: draft.bank_account_id || null,
        agreement_document_url: draft.agreement_document_url.trim() || null,
        is_confidential: draft.is_confidential,
        social_media_mention: draft.social_media_mention,
        notes: draft.notes.trim() || null,
        updated_by: access.employeeId,
      }

      const { data, error } = isNew
        ? await supabase.from('fr_grants').insert({
          ...payload,
          organisation_id: draft.organisation_id,
          // No opportunity behind it — that is the point of this path.
          opportunity_id: null,
          agreement_document_path: contractPath,
          contract_summary: summary?.trim() || null,
          created_by: access.employeeId,
        }).select().single()
        : await supabase
          .from('fr_grants').update(payload).eq('id', grant!.id).select().single()
      if (error) throw new Error(error.message)

      const saved = data as Grant
      const problems: string[] = []

      if (isNew) {
        const valueInr = payload.total_value_inr
        const fromContract = (scheduleRows ?? []).filter((r) => Number(r.amount) > 0 || r.due_date)
        const count = Number(trancheCount) || 0

        if (fromContract.length > 0) {
          const { error: trancheErr } = await supabase.from('fr_tranches').insert(
            fromContract.map((r, i) => {
              const amount = Number(r.amount) || 0
              return {
                grant_id: saved.id,
                sequence_no: i + 1,
                // An instalment tied to an event still has to be sorted and
                // chased, so the term start stands in until a date is agreed.
                due_date: r.due_date || draft.start_date,
                amount,
                currency: draft.currency,
                amount_inr_expected: Math.round(amount * rate * 100) / 100,
                trigger_type: r.due_date ? 'date_based' : 'milestone_based',
                condition_note: r.condition_note.trim() || null,
                status: 'pending',
                created_by: access.employeeId,
              }
            }),
          )
          if (trancheErr) problems.push('the tranche schedule')
        } else if (count > 0) {
          const { error: trancheErr } = await supabase.from('fr_tranches').insert(
            evenSchedule(count, value, valueInr, draft.start_date, draft.end_date).map((row, i) => ({
              grant_id: saved.id,
              sequence_no: i + 1,
              due_date: row.due_date,
              amount: row.amount,
              currency: draft.currency,
              amount_inr_expected: row.amountInr,
              trigger_type: 'date_based',
              status: 'pending',
              created_by: access.employeeId,
            })),
          )
          if (trancheErr) problems.push('the tranche schedule')
        }

        const chosenMilestones = milestones.filter((m) => m.include && m.title.trim() && m.due_date)
        if (chosenMilestones.length > 0) {
          const { error: milestoneErr } = await supabase.from('fr_compliance_milestones').insert(
            chosenMilestones.map((m) => ({
              grant_id: saved.id,
              milestone_type_id: m.milestone_type_id,
              title: m.title,
              due_date: m.due_date,
              owner_user_id: draft.owner_user_id,
              status: 'upcoming',
              created_by: access.employeeId,
            })),
          )
          if (milestoneErr) problems.push('the reporting timeline')
        }
      }

      if (problems.length > 0) {
        toast.error(`Grant created, but ${problems.join(' and ')} could not be saved. Finish it on the grant page.`)
      } else {
        toast.success(isNew ? 'Grant created.' : 'Saved.')
      }
      onSaved(saved)
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
      title={isNew ? 'Add grant' : 'Edit grant'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Create grant' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {isNew ? (
          <>
            <OrganisationPicker
              label="Donor organisation"
              value={draft.organisation_id}
              onChange={(v) => set('organisation_id', v)}
              help="Required. The grant hangs off the donor, not a deal."
            />
            <ContractUpload
              path={contractPath}
              onAttached={(p) => setContractPath(p)}
              onExtracted={applyContract}
            />
            {summary !== null ? (
              <Textarea
                label="Contract summary"
                rows={7}
                help="Read from the contract — edit freely. Shown on the grant's overview."
                value={summary}
                onChange={(e) => setSummary(e.currentTarget.value)}
              />
            ) : null}
          </>
        ) : null}

        <Input
          label="Agreement number"
          value={draft.agreement_number}
          onChange={(e) => set('agreement_number', e.currentTarget.value)}
        />

        <Select
          label="Capital category"
          value={draft.capital_category}
          onChange={(e) => set('capital_category', e.currentTarget.value)}
        >
          {CAPITAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Committed value"
              type="number"
              value={draft.total_value}
              onChange={(e) => set('total_value', e.currentTarget.value)}
            />
          </div>
          <Select
            label="Currency"
            value={draft.currency}
            onChange={(e) => set('currency', e.currentTarget.value)}
          >
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </Select>
        </div>

        <Checkbox
          label="Foreign contribution (FCRA)"
          checked={draft.is_fcra}
          onChange={setFcra}
        />

        <Select
          label="Receiving entity"
          value={draft.bank_account_id}
          onChange={(e) => set('bank_account_id', e.currentTarget.value)}
          help={draft.is_fcra ? 'FCRA-designated accounts only.' : 'Domestic accounts only.'}
        >
          <option value="">—</option>
          {legalAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>

        <Input
          label="Signed date"
          type="date"
          required
          value={draft.signed_date}
          onChange={(e) => set('signed_date', e.currentTarget.value)}
        />

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Start date"
              type="date"
              required
              value={draft.start_date}
              onChange={(e) => set('start_date', e.currentTarget.value)}
            />
          </div>
          <div className="grow">
            <Input
              label="End date"
              type="date"
              required
              value={draft.end_date}
              onChange={(e) => set('end_date', e.currentTarget.value)}
            />
          </div>
        </div>

        <Select
          label="Status"
          value={draft.status}
          onChange={(e) => set('status', e.currentTarget.value)}
        >
          {GRANT_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        <Select
          label="Owner"
          required
          value={draft.owner_user_id}
          onChange={(e) => set('owner_user_id', e.currentTarget.value)}
        >
          <option value="">—</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>

        <Input
          label="Agreement document URL"
          value={draft.agreement_document_url}
          onChange={(e) => set('agreement_document_url', e.currentTarget.value)}
        />

        <Checkbox
          label="Confidential"
          checked={draft.is_confidential}
          onChange={(v) => set('is_confidential', v)}
        />

        <Checkbox
          label="Donor may be publicly acknowledged (social media, press, annual report)"
          checked={draft.social_media_mention}
          onChange={(v) => set('social_media_mention', v)}
        />

        {isNew ? (
          <>
            <div className="tn-micro" style={{ marginTop: 'var(--space-3)' }}>Tranche schedule</div>
            {scheduleRows ? (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="chartsub" style={{ margin: 0 }}>Read from the contract.</span>
                  <Button size="sm" variant="secondary" onClick={() => setScheduleRows(null)}>
                    Split evenly instead
                  </Button>
                </div>
                {scheduleRows.map((r, i) => (
                  <div key={i} className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                    <Input
                      label="Due"
                      type="date"
                      value={r.due_date}
                      onChange={(e) => setScheduleRow(i, { due_date: e.currentTarget.value })}
                    />
                    <div className="grow">
                      <Input
                        label="Amount"
                        type="number"
                        value={r.amount}
                        onChange={(e) => setScheduleRow(i, { amount: e.currentTarget.value })}
                      />
                    </div>
                    <div className="grow">
                      <Input
                        label="Condition"
                        value={r.condition_note}
                        onChange={(e) => setScheduleRow(i, { condition_note: e.currentTarget.value })}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remove instalment"
                      title="Remove"
                      onClick={() => setScheduleRows((p) => (p ?? []).filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <p className="tn-num muted">
                  {formatMoney(scheduled)} of {formatMoney(valueNum)} scheduled
                  {Math.abs(valueNum - scheduled) > 0.5
                    ? ` · ${formatMoney(Math.abs(valueNum - scheduled))} ${scheduled > valueNum ? 'over' : 'unscheduled'}`
                    : ''}
                </p>
              </>
            ) : (
              <Input
                label="Number of instalments"
                type="number"
                min={0}
                max={24}
                value={trancheCount}
                onChange={(e) => setTrancheCount(e.currentTarget.value)}
                help="Split evenly across the term. Set 0 to schedule later on the grant page."
              />
            )}

            <div className="row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-3)' }}>
              <span className="tn-micro">
                {milestonesFromContract
                  ? 'Reporting timeline — read from the contract'
                  : `Reporting timeline — suggested from the ${draft.capital_category} template`}
              </span>
            </div>

            {milestones.length === 0 ? (
              <p className="muted">
                No milestone template matches this category. Add a row, or add reporting
                obligations on the grant page later.
              </p>
            ) : milestones.map((m, i) => (
              <div key={i} className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
                <Checkbox
                  label=""
                  checked={m.include}
                  onChange={(v) => setMilestones((prev) =>
                    prev.map((x, idx) => (idx === i ? { ...x, include: v } : x)))}
                />
                <div className="grow">
                  <Input
                    aria-label="Report name"
                    title={m.title}
                    value={m.title}
                    onChange={(e) => setMilestones((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, title: e.currentTarget.value } : x)))}
                  />
                </div>
                <div style={{ flex: '0 0 160px' }}>
                  <Input
                    aria-label="Due date"
                    type="date"
                    value={m.due_date}
                    onChange={(e) => setMilestones((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, due_date: e.currentTarget.value } : x)))}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove report"
                  title="Remove"
                  onClick={() => setMilestones((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMilestones((prev) => [
                ...prev, { milestone_type_id: null, title: '', due_date: '', include: true },
              ])}
            >
              Add row
            </Button>
          </>
        ) : null}

        <DictationTextarea label="Notes" rows={3} value={draft.notes} onChange={(v) => set('notes', v)} />
      </div>
    </Drawer>
  )
}

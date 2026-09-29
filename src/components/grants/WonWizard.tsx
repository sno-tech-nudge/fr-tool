import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Trash2 } from 'lucide-react'
import {
  Button, Checkbox, Drawer, Input, Select, Skeleton, Textarea, useToast,
} from '../ui'
import { CAPITAL_CATEGORIES } from '../../lib/enums'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { fiscalYear } from '../../lib/fy'
import { latestRateToInr } from '../../lib/fx'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'
import { useBankAccounts, accountsFor } from '../../hooks/useBankAccounts'
import { usePrograms } from '../../hooks/usePrograms'
import { ContractUpload } from './ContractUpload'
import { removeDocument, type ContractFields } from '../../lib/documents'
import {
  addMonths, evenSchedule, expandTemplate, milestonesFromContractRows, round2,
  type MilestoneDraft, type MilestoneTemplate, type ScheduleRow,
} from '../../lib/grantSchedule'

type WonOpportunity = {
  id: string
  name: string
  organisation_id: string
  capital_category: string
  amount: number | null
  currency: string
  amount_inr: number | null
  owner_user_id: string
  expected_close_date: string | null
}

type AllocationDraft = {
  program_id: string
  project_id: string
  fiscal_year: string
  amount: string
}

const STEPS = ['Agreement', 'Allocations', 'Schedule', 'Milestones']

/**
 * Fires whenever an opportunity reaches Closed won, and is the only path that
 * creates a grant — so a won deal always lands with its allocations, schedule
 * and reporting obligations attached rather than as a bare header row.
 *
 * PostgREST has no multi-statement transaction, so the grant is written first
 * and its children after. A child failure therefore leaves a real grant with
 * something missing, which the Grant 360 tabs can finish by hand — the
 * alternative, losing the won deal itself, would be far worse.
 */
export function WonWizard({
  open, opportunity, onClose, onCreated,
}: {
  open: boolean
  opportunity: WonOpportunity | null
  onClose: () => void
  onCreated: (grantId: string) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()
  const { accounts } = useBankAccounts()
  const { programs, projects } = usePrograms()

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loadingPrefill, setLoadingPrefill] = useState(false)

  const [agreementNumber, setAgreementNumber] = useState('')
  const [capitalCategory, setCapitalCategory] = useState('programmatic')
  const [totalValue, setTotalValue] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [isFcra, setIsFcra] = useState(false)
  const [signedDate, setSignedDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [socialMediaMention, setSocialMediaMention] = useState(false)

  const [contractPath, setContractPath] = useState<string | null>(null)
  // Null until a contract is read; then an editable digest of its terms.
  const [summary, setSummary] = useState<string | null>(null)

  const [allocations, setAllocations] = useState<AllocationDraft[]>([])
  const [trancheCount, setTrancheCount] = useState('4')
  // Null means "split the value evenly"; a list means the contract said so.
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[] | null>(null)
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([])
  // Suppresses the template auto-suggestion once the contract has supplied its
  // own reporting timeline, so the effect below does not silently overwrite it.
  const [milestonesFromContract, setMilestonesFromContract] = useState(false)
  const [templates, setTemplates] = useState<MilestoneTemplate[]>([])

  const legalAccounts = accountsFor(accounts, isFcra)
  const valueNum = Number(totalValue) || 0

  /* ---- prefill from the opportunity ---- */

  const prefill = useCallback(async () => {
    if (!opportunity) return
    setLoadingPrefill(true)
    setStep(0)
    setAgreementNumber('')
    setCapitalCategory(opportunity.capital_category ?? 'programmatic')
    setTotalValue(opportunity.amount != null ? String(opportunity.amount) : '')
    setCurrency(opportunity.currency ?? 'INR')
    setIsFcra(false)
    setOwnerId(opportunity.owner_user_id ?? '')
    setBankAccountId('')
    setSocialMediaMention(false)
    setTrancheCount('4')
    setContractPath(null)
    setSummary(null)
    setScheduleRows(null)
    setMilestonesFromContract(false)

    const today = new Date()
    setSignedDate(toISODate(today))
    setStartDate(toISODate(today))
    setEndDate(toISODate(addMonths(today, 12)))

    // The programs already attached to the deal become the opening allocation
    // split, so the wizard starts from what the team agreed rather than blank.
    const { data } = await supabase
      .from('fr_opportunity_programs')
      .select('program_id, project_id, indicative_amount_inr')
      .eq('opportunity_id', opportunity.id)

    const linked = (data ?? []) as Array<{
      program_id: string; project_id: string | null; indicative_amount_inr: number | null
    }>
    setAllocations(linked.length > 0
      ? linked.map((l) => ({
        program_id: l.program_id,
        project_id: l.project_id ?? '',
        fiscal_year: fiscalYear(today) ?? '',
        amount: l.indicative_amount_inr != null ? String(l.indicative_amount_inr) : '',
      }))
      : [])
    setLoadingPrefill(false)
  }, [opportunity])

  useEffect(() => { if (open) void prefill() }, [open, prefill])

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
    const matching = templates.filter((t) => t.capital_category === capitalCategory)
    setMilestones(matching.flatMap((t) => expandTemplate(t, startDate, endDate)))
    setMilestonesFromContract(false)
  }, [templates, capitalCategory, startDate, endDate])

  // Rebuilds the template suggestions as the category or term changes, unless
  // the contract already supplied its own reporting timeline — that stays put
  // until the person explicitly asks for the template instead.
  useEffect(() => {
    if (milestonesFromContract || !startDate || !endDate) return
    applyTemplateSuggestions()
    // applyTemplateSuggestions is recreated from these same values, so it is
    // deliberately left off the deps — including it would not change when
    // this fires, only how often it is redeclared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, capitalCategory, startDate, endDate, milestonesFromContract])

  /* ---- contract ---- */

  /** A date input silently rejects anything that is not yyyy-mm-dd. */
  const asDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

  /**
   * Only fields the contract actually stated are overwritten — a null from the
   * model means "not in the document", not "blank it out".
   */
  function applyContract(f: ContractFields) {
    const filled: string[] = []

    if (f.agreement_number) { setAgreementNumber(f.agreement_number); filled.push('the agreement number') }
    if (f.total_value != null && f.total_value > 0) {
      setTotalValue(String(f.total_value))
      filled.push('the value')
    }
    if (f.currency && /^[A-Za-z]{3}$/.test(f.currency)) setCurrency(f.currency.toUpperCase())
    if (f.is_foreign_contribution != null) {
      setIsFcra(f.is_foreign_contribution)
      setBankAccountId('')
    }
    // Only ever turned on by an explicit yes — silence in the document is not
    // consent to a social media mention, so it never flips the box off either.
    if (f.social_media_mention === true) {
      setSocialMediaMention(true)
      filled.push('a social media mention clause')
    }

    const signed = asDate(f.signed_date)
    const from = asDate(f.start_date)
    const to = asDate(f.end_date)
    if (signed) { setSignedDate(signed); filled.push('the signed date') }
    if (from) setStartDate(from)
    if (to) setEndDate(to)
    if (from || to) filled.push('the term')

    const rows = (f.tranches ?? []).filter((t) => t.amount != null || t.due_date)
    if (rows.length > 0) {
      setScheduleRows(rows.map((t) => ({
        due_date: asDate(t.due_date) ?? '',
        amount: t.amount != null ? String(t.amount) : '',
        condition_note: t.condition_note ?? '',
      })))
      filled.push(`${rows.length} instalments`)
    }

    const reportRows = milestonesFromContractRows(f.reporting_milestones ?? [])
    if (reportRows.length > 0) {
      setMilestones(reportRows)
      setMilestonesFromContract(true)
      filled.push(`${reportRows.length} reporting dates`)
    }

    setSummary(f.summary?.trim() ?? '')

    if (filled.length === 0) {
      toast.error('Nothing usable was found in that document. Fill the terms in by hand.')
      return
    }
    toast.success(`Read ${filled.join(', ')}. Check it against the document.`)
  }

  /* ---- allocation helpers ---- */

  function setAllocation(i: number, patch: Partial<AllocationDraft>) {
    setAllocations((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  function setScheduleRow(i: number, patch: Partial<ScheduleRow>) {
    setScheduleRows((prev) => (prev ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  /**
   * Leaving without creating the grant leaves the uploaded contract attached to
   * nothing, so it goes with the wizard.
   */
  function abandon() {
    if (contractPath) void removeDocument(contractPath)
    setContractPath(null)
    onClose()
  }

  function autoBalance() {
    if (allocations.length === 0) return
    const each = Math.round((valueNum / allocations.length) * 100) / 100
    setAllocations((prev) => prev.map((a, i) => ({
      ...a,
      amount: String(i === prev.length - 1
        ? Math.round((valueNum - each * (prev.length - 1)) * 100) / 100
        : each),
    })))
  }

  const allocated = allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const scheduled = (scheduleRows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)

  /* ---- commit ---- */

  async function create() {
    if (!opportunity) return
    if (!signedDate || !startDate || !endDate) { toast.error('Signed date and term are required.'); return }
    if (endDate < startDate) { toast.error('The end date cannot precede the start date.'); return }
    if (!ownerId) { toast.error('Pick an owner.'); return }

    setBusy(true)
    try {
      const rate = await latestRateToInr(currency)
      if (rate == null) throw new Error(`No FX rate on file for ${currency}.`)
      const valueInr = Math.round(valueNum * rate * 100) / 100

      const { data: grant, error: grantErr } = await supabase
        .from('fr_grants')
        .insert({
          opportunity_id: opportunity.id,
          organisation_id: opportunity.organisation_id,
          agreement_number: agreementNumber.trim() || null,
          capital_category: capitalCategory,
          total_value: valueNum,
          currency,
          total_value_inr: valueInr,
          fx_rate_at_signing: rate,
          is_fcra: isFcra,
          signed_date: signedDate,
          start_date: startDate,
          end_date: endDate,
          status: 'active',
          owner_user_id: ownerId,
          bank_account_id: bankAccountId || null,
          agreement_document_path: contractPath,
          social_media_mention: socialMediaMention,
          contract_summary: summary?.trim() || null,
          created_by: access.employeeId,
          updated_by: access.employeeId,
        })
        .select()
        .single()
      if (grantErr) throw new Error(grantErr.message)

      const grantId = (grant as { id: string }).id
      const problems: string[] = []

      const usable = allocations.filter((a) => a.program_id && Number(a.amount) > 0)
      if (usable.length > 0) {
        const { error } = await supabase.from('fr_grant_allocations').insert(
          usable.map((a) => ({
            grant_id: grantId,
            program_id: a.program_id,
            project_id: a.project_id || null,
            fiscal_year: a.fiscal_year || null,
            amount: Number(a.amount),
            currency,
            amount_inr: Number(a.amount),
          })),
        )
        if (error) problems.push('allocations')
      }

      const fromContract = (scheduleRows ?? []).filter((r) => Number(r.amount) > 0 || r.due_date)
      const count = Number(trancheCount) || 0

      if (fromContract.length > 0) {
        const { error } = await supabase.from('fr_tranches').insert(
          fromContract.map((r, i) => {
            const amount = Number(r.amount) || 0
            return {
              grant_id: grantId,
              sequence_no: i + 1,
              // An instalment tied to an event still has to be sorted and
              // chased, so the term start stands in until a date is agreed.
              due_date: r.due_date || startDate,
              amount,
              currency,
              amount_inr_expected: round2(amount * rate),
              trigger_type: r.due_date ? 'date_based' : 'milestone_based',
              condition_note: r.condition_note.trim() || null,
              status: 'pending',
              created_by: access.employeeId,
            }
          }),
        )
        if (error) problems.push('the tranche schedule')
      } else if (count > 0) {
        const { error } = await supabase.from('fr_tranches').insert(
          evenSchedule(count, valueNum, valueInr, startDate, endDate).map((row, i) => ({
            grant_id: grantId,
            sequence_no: i + 1,
            due_date: row.due_date,
            amount: row.amount,
            currency,
            amount_inr_expected: row.amountInr,
            trigger_type: 'date_based',
            status: 'pending',
            created_by: access.employeeId,
          })),
        )
        if (error) problems.push('the tranche schedule')
      }

      const chosen = milestones.filter((m) => m.include && m.title.trim() && m.due_date)
      if (chosen.length > 0) {
        const { error } = await supabase.from('fr_compliance_milestones').insert(
          chosen.map((m) => ({
            grant_id: grantId,
            milestone_type_id: m.milestone_type_id,
            title: m.title,
            due_date: m.due_date,
            owner_user_id: ownerId,
            status: 'upcoming',
            created_by: access.employeeId,
          })),
        )
        if (error) problems.push('milestones')
      }

      const { error: linkErr } = await supabase
        .from('fr_opportunities')
        .update({ won_grant_id: grantId, updated_by: access.employeeId })
        .eq('id', opportunity.id)
      if (linkErr) problems.push('the link back to the opportunity')

      if (problems.length > 0) {
        toast.error(`Grant created, but ${problems.join(', ')} could not be saved. Finish it on the grant page.`)
      } else {
        toast.success('Grant created.')
      }
      onCreated(grantId)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the grant.')
    } finally {
      setBusy(false)
    }
  }

  const isLast = step === STEPS.length - 1

  return (
    <Drawer
      open={open}
      title={opportunity ? `Won · ${opportunity.name}` : 'Won'}
      onClose={abandon}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={abandon} disabled={busy}>Finish later</Button>
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              Back
            </Button>
          ) : null}
          {isLast ? (
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create grant'}
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)} disabled={busy}>Next</Button>
          )}
        </>
      }
    >
      <ol className="wizsteps">
        {STEPS.map((label, i) => (
          <li key={label} data-state={i === step ? 'current' : i < step ? 'done' : undefined}>
            <span className="tn-num">{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {loadingPrefill ? <Skeleton height={200} /> : (
        <div className="stack">
          {step === 0 ? (
            <>
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
              <Input
                label="Agreement number"
                value={agreementNumber}
                onChange={(e) => setAgreementNumber(e.currentTarget.value)}
              />
              <Select
                label="Capital category"
                value={capitalCategory}
                onChange={(e) => setCapitalCategory(e.currentTarget.value)}
              >
                {CAPITAL_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                <div className="grow">
                  <Input
                    label="Committed value"
                    type="number"
                    value={totalValue}
                    onChange={(e) => setTotalValue(e.currentTarget.value)}
                  />
                </div>
                <Input
                  label="Currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.currentTarget.value.toUpperCase())}
                />
              </div>
              <Checkbox
                label="Foreign contribution (FCRA)"
                checked={isFcra}
                onChange={(v) => { setIsFcra(v); setBankAccountId('') }}
              />
              <Select
                label="Receiving entity"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.currentTarget.value)}
                help={isFcra ? 'FCRA-designated accounts only.' : 'Domestic accounts only.'}
              >
                <option value="">—</option>
                {legalAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
              <Input
                label="Signed date"
                type="date"
                required
                value={signedDate}
                onChange={(e) => setSignedDate(e.currentTarget.value)}
              />
              <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                <div className="grow">
                  <Input
                    label="Start date"
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.currentTarget.value)}
                  />
                </div>
                <div className="grow">
                  <Input
                    label="End date"
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.currentTarget.value)}
                  />
                </div>
              </div>
              <Select
                label="Owner"
                required
                value={ownerId}
                onChange={(e) => setOwnerId(e.currentTarget.value)}
              >
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
              <Checkbox
                label="Donor may be publicly acknowledged (social media, press, annual report)"
                checked={socialMediaMention}
                onChange={setSocialMediaMention}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="tn-micro">Split across programs</span>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <Button size="sm" variant="secondary" onClick={autoBalance}>Auto-balance</Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAllocations((p) => [...p, {
                      program_id: '', project_id: '', fiscal_year: fiscalYear(startDate) ?? '', amount: '',
                    }])}
                  >
                    Add row
                  </Button>
                </div>
              </div>

              {allocations.length === 0 ? (
                <p className="muted">
                  No programs were attached to this deal. Add a row, or skip and allocate later.
                </p>
              ) : allocations.map((a, i) => (
                <div key={i} className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                  <Select
                    label="Program"
                    value={a.program_id}
                    onChange={(e) => setAllocation(i, { program_id: e.currentTarget.value, project_id: '' })}
                  >
                    <option value="">—</option>
                    {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                  </Select>
                  <Select
                    label="Project"
                    value={a.project_id}
                    onChange={(e) => setAllocation(i, { project_id: e.currentTarget.value })}
                  >
                    <option value="">—</option>
                    {projects.filter((p) => p.program_id === a.program_id)
                      .map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                  </Select>
                  <Input
                    label="Fiscal year"
                    value={a.fiscal_year}
                    onChange={(e) => setAllocation(i, { fiscal_year: e.currentTarget.value })}
                  />
                  <div className="grow">
                    <Input
                      label="Amount"
                      type="number"
                      value={a.amount}
                      onChange={(e) => setAllocation(i, { amount: e.currentTarget.value })}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAllocations((p) => p.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              <p className="tn-num muted">
                {formatMoney(allocated)} of {formatMoney(valueNum)} allocated
                {Math.abs(valueNum - allocated) > 0.5
                  ? ` · ${formatMoney(Math.abs(valueNum - allocated))} ${allocated > valueNum ? 'over' : 'left'}`
                  : ''}
              </p>
            </>
          ) : null}

          {step === 2 ? (
            scheduleRows ? (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="tn-micro">Read from the contract</span>
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
              <>
                <Input
                  label="Number of instalments"
                  type="number"
                  min={0}
                  max={24}
                  value={trancheCount}
                  onChange={(e) => setTrancheCount(e.currentTarget.value)}
                  help={`${formatMoney(valueNum)} split evenly between ${formatDate(startDate)} and ${formatDate(endDate)}. Set 0 to schedule later.`}
                />
                {Number(trancheCount) > 0 ? (
                  <p className="muted tn-num">
                    {formatMoney(valueNum / (Number(trancheCount) || 1))} per instalment.
                  </p>
                ) : null}
              </>
            )
          ) : null}

          {step === 3 ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="tn-micro">
                  {milestonesFromContract
                    ? 'Read from the contract'
                    : `Suggested from the ${capitalCategory} template`}
                  {' '}— untick anything that does not apply.
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
        </div>
      )}
    </Drawer>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { currentFiscalYear } from '../../lib/fy'
import { isEffectivelyOverdue } from '../../lib/grants'
import { loadHealthRules } from '../../lib/healthRules'

/**
 * Everything the organisation Overview's account plan reads, worked out from
 * the organisation's grants, instalments, receipts, compliance and deals.
 * One organisation's records stay far under the 1,000-row read cap, so the
 * rollups happen here rather than in a view.
 */

export type Rag = 'green' | 'amber' | 'red'

export type AccountPlan = {
  id?: string
  organisation_id: string
  reporting_cadence: string | null
  call_cadence: string | null
  next_steps: string | null
  top_partners: string | null
  renewal_cycle: string | null
  board_meeting: string | null
  aspiration_target_inr: number | null
  aspiration_programs: string | null
  aspiration_notes: string | null
  health_collection: Rag | null
  health_compliance: Rag | null
  health_relationship: Rag | null
  health_renewal: Rag | null
  donor_delight_score: number | null
  /** "YYYY-MM" while editing; stored as the first of that month. */
  partner_since: string | null
}

export type PlanContact = {
  id: string
  full_name: string
  designation: string | null
  seniority: string | null
  influence_role: 'decision_maker' | 'influencer' | null
  relationship_rag: Rag | null
}

export type FyRow = {
  fy: string
  label: string
  budget: number | null
  collected: number
  share: number | null
  due: number
  received: number
  cumulativePct: number | null
}

export type AccountData = {
  /** Null until the account-plan SQL has been run. */
  plan: AccountPlan | null
  planMissing: boolean
  budgets: Record<string, number | null>
  contacts: PlanContact[]
  years: FyRow[]
  header: {
    from: string | null
    to: string | null
    committed: number
    received: number
    programs: string[]
    states: string[]
    entities: string[]
    partnerSince: string | null
  }
  /** Worked out from the data; the plan's health_* columns override these. */
  auto: {
    collection: Rag | null
    compliance: Rag | null
    relationship: Rag | null
    renewal: Rag | null
    reportingCadence: string | null
    renewalCycle: string | null
  }
}

export const EMPTY_PLAN = (organisationId: string): AccountPlan => ({
  organisation_id: organisationId,
  reporting_cadence: null, call_cadence: null, next_steps: null, top_partners: null,
  renewal_cycle: null, board_meeting: null, aspiration_target_inr: null,
  aspiration_programs: null, aspiration_notes: null, health_collection: null,
  health_compliance: null, health_relationship: null, health_renewal: null,
  donor_delight_score: null,
  partner_since: null,
})

type GrantRow = {
  id: string; total_value_inr: number | null; received_inr: number | null
  start_date: string | null; end_date: string | null; signed_date: string | null
  status: string | null; bank_label: string | null
}
type TrancheRow = { amount_inr_expected: number; received_inr: number; due_fiscal_year: string | null; is_overdue: boolean; effective_due_date: string | null; status: string }
type RemitRow = { amount_inr: number | null; received_fiscal_year: string | null }
type OppRow = { geography: string | null; is_open: boolean; is_won: boolean; opportunity_type: string | null; expected_close_date: string | null }
type MilestoneRow = { status: string | null; due_date: string | null; grant_id: string }

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const uniq = (xs: Array<string | null | undefined>) =>
  [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))]

/** "FY 2026-27" -> start year 2026, for ordering and stepping back. */
const fyStart = (fy: string) => Number(fy.slice(3, 7))
const fyLabel = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`

/** Milestones per grant-year → the reporting rhythm the MoU set. */
function cadenceFrom(milestones: MilestoneRow[], grants: GrantRow[]): string | null {
  const years = sum(grants.map((g) => {
    if (!g.start_date || !g.end_date) return 0
    const ms = new Date(g.end_date).getTime() - new Date(g.start_date).getTime()
    return milestones.some((m) => m.grant_id === g.id) ? Math.max(ms / 3.156e10, 0.5) : 0
  }))
  if (!years || milestones.length === 0) return null
  const perYear = milestones.length / years
  if (perYear >= 10) return 'Monthly'
  if (perYear >= 3) return 'Quarterly'
  if (perYear >= 1.6) return 'Half-yearly'
  return 'Annual'
}

function renewalCycleFrom(grants: GrantRow[]): string | null {
  const spans = grants
    .filter((g) => g.start_date && g.end_date)
    .map((g) => (new Date(g.end_date!).getTime() - new Date(g.start_date!).getTime()) / 3.156e10)
  if (spans.length === 0) return null
  const avg = Math.round(sum(spans) / spans.length)
  return avg <= 1 ? 'Annual' : `Every ${avg} years`
}

/** The stored row in the shape the form edits: partner_since as "YYYY-MM". */
function toPlan(row: AccountPlan | null, organisationId: string): AccountPlan {
  if (!row) return EMPTY_PLAN(organisationId)
  return { ...EMPTY_PLAN(organisationId), ...row, partner_since: row.partner_since ? row.partner_since.slice(0, 7) : null }
}

/** The most common rating; a tie goes to the worse one. */
function majority(rags: Rag[]): Rag {
  const n = (r: Rag) => rags.filter((x) => x === r).length
  return (['red', 'amber', 'green'] as Rag[]).reduce((best, r) => (n(r) > n(best) ? r : best), 'red')
}

export function useAccountData(organisationId: string) {
  const [data, setData] = useState<AccountData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const [grantsRes, tranchesRes, remitsRes, oppsRes, contactsRes, planRes, budgetsRes, rules] = await Promise.all([
      supabase.from('v_fr_grant_facts')
        .select('id, total_value_inr, received_inr, start_date, end_date, signed_date, status, bank_label')
        .eq('organisation_id', organisationId),
      supabase.from('v_fr_tranche_facts')
        .select('amount_inr_expected, received_inr, due_fiscal_year, is_overdue, effective_due_date, status')
        .eq('organisation_id', organisationId),
      supabase.from('v_fr_remittance_facts')
        .select('amount_inr, received_fiscal_year')
        .eq('organisation_id', organisationId),
      supabase.from('v_fr_opportunity_facts')
        .select('geography, is_open, is_won, opportunity_type, expected_close_date')
        .eq('organisation_id', organisationId),
      supabase.from('fr_contacts')
        .select('id, full_name, designation, seniority, influence_role, relationship_rag')
        .eq('organisation_id', organisationId).is('deleted_at', null).order('full_name'),
      supabase.from('fr_org_account_plans').select('*').eq('organisation_id', organisationId).maybeSingle(),
      supabase.from('fr_org_csr_budgets').select('fiscal_year, budget_inr').eq('organisation_id', organisationId),
      loadHealthRules(),
    ])
    const firstError = grantsRes.error ?? tranchesRes.error ?? remitsRes.error ?? oppsRes.error
    if (firstError) { setError(firstError.message); return }

    const grants = ((grantsRes.data ?? []) as GrantRow[]).filter((g) => g.status !== 'cancelled')
    const tranches = (tranchesRes.data ?? []) as TrancheRow[]
    const remits = (remitsRes.data ?? []) as RemitRow[]
    const opps = (oppsRes.data ?? []) as OppRow[]
    const grantIds = grants.map((g) => g.id)

    // Programs and reporting rhythm hang off the grants, so they wait for them.
    const [allocRes, msRes] = grantIds.length
      ? await Promise.all([
          supabase.from('fr_grant_allocations').select('fr_programs(code)').in('grant_id', grantIds),
          supabase.from('fr_compliance_milestones').select('status, due_date, grant_id')
            .in('grant_id', grantIds).is('deleted_at', null),
        ])
      : [{ data: [] }, { data: [] }]
    const programs = uniq(((allocRes.data ?? []) as unknown as Array<{ fr_programs: { code: string } | null }>)
      .map((a) => a.fr_programs?.code))
    const milestones = (msRes.data ?? []) as MilestoneRow[]

    // Contacts without the new columns (SQL not yet run) still list, untagged.
    const contacts = contactsRes.error
      ? []
      : ((contactsRes.data ?? []) as PlanContact[])
    const planMissing = Boolean(planRes.error)
    const budgets: Record<string, number | null> = {}
    for (const b of (budgetsRes.data ?? []) as Array<{ fiscal_year: string; budget_inr: number | null }>) {
      budgets[b.fiscal_year] = b.budget_inr == null ? null : Number(b.budget_inr)
    }

    // ---- Fiscal years: the span of the relationship, capped at the last six.
    const current = fyStart(currentFiscalYear())
    const touched = [
      ...tranches.map((t) => t.due_fiscal_year),
      ...remits.map((r) => r.received_fiscal_year),
      ...Object.keys(budgets),
    ].filter((x): x is string => Boolean(x)).map(fyStart).filter((y) => y <= current + 1)
    const first = Math.max(touched.length ? Math.min(...touched) : current - 3, current - 5)
    const last = Math.max(touched.length ? Math.max(...touched) : current, current)
    let dueRun = 0
    let receivedRun = 0
    const years: FyRow[] = []
    for (let y = first; y <= last; y++) {
      const fy = fyLabel(y)
      const collected = sum(remits.filter((r) => r.received_fiscal_year === fy).map((r) => Number(r.amount_inr ?? 0)))
      const inYear = tranches.filter((t) => t.due_fiscal_year === fy && t.status !== 'cancelled')
      const due = sum(inYear.map((t) => Number(t.amount_inr_expected ?? 0)))
      const received = sum(inYear.map((t) => Number(t.received_inr ?? 0)))
      dueRun += due
      receivedRun += received
      const budget = budgets[fy] ?? null
      years.push({
        fy, label: `FY${String(y).slice(2)}`, budget, collected,
        share: budget ? Math.round((collected / budget) * 1000) / 10 : null,
        due, received,
        cumulativePct: dueRun ? Math.round((receivedRun / dueRun) * 1000) / 10 : null,
      })
    }

    // ---- Auto health, by the thresholds in Configuration → Health rules
    const today = new Date().toISOString().slice(0, 10)
    const daysFromNow = (d: string) => (new Date(d).getTime() - Date.now()) / 864e5
    const dueSoFar = tranches.filter((t) => t.status !== 'cancelled' && t.effective_due_date && t.effective_due_date <= today)
    const dueAmt = sum(dueSoFar.map((t) => Number(t.amount_inr_expected ?? 0)))
    const gotAmt = sum(dueSoFar.map((t) => Number(t.received_inr ?? 0)))
    const collectionRatio = dueAmt ? gotAmt / dueAmt : null
    const collection: Rag | null = collectionRatio == null ? null
      : collectionRatio * 100 >= rules.collection_green_pct ? 'green'
      : collectionRatio * 100 >= rules.collection_amber_pct ? 'amber' : 'red'

    const overdueMs = milestones.filter((m) => isEffectivelyOverdue(m.status, m.due_date) || m.status === 'overdue')
    const lateBeyondGrace = overdueMs.some((m) => !m.due_date || -daysFromNow(m.due_date) > rules.compliance_red_after_days)
    const soonMs = milestones.filter((m) => m.status === 'upcoming' && m.due_date && m.due_date >= today
      && daysFromNow(m.due_date) <= rules.compliance_amber_within_days)
    const compliance: Rag | null = milestones.length === 0 ? null
      : lateBeyondGrace ? 'red' : overdueMs.length || soonMs.length ? 'amber' : 'green'

    const openRenewal = opps.some((o) => o.is_open && (o.opportunity_type === 'renewal' || o.opportunity_type === 'upsell'))
    const endingSoon = grants.some((g) => g.end_date && g.end_date >= today
      && daysFromNow(g.end_date) <= rules.renewal_amber_within_days)
    const renewal: Rag | null = openRenewal ? 'green' : endingSoon ? 'amber' : null

    const ragContacts = contacts.map((c) => c.relationship_rag).filter(Boolean) as Rag[]
    const relationship: Rag | null = ragContacts.length === 0 ? null
      : rules.relationship_rule === 'majority' ? majority(ragContacts)
      : ragContacts.includes('red') ? 'red' : ragContacts.includes('amber') ? 'amber' : 'green'

    const starts = grants.map((g) => g.start_date ?? g.signed_date).filter(Boolean).sort() as string[]
    const ends = grants.map((g) => g.end_date).filter(Boolean).sort() as string[]
    const signed = grants.map((g) => g.signed_date ?? g.start_date).filter(Boolean).sort() as string[]
    const wonDates = opps.filter((o) => o.is_won).map((o) => o.expected_close_date).filter(Boolean).sort() as string[]

    setData({
      plan: planMissing ? null : toPlan(planRes.data as AccountPlan | null, organisationId),
      planMissing,
      budgets,
      contacts,
      years,
      header: {
        from: starts[0] ?? null,
        to: ends[ends.length - 1] ?? null,
        committed: sum(grants.map((g) => Number(g.total_value_inr ?? 0))),
        received: sum(grants.map((g) => Number(g.received_inr ?? 0))),
        programs,
        states: uniq(opps.filter((o) => o.is_won || o.is_open).map((o) => o.geography)),
        entities: uniq(grants.map((g) => g.bank_label)),
        partnerSince: [signed[0], wonDates[0]].filter(Boolean).sort()[0] ?? null,
      },
      auto: {
        collection, compliance, relationship, renewal,
        reportingCadence: cadenceFrom(milestones, grants),
        renewalCycle: renewalCycleFrom(grants),
      },
    })
  }, [organisationId])

  useEffect(() => { void load() }, [load])

  return { data, error, reload: load, setData }
}


import { supabase } from '../../lib/supabase'
import type { Stage } from '../../hooks/usePipelineStages'
import type { Opportunity } from './OpportunityForm'

export type StageMoveExtras = {
  lossReasonId?: string | null
  lossNote?: string | null
  nextStep?: string | null
  nextStepDate?: string | null
  note?: string | null
  /** Stage-gate answers, keyed by column, tagged with the record they live on. */
  fields?: Record<string, { on: 'opportunity' | 'organisation' | 'proposal'; value: string }>
}

/** Columns that must go to the database as numbers, not the strings a form gives. */
const NUMERIC_GATES = new Set(['amount'])

/** What the UI must collect before a move to `target` is allowed. */
export function stageMoveRequirement(target: Stage | undefined): 'loss' | 'next_step' | null {
  if (!target) return null
  if (target.terminal_type === 'lost') return 'loss'
  if (target.terminal_type === 'won') return null
  // Every open opportunity must carry a next step (PRD FR-22).
  return 'next_step'
}

/**
 * Moves an opportunity to a new stage and appends to the audit log.
 *
 * These are two writes rather than one transaction: PostgREST has no
 * multi-statement call, so a Postgres RPC would be needed for true atomicity.
 * The stage update is done FIRST and the history row second — if the second
 * fails the worst case is a missing audit entry, never a lost stage change or
 * a history row pointing at a move that did not happen. The caller is told
 * so it can surface a warning.
 */
export async function moveOpportunityStage({
  opportunity, toStage, employeeId, extras = {},
}: {
  opportunity: Opportunity
  toStage: Stage
  employeeId: string | null
  extras?: StageMoveExtras
}): Promise<{ opportunity: Opportunity; historyWritten: boolean; error?: string }> {
  const fromStageId = opportunity.stage_id

  const patch: Record<string, unknown> = {
    stage_id: toStage.id,
    probability_pct: toStage.probability_pct,
    updated_by: employeeId,
  }

  if (toStage.terminal_type === 'lost') {
    patch.loss_reason_id = extras.lossReasonId ?? null
    patch.loss_note = extras.lossNote?.trim() || null
    // A closed deal has no outstanding next step.
    patch.next_step = null
    patch.next_step_date = null
  } else {
    patch.loss_reason_id = null
    patch.loss_note = null
    if (extras.nextStep !== undefined) patch.next_step = extras.nextStep?.trim() || null
    if (extras.nextStepDate !== undefined) patch.next_step_date = extras.nextStepDate || null
  }
  if (toStage.terminal_type === 'won') {
    patch.next_step = null
    patch.next_step_date = null
  }

  // Gate answers for the deal itself ride along with the stage change, so a
  // move is one write rather than a save-then-move the user could half-finish.
  for (const [key, field] of Object.entries(extras.fields ?? {})) {
    if (field.on !== 'opportunity') continue
    const trimmed = field.value?.trim() ?? ''
    patch[key] = trimmed === '' ? null : NUMERIC_GATES.has(key) ? Number(trimmed) : trimmed
  }

  const { data, error } = await supabase
    .from('fr_opportunities')
    .update(patch)
    .eq('id', opportunity.id)
    .select()
    .single()

  if (error) return { opportunity, historyWritten: false, error: error.message }

  const moved = data as Opportunity

  // Company type lives on the donor, not the deal — the gate collects it here
  // because that is where someone notices it is missing.
  const orgField = extras.fields?.donor_type
  if (orgField?.on === 'organisation' && orgField.value?.trim() && moved.organisation_id) {
    await supabase
      .from('fr_organisations')
      .update({ donor_type: orgField.value.trim(), updated_by: employeeId })
      .eq('id', moved.organisation_id)
  }

  // The proposal gate records the link if no proposal exists yet; an existing
  // one is left alone, since the Proposals tab owns versioning.
  const proposalField = extras.fields?.document_url
  if (proposalField?.on === 'proposal' && proposalField.value?.trim()) {
    const { data: existing } = await supabase
      .from('fr_proposals')
      .select('id')
      .eq('opportunity_id', opportunity.id)
      .is('deleted_at', null)
      .limit(1)
    if (!existing || existing.length === 0) {
      await supabase.from('fr_proposals').insert({
        opportunity_id: opportunity.id,
        version: 1,
        title: `${opportunity.name} proposal`,
        document_url: proposalField.value.trim(),
        status: 'sent',
        created_by: employeeId,
      })
    }
  }

  const { error: histError } = await supabase.from('fr_opportunity_stage_history').insert({
    opportunity_id: opportunity.id,
    from_stage_id: fromStageId,
    to_stage_id: toStage.id,
    changed_by: employeeId,
    note: extras.note?.trim() || null,
  })

  return {
    opportunity: moved,
    historyWritten: !histError,
  }
}

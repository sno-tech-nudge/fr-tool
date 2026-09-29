import { CAPITAL_CATEGORIES, DEAL_CATEGORIES, DONOR_TYPES, type Option } from '../../lib/enums'
import type { Stage } from '../../hooks/usePipelineStages'

/**
 * The minimum a deal must carry to sit at each stage.
 *
 * Requirements are CUMULATIVE by stage order: moving straight from Target to
 * MoU negotiation asks for everything the four stages in between would have
 * asked for, because skipping a stage should not skip its evidence.
 *
 * Closing lost is exempt. A deal dies with whatever was known about it, and
 * demanding an amount and a receiving entity before someone can record a loss
 * is how deals quietly stay open forever instead.
 */

export type GateTarget = 'opportunity' | 'organisation' | 'proposal'

export type GateField = {
  /** Column name on whichever record `on` points at. */
  key: string
  label: string
  /** Stage key from which this is mandatory. */
  requiredAt: string
  on: GateTarget
  type: 'text' | 'number' | 'date' | 'select' | 'employee' | 'bank_account'
  options?: Option[]
  help?: string
}

export const GATE_FIELDS: GateField[] = [
  {
    key: 'deal_category',
    label: 'Deal type',
    requiredAt: 'target',
    on: 'opportunity',
    type: 'select',
    options: DEAL_CATEGORIES,
  },
  {
    key: 'donor_type',
    label: 'Company type',
    requiredAt: 'target',
    on: 'organisation',
    type: 'select',
    options: DONOR_TYPES,
    help: 'Held on the organisation, so setting it here updates the donor record.',
  },
  {
    key: 'capital_category',
    label: 'Donation type',
    requiredAt: 'qualified',
    on: 'opportunity',
    type: 'select',
    options: CAPITAL_CATEGORIES,
  },
  {
    key: 'bank_account_id',
    label: 'Receiving entity',
    requiredAt: 'qualified',
    on: 'opportunity',
    type: 'bank_account',
  },
  {
    key: 'amount',
    label: 'Amount',
    requiredAt: 'qualified',
    on: 'opportunity',
    type: 'number',
  },
  {
    key: 'currency',
    label: 'Currency',
    requiredAt: 'qualified',
    on: 'opportunity',
    type: 'text',
  },
  {
    key: 'expected_close_date',
    label: 'Expected close date',
    requiredAt: 'qualified',
    on: 'opportunity',
    type: 'date',
    help: 'Fiscal year and closure quarter are derived from this.',
  },
  {
    key: 'pre_sales_rep_user_id',
    label: 'Pre-sales rep',
    requiredAt: 'proposal_in_progress',
    on: 'opportunity',
    type: 'employee',
  },
  {
    key: 'document_url',
    label: 'Proposal link',
    requiredAt: 'proposal_sent',
    on: 'proposal',
    type: 'text',
    help: 'Drive link to the proposal. Files themselves attach on the Proposals tab.',
  },
]

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/**
 * Every field that applies at `toStage`, in stage order, each marked with
 * whether the record already satisfies it.
 *
 * Fields already answered are returned too, not filtered out — the dialog
 * shows them filled in so a complete deal is one click, and so a wrong value
 * can be corrected on the way past.
 */
export function gateFieldsFor(
  toStage: Stage,
  stages: Stage[],
  values: Record<string, unknown>,
): Array<GateField & { satisfied: boolean }> {
  if (toStage.terminal_type === 'lost') return []

  const orderOf = (key: string) => stages.find((s) => s.key === key)?.sort_order ?? Infinity

  return GATE_FIELDS
    .filter((f) => orderOf(f.requiredAt) <= toStage.sort_order)
    .sort((a, b) => orderOf(a.requiredAt) - orderOf(b.requiredAt))
    .map((f) => ({ ...f, satisfied: !isBlank(values[f.key]) }))
}

/**
 * Declarative specs for the reusable admin PicklistEditor.
 *
 * Every FR enum lives in a TABLE, not a Postgres enum, so an FR manager can
 * edit reference data without a migration (PRD FR-63). Adding a new picklist
 * screen should mean adding a spec here — nothing else.
 */

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'color' | 'date' | 'tags' | 'fk' | 'json'

export type FieldSpec = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  /** Options for type 'select'. */
  options?: Array<{ value: string; label: string }>
  /** Lookup config for type 'fk'. */
  fk?: { table: string; valueKey: string; labelKeys: string[] }
  /** Natural keys must not be edited after creation — they are resolution keys. */
  immutable?: boolean
  help?: string
  width?: string
  /** Hide from the table but keep in the add/edit form. */
  hideInTable?: boolean
}

export type PicklistSpec = {
  /** URL segment, e.g. /admin/pipeline-stages */
  slug: string
  table: string
  title: string
  description?: string
  /** Shown in the admin tab strip. */
  tab: string
  orderBy: Array<{ column: string; ascending?: boolean }>
  fields: FieldSpec[]
  /** Reference rows the module depends on — block delete, allow deactivate. */
  deleteProtected?: boolean
}

const ACTIVE: FieldSpec = { key: 'is_active', label: 'Active', type: 'boolean' }
const SORT: FieldSpec = { key: 'sort_order', label: 'Order', type: 'number', width: '80px' }

const CAPITAL_CATEGORY_OPTIONS = [
  { value: 'programmatic', label: 'Programmatic' },
  { value: 'unrestricted', label: 'Unrestricted' },
  { value: 'corpus', label: 'Corpus' },
]

export const PICKLIST_SPECS: PicklistSpec[] = [
  {
    slug: 'pipeline-stages',
    table: 'fr_pipeline_stages',
    tab: 'Pipeline stages',
    title: 'Pipeline stages',
    description:
      'The 10 stages of the pipeline. Probability drives the weighted pipeline, so changing it changes every forecast.',
    orderBy: [{ column: 'sort_order' }],
    deleteProtected: true,
    fields: [
      SORT,
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      { key: 'probability_pct', label: 'Win %', type: 'number', required: true, width: '90px' },
      {
        key: 'terminal_type', label: 'Terminal', type: 'select', width: '120px',
        options: [
          { value: '', label: '—' },
          { value: 'won', label: 'Won' },
          { value: 'lost', label: 'Lost' },
        ],
      },
      { key: 'color', label: 'Colour', type: 'color', width: '100px' },
      ACTIVE,
    ],
  },
  {
    slug: 'programs',
    table: 'fr_programs',
    tab: 'Programs',
    title: 'Programs',
    description: 'EUP is the legacy name for EIP — never add an EUP row, map it to EIP.',
    orderBy: [{ column: 'sort_order' }],
    deleteProtected: true,
    fields: [
      SORT,
      { key: 'code', label: 'Code', type: 'text', required: true, immutable: true, help: 'Resolution key — cannot change later.' },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea', hideInTable: true },
      {
        key: 'status', label: 'Status', type: 'select', required: true, width: '120px',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'paused', label: 'Paused' },
          { value: 'closed', label: 'Closed' },
        ],
      },
      ACTIVE,
    ],
  },
  {
    slug: 'projects',
    table: 'fr_projects',
    tab: 'Projects',
    title: 'Projects',
    description: 'Sub-projects under a program. Codes are resolution keys and must be unique within their program.',
    orderBy: [{ column: 'code' }],
    fields: [
      {
        key: 'program_id', label: 'Program', type: 'fk', required: true,
        fk: { table: 'fr_programs', valueKey: 'id', labelKeys: ['code', 'name'] },
      },
      { key: 'code', label: 'Code', type: 'text', required: true, immutable: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'geography', label: 'Geography', type: 'text' },
      ACTIVE,
    ],
  },
  {
    slug: 'capital-categories',
    table: 'fr_capital_categories',
    tab: 'Capital categories',
    title: 'Capital categories',
    description: 'The colour of money. Fixed set of three — labels are editable, keys are not.',
    orderBy: [{ column: 'sort_order' }],
    deleteProtected: true,
    fields: [
      SORT,
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      ACTIVE,
    ],
  },
  {
    slug: 'bank-accounts',
    table: 'fr_bank_accounts',
    tab: 'Bank accounts',
    title: 'Receiving entities',
    description:
      'Only TNF and NLF FCRA are FCRA-designated. A foreign grant must route to an FCRA account and domestic money to a domestic one — a database trigger rejects mismatches.',
    orderBy: [{ column: 'sort_order' }],
    deleteProtected: true,
    fields: [
      SORT,
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      { key: 'full_name', label: 'Legal name', type: 'text' },
      { key: 'is_fcra', label: 'FCRA', type: 'boolean', width: '90px' },
      { key: 'allowed_categories', label: 'Allowed categories', type: 'tags', hideInTable: true },
      ACTIVE,
    ],
  },
  {
    slug: 'currencies',
    table: 'fr_currencies',
    tab: 'Currencies',
    title: 'Currencies',
    orderBy: [{ column: 'sort_order' }],
    deleteProtected: true,
    fields: [
      SORT,
      { key: 'code', label: 'Code', type: 'text', required: true, immutable: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'symbol', label: 'Symbol', type: 'text', width: '90px' },
      ACTIVE,
    ],
  },
  {
    slug: 'fx-rates',
    table: 'fr_fx_rates',
    tab: 'FX rates',
    title: 'FX rates',
    description:
      'Rate is INR per 1 unit of the currency. Seeded statically — there is no auto-fetch. Only USD is confirmed; the rest need finance sign-off.',
    orderBy: [{ column: 'rate_date', ascending: false }, { column: 'currency_code' }],
    fields: [
      { key: 'rate_date', label: 'Date', type: 'date', required: true },
      {
        key: 'currency_code', label: 'Currency', type: 'fk', required: true,
        fk: { table: 'fr_currencies', valueKey: 'code', labelKeys: ['code', 'name'] },
      },
      { key: 'rate_to_inr', label: 'INR per unit', type: 'number', required: true },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'is_manual_override', label: 'Manual', type: 'boolean', width: '90px' },
    ],
  },
  {
    slug: 'lead-sources',
    table: 'fr_lead_sources',
    tab: 'Lead sources',
    title: 'Lead sources',
    orderBy: [{ column: 'sort_order' }],
    fields: [
      SORT,
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      ACTIVE,
    ],
  },
  {
    slug: 'loss-reasons',
    table: 'fr_loss_reasons',
    tab: 'Loss reasons',
    title: 'Loss reasons',
    description: 'A loss reason is mandatory when an opportunity moves to Closed Lost.',
    orderBy: [{ column: 'sort_order' }],
    fields: [
      SORT,
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      ACTIVE,
    ],
  },
  {
    slug: 'milestone-types',
    table: 'fr_milestone_types',
    tab: 'Milestone types',
    title: 'Compliance milestone types',
    orderBy: [{ column: 'sort_order' }],
    deleteProtected: true,
    fields: [
      SORT,
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      {
        key: 'applicable_categories', label: 'Applies to', type: 'tags',
        help: 'Which capital categories this obligation applies to.',
      },
      ACTIVE,
    ],
  },
  {
    slug: 'milestone-templates',
    table: 'fr_milestone_templates',
    tab: 'Milestone templates',
    title: 'Milestone templates',
    description:
      'Default reporting schedules per capital category. The Won-Wizard uses these to suggest milestones when a grant is created.',
    orderBy: [{ column: 'capital_category' }, { column: 'name' }],
    fields: [
      {
        key: 'capital_category', label: 'Category', type: 'select', required: true,
        options: CAPITAL_CATEGORY_OPTIONS,
      },
      { key: 'name', label: 'Name', type: 'text', required: true },
      {
        key: 'milestone_type_id', label: 'Type', type: 'fk',
        fk: { table: 'fr_milestone_types', valueKey: 'id', labelKeys: ['label'] },
      },
      {
        key: 'recurrence', label: 'Recurrence', type: 'select', required: true,
        options: [
          { value: 'once', label: 'Once' },
          { value: 'quarterly', label: 'Quarterly' },
          { value: 'half_yearly', label: 'Half yearly' },
          { value: 'annually', label: 'Annually' },
        ],
      },
      {
        key: 'offset_months', label: 'Offset (months)', type: 'number', width: '130px',
        help: 'Due date = grant start date + this many months, then recurs.',
      },
      ACTIVE,
    ],
  },
  {
    slug: 'settings',
    table: 'fr_settings',
    tab: 'Settings',
    title: 'Module settings',
    description: 'Values are JSON. Thresholds here drive staleness flags, reminders and renewal auto-creation.',
    orderBy: [{ column: 'key' }],
    fields: [
      { key: 'key', label: 'Key', type: 'text', required: true, immutable: true },
      { key: 'value', label: 'Value', type: 'json', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
]

export function specBySlug(slug: string): PicklistSpec | undefined {
  return PICKLIST_SPECS.find((s) => s.slug === slug)
}

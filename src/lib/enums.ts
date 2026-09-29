/**
 * Option lists for columns that are plain CHECK-constrained text rather than
 * their own picklist table. Anything with an fr_* table behind it (stages,
 * programs, lead sources, loss reasons, bank accounts…) is loaded from the DB
 * instead, so an admin can change it without a deploy.
 */

export type Option = { value: string; label: string }

export const DONOR_TYPES: Option[] = [
  { value: 'corporate', label: 'Corporate' },
  { value: 'indian_foundation', label: 'Indian foundation' },
  { value: 'global_foundation', label: 'Global foundation' },
  { value: 'family_office', label: 'Family office' },
  { value: 'individual_account', label: 'Individual' },
  { value: 'government', label: 'Government' },
  { value: 'psu', label: 'PSU' },
  { value: 'other', label: 'Other' },
]

export const RELATIONSHIP_STATUSES: Option[] = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'in_conversation', label: 'In conversation' },
  { value: 'active_partner', label: 'Active partner' },
  { value: 'past_partner', label: 'Past partner' },
  { value: 'dormant', label: 'Dormant' },
]

export const SENIORITIES: Option[] = [
  { value: 'cxo', label: 'CXO' },
  { value: 'senior_leadership', label: 'Senior leadership' },
  { value: 'manager', label: 'Manager' },
  { value: 'csr_team', label: 'CSR team' },
  { value: 'trustee', label: 'Trustee' },
  { value: 'program_officer', label: 'Program officer' },
  { value: 'other', label: 'Other' },
]

export const LEAD_STATUSES: Option[] = [
  { value: 'new', label: 'New' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'qualified_converted', label: 'Converted' },
  { value: 'rejected', label: 'Rejected' },
]

/** IA 3.1 — required when a lead is rejected. */
export const LEAD_REJECTION_REASONS: Option[] = [
  { value: 'not_a_fit', label: 'Not a fit' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'insufficient_info', label: 'Insufficient info' },
  { value: 'other', label: 'Other' },
]

export const ACTIVITY_TYPES: Option[] = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'note', label: 'Note' },
  { value: 'task', label: 'Task' },
]

export type ActivityParentType = 'organisation' | 'contact' | 'opportunity' | 'grant' | 'lead'

export function labelOf(options: Option[], value: string | null | undefined): string {
  if (!value) return '—'
  return options.find((o) => o.value === value)?.label ?? value
}

/** Relationship status -> badge tone. Reserved RAG colours are not used here. */
export function relationshipTone(status: string | null | undefined) {
  switch (status) {
    case 'active_partner': return 'green' as const
    case 'in_conversation': return 'brown' as const
    case 'dormant':
    case 'past_partner': return 'outline' as const
    default: return 'outline' as const
  }
}

/**
 * Mirrors the generated column fr_organisations.normalized_name
 * (lowercased, alphanumeric only). Used client-side for duplicate warnings —
 * the DB column stays the source of truth.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/* ---------- opportunity / pipeline ---------- */

export const CAPITAL_CATEGORIES: Option[] = [
  { value: 'programmatic', label: 'Programmatic' },
  { value: 'unrestricted', label: 'Unrestricted' },
  { value: 'corpus', label: 'Corpus' },
]

export const OPPORTUNITY_TYPES: Option[] = [
  { value: 'new', label: 'New' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'upsell', label: 'Upsell' },
]

/** New Business Development vs Partner Management — a primary list filter. */
export const DEAL_CATEGORIES: Option[] = [
  { value: 'NBD', label: 'NBD' },
  { value: 'PM', label: 'PM' },
]

/** Provenance of a migrated record; null means entered by hand. */
export const SOURCE_DETAILS: Option[] = [
  { value: 'sheet', label: 'Sheet' },
  { value: 'zoho', label: 'Zoho' },
]

export const PROPOSAL_TYPES: Option[] = [
  { value: 'concept_note', label: 'Concept note' },
  { value: 'full_proposal', label: 'Full proposal' },
  { value: 'budget', label: 'Budget' },
  { value: 'pitch_deck', label: 'Pitch deck' },
  { value: 'other', label: 'Other' },
]

export const PROPOSAL_STATUSES: Option[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'revised', label: 'Revised' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
]

/* ---------- grants / money (phase 3) ---------- */

export const GRANT_STATUSES: Option[] = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'terminated', label: 'Terminated' },
]

/** The four real tranche states — the PRD's seven were never used. */
export const TRANCHE_STATUSES: Option[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'received', label: 'Received' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const TRANCHE_TRIGGERS: Option[] = [
  { value: 'date_based', label: 'Date based' },
  { value: 'milestone_based', label: 'Milestone based' },
]

export const RECEIPT_TYPES: Option[] = [
  { value: '80g', label: '80G' },
  { value: 'gst', label: 'GST' },
  { value: 'us_tax_receipt', label: 'US tax receipt' },
  { value: 'other', label: 'Other' },
]

export const REPORTING_FREQUENCIES: Option[] = [
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half yearly' },
  { value: 'bi_annually', label: 'Bi-annually' },
  { value: 'annually', label: 'Annually' },
  { value: 'ad_hoc', label: 'Ad hoc' },
]

export const REPORT_TYPES: Option[] = [
  { value: 'standard_mou_report', label: 'Standard MoU report' },
  { value: 'financial_uc', label: 'Financial UC' },
  { value: 'program_completion_report', label: 'Program completion report' },
  { value: 'other', label: 'Other' },
]

/**
 * `overdue` is stored only when a submission genuinely lapsed; the common case
 * is an `upcoming` milestone whose due date has passed, which is computed at
 * display time (see isEffectivelyOverdue) and never written back.
 */
export const MILESTONE_STATUSES: Option[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'overdue', label: 'Overdue' },
]

export function trancheTone(status: string | null | undefined) {
  switch (status) {
    case 'received': return 'green' as const
    case 'delayed': return 'red' as const
    case 'cancelled': return 'outline' as const
    default: return 'brown' as const
  }
}

export function grantStatusTone(status: string | null | undefined) {
  switch (status) {
    case 'active': return 'green' as const
    case 'completed': return 'brown' as const
    case 'terminated': return 'red' as const
    default: return 'outline' as const
  }
}

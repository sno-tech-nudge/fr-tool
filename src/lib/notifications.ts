/**
 * Notification vocabulary, shared by the settings screen and the home rail.
 *
 * Two separate ideas live here and are easy to confuse:
 *  - ESCALATION recipients are roles on a deal, configured once for everybody
 *    by an admin. They decide who gets chased when a deal stops moving.
 *  - CATEGORIES are what an individual can switch on or off for themselves,
 *    per channel.
 */

/** Who an overdue stage escalates to, from the FR team's escalation matrix. */
export const ESCALATION_RECIPIENTS = [
  { value: 'fr_owner', label: 'FR owner' },
  { value: 'fr_lead', label: 'FR lead' },
  { value: 'pre_sales_rep', label: 'Pre-sales rep' },
  { value: 'cdo', label: 'CDO' },
] as const

export type EscalationRecipient = typeof ESCALATION_RECIPIENTS[number]['value']

export const recipientLabel = (value: string) =>
  ESCALATION_RECIPIENTS.find((r) => r.value === value)?.label ?? value

export type NotificationCategory = {
  key: string
  label: string
  description: string
  /** False while the thing that would raise it does not exist yet. */
  live: boolean
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    key: 'stage_nudge',
    label: 'Deals needing an update',
    description: 'A deal of mine has sat at one stage past its amber or red threshold.',
    live: true,
  },
  {
    key: 'tranche_due',
    label: 'Instalments due',
    description: 'Money expected on a grant I own, before and after the due date.',
    live: true,
  },
  {
    key: 'report_due',
    label: 'Reports and compliance',
    description: 'Utilisation certificates, narrative reports and audits I owe.',
    live: true,
  },
  {
    key: 'task_due',
    label: 'Tasks assigned to me',
    description: 'Tasks logged against any record with my name on them.',
    live: true,
  },
  {
    key: 'signal',
    label: 'Prospect and partner news',
    description: 'Companies growing their CSR spend, renewal windows, upsell openings.',
    live: false,
  },
  {
    key: 'digest',
    label: 'Weekly digest',
    description: 'One summary of everything above, Monday morning.',
    live: true,
  },
]

export const CHANNELS = [
  { key: 'in_app', label: 'In app' },
  { key: 'email', label: 'Email' },
  { key: 'slack', label: 'Slack' },
] as const

export type Channel = typeof CHANNELS[number]['key']

/** Only the in-app channel has anywhere to deliver to today. */
export const CHANNEL_LIVE: Record<Channel, boolean> = {
  in_app: true,
  email: false,
  slack: false,
}

export function severityTone(severity: string | null): 'red' | 'amber' | 'outline' {
  if (severity === 'red') return 'red'
  if (severity === 'amber') return 'amber'
  return 'outline'
}

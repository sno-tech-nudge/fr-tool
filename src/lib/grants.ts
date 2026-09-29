/**
 * Derived grant values. None of these are stored columns: received-to-date is
 * summed from remittances, and "overdue" is a display state computed against
 * today's date — writing it back to a status column would make the record lie
 * the moment the clock moved.
 */

/** Local-midnight today, so date-only comparisons don't slip a day on UTC. */
function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from today until `date` — negative once it is in the past. */
export function daysUntil(date: string | null | undefined): number | null {
  const d = asDate(date)
  if (!d) return null
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today().getTime()) / 86_400_000)
}

/**
 * A milestone the team still owes, past its due date. Stored `overdue` counts
 * too; `submitted`/`accepted` never do, however late they were.
 */
export function isEffectivelyOverdue(
  status: string | null | undefined,
  dueDate: string | null | undefined,
): boolean {
  if (status === 'overdue') return true
  if (status !== 'upcoming' && status !== 'in_progress') return false
  const d = daysUntil(dueDate)
  return d !== null && d < 0
}

/** Same idea for money: a tranche is late if it is unpaid and past due. */
export function isTrancheOverdue(
  status: string | null | undefined,
  dueDate: string | null | undefined,
): boolean {
  if (status === 'received' || status === 'cancelled') return false
  const d = daysUntil(dueDate)
  return d !== null && d < 0
}

/**
 * Grant health, per the daily-recompute rule in IA §8. Computed here rather
 * than read from `fr_grants.health` so the badge is right even though no
 * nightly job exists yet — the stored column stays for the dashboards to
 * aggregate on later.
 */
export function computeHealth(
  items: Array<{ status: string | null; due_date: string | null }>,
): 'green' | 'amber' | 'red' {
  let amber = false
  for (const it of items) {
    const overdueBy = isTrancheOverdue(it.status, it.due_date)
      || isEffectivelyOverdue(it.status, it.due_date)
    if (overdueBy) {
      const d = daysUntil(it.due_date)
      if (d !== null && d < -15) return 'red'
      amber = true
      continue
    }
    const d = daysUntil(it.due_date)
    if (d !== null && d >= 0 && d <= 7) amber = true
  }
  return amber ? 'amber' : 'green'
}

/** Received ÷ committed, clamped to a sane percentage for progress bars. */
export function collectionPct(receivedInr: number, committedInr: number): number {
  if (!committedInr) return 0
  return Math.max(0, Math.min(100, (receivedInr / committedInr) * 100))
}

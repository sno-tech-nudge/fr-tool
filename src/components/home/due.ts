import { formatDate, toISODate } from '../../lib/format'
import { daysUntil } from '../../lib/grants'

/** How late or how soon, as a badge — shared so every card words it alike. */
export function dueBadge(date: string | null): { tone: 'red' | 'amber' | 'outline'; label: string } {
  const days = daysUntil(date)
  if (days === null) return { tone: 'outline', label: 'No date' }
  if (days < 0) return { tone: 'red', label: days === -1 ? '1 day late' : `${Math.abs(days)} days late` }
  if (days === 0) return { tone: 'amber', label: 'Today' }
  return { tone: 'outline', label: formatDate(date) }
}

export function daysFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

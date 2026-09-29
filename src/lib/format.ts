// Indian money + date formatting. Always pair rendered numbers with the
// .tn-num class so they use tabular numerals.

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const CRORE = 10_000_000
const LAKH = 100_000

/** Full Indian grouping: 12345678 -> "₹1,23,45,678" */
export function formatINR(value: number | null | undefined): string {
  if (value == null) return '—'
  return `₹${inr.format(value)}`
}

/** Crore, 2dp: 12345678 -> "₹1.23 Cr" */
export function formatCrore(value: number | null | undefined): string {
  if (value == null) return '—'
  return `₹${inr2.format(value / CRORE)} Cr`
}

/**
 * The default for dashboards and lists: crore above a crore, lakh above a
 * lakh, plain rupees below that.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value == null) return '—'
  const abs = Math.abs(value)
  if (abs >= CRORE) return `₹${inr2.format(value / CRORE)} Cr`
  if (abs >= LAKH) return `₹${inr2.format(value / LAKH)} L`
  return `₹${inr.format(value)}`
}

/** Non-INR amounts keep their own currency code alongside the number. */
export function formatAmount(value: number | null | undefined, currency = 'INR'): string {
  if (value == null) return '—'
  if (currency === 'INR') return formatMoney(value)
  return `${currency} ${inr2.format(value)}`
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${value}%`
}

/** Stored UTC, displayed IST. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  })
}

/** For <input type="date"> values. */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/**
 * A Date's own calendar day as `YYYY-MM-DD`, for writing to a `date` column.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first,
 * so in IST (UTC+5:30) a locally-constructed midnight — 1 Oct, say — is
 * written back as 30 Sept. Reading the local components avoids the shift.
 */
export function toISODate(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

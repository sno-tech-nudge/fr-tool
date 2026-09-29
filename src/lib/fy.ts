// Indian fiscal year: April -> March. Mirrors the DB helpers fr_fiscal_year()
// and fr_fiscal_quarter() exactly. The DB remains the source of truth for
// stored values; these are for client-side display and filter options.

/** 2026-09-15 -> "FY 2026-27"   |   2027-02-10 -> "FY 2026-27" */
export function fiscalYear(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1 // getMonth() is 0-based; 3 = April
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** Apr-Jun Q1, Jul-Sep Q2, Oct-Dec Q3, Jan-Mar Q4 */
export function fiscalQuarter(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return null
  return `Q${Math.floor((((d.getMonth() + 1 - 4) + 12) % 12) / 3) + 1}`
}

export function currentFiscalYear(): string {
  return fiscalYear(new Date())!
}

/** Descending list of FY labels for filter dropdowns. */
export function fiscalYearOptions(back = 6, forward = 1): string[] {
  const now = new Date()
  const currentStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const out: string[] = []
  for (let y = currentStart + forward; y >= currentStart - back; y--) {
    out.push(`FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`)
  }
  return out
}

/** "FY 2026-27" -> "FY26", for compact pill filters with many years on show. */
export function shortFyLabel(label: string): string {
  const m = /^FY (\d{4})-\d{2}$/.exec(label)
  return m ? `FY${m[1].slice(2)}` : label
}

/**
 * Inclusive date bounds for an FY label, for range filters on columns that
 * store a plain date rather than a derived fiscal_year (grants.signed_date,
 * remittances.received_date). "FY 2026-27" -> 2026-04-01 … 2027-03-31.
 */
export function fiscalYearRange(label: string): { from: string; to: string } | null {
  const m = /^FY (\d{4})-\d{2}$/.exec(label)
  if (!m) return null
  const start = Number(m[1])
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` }
}

/**
 * Several FYs can be picked at once; the URL carries them comma-separated so a
 * filtered view stays shareable. FY labels never contain a comma.
 */
export function parseFyList(value: string | null | undefined): string[] {
  return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : []
}

export function joinFyList(list: string[]): string {
  return list.join(',')
}

import { supabase } from './supabase'

/**
 * INR-per-unit rate for a currency on a given day: the newest rate on or
 * before that date, so a receipt from March is valued at a March rate.
 * Falls back to the earliest rate on file when the date predates them all.
 * Returns 1 for INR, or null if the currency has no rate on file.
 */
export async function rateToInrOn(currency: string, date: string | null): Promise<number | null> {
  if (!currency || currency === 'INR') return 1
  const pick = (q: ReturnType<typeof base>) => q.limit(1).maybeSingle()
  const base = () => supabase.from('fr_fx_rates').select('rate_to_inr').eq('currency_code', currency)
  const onOrBefore = date
    ? await pick(base().lte('rate_date', date).order('rate_date', { ascending: false }))
    : await pick(base().order('rate_date', { ascending: false }))
  const row = onOrBefore.data ?? (await pick(base().order('rate_date', { ascending: true }))).data
  return row ? Number((row as { rate_to_inr: number }).rate_to_inr) : null
}

/** Latest rate on file, for pipeline values that have no date of their own. */
export function latestRateToInr(currency: string): Promise<number | null> {
  return rateToInrOn(currency, null)
}

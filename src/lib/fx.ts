import { supabase } from './supabase'

/**
 * Latest INR-per-unit rate for a currency. Rates are static seeds (no
 * auto-fetch), so the newest row on or before today wins.
 * Returns 1 for INR, or null if the currency has no rate on file.
 */
export async function latestRateToInr(currency: string): Promise<number | null> {
  if (!currency || currency === 'INR') return 1
  const { data } = await supabase
    .from('fr_fx_rates')
    .select('rate_to_inr')
    .eq('currency_code', currency)
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? Number((data as { rate_to_inr: number }).rate_to_inr) : null
}

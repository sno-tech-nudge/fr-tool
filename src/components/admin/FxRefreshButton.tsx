import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, useToast } from '../ui'

// Free, open-source daily rates (github.com/fawazahmed0/exchange-api), no key.
// Second URL is the project's own mirror, used if the CDN is down.
const SOURCES = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/inr.json',
  'https://latest.currency-api.pages.dev/v1/currencies/inr.json',
]

type Feed = { date: string; inr: Record<string, number> }

async function fetchFeed(): Promise<Feed> {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) return (await res.json()) as Feed
    } catch { /* try the next one */ }
  }
  throw new Error('Could not reach the rates service.')
}

/** Adds today's INR-per-unit rate for every active currency. Older rates stay. */
export function FxRefreshButton({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setBusy(true)
    try {
      const { data: currencies, error } = await supabase
        .from('fr_currencies').select('code').eq('is_active', true).neq('code', 'INR')
      if (error) throw new Error(error.message)
      const feed = await fetchFeed()

      // A rate someone set by hand for that day is kept.
      const { data: manual } = await supabase
        .from('fr_fx_rates').select('currency_code')
        .eq('rate_date', feed.date).eq('is_manual_override', true)
      const keep = new Set((manual ?? []).map((r) => String(r.currency_code).trim()))

      const missing: string[] = []
      const rows = (currencies ?? []).flatMap(({ code }) => {
        const c = String(code).trim()
        if (keep.has(c)) return []
        const perInr = feed.inr[c.toLowerCase()]
        if (!perInr) { missing.push(c); return [] }
        return [{
          rate_date: feed.date, currency_code: c,
          rate_to_inr: Math.round((1 / perInr) * 1e6) / 1e6,
          source: 'currency-api', is_manual_override: false,
        }]
      })

      if (rows.length) {
        const { error: upErr } = await supabase
          .from('fr_fx_rates').upsert(rows, { onConflict: 'rate_date,currency_code' }).select()
        if (upErr) throw new Error(upErr.message)
      }
      onDone()
      toast.success(`${rows.length} rate${rows.length === 1 ? '' : 's'} updated for ${feed.date}.`)
      if (missing.length) toast.error(`No rate found for ${missing.join(', ')}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not refresh rates.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" iconLeft={<RefreshCw size={15} />} disabled={busy} onClick={() => void refresh()}>
      {busy ? 'Refreshing…' : 'Refresh rates'}
    </Button>
  )
}

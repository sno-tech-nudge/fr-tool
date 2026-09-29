import { supabase } from './supabase'

export type NewsItem = {
  id: string
  organisation_id: string
  org_name?: string | null
  title: string
  url: string
  source: string | null
  published_at: string | null
  category: string | null
  why: string | null
}

export type NewsRun = {
  checked: number
  /** Stale orgs left over after the per-call cap — press again for the rest. */
  remaining: number
  found: number
  kept: number
  failed?: number
  /** Orgs whose news search itself failed (e.g. the source blocked us). */
  unreachable?: number
  fetch_error?: string | null
}

export const NEWS_CATEGORY: Record<string, string> = {
  csr_budget: 'CSR budget',
  csr_focus: 'CSR focus',
  financial_growth: 'Growth',
  csr_leadership: 'CSR leadership',
  grant_call: 'Grant call',
  ngo_partnership: 'NGO partnership',
  reputation_risk: 'Risk',
  other: 'Other',
}

/** supabase-js buries the function's own message inside a Response. */
async function reason(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try { const b = await ctx.json() as { error?: string }; if (b?.error) return b.error } catch { /* not JSON */ }
  }
  return error instanceof Error ? error.message : 'The news service could not be reached.'
}

export async function refreshNews(
  mode: 'mine' | 'org' | 'all', organisationId?: string,
): Promise<NewsRun> {
  const { data, error } = await supabase.functions.invoke('fr-news', {
    body: { mode, organisation_id: organisationId },
  })
  if (error) throw new Error(await reason(error))
  return data as NewsRun
}

/**
 * The home Refresh: the function handles 40 orgs per call, so keep calling
 * until nothing stale is left. Stops early if a call makes no progress.
 * `onBatch` fires after each call with the running totals.
 */
export async function refreshAllNews(
  onBatch?: (total: NewsRun) => void, mode: 'mine' | 'all' = 'mine',
): Promise<NewsRun> {
  const total: NewsRun = { checked: 0, remaining: 0, found: 0, kept: 0, failed: 0, unreachable: 0, fetch_error: null }
  for (let i = 0; i < 25; i++) {
    const r = await refreshNews(mode)
    total.checked += r.checked
    total.found += r.found
    total.kept += r.kept
    total.failed = (total.failed ?? 0) + (r.failed ?? 0)
    total.unreachable = (total.unreachable ?? 0) + (r.unreachable ?? 0)
    total.fetch_error = r.fetch_error ?? total.fetch_error
    total.remaining = r.remaining
    onBatch?.(total)
    if (r.remaining === 0 || r.checked === 0 || runFailed(r)) break
  }
  return total
}

/** One sentence for a toast, so every refresh button reports alike. */
export function describeRun(r: NewsRun): string {
  if (r.checked === 0) return 'Already up to date — checked in the last 6 hours.'
  if (r.unreachable && r.unreachable === r.checked) {
    return `Could not search news for any of them: ${r.fetch_error ?? 'the news sources did not answer'}.`
  }
  const base = `Checked ${r.checked} ${r.checked === 1 ? 'organisation' : 'organisations'}: `
    + `${r.found} new ${r.found === 1 ? 'headline' : 'headlines'}, ${r.kept} worth keeping.`
  const blocked = r.unreachable ? ` ${r.unreachable} could not be searched and will be retried.` : ''
  return r.remaining > 0 ? `${base}${blocked} ${r.remaining} more still to check — press again.` : base + blocked
}

/** A run where nothing could be searched is a failure, not an empty result. */
export const runFailed = (r: NewsRun) => !!r.unreachable && r.unreachable === r.checked

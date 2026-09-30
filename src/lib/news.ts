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
  remaining: number
  found: number
  kept: number
  failed?: number
  /** Orgs whose news search itself failed (e.g. the source blocked us). */
  unreachable?: number
  fetch_error?: string | null
  /** Other stale orgs the server went on to fetch in the background. */
  background?: number
}

/** Where a background run has got to. */
export type NewsStatus = { remaining: number; total: number; kept: number }

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

export async function refreshNews(mode: 'mine' | 'org', organisationId?: string): Promise<NewsRun> {
  const { data, error } = await supabase.functions.invoke('fr-news', {
    body: { mode, organisation_id: organisationId },
  })
  if (error) throw new Error(await reason(error))
  return data as NewsRun
}

/** Super admin: start a background run over every organisation. */
export async function startAllNews(): Promise<{ started: boolean; remaining: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('fr-news', { body: { mode: 'all' } })
  if (error) throw new Error(await reason(error))
  return data as { started: boolean; remaining: number; total: number }
}

/** How many orgs are still waiting, and how many headlines were kept since `since`. */
export async function newsStatus(scope: 'all' | 'live', since?: string): Promise<NewsStatus> {
  const { data, error } = await supabase.functions.invoke('fr-news', { body: { mode: 'status', scope, since } })
  if (error) throw new Error(await reason(error))
  return data as NewsStatus
}

/** One sentence for a toast, so every refresh button reports alike. */
export function describeRun(r: NewsRun): string {
  if (r.checked === 0) {
    return r.background
      ? `Your organisations are up to date. ${r.background} others are updating in the background.`
      : 'Already up to date — checked in the last 6 hours.'
  }
  if (r.unreachable && r.unreachable === r.checked) {
    return `Could not search news for any of them: ${r.fetch_error ?? 'the news sources did not answer'}.`
  }
  const base = `Checked ${r.checked} ${r.checked === 1 ? 'organisation' : 'organisations'}: `
    + `${r.found} new ${r.found === 1 ? 'headline' : 'headlines'}, ${r.kept} worth keeping.`
  const blocked = r.unreachable ? ` ${r.unreachable} could not be searched and will be retried.` : ''
  const bg = r.background ? ` ${r.background} other organisations are updating in the background.` : ''
  return base + blocked + bg
}

/** A run where nothing could be searched is a failure, not an empty result. */
export const runFailed = (r: NewsRun) => !!r.unreachable && r.unreachable === r.checked

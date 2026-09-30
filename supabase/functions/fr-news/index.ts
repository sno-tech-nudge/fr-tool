// Supabase Edge Function: fr-news
//
// Fetches recent news for donor organisations and keeps only what helps the
// fundraising team. Built to spend as few Gemini tokens as possible:
//   1. news RSS (Google, else Bing), CSR terms inside the query itself (free)
//   2. anything already stored is skipped (free)
//   3. only NEW headlines go to Gemini, ~50 per call, titles only
//   4. every verdict is stored so no headline is judged twice; dropped ones
//      are deleted once older than the feeds reach back (30 days)
// News belongs to an organisation, not a person, so each org is fetched once
// for the whole team and re-checked at most every STALE_HOURS.
//
// Long runs happen in the background: each invocation does one batch, then
// calls itself for the next, so no single request hits the time limit and
// nobody has to keep a page open.
//
// Edge Functions are edited in the Supabase dashboard; this file is the source
// to paste there.
//
// Modes (POST body):
//   { mode: 'mine' }                   the caller's own stale orgs now, then every other
//                                      stale live org in the background
//   { mode: 'org', organisation_id }   one org (Org 360 → News → Refresh)
//   { mode: 'all' }                    every stale org, live or not, in the background;
//                                      super admin only
//   { mode: 'status', scope, since }   how many are still stale — for progress bars
//   { mode: 'sweep', scope }           one background batch; service role only

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash'
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const STALE_HOURS = 6
// One batch per invocation keeps each request well inside the time limit.
const MAX_ORGS = 50
const ITEMS_PER_ORG = 8
const BATCH = 50
/** News searches at once. */
const CONCURRENCY = 15
/** Gemini calls at once — kept low to stay clear of its rate limit. */
const GEMINI_PARALLEL = 4
/** Dropped headlines older than this can no longer come back from the feeds. */
const DROPPED_KEEP_DAYS = 30
const SELF_URL = `${SUPABASE_URL}/functions/v1/fr-news`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const admin = createClient(SUPABASE_URL, SERVICE_KEY)

type Org = { id: string; name: string; news_query: string | null; news_checked_at: string | null }
type Item = { orgId: string; orgName: string; title: string; url: string; source: string | null; published: string | null }
type Scope = 'all' | 'live'
/** Per-run state shared by every search in it. */
type Run = { googleBlocked: boolean }

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

/** Keep working after the response has gone; inline where unsupported. */
async function later(work: () => Promise<unknown>) {
  const p = work().catch((e) => console.error('background', e))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p)
  else await p
}

/** PostgREST caps reads at 1,000 rows, the service role included. */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

/** Orgs with an open deal or an active grant — optionally only one owner's. */
async function liveOrgIds(ownerId?: string): Promise<Set<string>> {
  const [opps, grants] = await Promise.all([
    readAll<{ organisation_id: string }>((a, b) => {
      let q = admin.from('fr_opportunities')
        .select('organisation_id, fr_pipeline_stages!inner(terminal_type)')
        .is('deleted_at', null).is('fr_pipeline_stages.terminal_type', null)
      if (ownerId) q = q.eq('owner_user_id', ownerId)
      return q.range(a, b)
    }),
    readAll<{ organisation_id: string }>((a, b) => {
      let q = admin.from('fr_grants').select('organisation_id')
        .is('deleted_at', null).eq('status', 'active')
      if (ownerId) q = q.eq('owner_user_id', ownerId)
      return q.range(a, b)
    }),
  ])
  return new Set([...opps, ...grants].map((r) => r.organisation_id).filter(Boolean))
}

const isStale = (o: Org) =>
  !o.news_checked_at || Date.now() - new Date(o.news_checked_at).getTime() > STALE_HOURS * 3600_000

/** Stalest first; never-checked before everything. */
const byStaleness = (a: Org, b: Org) =>
  (a.news_checked_at ?? '').localeCompare(b.news_checked_at ?? '')

function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}
const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decode(m[1]) : null
}

const TERMS = '(CSR OR foundation OR philanthropy OR grant OR "social impact" OR NGO)'
const MONTH_MS = 30 * 86_400_000

/** A search either returns RSS or says why it didn't — never a silent empty. */
async function getRss(url: string): Promise<{ xml: string | null; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (fr-news)', Accept: 'application/rss+xml, application/xml' },
    })
    const text = await res.text()
    if (!res.ok) return { xml: null, error: `HTTP ${res.status}` }
    // A consent or captcha page comes back 200 but is HTML, not a feed.
    if (!/<rss[\s>]/.test(text)) return { xml: null, error: 'returned a web page, not a news feed' }
    return { xml: text }
  } catch (e) {
    return { xml: null, error: e instanceof Error ? e.message : 'request failed' }
  }
}

function parse(xml: string, org: Org, fromBing: boolean): Item[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap((m) => {
    const source = tag(m[1], fromBing ? 'News:Source' : 'source')
    let title = tag(m[1], 'title') ?? ''
    // Google appends " - Source" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3))
    let link = tag(m[1], 'link')
    // Bing wraps the article in a click-tracking URL that changes per fetch,
    // which would defeat de-duplication — keep the real article address.
    if (fromBing && link) {
      try { link = new URL(link).searchParams.get('url') ?? link } catch { /* keep as is */ }
    }
    const date = tag(m[1], 'pubDate')
    const published = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null
    // Bing's feed has no date filter of its own.
    if (published && Date.now() - Date.parse(published) > MONTH_MS) return []
    return title && link ? [{ orgId: org.id, orgName: org.name, title, url: link, source, published }] : []
  }).slice(0, ITEMS_PER_ORG)
}

/**
 * Headlines say "HDFC Bank", never "HDFC Bank Limited" — searched in quotes,
 * the legal suffix alone finds nothing. news_query overrides all of this.
 */
function searchName(org: Org): string {
  if (org.news_query?.trim()) return org.news_query.replace(/"/g, '').trim()
  return org.name
    .replace(/\((india|i)\)/gi, ' ')
    .replace(/\b(private|pvt|limited|ltd|llp|inc)\b\.?/gi, ' ')
    .replace(/["]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Google News first, Bing News if Google refuses. Google blocks most requests
 * from cloud servers like this one, so after its first refusal in a run it is
 * skipped for the rest — every search would otherwise wait on a failure first.
 * The CSR terms sit inside the search either way.
 */
async function fetchNews(org: Org, run: Run): Promise<{ items: Item[]; ok: boolean; error?: string }> {
  const name = searchName(org)
  let google: { xml: string | null; error?: string } = { xml: null, error: 'skipped (blocked earlier in this run)' }
  if (!run.googleBlocked) {
    google = await getRss(`https://news.google.com/rss/search?q=${
      encodeURIComponent(`"${name}" ${TERMS} when:30d`)}&hl=en-IN&gl=IN&ceid=IN:en`)
    if (google.xml) return { items: parse(google.xml, org, false), ok: true }
    run.googleBlocked = true
  }

  const bing = await getRss(`https://www.bing.com/news/search?q=${
    encodeURIComponent(`"${name}" ${TERMS}`)}&format=rss&cc=IN`)
  if (bing.xml) return { items: parse(bing.xml, org, true), ok: true }

  return { items: [], ok: false, error: `Google ${google.error}; Bing ${bing.error}` }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

const PROMPT = `You screen news for The/Nudge, an Indian non-profit whose fundraising team raises CSR and foundation money for livelihoods, skilling, education, social entrepreneurship and rural development programs.

For each numbered headline, decide whether it helps that team with the organisation named in brackets. Keep only:
- CSR budget, spend or policy announcements
- a new CSR or foundation focus area, or a new foundation
- strong profit or revenue growth (more CSR money)
- a new CSR head or foundation leader
- grant calls or proposals invited
- grants to, or partnerships with, other NGOs
- controversy that could affect a partnership
Drop everything else — products, share price, general executive changes, routine results — and anything not really about the named organisation.

why: one plain sentence under 20 words on why it matters for fundraising; empty when dropped.`

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      i: { type: 'NUMBER' },
      keep: { type: 'BOOLEAN' },
      category: {
        type: 'STRING',
        enum: ['csr_budget', 'csr_focus', 'financial_growth', 'csr_leadership',
          'grant_call', 'ngo_partnership', 'reputation_risk', 'other'],
      },
      why: { type: 'STRING' },
    },
    required: ['i', 'keep', 'category', 'why'],
  },
}

type Verdict = { i: number; keep: boolean; category: string; why: string }

async function classify(batch: Item[]): Promise<Verdict[] | null> {
  const lines = batch.map((it, i) => `${i}. [${it.orgName}] ${it.title}`).join('\n')
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\n${lines}` }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    },
  )
  if (!res.ok) { console.error('gemini', res.status, (await res.text()).slice(0, 300)); return null }
  const text = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text
  try { return JSON.parse(text) as Verdict[] } catch { return null }
}

type Summary = {
  checked: number
  found: number
  kept: number
  failed: number
  unreachable: number
  fetch_error: string | null
}

async function loadOrgs(): Promise<Org[]> {
  return readAll<Org>((a, b) => admin.from('fr_organisations')
    .select('id, name, news_query, news_checked_at').is('deleted_at', null).range(a, b))
}

/** Stale orgs in a scope, stalest first, plus how many the scope holds. */
async function staleIn(scope: Scope): Promise<{ stale: Org[]; total: number }> {
  const orgs = await loadOrgs()
  let inScope = orgs
  if (scope === 'live') {
    const live = await liveOrgIds()
    inScope = orgs.filter((o) => live.has(o.id))
  }
  return { stale: inScope.filter(isStale).sort(byStaleness), total: inScope.length }
}

/** Fetch, judge and store one batch of orgs. */
async function runBatch(pick: Org[]): Promise<Summary> {
  const empty: Summary = { checked: 0, found: 0, kept: 0, failed: 0, unreachable: 0, fetch_error: null }
  if (pick.length === 0) return empty

  // Claim the batch first, so a second run going at the same time picks
  // different orgs. Orgs whose search fails get their old time back below.
  await admin.from('fr_organisations')
    .update({ news_checked_at: new Date().toISOString() })
    .in('id', pick.map((o) => o.id))

  // ---- fetch, then drop what is already stored ----
  const run: Run = { googleBlocked: false }
  const results = await pool(pick, CONCURRENCY, (o) => fetchNews(o, run))
  const fetched = results.flatMap((r) => r.items)
  const unreachable = pick.filter((_, i) => !results[i].ok)
  const firstError = results.find((r) => !r.ok)?.error ?? null
  if (unreachable.length > 0) console.error('news search failed', unreachable.length, firstError)
  const { data: known } = await admin.from('fr_org_news').select('organisation_id, url')
    .in('organisation_id', pick.map((o) => o.id))
  const seen = new Set((known ?? []).map((k) => `${k.organisation_id}|${k.url}`))
  const fresh = fetched.filter((it, i, all) =>
    !seen.has(`${it.orgId}|${it.url}`)
    && all.findIndex((x) => x.orgId === it.orgId && x.url === it.url) === i)

  // ---- judge only the new headlines, several Gemini calls at once ----
  const batches: Item[][] = []
  for (let b = 0; b < fresh.length; b += BATCH) batches.push(fresh.slice(b, b + BATCH))
  const judged = await pool(batches, GEMINI_PARALLEL, async (batch) => {
    const verdicts = await classify(batch)
    // A failed batch is not stored, so the same headlines are retried next time.
    if (!verdicts) return { kept: 0, failed: batch.length }
    const byIndex = new Map(verdicts.map((v) => [v.i, v]))
    let kept = 0
    const rows = batch.map((it, i) => {
      const v = byIndex.get(i)
      const keep = v?.keep === true
      if (keep) kept++
      return {
        organisation_id: it.orgId,
        url: it.url,
        title: it.title,
        source: it.source,
        published_at: it.published,
        is_relevant: keep,
        category: keep ? v?.category ?? 'other' : null,
        why: keep ? (v?.why || null) : null,
      }
    })
    await admin.from('fr_org_news').upsert(rows, { onConflict: 'organisation_id,url', ignoreDuplicates: true })
    return { kept, failed: 0 }
  })

  // A blocked or failed search must be retried on the next press, not skipped
  // for 6 hours — hand those orgs back their previous time.
  await Promise.all(unreachable.map((o) =>
    admin.from('fr_organisations').update({ news_checked_at: o.news_checked_at }).eq('id', o.id)))

  return {
    checked: pick.length,
    found: fresh.length,
    kept: judged.reduce((n, j) => n + j.kept, 0),
    failed: judged.reduce((n, j) => n + j.failed, 0),
    unreachable: unreachable.length,
    fetch_error: firstError,
  }
}

/** Dropped headlines past the feeds' reach can never be re-fetched, so they go. */
async function pruneDropped() {
  const cutoff = new Date(Date.now() - DROPPED_KEEP_DAYS * 86_400_000).toISOString()
  await admin.from('fr_org_news').delete().eq('is_relevant', false).lt('published_at', cutoff)
  await admin.from('fr_org_news').delete().eq('is_relevant', false).is('published_at', null).lt('created_at', cutoff)
}

/** Hand the next batch to a fresh invocation of this same function. */
async function nextHop(scope: Scope) {
  const res = await fetch(SELF_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'sweep', scope }),
  })
  if (!res.ok) console.error('next hop failed', res.status, (await res.text()).slice(0, 200))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  if (!GEMINI_KEY) return json(500, { error: 'GEMINI_API_KEY is not set on this function.' })

  let body: { mode?: string; organisation_id?: string; scope?: string; since?: string }
  try { body = await req.json() } catch { return json(400, { error: 'Expected a JSON body.' }) }
  const mode = body.mode
  const scope: Scope = body.scope === 'all' ? 'all' : 'live'

  const authorization = req.headers.get('Authorization') ?? ''
  const isService = authorization === `Bearer ${SERVICE_KEY}`
  let employee: { id: string; erp_role: string } | null = null

  if (!isService) {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } })
    const { data: allowed } = await asUser.rpc('is_fr_authorised')
    if (allowed !== true) return json(403, { error: 'You do not have access to this module.' })
    const { data: u } = await asUser.auth.getUser()
    const { data: e } = await admin.from('employees').select('id, erp_role')
      .ilike('email', u.user?.email ?? '').maybeSingle()
    employee = e
    if (!employee) return json(403, { error: 'No employee record matches your sign-in.' })
  }

  // ---- one org, right now ----
  if (mode === 'org') {
    const org = (await loadOrgs()).find((o) => o.id === body.organisation_id)
    if (!org) return json(404, { error: 'Organisation not found.' })
    const r = await runBatch(isStale(org) ? [org] : [])
    return json(200, { ok: true, ...r, remaining: 0, background: 0 })
  }

  // ---- the caller's own now, everyone else's in the background ----
  if (mode === 'mine') {
    if (!employee) return json(400, { error: 'mine needs a signed-in user.' })
    const [{ stale }, mine] = await Promise.all([staleIn('live'), liveOrgIds(employee.id)])
    const own = stale.filter((o) => mine.has(o.id)).slice(0, MAX_ORGS)
    const r = await runBatch(own)
    const background = stale.length - own.length
    if (background > 0) await later(() => nextHop('live'))
    else await later(pruneDropped)
    return json(200, { ok: true, ...r, remaining: 0, background })
  }

  // ---- every org, entirely in the background ----
  if (mode === 'all') {
    if (!isService && employee?.erp_role !== 'super_admin') {
      return json(403, { error: 'Only a super admin can fetch news for every organisation.' })
    }
    const { stale, total } = await staleIn('all')
    if (stale.length > 0) await later(() => nextHop('all'))
    return json(200, { ok: true, started: stale.length > 0, remaining: stale.length, total })
  }

  // ---- progress for whoever is watching ----
  if (mode === 'status') {
    const { stale, total } = await staleIn(scope)
    let kept = 0
    if (body.since) {
      const { count } = await admin.from('fr_org_news').select('id', { count: 'exact', head: true })
        .eq('is_relevant', true).gte('created_at', body.since)
      kept = count ?? 0
    }
    return json(200, { ok: true, remaining: stale.length, total, kept })
  }

  // ---- one hop of the background chain ----
  if (mode === 'sweep') {
    if (!isService) return json(403, { error: 'The sweep runs in the background only.' })
    // Answer at once so the hop that called us can finish; the work carries on.
    await later(async () => {
      const { stale } = await staleIn(scope)
      if (stale.length === 0) return
      const r = await runBatch(stale.slice(0, MAX_ORGS))
      console.log('sweep', scope, JSON.stringify(r))
      // Stop if nothing could be searched — going again at once would fail too.
      if (stale.length > MAX_ORGS && r.unreachable < r.checked) await nextHop(scope)
      else await pruneDropped()
    })
    return json(202, { ok: true, started: true })
  }

  return json(400, { error: 'mode must be mine, org, all, status or sweep.' })
})

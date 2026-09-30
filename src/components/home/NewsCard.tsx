import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, EmptyState, SearchInput, Skeleton, useToast } from '../ui'
import { describeRun, refreshNews, runFailed, type NewsItem } from '../../lib/news'
import { sanitizeSearch } from '../../lib/query'
import { HomeSection } from './HomeSection'
import { NewsCarousel } from './NewsCarousel'

const COLS = 'id, organisation_id, title, url, source, published_at, category, why'

/**
 * Fundraising-relevant news. By default: the organisations on this person's
 * deals, from fr_v_my_org_news. Typing an organisation's name switches the
 * strip to news already stored for any matching organisation — search reads
 * what is there, it never fetches. Refresh fetches, then returns to the
 * person's own news.
 */
export function NewsCard() {
  const toast = useToast()
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')

  // Wait for a pause in typing rather than querying on every key.
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(sanitizeSearch(search)), 300)
    return () => window.clearTimeout(id)
  }, [search])

  const load = useCallback(async () => {
    setError(null)
    if (term) {
      const { data, error: err } = await supabase
        .from('fr_org_news')
        .select(`${COLS}, fr_organisations!inner(name)`)
        .ilike('fr_organisations.name', `%${term}%`)
        .eq('is_relevant', true)
        .is('deleted_at', null)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(30)
      if (err) { setError(err.message); setItems([]); return }
      type Row = NewsItem & { fr_organisations: { name: string } | null }
      setItems(((data ?? []) as unknown as Row[]).map((r) => ({ ...r, org_name: r.fr_organisations?.name ?? null })))
      return
    }
    const { data, error: err } = await supabase
      .from('fr_v_my_org_news')
      .select(`${COLS}, org_name`)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(30)
    if (err) { setError(err.message); setItems([]); return }
    setItems((data ?? []) as NewsItem[])
  }, [term])

  useEffect(() => { void load() }, [load])

  async function refresh() {
    setBusy(true)
    try {
      // The server fetches this person's own orgs before answering, then
      // carries on with everyone else's in the background.
      const r = await refreshNews('mine')
      if (runFailed(r)) toast.error(describeRun(r))
      else toast.success(describeRun(r))
      // Back to the person's own news, which is what Refresh just updated.
      if (search || term) { setSearch(''); setTerm('') }
      else await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch news.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <HomeSection
      title="News"
      micro
      action={
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <div className="newssearch">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by organisation" />
          </div>
          <Button size="sm" variant="ghost" iconLeft={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={busy}>
            {busy ? 'Fetching…' : 'Refresh'}
          </Button>
        </div>
      }
    >
      {items === null ? (
        <div className="row" style={{ gap: 'var(--space-4)' }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ flex: 1 }}><Skeleton height={151} /></div>)}
        </div>
      ) : error ? (
        <div className="card">
          <EmptyState title="News is not set up yet" body={`${error} — the news tables may not exist yet.`} />
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          {term ? (
            <EmptyState
              title={`No news stored for “${term}”`}
              body="Only organisations already fetched have news. Open the organisation and use Refresh on its News tab to fetch it."
            />
          ) : (
            <EmptyState
              title="No news yet"
              body="Press Refresh to check the organisations on your deals. Only news useful for fundraising is kept."
            />
          )}
        </div>
      ) : (
        // Keyed by the search so a new result set starts from its first card.
        <NewsCarousel key={term} items={items} />
      )}
    </HomeSection>
  )
}

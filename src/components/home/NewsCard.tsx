import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, EmptyState, Skeleton, useToast } from '../ui'
import { describeRun, refreshAllNews, runFailed, type NewsItem } from '../../lib/news'
import { NewsList } from '../news/NewsList'
import { HomeCard } from './HomeCard'

/**
 * Fundraising-relevant news about the organisations on this person's deals.
 *
 * Reads fr_v_my_org_news, which already narrows to orgs where the signed-in
 * person owns an open deal or active grant. Refresh checks every live org not
 * checked in the last 6 hours, theirs first; everyone shares the results.
 */
export function NewsCard() {
  const toast = useToast()
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('fr_v_my_org_news')
      .select('id, organisation_id, org_name, title, url, source, published_at, category, why')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(30)
    if (err) { setError(err.message); setItems([]); return }
    setItems((data ?? []) as NewsItem[])
  }, [])

  useEffect(() => { void load() }, [load])

  async function refresh() {
    setBusy(true)
    try {
      let first = true
      const r = await refreshAllNews((t) => {
        setProgress(t.remaining > 0 ? `${t.checked} of ${t.checked + t.remaining}` : null)
        // Their own orgs are fetched first, so show them without waiting for the rest.
        if (first) { first = false; void load() }
      })
      if (runFailed(r)) toast.error(describeRun(r))
      else toast.success(describeRun(r))
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch news.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <HomeCard
      title="News"
      action={
        <Button size="sm" variant="ghost" iconLeft={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={busy}>
          {busy ? (progress ? `Fetching ${progress}` : 'Fetching…') : 'Refresh'}
        </Button>
      }
    >
      {items === null ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}</div>
      ) : error ? (
        <EmptyState title="News is not set up yet" body={`${error} — the news tables may not exist yet.`} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No news yet"
          body="Press Refresh to check the organisations on your deals. Only news useful for fundraising is kept."
        />
      ) : (
        <NewsList items={items} showOrg />
      )}
    </HomeCard>
  )
}

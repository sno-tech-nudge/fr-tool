import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, EmptyState, Skeleton, useToast } from '../ui'
import { formatDateTime } from '../../lib/format'
import { describeRun, refreshNews, runFailed, type NewsItem } from '../../lib/news'
import { NewsList } from '../news/NewsList'

/** Every kept news item for one organisation, newest first. Reads the store; costs nothing. */
export function OrgNewsTab({ organisationId }: { organisationId: string }) {
  const toast = useToast()
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [news, org] = await Promise.all([
      supabase
        .from('fr_org_news')
        .select('id, organisation_id, title, url, source, published_at, category, why')
        .eq('organisation_id', organisationId)
        .eq('is_relevant', true)
        .is('deleted_at', null)
        .order('published_at', { ascending: false, nullsFirst: false }),
      supabase.from('fr_organisations').select('news_checked_at').eq('id', organisationId).maybeSingle(),
    ])
    if (news.error) { setError(news.error.message); setItems([]); return }
    setItems((news.data ?? []) as NewsItem[])
    setCheckedAt((org.data as { news_checked_at: string | null } | null)?.news_checked_at ?? null)
  }, [organisationId])

  useEffect(() => { void load() }, [load])

  async function refresh() {
    setBusy(true)
    try {
      const r = await refreshNews('org', organisationId)
      if (runFailed(r)) toast.error(describeRun(r))
      else toast.success(describeRun(r))
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch news.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="chartsub" style={{ margin: 0 }}>
          {checkedAt ? `Last checked ${formatDateTime(checkedAt)}` : 'Not checked yet'}
        </span>
        <Button size="sm" variant="secondary" iconLeft={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Fetching…' : 'Refresh'}
        </Button>
      </div>

      {items === null ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}</div>
      ) : error ? (
        <EmptyState title="News is not set up yet" body={`${error} — the news tables may not exist yet.`} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No news kept for this organisation"
          body="Only news useful for fundraising is kept — CSR budgets, focus areas, grants, growth."
        />
      ) : (
        <NewsList items={items} showOrg={false} />
      )}
    </div>
  )
}

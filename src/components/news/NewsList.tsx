import { Link } from '@tanstack/react-router'
import { Newspaper } from 'lucide-react'
import { Badge } from '../ui'
import { formatDate } from '../../lib/format'
import { NEWS_CATEGORY, type NewsItem } from '../../lib/news'

/** The same rendering on the home card and the organisation tab. */
export function NewsList({ items, showOrg }: { items: NewsItem[]; showOrg: boolean }) {
  return (
    <div className="feed">
      {items.map((n) => (
        <article key={n.id} className="feeditem">
          <span className="feeditem__icon" aria-hidden="true"><Newspaper size={14} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="feeditem__head">
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="feeditem__subject newslink"
              >
                {n.title}
              </a>
              {n.category ? <Badge tone="outline">{NEWS_CATEGORY[n.category] ?? n.category}</Badge> : null}
            </div>
            {n.why ? <p className="feeditem__body">{n.why}</p> : null}
            <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
              {showOrg && n.org_name ? (
                <Link
                  to="/organisations/$id"
                  params={{ id: n.organisation_id }}
                  className="celllink feeditem__when"
                >
                  {n.org_name}
                </Link>
              ) : null}
              <span className="feeditem__when tn-num">
                {[n.source, n.published_at ? formatDate(n.published_at) : null].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

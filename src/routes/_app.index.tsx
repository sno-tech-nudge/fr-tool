import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAccess } from '../lib/accessContext'
import { currentFiscalYear } from '../lib/fy'
import { ActionsCard } from '../components/home/ActionsCard'
import { CollectionsCard } from '../components/home/CollectionsCard'
import { NewsCard } from '../components/home/NewsCard'
import { NotificationsRail } from '../components/home/NotificationsRail'

export const Route = createFileRoute('/_app/')({ component: HomePage })

/**
 * My Day (IA §5.1). What is on this page depends on which half of the job the
 * person does: hunting new business or managing existing partners.
 *
 * The choice is made by the person rather than inferred, because nothing in
 * the schema records which team someone is on — `deal_category` sits on deals,
 * not on people. When that changes this becomes the default rather than the
 * whole mechanism.
 */

const VIEW_KEY = 'fr-home-view'

const VIEWS = [
  { key: 'day', label: 'My day' },
  { key: 'hunting', label: 'Hunting' },
  { key: 'partners', label: 'Partner management' },
] as const

type View = typeof VIEWS[number]['key']

function readStoredView(): View {
  try {
    const stored = localStorage.getItem(VIEW_KEY)
    if (VIEWS.some((v) => v.key === stored)) return stored as View
  } catch { /* storage disabled — fall through */ }
  return 'day'
}

function HomePage() {
  const access = useAccess()
  const [view, setView] = useState<View>('day')

  // Read after mount, so the first paint never depends on storage.
  useEffect(() => { setView(readStoredView()) }, [])

  function choose(next: View) {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* ignore */ }
  }

  const firstName = access.employeeName?.split(' ')[0]

  return (
    <div className="page stack">
      {/* The page's own gap spaces header, pills and cards evenly; the head's
          default bottom margin on top of it left a lopsided hole. */}
      <div className="page__head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page__title">{firstName ? `Hello, ${firstName}` : 'Fundraising'}</h1>
          {/* Shown with an en dash: a year range's proper mark, and a thin
              hyphen in light type reads as a gap. The value itself is unchanged. */}
          <p className="page__sub">{currentFiscalYear().replace('-', '–')}</p>
        </div>
      </div>

      <div className="pillrow" role="radiogroup" aria-label="What to show">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pill"
            data-active={view === v.key}
            aria-pressed={view === v.key}
            onClick={() => choose(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Two even columns: what needs doing and what just happened on top,
          money and news beneath. Each card scrolls inside itself. */}
      <div className="homegrid">
        <ActionsCard dealCategory={view === 'hunting' ? 'NBD' : view === 'partners' ? 'PM' : null} />
        <NotificationsRail />
        {/* Hunters rarely own grants, so collections would sit empty for them. */}
        {view !== 'hunting' ? <CollectionsCard /> : null}
        <NewsCard />
      </div>
    </div>
  )
}

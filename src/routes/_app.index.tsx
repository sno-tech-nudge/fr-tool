import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAccess } from '../lib/accessContext'
import { currentFiscalYear } from '../lib/fy'
import { ActionsCard } from '../components/home/ActionsCard'
import { CollectionsCard } from '../components/home/CollectionsCard'
import { NewsCard } from '../components/home/NewsCard'
import { NotificationsRail } from '../components/home/NotificationsRail'
import { ToConfirmCard } from '../components/home/ToConfirmCard'
import { usePaymentAccess } from '../lib/payments'

export const Route = createFileRoute('/_app/')({ component: HomePage })

/**
 * My Day (IA §5.1): news and notifications up front, with the person's actions
 * and remaining collections a click away. Collections are hidden for anyone
 * tagged Hunting on the Team members page — hunters rarely own grants, so the
 * tab would only ever be empty. Untagged people (admins, for one) see it.
 */

const VIEW_KEY = 'fr-home-view'

const VIEWS = [
  { key: 'day', label: 'My day' },
  { key: 'actions', label: 'Actions' },
  { key: 'collections', label: 'Remaining collections' },
  { key: 'confirm', label: 'To confirm' },
] as const

type View = typeof VIEWS[number]['key']

function readStoredView(): View | null {
  try {
    const stored = localStorage.getItem(VIEW_KEY)
    if (VIEWS.some((v) => v.key === stored)) return stored as View
  } catch { /* storage disabled — fall through */ }
  return null
}

function HomePage() {
  const access = useAccess()
  const [chosen, setChosen] = useState<View | null>(null)
  // Finance works from the receipts queue and rarely owns grants: their Home
  // leads with it, and remaining collections (always empty for them) goes.
  const isFinance = access.frSubRole === 'finance'
  const { canConfirm } = usePaymentAccess()
  const showCollections = access.frFocus !== 'hunting' && !isFinance
  const views = (isFinance
    ? [...VIEWS.filter((v) => v.key === 'confirm'), ...VIEWS.filter((v) => v.key !== 'confirm')]
    : [...VIEWS]
  ).filter((v) => (v.key !== 'collections' || showCollections) && (v.key !== 'confirm' || canConfirm))
  // A stored choice can point at a tab this person no longer has.
  const view: View = chosen && views.some((v) => v.key === chosen) ? chosen : views[0].key

  // Read after mount, so the first paint never depends on storage.
  useEffect(() => { setChosen(readStoredView()) }, [])

  function choose(next: View) {
    setChosen(next)
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
        {views.map((v) => (
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

      {/* News strip, then full-width tables. Each table scrolls within itself if long. */}
      <div className="homestack">
        {view === 'day' ? (
          <>
            <NewsCard />
            <NotificationsRail />
          </>
        ) : null}
        {view === 'actions' ? <ActionsCard /> : null}
        {view === 'collections' ? <CollectionsCard /> : null}
        {view === 'confirm' ? <ToConfirmCard /> : null}
      </div>
    </div>
  )
}

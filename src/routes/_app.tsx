import { useEffect, useState } from 'react'
import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { Button, Skeleton } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useFrAccess } from '../hooks/useFrAccess'
import { FrAccessProvider } from '../lib/accessContext'

export const Route = createFileRoute('/_app')({ component: AppLayout })

const SIDEBAR_STORAGE_KEY = 'fr-sidebar-collapsed'

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
  } catch {
    // Private browsing / storage disabled — default to expanded.
    return false
  }
}

/**
 * The protected shell. Renders an <Outlet/> — the list/landing view for this
 * segment lives in _app.index.tsx, never here, or child routes silently render
 * the wrong page.
 */
function AppLayout() {
  const { session, loading, signOut } = useAuth()
  const access = useFrAccess()

  // One boolean, read once from localStorage after mount (avoids a
  // server/client mismatch on first paint). Toggling it only ever flips the
  // `data-sidebar` attribute below — the collapse/expand motion itself is
  // pure CSS on `.sidebar` (see app.css), so no React re-render happens
  // while it plays and nothing else on the page is touched.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  useEffect(() => { setSidebarCollapsed(readStoredCollapsed()) }, [])

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  if (loading) return <BootSkeleton />
  if (!session) return <Navigate to="/login" />
  if (access.loading) return <BootSkeleton />

  if (access.error) {
    return (
      <Centered
        title="Could not check your access"
        body={access.error}
        action={<Button variant="secondary" onClick={() => window.location.reload()}>Retry</Button>}
      />
    )
  }

  if (!access.authorised) {
    return (
      <Centered
        title="No access to fundraising"
        body="Your account is not on the fundraising team. Ask an FR manager to add you."
        action={<Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>}
      />
    )
  }

  return (
    <FrAccessProvider value={access}>
      <div className="app" data-sidebar={sidebarCollapsed ? 'collapsed' : undefined}>
        <Sidebar access={access} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <div className="main">
          <Outlet />
        </div>
      </div>
    </FrAccessProvider>
  )
}

function BootSkeleton() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand"><Skeleton height={22} width={110} /></div>
        <div className="stack">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} height={18} />)}
        </div>
      </aside>
      <div className="main">
        <div className="page stack">
          <Skeleton height={26} width="30%" />
          <Skeleton height={120} />
        </div>
      </div>
    </div>
  )
}

function Centered({
  title, body, action,
}: {
  title: string
  body: string
  action: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
      <div className="card" style={{ maxWidth: 420 }}>
        <p className="empty__title">{title}</p>
        <p className="empty__body">{body}</p>
        {action}
      </div>
    </div>
  )
}

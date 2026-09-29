import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { PICKLIST_SPECS } from '../components/admin/picklistSpecs'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin')({ component: AdminLayout })

/**
 * Admin shell. Renders an <Outlet/> only — the default view lives in
 * _app.admin.index.tsx.
 */
function AdminLayout() {
  const access = useAccess()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Everyone sets their own notification switches, so that one page is open to
  // the whole team. The rest of Configuration is reference data and is not.
  const onNotifications = pathname === '/admin/notifications'

  if (!access.isManager && !onNotifications) {
    return (
      <div className="page">
        <div className="card">
          <p className="empty__title">Managers only</p>
          <p className="empty__body">
            Reference data can only be changed by an FR manager or an admin.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page stack">
      <div>
        <h1 className="page__title">Configuration</h1>
        <p className="page__sub">
          Every picklist is a table, so these can change without a migration. Keys are resolution
          keys — they cannot be edited once rows reference them.
        </p>
      </div>

      <nav className="tabs" aria-label="Configuration sections">
        {access.isManager ? PICKLIST_SPECS.map((s) => (
          <Link
            key={s.slug}
            to="/admin/$slug"
            params={{ slug: s.slug }}
            className="tab"
            data-active={pathname === `/admin/${s.slug}`}
          >
            {s.tab}
          </Link>
        )) : null}
        {access.isManager ? (
          <Link to="/admin/team" className="tab" data-active={pathname === '/admin/team'}>
            Team members
          </Link>
        ) : null}
        <Link to="/admin/notifications" className="tab" data-active={onNotifications}>
          Notifications
        </Link>
        {/* Nucleus-wide roles, not fundraising's — super admins only. */}
        {access.erpRole === 'super_admin' ? (
          <Link to="/admin/people" className="tab" data-active={pathname === '/admin/people'}>
            People
          </Link>
        ) : null}
      </nav>

      <Outlet />
    </div>
  )
}

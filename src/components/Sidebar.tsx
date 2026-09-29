import { Link, useRouterState } from '@tanstack/react-router'
import {
  Building2, Contact, Home, KanbanSquare, LineChart, LogOut, PanelLeft, PanelLeftClose,
  Settings, Sparkles, UserPlus, Wallet,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import type { FrAccess } from '../hooks/useFrAccess'

type NavItem = {
  to?: string
  label: string
  icon: React.ReactNode
  /** Which build phase delivers it — items without a `to` are not built yet. */
  phase?: number
  managerOnly?: boolean
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Home', icon: <Home size={16} /> },
  { to: '/leads', label: 'Leads', icon: <UserPlus size={16} /> },
  { to: '/organisations', label: 'Organisations', icon: <Building2 size={16} /> },
  { to: '/contacts', label: 'Contacts', icon: <Contact size={16} /> },
  { to: '/opportunities', label: 'Pipeline', icon: <KanbanSquare size={16} /> },
  { to: '/grants', label: 'Grants', icon: <Wallet size={16} /> },
  { to: '/dashboards', label: 'Dashboards', icon: <LineChart size={16} /> },
  { label: 'Explorer', icon: <Sparkles size={16} />, phase: 6 },
]

/**
 * Collapse leaves a slim icon rail, not a closed panel — nav stays reachable
 * and visible, so nothing here needs to leave the tab order. It's driven
 * entirely by CSS (`.app[data-sidebar='collapsed']` in app.css re-sizes the
 * rail and fades only the labels/logo/user-text); `collapsed` here just
 * swaps the toggle button's icon and title.
 */
export function Sidebar({
  access, collapsed, onToggle,
}: {
  access: FrAccess
  collapsed: boolean
  onToggle: () => void
}) {
  const { email, signOut } = useAuth()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img src="/design-system/logos/thenudge-wordmark-cream.png" alt="The/Nudge" />
        <button
          className="sidebar-collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
          title={collapsed ? 'Open sidebar' : 'Close sidebar'}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {PRIMARY.map((item) =>
          item.to ? (
            <Link
              key={item.label}
              to={item.to}
              className="navlink"
              title={item.label}
              data-active={item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ) : (
            <span
              key={item.label}
              className="navlink"
              aria-disabled="true"
              title={`Phase ${item.phase}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </span>
          ),
        )}

        {access.isManager ? (
          <>
            <div className="sidebar__section">Admin</div>
            <Link
              to="/admin"
              className="navlink"
              title="Configuration"
              data-active={pathname.startsWith('/admin')}
            >
              <Settings size={16} />
              <span>Configuration</span>
            </Link>
          </>
        ) : null}
      </nav>

      <div className="sidebar__foot">
        <div className="sidebar__user">
          <strong>{access.employeeName ?? email}</strong>
          {access.erpRole}
          {access.frSubRole ? ` · fr ${access.frSubRole}` : ''}
        </div>
        <button
          className="navlink"
          onClick={() => void signOut()}
          title="Sign out"
          style={{ border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}

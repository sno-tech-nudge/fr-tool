import {
  Building2, Contact, Home, KanbanSquare, LineChart, Settings, Wallet, type LucideIcon,
} from 'lucide-react'

/**
 * The app's destinations, shaped like Nucleus's NavItem so the list lifts
 * straight into its Fundraising menu (as sub-items) at the merge.
 * `tab` marks the four that sit on the phone's bottom bar; the rest go under More.
 */
export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  module: 'fundraising'
  subs?: NavItem[]
  superAdminOnly?: boolean
  /** FR managers and super admins only (is_fr_manager). */
  managerOnly?: boolean
  /** Extra path prefixes that count as this item being active. */
  matchPaths?: string[]
  tab?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, module: 'fundraising', tab: true },
  { to: '/opportunities', label: 'Deals', icon: KanbanSquare, module: 'fundraising', tab: true },
  { to: '/organisations', label: 'Companies', icon: Building2, module: 'fundraising', tab: true },
  { to: '/grants', label: 'Grants', icon: Wallet, module: 'fundraising', tab: true },
  { to: '/contacts', label: 'Contacts', icon: Contact, module: 'fundraising' },
  { to: '/dashboards', label: 'Dashboards', icon: LineChart, module: 'fundraising' },
  { to: '/admin', label: 'Configuration', icon: Settings, module: 'fundraising', managerOnly: true },
]

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return [item.to, ...(item.matchPaths ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

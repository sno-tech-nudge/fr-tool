import { createFileRoute } from '@tanstack/react-router'
import { ZohoOwners } from '../components/admin/ZohoOwners'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/zoho-owners')({ component: ZohoOwnersRoute })

function ZohoOwnersRoute() {
  const access = useAccess()
  if (access.erpRole !== 'super_admin') {
    return (
      <div className="card">
        <p className="empty__title">Super admins only</p>
      </div>
    )
  }
  return <ZohoOwners />
}

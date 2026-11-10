import { createFileRoute } from '@tanstack/react-router'
import { HealthRules } from '../components/admin/HealthRules'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/health')({ component: HealthRoute })

function HealthRoute() {
  const access = useAccess()

  if (access.erpRole !== 'super_admin') {
    return (
      <div className="card">
        <p className="empty__title">Super admins only</p>
        <p className="empty__body">Health rules are set by a super admin.</p>
      </div>
    )
  }

  return <HealthRules />
}

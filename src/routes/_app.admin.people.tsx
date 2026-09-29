import { createFileRoute } from '@tanstack/react-router'
import { People } from '../components/admin/People'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/people')({ component: PeopleRoute })

function PeopleRoute() {
  const access = useAccess()

  // The database enforces this too — the UI guard only avoids showing a screen
  // whose every control would be refused.
  if (access.erpRole !== 'super_admin') {
    return (
      <div className="card">
        <p className="empty__title">Super admins only</p>
        <p className="empty__body">
          ERP roles are Nucleus-wide, so only a super admin can change them.
        </p>
      </div>
    )
  }

  return <People />
}

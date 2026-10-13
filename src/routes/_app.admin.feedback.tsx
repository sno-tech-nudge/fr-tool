import { createFileRoute } from '@tanstack/react-router'
import { FeedbackInbox } from '../components/admin/FeedbackInbox'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/feedback')({ component: FeedbackRoute })

function FeedbackRoute() {
  const access = useAccess()

  // The database enforces this too — the guard just avoids an empty screen.
  if (access.erpRole !== 'super_admin') {
    return (
      <div className="card">
        <p className="empty__title">Super admins only</p>
        <p className="empty__body">Feedback from testers is only visible to super admins.</p>
      </div>
    )
  }

  return <FeedbackInbox />
}

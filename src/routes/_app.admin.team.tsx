import { createFileRoute } from '@tanstack/react-router'
import { TeamMembers } from '../components/admin/TeamMembers'
import { PaymentEntrySetting } from '../components/admin/PaymentEntrySetting'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/team')({ component: TeamRoute })

function TeamRoute() {
  const access = useAccess()
  return (
    <div className="stack">
      <PaymentEntrySetting canEdit={access.isManager} />
      <TeamMembers canEdit={access.isManager} />
    </div>
  )
}

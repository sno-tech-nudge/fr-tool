import { createFileRoute } from '@tanstack/react-router'
import { TeamMembers } from '../components/admin/TeamMembers'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/team')({ component: TeamRoute })

function TeamRoute() {
  const access = useAccess()
  return <TeamMembers canEdit={access.isManager} />
}

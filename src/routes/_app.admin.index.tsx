import { Navigate, createFileRoute } from '@tanstack/react-router'
import { PICKLIST_SPECS } from '../components/admin/picklistSpecs'

export const Route = createFileRoute('/_app/admin/')({
  component: () => (
    <Navigate to="/admin/$slug" params={{ slug: PICKLIST_SPECS[0].slug }} replace />
  ),
})

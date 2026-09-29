import { createFileRoute } from '@tanstack/react-router'
import { PicklistEditor } from '../components/admin/PicklistEditor'
import { specBySlug } from '../components/admin/picklistSpecs'
import { ResyncWinProbability } from '../components/admin/ResyncWinProbability'
import { EmptyState } from '../components/ui'
import { useAccess } from '../lib/accessContext'

export const Route = createFileRoute('/_app/admin/$slug')({ component: PicklistRoute })

function PicklistRoute() {
  const { slug } = Route.useParams()
  const access = useAccess()
  const spec = specBySlug(slug)

  if (!spec) {
    return (
      <div className="card">
        <EmptyState title="Unknown configuration section" body={`No picklist is registered for "${slug}".`} />
      </div>
    )
  }
  return (
    <div className="stack">
      <PicklistEditor spec={spec} canEdit={access.isManager} />
      {/* Stage win % is copied onto deals, so it needs a way to catch up. */}
      {slug === 'pipeline-stages' ? <ResyncWinProbability canEdit={access.isManager} /> : null}
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { EscalationTimelines } from '../components/admin/EscalationTimelines'
import { NotificationPreferences } from '../components/admin/NotificationPreferences'
import { LatestNewsRun } from '../components/admin/LatestNewsRun'

export const Route = createFileRoute('/_app/admin/notifications')({ component: NotificationsRoute })

/**
 * Two audiences on one screen: the escalation matrix is team policy set by an
 * admin, the switches below it are personal and open to everybody.
 */
function NotificationsRoute() {
  return (
    <div className="stack">
      <section className="card stack">
        <div>
          <div className="tn-micro">Escalation timelines</div>
        </div>
        <EscalationTimelines />
      </section>

      <section className="card stack">
        <div>
          <div className="tn-micro">My notifications</div>
        </div>
        <NotificationPreferences />
      </section>

      <LatestNewsRun />
    </div>
  )
}

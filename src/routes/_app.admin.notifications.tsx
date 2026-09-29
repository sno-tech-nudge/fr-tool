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
          <p className="chartsub" style={{ marginTop: 'var(--space-2)' }}>
            How long a deal may sit at a stage without an update before it turns amber, then red,
            and who hears about it.
          </p>
        </div>
        <EscalationTimelines />
      </section>

      <section className="card stack">
        <div>
          <div className="tn-micro">My notifications</div>
          <p className="chartsub" style={{ marginTop: 'var(--space-2)' }}>
            Yours alone — nobody else sees or sets these.
          </p>
        </div>
        <NotificationPreferences />
      </section>

      <LatestNewsRun />
    </div>
  )
}

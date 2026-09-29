import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, Checkbox, EmptyState, TableSkeleton, useToast } from '../ui'
import { useAccess } from '../../lib/accessContext'
import {
  CHANNELS, CHANNEL_LIVE, NOTIFICATION_CATEGORIES, type Channel,
} from '../../lib/notifications'

/**
 * One person's own notification switches — what they are told about, and
 * where.
 *
 * Unlike the escalation matrix above it, this is nobody else's business:
 * everyone sets their own, including people who cannot see the rest of
 * Configuration.
 */

type Pref = { category: string; in_app: boolean; email: boolean; slack: boolean }

const DEFAULT: Omit<Pref, 'category'> = { in_app: true, email: false, slack: false }

export function NotificationPreferences() {
  const toast = useToast()
  const access = useAccess()
  const [prefs, setPrefs] = useState<Record<string, Pref> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!access.employeeId) return
    setPrefs(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_notification_preferences')
      .select('category, in_app, email, slack')
      .eq('employee_id', access.employeeId)
    if (err) { setError(err.message); return }

    const stored = new Map((data ?? []).map((d) => [(d as Pref).category, d as Pref]))
    setPrefs(Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [
      c.key,
      stored.get(c.key) ?? { category: c.key, ...DEFAULT },
    ])))
  }, [access.employeeId])

  useEffect(() => { void load() }, [load])

  async function set(category: string, channel: Channel, value: boolean) {
    const next = { ...(prefs?.[category] ?? { category, ...DEFAULT }), [channel]: value }
    setPrefs((prev) => (prev ? { ...prev, [category]: next } : prev))

    const { error: err } = await supabase
      .from('fr_notification_preferences')
      .upsert({
        employee_id: access.employeeId,
        category,
        in_app: next.in_app,
        email: next.email,
        slack: next.slack,
        updated_by: access.employeeId,
      }, { onConflict: 'employee_id,category' })
    if (err) { toast.error(err.message); void load() }
  }

  if (error) {
    return (
      <div className="card">
        <EmptyState
          title="Could not load your notification settings"
          body={`${error} — the fr_notification_preferences table may not exist yet.`}
        />
      </div>
    )
  }

  if (!prefs) return <TableSkeleton rows={6} cols={4} />

  return (
    <div className="stack">
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tell me about</th>
              {CHANNELS.map((c) => (
                <th key={c.key} style={{ width: '120px' }}>
                  {c.label}
                  {CHANNEL_LIVE[c.key] ? null : <> <Badge tone="outline">Soon</Badge></>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((cat) => (
              <tr key={cat.key}>
                <td>
                  <div>
                    {cat.label}
                    {cat.live ? null : <> <Badge tone="outline">Not built yet</Badge></>}
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                    {cat.description}
                  </div>
                </td>
                {CHANNELS.map((ch) => (
                  <td key={ch.key}>
                    <Checkbox
                      label=""
                      checked={prefs[cat.key]?.[ch.key] ?? false}
                      onChange={(v) => void set(cat.key, ch.key, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="chartsub">
        Email and Slack have nowhere to deliver to yet — the switches are saved, and start
        working when those channels are connected. In-app notifications show on the home page.
      </p>
    </div>
  )
}

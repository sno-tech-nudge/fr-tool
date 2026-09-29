import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Clock, FileCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, EmptyState, Skeleton } from '../ui'
import { useAccess } from '../../lib/accessContext'
import { HomeCard } from './HomeCard'
import { dueBadge, daysFromToday } from './due'

/**
 * Everything waiting on this person to do something, in one list: next steps
 * on their deals, reports they owe on their grants, and tasks assigned to
 * them. Soonest first, with anything late at the top.
 */

type Kind = 'next_step' | 'report' | 'task'

type Item = {
  key: string
  kind: Kind
  title: string
  detail: string | null
  /** Null for tasks, which carry no due date — they sort after dated work. */
  due: string | null
  link: { to: string; id: string } | null
}

const ICON: Record<Kind, React.ReactNode> = {
  next_step: <Clock size={14} />,
  report: <FileCheck size={14} />,
  task: <Check size={14} />,
}

const DETAIL_ROUTES: Record<string, string> = {
  opportunity: '/opportunities/$id',
  grant: '/grants/$id',
  organisation: '/organisations/$id',
}

export function ActionsCard({ dealCategory }: { dealCategory: 'NBD' | 'PM' | null }) {
  const access = useAccess()
  const [items, setItems] = useState<Item[] | null>(null)

  const load = useCallback(async () => {
    const me = access.employeeId
    if (!me) return
    setItems(null)

    let steps = supabase
      .from('fr_opportunities')
      .select('id, name, next_step, next_step_date, fr_organisations(name), fr_pipeline_stages!inner(terminal_type)')
      .eq('owner_user_id', me)
      .is('deleted_at', null)
      .is('fr_pipeline_stages.terminal_type', null)
      .not('next_step_date', 'is', null)
      .lte('next_step_date', daysFromToday(7))
      .order('next_step_date')
      .limit(20)
    if (dealCategory) steps = steps.eq('deal_category', dealCategory)

    const [s, r, t] = await Promise.all([
      steps,
      supabase
        .from('fr_compliance_milestones')
        .select('id, title, due_date, grant_id, fr_grants!inner(deleted_at, fr_organisations(name))')
        .eq('owner_user_id', me)
        .is('deleted_at', null)
        .is('fr_grants.deleted_at', null)
        .in('status', ['upcoming', 'in_progress', 'overdue'])
        .lte('due_date', daysFromToday(60))
        .order('due_date')
        .limit(20),
      supabase
        .from('fr_activities')
        .select('id, subject, parent_type, parent_id')
        .eq('activity_type', 'task')
        .eq('assignee_user_id', me)
        .eq('task_status', 'open')
        .is('deleted_at', null)
        .order('activity_date', { ascending: false })
        .limit(20),
    ])

    type Step = { id: string; name: string; next_step: string | null; next_step_date: string; fr_organisations: { name: string } | null }
    type Report = { id: string; title: string; due_date: string; grant_id: string; fr_grants: { fr_organisations: { name: string } | null } | null }
    type Task = { id: string; subject: string | null; parent_type: string; parent_id: string }

    const all: Item[] = [
      ...((s.data ?? []) as unknown as Step[]).map((d): Item => ({
        key: `s${d.id}`,
        kind: 'next_step',
        title: d.name,
        detail: [d.next_step ?? 'No next step written down', d.fr_organisations?.name].filter(Boolean).join(' · '),
        due: d.next_step_date,
        link: { to: '/opportunities/$id', id: d.id },
      })),
      ...((r.data ?? []) as unknown as Report[]).map((m): Item => ({
        key: `r${m.id}`,
        kind: 'report',
        title: m.title,
        detail: m.fr_grants?.fr_organisations?.name ?? null,
        due: m.due_date,
        link: { to: '/grants/$id', id: m.grant_id },
      })),
      ...((t.data ?? []) as Task[]).map((a): Item => ({
        key: `t${a.id}`,
        kind: 'task',
        title: a.subject ?? 'Task',
        detail: null,
        due: null,
        link: DETAIL_ROUTES[a.parent_type] ? { to: DETAIL_ROUTES[a.parent_type], id: a.parent_id } : null,
      })),
    ]
    all.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    setItems(all)
  }, [access.employeeId, dealCategory])

  useEffect(() => { void load() }, [load])

  return (
    <HomeCard
      title="Actions"
      meta={items && items.length > 0 ? <Badge tone="brown">{items.length}</Badge> : null}
    >
      {items === null ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={36} />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing waiting on you"
          body="Next steps due this week, reports due in the next 60 days, and tasks assigned to you show here."
        />
      ) : (
        <div className="feed">
          {items.map((it) => {
            const badge = it.kind === 'task' ? { tone: 'outline' as const, label: 'Task' } : dueBadge(it.due)
            return (
              <article key={it.key} className="feeditem">
                <span className="feeditem__icon" aria-hidden="true">{ICON[it.kind]}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="feeditem__head">
                    {it.link ? (
                      <Link to={it.link.to} params={{ id: it.link.id }} className="feeditem__subject celllink">
                        {it.title}
                      </Link>
                    ) : <span className="feeditem__subject">{it.title}</span>}
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  {it.detail ? <p className="feeditem__body">{it.detail}</p> : null}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </HomeCard>
  )
}

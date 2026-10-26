import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * @mentions in notes. Anyone on the fundraising team can be tagged — super
 * admins, the fundraising manager and active team members — and is sent an
 * in-app notification that links back to the record. Mentions are stored in
 * the text as "@Full Name", so finding them again is a text match against the
 * team list.
 */

export type FrPerson = { id: string; name: string }

let cache: FrPerson[] | null = null
let pending: Promise<FrPerson[]> | null = null

async function loadPeople(): Promise<FrPerson[]> {
  const [emps, team] = await Promise.all([
    supabase.from('employees').select('id, name, erp_role, managed_module').eq('is_active', true),
    supabase.from('fr_team_members').select('user_id').eq('is_active', true).is('deleted_at', null),
  ])
  const onTeam = new Set(((team.data ?? []) as Array<{ user_id: string }>).map((t) => t.user_id))
  type Emp = { id: string; name: string; erp_role: string; managed_module: string | null }
  return ((emps.data ?? []) as Emp[])
    .filter((e) => e.erp_role === 'super_admin'
      || (e.erp_role === 'manager' && e.managed_module === 'fundraising')
      || onTeam.has(e.id))
    .map((e) => ({ id: e.id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The fundraising team, loaded once per session. */
export function useFrPeople(): FrPerson[] {
  const [people, setPeople] = useState<FrPerson[]>(cache ?? [])
  useEffect(() => {
    if (cache) return
    let active = true
    pending ??= loadPeople()
    void pending.then((p) => { cache = p; if (active) setPeople(p) })
    return () => { active = false }
  }, [])
  return people
}

/**
 * People whose "@Name" appears in the text, as whole names. Longer names win:
 * "@Sai Krishna" tags Sai Krishna, not also someone called just "Sai".
 */
export function mentionedIds(text: string | null | undefined, people: FrPerson[]): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const taken: Array<[number, number]> = []
  const found = new Set<string>()
  const byLength = [...people].sort((a, b) => b.name.length - a.name.length)
  for (const p of byLength) {
    const tag = `@${p.name.toLowerCase()}`
    for (let i = lower.indexOf(tag); i >= 0; i = lower.indexOf(tag, i + 1)) {
      const end = i + tag.length
      const next = lower[end]
      if (next !== undefined && /[a-z0-9]/.test(next)) continue
      if (taken.some(([s0, e0]) => i >= s0 && i < e0)) continue
      taken.push([i, end])
      found.add(p.id)
    }
  }
  return people.filter((p) => found.has(p.id)).map((p) => p.id)
}

export type MentionTarget = 'opportunity' | 'organisation' | 'grant' | 'contact' | 'lead'

/**
 * Notifies people newly tagged in a saved note — tagged in `after` but not in
 * `before` — so editing a note does not re-notify everyone already in it.
 * Never throws: a failed notification must not undo a save that succeeded.
 */
export async function notifyMentions(opts: {
  before: string | null | undefined
  after: string | null | undefined
  people: FrPerson[]
  parentType: MentionTarget
  parentId: string
  /** Where on the record it was written; 'activity' opens the Activity tab. */
  source?: 'notes' | 'activity'
  selfId: string | null
}): Promise<number> {
  const already = new Set(mentionedIds(opts.before, opts.people))
  const fresh = mentionedIds(opts.after, opts.people).filter((id) => !already.has(id) && id !== opts.selfId)
  if (fresh.length === 0) return 0
  const { data, error } = await supabase.rpc('fr_notify_mentions', {
    p_recipients: fresh,
    p_parent_type: opts.parentType,
    p_parent_id: opts.parentId,
    p_snippet: (opts.after ?? '').trim().slice(0, 280),
    p_source: opts.source ?? 'notes',
  })
  if (error) { console.error('mention notification failed', error.message); return 0 }
  return Number(data ?? 0)
}

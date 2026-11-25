import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type TeamPerson = { id: string; name: string; email: string }

/**
 * The fundraising team: active staff on the FR team, plus super admins and
 * the fundraising manager (who have access without a team row). For owner
 * and collaborator pickers. Loaded fresh each time a screen opens, so someone
 * just added shows up without a page refresh.
 */
export function useFrTeam() {
  const [team, setTeam] = useState<TeamPerson[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const [{ data: emps }, { data: members }] = await Promise.all([
        supabase.from('employees').select('id, name, email, erp_role, managed_module').eq('is_active', true).order('name'),
        supabase.from('fr_team_members').select('user_id').eq('is_active', true).is('deleted_at', null),
      ])
      if (!active) return
      const onTeam = new Set(((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id))
      setTeam(((emps ?? []) as Array<TeamPerson & { erp_role: string | null; managed_module: string | null }>)
        .filter((e) => onTeam.has(e.id) || e.erp_role === 'super_admin'
          || (e.erp_role === 'manager' && e.managed_module === 'fundraising'))
        .map(({ id, name, email }) => ({ id, name, email })))
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  return { team, loading }
}

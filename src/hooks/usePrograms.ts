import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type Program = { id: string; code: string; name: string }
export type Project = { id: string; code: string; name: string; program_id: string }

let cache: { programs: Program[]; projects: Project[] } | null = null

/**
 * The ~12 programs and the projects nested under them. Projects are always
 * resolved by `code`, never by name — names drift, codes do not.
 */
export function usePrograms() {
  const [programs, setPrograms] = useState<Program[]>(cache?.programs ?? [])
  const [projects, setProjects] = useState<Project[]>(cache?.projects ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    if (cache !== null) return
    let active = true
    ;(async () => {
      const [p, pr] = await Promise.all([
        supabase.from('fr_programs').select('id, code, name').eq('is_active', true).order('sort_order'),
        supabase.from('fr_projects').select('id, code, name, program_id').eq('is_active', true).order('code'),
      ])
      if (!active) return
      cache = {
        programs: (p.data ?? []) as Program[],
        projects: (pr.data ?? []) as Project[],
      }
      setPrograms(cache.programs)
      setProjects(cache.projects)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  return { programs, projects, loading }
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type EmployeeOption = { id: string; name: string; email: string }

let cache: EmployeeOption[] | null = null

/** Active staff, for owner pickers. Cached for the session — it barely changes. */
export function useEmployees() {
  const [employees, setEmployees] = useState<EmployeeOption[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    if (cache !== null) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('employees')
        .select('id, name, email')
        .eq('is_active', true)
        .order('name')
      if (!active) return
      cache = (data ?? []) as EmployeeOption[]
      setEmployees(cache)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  return { employees, loading }
}

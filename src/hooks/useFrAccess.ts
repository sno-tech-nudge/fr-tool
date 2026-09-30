import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export type FrAccess = {
  loading: boolean
  /** May use the module at all. */
  authorised: boolean
  /** May edit reference data, see every confidential record, manage the team. */
  isManager: boolean
  /** This user's employees.id — the value every owner_user_id FK stores. */
  employeeId: string | null
  employeeName: string | null
  frSubRole: 'lead' | 'member' | 'finance' | null
  /** Which half of the job: hunting new donors or managing existing partners. */
  frFocus: 'hunting' | 'pm' | null
  erpRole: string | null
  error: string | null
}

const initial: FrAccess = {
  loading: true,
  authorised: false,
  isManager: false,
  employeeId: null,
  employeeName: null,
  frSubRole: null,
  frFocus: null,
  erpRole: null,
  error: null,
}

/**
 * Resolves the signed-in user's FR access by calling the three SQL helpers.
 * Those helpers resolve identity from the JWT email, so this returns false for
 * anyone without a matching active `employees` row — it fails closed.
 */
export function useFrAccess(): FrAccess {
  const { session, email } = useAuth()

  /**
   * Deliberately a boolean, not the session object. Supabase hands back a NEW
   * session object every time it refreshes the token, which it does whenever
   * the tab regains focus. Depending on that object re-ran this effect on
   * every return to the tab, which flipped the layout back to its boot
   * skeleton and tore down the whole page underneath — losing anything
   * half-typed, including an open Won wizard. The signed-in email is what
   * actually decides access, and that does not change on a refresh.
   */
  const signedIn = Boolean(session)
  const [state, setState] = useState<FrAccess>(initial)

  // Access is re-checked quietly after the first time: showing the skeleton
  // again would unmount the page for a question we already have an answer to.
  const resolvedOnce = useRef(false)

  useEffect(() => {
    if (!signedIn || !email) {
      resolvedOnce.current = false
      setState({ ...initial, loading: false })
      return
    }
    let active = true
    setState((s) => ({ ...s, loading: !resolvedOnce.current, error: null }))

    const resolve = () => Promise.all([
      supabase.rpc('is_fr_authorised'),
      supabase.rpc('is_fr_manager'),
      supabase
        .from('employees')
        .select('id, name, erp_role, fr_team_members(fr_sub_role, is_active, deleted_at)')
        .ilike('email', email)
        .maybeSingle(),
    ])

    ;(async () => {
      let [authorised, manager, employee] = await resolve()

      /**
       * A freshly minted token can carry an `iat` a fraction of a second ahead
       * of the database clock, which Postgres rejects outright with "JWT issued
       * at future". It resolves itself as the clock advances, so retry once
       * rather than showing the user an error they can only click through.
       */
      const skewed = [authorised.error, manager.error, employee.error]
        .some((e) => e?.message?.toLowerCase().includes('issued at future'))
      if (skewed) {
        await new Promise((r) => setTimeout(r, 1200))
        if (!active) return
        ;[authorised, manager, employee] = await resolve()
      }
      if (!active) return

      const rpcError = authorised.error ?? manager.error ?? employee.error

      // fr_team_members has unique(user_id), so PostgREST classifies the
      // relationship as to-ONE and embeds a single object rather than an
      // array. Normalise both shapes — a future schema change that drops the
      // unique constraint would silently flip it back to an array.
      type Membership = {
        fr_sub_role: FrAccess['frSubRole']
        is_active: boolean
        deleted_at: string | null
      }
      const embedded = employee.data?.fr_team_members as
        | Membership | Membership[] | null | undefined
      const membership: Membership[] = Array.isArray(embedded)
        ? embedded
        : embedded
          ? [embedded]
          : []
      const activeMembership = membership.find((m) => m.is_active && !m.deleted_at)

      // The team tag is read on its own and allowed to fail: if the column is
      // missing (SQL not run yet) access must still resolve, not error out.
      let focus: FrAccess['frFocus'] = null
      if (employee.data?.id) {
        const { data: f } = await supabase
          .from('fr_team_members')
          .select('focus')
          .eq('user_id', employee.data.id)
          .is('deleted_at', null)
          .maybeSingle()
        focus = ((f as { focus?: FrAccess['frFocus'] } | null)?.focus) ?? null
        if (!active) return
      }

      resolvedOnce.current = true
      setState({
        loading: false,
        authorised: authorised.data === true,
        isManager: manager.data === true,
        employeeId: employee.data?.id ?? null,
        employeeName: employee.data?.name ?? null,
        frSubRole: activeMembership?.fr_sub_role ?? null,
        frFocus: activeMembership ? focus : null,
        erpRole: employee.data?.erp_role ?? null,
        error: rpcError ? rpcError.message : null,
      })
    })()

    return () => {
      active = false
    }
  }, [signedIn, email])

  return state
}

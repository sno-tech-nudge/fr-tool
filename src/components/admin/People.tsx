import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, EmptyState, Select, TableSkeleton, useToast,
} from '../ui'
import { useAccess } from '../../lib/accessContext'

type Person = {
  id: string
  name: string
  email: string
  erp_role: string
  managed_module: string | null
  is_active: boolean
}

const ERP_ROLES = [
  { value: 'super_admin', label: 'Super admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'member', label: 'Member' },
] as const

/** Every module a manager can be scoped to. Only one exists so far. */
const MODULES = [{ value: 'fundraising', label: 'Fundraising' }] as const

/**
 * How this person currently reaches the fundraising module, mirroring
 * is_fr_authorised(). Shown because "why can I not see them on the team page"
 * is otherwise a confusing question — a manager scoped to fundraising has full
 * access without any team-member row at all.
 */
function frAccess(p: Person, onTeam: boolean): { tone: 'green' | 'outline'; label: string } {
  if (!p.is_active) return { tone: 'outline', label: 'Inactive' }
  if (p.erp_role === 'super_admin' || p.erp_role === 'admin') {
    return { tone: 'green', label: `Via ${p.erp_role === 'admin' ? 'admin' : 'super admin'}` }
  }
  if (p.erp_role === 'manager' && p.managed_module === 'fundraising') {
    return { tone: 'green', label: 'Via manager' }
  }
  if (onTeam) return { tone: 'green', label: 'Via team' }
  return { tone: 'outline', label: 'No access' }
}

/**
 * Nucleus-level people administration: who holds which ERP role.
 *
 * This is deliberately its own screen rather than part of the FR team page —
 * `employees` belongs to Nucleus, not fundraising, so when the two merge this
 * whole screen lifts out and its two SQL statements are revoked (see
 * sql/phase0/08_employees_role_admin.sql).
 */
export function People() {
  const toast = useToast()
  const meId = useAccess().employeeId
  const [people, setPeople] = useState<Person[] | null>(null)
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setPeople(null)
    setError(null)
    const [staff, team] = await Promise.all([
      supabase.from('employees')
        .select('id, name, email, erp_role, managed_module, is_active')
        .order('name'),
      supabase.from('fr_team_members').select('user_id').is('deleted_at', null).eq('is_active', true),
    ])
    if (staff.error) { setError(staff.error.message); setPeople([]); return }
    setPeople((staff.data ?? []) as Person[])
    setTeamIds(new Set(((team.data ?? []) as Array<{ user_id: string }>).map((t) => t.user_id)))
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(p: Person, patch: Partial<Person>) {
    setSavingId(p.id)
    const { data, error: err } = await supabase
      .from('employees')
      .update(patch)
      .eq('id', p.id)
      .select('id, name, email, erp_role, managed_module, is_active')
      .single()
    setSavingId(null)

    if (err) {
      toast.error(
        err.message.includes('permission denied')
          ? 'Only a super admin can change roles, and not their own.'
          : err.message,
      )
      return
    }
    setPeople((prev) => (prev ?? []).map((x) => (x.id === p.id ? (data as Person) : x)))
    toast.success('Role updated.')
  }

  /** A manager with no module reaches nothing, so the two move together. */
  function setRole(p: Person, role: string) {
    const patch: Partial<Person> = { erp_role: role }
    if (role !== 'manager') patch.managed_module = null
    else if (!p.managed_module) patch.managed_module = 'fundraising'
    void save(p, patch)
  }

  return (
    <div className="stack">
      <div>
        <h2 className="page__title">People</h2>
        <p className="page__sub">
          ERP roles are Nucleus-wide, not fundraising-only — changing one here changes what that
          person can do across every module. Super admins only, and nobody can change their own.
        </p>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load people"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : people === null ? (
        <TableSkeleton rows={4} cols={5} />
      ) : people.length === 0 ? (
        <div className="card">
          <EmptyState title="No employees" body="Nobody has an employees record yet." />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th style={{ width: '170px' }}>ERP role</th>
                <th style={{ width: '170px' }}>Manages</th>
                <th style={{ width: '140px' }}>FR access</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const isMe = p.id === meId
                const access = frAccess(p, teamIds.has(p.id))
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      {isMe ? <> <Badge tone="outline">You</Badge></> : null}
                      {!p.is_active ? <> <Badge tone="outline">Inactive</Badge></> : null}
                    </td>
                    <td className="muted">{p.email}</td>
                    <td>
                      <Select
                        value={p.erp_role}
                        aria-label={`ERP role for ${p.name}`}
                        disabled={isMe || savingId === p.id}
                        onChange={(e) => setRole(p, e.currentTarget.value)}
                      >
                        {ERP_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      {p.erp_role === 'manager' ? (
                        <Select
                          value={p.managed_module ?? ''}
                          aria-label={`Module managed by ${p.name}`}
                          disabled={isMe || savingId === p.id}
                          onChange={(e) => void save(p, { managed_module: e.currentTarget.value || null })}
                        >
                          <option value="">No module</option>
                          {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </Select>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td><Badge tone={access.tone}>{access.label}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="chartsub">
        Someone can only sign in once they also have an auth user with the same email — that is
        created in the Supabase dashboard, and the two ids are expected to differ.
      </p>
    </div>
  )
}

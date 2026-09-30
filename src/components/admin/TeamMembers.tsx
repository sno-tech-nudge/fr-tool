import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Badge, Button, ConfirmDialog, EmptyState, Select, TableSkeleton, useToast,
} from '../ui'
import { formatDate } from '../../lib/format'

type Employee = { id: string; name: string; email: string; erp_role: string }
type Member = {
  id: string
  user_id: string
  fr_sub_role: 'lead' | 'member' | 'finance'
  focus: 'hunting' | 'pm' | null
  is_active: boolean
  created_at: string
  employees: Employee | null
}

const SUB_ROLES = [
  { value: 'lead', label: 'Lead' },
  { value: 'member', label: 'Member' },
  { value: 'finance', label: 'Finance' },
] as const

/** Decides whether the Remaining collections tab shows on their home page. */
const FOCUS = [
  { value: 'hunting', label: 'Hunting' },
  { value: 'pm', label: 'Partner management' },
] as const

const MEMBER_COLS = 'id, user_id, fr_sub_role, focus, is_active, created_at, employees(id, name, email, erp_role)'

/**
 * FR sub-role membership. This layer sits on top of the global ERP roles and
 * never touches them — adding someone here grants module access without
 * changing anything about their Nucleus-wide role.
 */
export function TeamMembers({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [adding, setAdding] = useState(false)
  const [newUserId, setNewUserId] = useState('')
  const [newRole, setNewRole] = useState<string>('member')
  const [newFocus, setNewFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)

  const load = useCallback(async () => {
    setMembers(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_team_members')
      .select(MEMBER_COLS)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (err) { setError(err.message); setMembers([]); return }
    setMembers((data ?? []) as unknown as Member[])
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!canEdit) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('employees')
        .select('id, name, email, erp_role')
        .eq('is_active', true)
        .order('name')
      if (active) setEmployees((data ?? []) as Employee[])
    })()
    return () => { active = false }
  }, [canEdit])

  async function addMember() {
    if (!newUserId) { toast.error('Pick a person first.'); return }
    if (!newFocus) { toast.error('Choose Hunting or Partner management.'); return }
    setBusy(true)
    const { data, error: err } = await supabase
      .from('fr_team_members')
      .insert({ user_id: newUserId, fr_sub_role: newRole, focus: newFocus, is_active: true })
      .select(MEMBER_COLS)
      .single()
    setBusy(false)
    if (err) {
      toast.error(
        err.message.includes('duplicate key')
          ? 'That person is already on the FR team.'
          : err.message,
      )
      return
    }
    setMembers((prev) => [...(prev ?? []), data as unknown as Member])
    setAdding(false)
    setNewUserId('')
    setNewRole('member')
    setNewFocus('')
    toast.success('Added to the FR team.')
  }

  async function updateMember(id: string, patch: Partial<Member>) {
    const { data, error: err } = await supabase
      .from('fr_team_members')
      .update(patch)
      .eq('id', id)
      .select(MEMBER_COLS)
      .single()
    if (err) { toast.error(err.message); return }
    setMembers((prev) => (prev ?? []).map((m) => (m.id === id ? (data as unknown as Member) : m)))
    toast.success('Saved.')
  }

  async function removeMember() {
    if (!removeTarget) return
    setBusy(true)
    // Soft delete — the module never hard-deletes.
    const { error: err } = await supabase
      .from('fr_team_members')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', removeTarget.id)
    setBusy(false)
    if (err) { toast.error(err.message); setRemoveTarget(null); return }
    setMembers((prev) => (prev ?? []).filter((m) => m.id !== removeTarget.id))
    setRemoveTarget(null)
    toast.success('Removed from the FR team.')
  }

  const alreadyMember = new Set((members ?? []).map((m) => m.user_id))
  const assignable = employees.filter((e) => !alreadyMember.has(e.id))

  return (
    <div className="stack">
      <div className="page__head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page__title">Team members</h2>
          <p className="page__sub">
            FR sub-roles sit on top of global ERP roles. Super admins and the fundraising manager
            already have full access without appearing here.
          </p>
        </div>
        {canEdit && !adding ? (
          <Button iconLeft={<Plus size={15} />} onClick={() => setAdding(true)}>Add member</Button>
        ) : null}
      </div>

      {adding ? (
        <div className="card">
          <div className="row row--wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-4)' }}>
            <div className="grow" style={{ minWidth: 240 }}>
              <Select
                label="Person"
                value={newUserId}
                onChange={(e) => setNewUserId(e.currentTarget.value)}
              >
                <option value="">Select an employee</option>
                {assignable.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} · {e.email}</option>
                ))}
              </Select>
            </div>
            <div style={{ minWidth: 160 }}>
              <Select label="FR role" value={newRole} onChange={(e) => setNewRole(e.currentTarget.value)}>
                {SUB_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </div>
            <div style={{ minWidth: 190 }}>
              <Select label="Team" value={newFocus} onChange={(e) => setNewFocus(e.currentTarget.value)}>
                <option value="">Choose a team</option>
                {FOCUS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
            <Button onClick={() => void addMember()} disabled={busy}>
              {busy ? 'Adding…' : 'Add'}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              <X size={15} />
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load the team"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : members === null ? (
        <TableSkeleton rows={4} cols={6} />
      ) : members.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No FR team members yet"
            body="Access still works for super admins and the fundraising manager."
          />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th style={{ width: '140px' }}>ERP role</th>
                <th style={{ width: '150px' }}>FR role</th>
                <th style={{ width: '210px' }}>Team</th>
                <th style={{ width: '110px' }}>Active</th>
                <th style={{ width: '130px' }}>Added</th>
                {canEdit ? <th className="col-actions">&nbsp;</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.employees?.name ?? <span className="faint">Unknown</span>}</td>
                  <td className="muted">{m.employees?.email ?? '—'}</td>
                  <td><Badge tone="outline">{m.employees?.erp_role ?? '—'}</Badge></td>
                  <td>
                    {canEdit ? (
                      <Select
                        value={m.fr_sub_role}
                        aria-label="FR role"
                        onChange={(e) => void updateMember(m.id, { fr_sub_role: e.currentTarget.value as Member['fr_sub_role'] })}
                      >
                        {SUB_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    ) : (
                      <Badge>{m.fr_sub_role}</Badge>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <Select
                        value={m.focus ?? ''}
                        aria-label="Team"
                        onChange={(e) => void updateMember(m.id, { focus: (e.currentTarget.value || null) as Member['focus'] })}
                      >
                        <option value="">Not set</option>
                        {FOCUS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </Select>
                    ) : (
                      <Badge>{FOCUS.find((f) => f.value === m.focus)?.label ?? 'Not set'}</Badge>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.is_active}
                      disabled={!canEdit}
                      aria-label="Active"
                      onChange={(e) => void updateMember(m.id, { is_active: e.currentTarget.checked })}
                      style={{ accentColor: 'var(--action)', width: 15, height: 15 }}
                    />
                  </td>
                  <td className="tn-num muted">{formatDate(m.created_at)}</td>
                  {canEdit ? (
                    <td className="col-actions">
                      <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setRemoveTarget(m)}>
                        <Trash2 size={15} />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove from the FR team?"
        body={
          removeTarget?.employees
            ? `${removeTarget.employees.name} will lose access to the fundraising module.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={() => void removeMember()}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}

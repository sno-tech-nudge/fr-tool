import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, ConfirmDialog, EmptyState, TableSkeleton, useToast } from '../ui'
import { TeamPicker } from '../TeamPicker'
import { useFrTeam } from '../../hooks/useFrTeam'
import { useAccess } from '../../lib/accessContext'

/**
 * Temporary: maps each owner name from the Zoho export to a team member, then
 * Apply sets the real owners on imported deals and companies. Remove once
 * everyone is in the tool and mapped (sql/phase5/zoho_owners.sql).
 */

type Summary = { name: string; deals: number; companies: number; pm_deals: number }

export function ZohoOwners() {
  const toast = useToast()
  const access = useAccess()
  const { team } = useFrTeam()
  const [rows, setRows] = useState<Summary[] | null>(null)
  const [map, setMap] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    const [s, m] = await Promise.all([
      supabase.from('fr_zoho_owner_summary').select('name, deals, companies, pm_deals'),
      supabase.from('fr_zoho_owner_map').select('zoho_owner, employee_id'),
    ])
    if (s.error || m.error) { setError((s.error ?? m.error)!.message); setRows([]); return }
    setRows(((s.data ?? []) as Summary[])
      .sort((a, b) => (b.deals + b.companies + b.pm_deals) - (a.deals + a.companies + a.pm_deals)))
    setMap(Object.fromEntries(((m.data ?? []) as Array<{ zoho_owner: string; employee_id: string | null }>)
      .map((r) => [r.zoho_owner, r.employee_id])))
  }, [])

  useEffect(() => { void load() }, [load])

  async function setPerson(name: string, employeeId: string | null) {
    const before = map[name] ?? null
    setMap((prev) => ({ ...prev, [name]: employeeId }))
    const { error: err } = await supabase
      .from('fr_zoho_owner_map')
      .upsert({ zoho_owner: name, employee_id: employeeId, updated_at: new Date().toISOString(), updated_by: access.employeeId })
      .select()
      .single()
    if (err) {
      setMap((prev) => ({ ...prev, [name]: before }))
      toast.error(err.message)
    }
  }

  async function apply() {
    setApplying(true)
    const { data, error: err } = await supabase.rpc('fr_apply_zoho_owners')
    setApplying(false)
    setConfirming(false)
    if (err) { toast.error(err.message); return }
    const r = data as { deals: number; pm: number; companies: number }
    toast.success(`Updated ${r.deals} deals, ${r.companies} companies, ${r.pm} PM owners`)
  }

  if (error) return <div className="card"><EmptyState title="Could not load Zoho owners" body={error} /></div>
  if (rows === null) return <TableSkeleton rows={8} cols={5} />
  if (rows.length === 0) return <div className="card"><EmptyState title="No Zoho owner data loaded" /></div>

  const mappedCount = rows.filter((r) => map[r.name]).length

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span className="muted tn-num">{mappedCount} of {rows.length} mapped</span>
        <Button onClick={() => setConfirming(true)} disabled={mappedCount === 0 || applying}>Apply</Button>
      </div>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Zoho name</th>
              <th style={{ width: '90px' }}>Deals</th>
              <th style={{ width: '110px' }}>Companies</th>
              <th style={{ width: '90px' }}>PM on</th>
              <th style={{ width: '280px' }}>Team member</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="tn-num">{r.deals || '—'}</td>
                <td className="tn-num">{r.companies || '—'}</td>
                <td className="tn-num">{r.pm_deals || '—'}</td>
                <td>
                  <TeamPicker
                    people={team}
                    value={map[r.name] ?? null}
                    onChange={(id) => void setPerson(r.name, id)}
                    label={`Team member for ${r.name}`}
                    placeholder="Not mapped"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Apply Zoho owners?"
        body={`Imported deals and companies of the ${mappedCount} mapped names go to their team member. Anything temporarily with a mapped person that Zoho gives to someone else comes back to you.`}
        confirmLabel="Apply"
        busy={applying}
        onConfirm={() => void apply()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

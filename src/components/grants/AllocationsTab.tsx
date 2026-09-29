import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Button, ConfirmDialog, EmptyState, Input, Select, TableSkeleton, useToast,
} from '../ui'
import { formatMoney } from '../../lib/format'
import { fiscalYearOptions } from '../../lib/fy'
import { usePrograms } from '../../hooks/usePrograms'

type Allocation = {
  id: string
  program_id: string
  project_id: string | null
  fiscal_year: string | null
  amount_inr: number | null
  geography: string | null
  fr_programs: { id: string; code: string; name: string } | null
  fr_projects: { id: string; code: string; name: string } | null
}

const SELECT_COLS = '*, fr_programs(id, code, name), fr_projects(id, code, name)'

/**
 * Splits a grant across programs, projects and fiscal years. The running total
 * is checked against the grant's committed value so an unbalanced split is
 * visible while it is being entered rather than at reporting time.
 */
export function AllocationsTab({
  grantId, committedInr, currency,
}: {
  grantId: string
  committedInr: number
  currency: string
}) {
  const toast = useToast()
  const { programs, projects } = usePrograms()

  const [rows, setRows] = useState<Allocation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Allocation | null>(null)

  const [programId, setProgramId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [fy, setFy] = useState('')
  const [amount, setAmount] = useState('')
  const [geography, setGeography] = useState('')

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_grant_allocations')
      .select(SELECT_COLS)
      .eq('grant_id', grantId)
      .order('fiscal_year')
    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as Allocation[])
  }, [grantId])

  useEffect(() => { void load() }, [load])

  async function add() {
    if (!programId) { toast.error('Pick a program.'); return }
    if (!amount) { toast.error('Enter an amount.'); return }

    // The table's unique constraint treats a NULL project_id as distinct, so
    // it will happily store the same program/FY twice. Check here instead.
    const clash = (rows ?? []).some((r) =>
      r.program_id === programId
      && (r.project_id ?? '') === projectId
      && (r.fiscal_year ?? '') === fy)
    if (clash) {
      toast.error('That program, project and year is already allocated.')
      return
    }

    setBusy(true)
    const { data, error: err } = await supabase
      .from('fr_grant_allocations')
      .insert({
        grant_id: grantId,
        program_id: programId,
        project_id: projectId || null,
        fiscal_year: fy || null,
        amount: Number(amount),
        currency,
        amount_inr: Number(amount),
        geography: geography.trim() || null,
      })
      .select(SELECT_COLS)
      .single()
    setBusy(false)
    if (err) { toast.error(err.message); return }

    setRows((prev) => [...(prev ?? []), data as unknown as Allocation])
    setProgramId('')
    setProjectId('')
    setAmount('')
    setGeography('')
    toast.success('Allocation added.')
  }

  async function remove(row: Allocation) {
    const { error: err } = await supabase.from('fr_grant_allocations').delete().eq('id', row.id)
    setConfirmDelete(null)
    if (err) { toast.error(err.message); return }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id))
    toast.success('Allocation removed.')
  }

  const allocated = (rows ?? []).reduce((s, r) => s + Number(r.amount_inr ?? 0), 0)
  const variance = committedInr - allocated
  const projectsFor = projects.filter((p) => p.program_id === programId)

  return (
    <div className="stack">
      <div className="card stack">
        <div className="tn-micro">Add an allocation</div>
        <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Select
            label="Program"
            value={programId}
            onChange={(e) => { setProgramId(e.currentTarget.value); setProjectId('') }}
          >
            <option value="">—</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
          <Select
            label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.currentTarget.value)}
            disabled={!programId}
          >
            <option value="">—</option>
            {projectsFor.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </Select>
          <Select label="Fiscal year" value={fy} onChange={(e) => setFy(e.currentTarget.value)}>
            <option value="">—</option>
            {fiscalYearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Input
            label="Amount (INR)"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
          />
          <Input
            label="Geography"
            value={geography}
            onChange={(e) => setGeography(e.currentTarget.value)}
          />
          <Button onClick={() => void add()} disabled={busy}>Add</Button>
        </div>
      </div>

      {error ? (
        <div className="card"><EmptyState title="Could not load allocations" body={error} /></div>
      ) : rows === null ? (
        <TableSkeleton rows={4} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing allocated yet"
            body="Split the grant across the programs and years it funds, so reporting can roll up by program."
          />
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Program</th>
                  <th style={{ width: '120px' }}>Project</th>
                  <th style={{ width: '140px' }}>Fiscal year</th>
                  <th style={{ width: '150px' }}>Amount</th>
                  <th style={{ width: '140px' }}>Geography</th>
                  <th style={{ width: '60px' }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.fr_programs ? `${r.fr_programs.code} · ${r.fr_programs.name}` : '—'}</td>
                    <td className="muted">{r.fr_projects?.code ?? '—'}</td>
                    <td className="tn-num muted">{r.fiscal_year ?? '—'}</td>
                    <td className="tn-num">{formatMoney(r.amount_inr)}</td>
                    <td className="muted">{r.geography ?? '—'}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<Trash2 size={14} />}
                        onClick={() => setConfirmDelete(r)}
                        aria-label="Remove allocation"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card row" style={{ justifyContent: 'space-between' }}>
            <span className="tn-num">
              {formatMoney(allocated)} allocated of {formatMoney(committedInr)}
            </span>
            <span className="tn-num" style={{ color: variance === 0 ? 'var(--rag-green)' : 'var(--rag-amber)' }}>
              {variance === 0
                ? 'Fully allocated'
                : variance > 0
                  ? `${formatMoney(variance)} unallocated`
                  : `${formatMoney(Math.abs(variance))} over-allocated`}
            </span>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remove this allocation?"
        body="The amount goes back to unallocated. Nothing else about the grant changes."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete) }}
      />
    </div>
  )
}

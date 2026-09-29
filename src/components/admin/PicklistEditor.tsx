import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, X, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../ui'
import {
  Badge, Button, ConfirmDialog, EmptyState, Input, Select, TableSkeleton, Textarea,
} from '../ui'
import { formatDate } from '../../lib/format'
import type { FieldSpec, PicklistSpec } from './picklistSpecs'
import { invalidatePipelineStages } from '../../hooks/usePipelineStages'

type Row = Record<string, unknown>
type Draft = Record<string, string>
type FkOptions = Record<string, Array<{ value: string; label: string }>>

/* ---------- value <-> form-string conversion ---------- */

function toDraft(spec: PicklistSpec, row: Row | null): Draft {
  const d: Draft = {}
  for (const f of spec.fields) {
    const v = row?.[f.key]
    if (v == null) {
      d[f.key] = f.type === 'boolean' ? 'false' : ''
    } else if (f.type === 'boolean') {
      d[f.key] = v ? 'true' : 'false'
    } else if (f.type === 'tags') {
      d[f.key] = Array.isArray(v) ? v.join(', ') : String(v)
    } else if (f.type === 'json') {
      d[f.key] = typeof v === 'string' ? v : JSON.stringify(v)
    } else {
      d[f.key] = String(v)
    }
  }
  // Sensible defaults on a brand-new row.
  if (!row) {
    for (const f of spec.fields) {
      if (f.type === 'boolean' && f.key === 'is_active') d[f.key] = 'true'
      if (f.type === 'select' && f.required && !d[f.key]) d[f.key] = f.options?.[0]?.value ?? ''
    }
  }
  return d
}

/** Returns the payload, or throws with a human message. */
function fromDraft(spec: PicklistSpec, draft: Draft): Row {
  const out: Row = {}
  for (const f of spec.fields) {
    const raw = (draft[f.key] ?? '').trim()

    if (f.type === 'boolean') { out[f.key] = raw === 'true'; continue }

    if (!raw) {
      if (f.required) throw new Error(`${f.label} is required.`)
      out[f.key] = null
      continue
    }

    switch (f.type) {
      case 'number': {
        const n = Number(raw)
        if (Number.isNaN(n)) throw new Error(`${f.label} must be a number.`)
        out[f.key] = n
        break
      }
      case 'tags':
        out[f.key] = raw.split(',').map((s) => s.trim()).filter(Boolean)
        break
      case 'json':
        try { out[f.key] = JSON.parse(raw) } catch { throw new Error(`${f.label} must be valid JSON.`) }
        break
      default:
        out[f.key] = raw
    }
  }
  return out
}

function displayValue(
  f: FieldSpec, row: Row, fkOptions: FkOptions,
): React.ReactNode {
  const v = row[f.key]

  if (f.type === 'boolean') {
    if (f.key === 'is_fcra') {
      return v
        ? <Badge tone="fcra">FCRA</Badge>
        : <Badge tone="domestic">Domestic</Badge>
    }
    return v ? <Check size={15} aria-label="Yes" /> : <span className="faint">—</span>
  }
  if (v == null || v === '') return <span className="faint">—</span>
  if (f.type === 'color') {
    return (
      <span className="row" style={{ gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 14, height: 14, borderRadius: 2,
            background: String(v), border: '1px solid var(--border)',
          }}
        />
        <span className="tn-num faint" style={{ fontSize: 'var(--text-xs)' }}>{String(v)}</span>
      </span>
    )
  }
  if (f.type === 'date') return <span className="tn-num">{formatDate(String(v))}</span>
  if (f.type === 'number') return <span className="tn-num">{String(v)}</span>
  if (f.type === 'tags') return Array.isArray(v) ? v.join(', ') : String(v)
  if (f.type === 'json') return <span className="tn-num">{JSON.stringify(v)}</span>
  if (f.type === 'fk') {
    const opt = fkOptions[f.key]?.find((o) => o.value === String(v))
    return opt ? opt.label : <span className="faint">{String(v)}</span>
  }
  if (f.type === 'select') {
    const opt = f.options?.find((o) => o.value === String(v))
    return opt?.label ?? String(v)
  }
  return String(v)
}

/* ---------- one editable cell ---------- */

function FieldControl({
  field, value, onChange, fkOptions, isNew,
}: {
  field: FieldSpec
  value: string
  onChange: (next: string) => void
  fkOptions: FkOptions
  isNew: boolean
}) {
  const locked = field.immutable && !isNew

  if (field.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === 'true'}
        onChange={(e) => onChange(e.currentTarget.checked ? 'true' : 'false')}
        style={{ accentColor: 'var(--action)', width: 15, height: 15 }}
        aria-label={field.label}
      />
    )
  }
  if (field.type === 'select') {
    return (
      <Select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={field.label}>
        {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  }
  if (field.type === 'fk') {
    return (
      <Select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={field.label}>
        <option value="">—</option>
        {(fkOptions[field.key] ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    )
  }
  if (field.type === 'textarea') {
    return (
      <Textarea
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label={field.label}
        style={{ minHeight: '3.5rem' }}
      />
    )
  }
  return (
    <Input
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={value}
      disabled={locked}
      onChange={(e) => onChange(e.currentTarget.value)}
      aria-label={field.label}
      step={field.type === 'number' ? 'any' : undefined}
    />
  )
}

/* ============================================================
   PicklistEditor
   ============================================================ */

export function PicklistEditor({ spec, canEdit }: { spec: PicklistSpec; canEdit: boolean }) {
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fkOptions, setFkOptions] = useState<FkOptions>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)

  const tableFields = useMemo(() => spec.fields.filter((f) => !f.hideInTable), [spec])

  /* ---- load rows ---- */
  const load = useCallback(async () => {
    setRows(null)
    setLoadError(null)
    let q = supabase.from(spec.table).select('*')
    for (const o of spec.orderBy) q = q.order(o.column, { ascending: o.ascending ?? true })
    const { data, error } = await q
    if (error) { setLoadError(error.message); setRows([]); return }
    setRows(data ?? [])
  }, [spec])

  useEffect(() => {
    setEditingId(null)
    setAdding(false)
    void load()
  }, [load])

  /* ---- load fk option lists ---- */
  useEffect(() => {
    const fkFields = spec.fields.filter((f) => f.type === 'fk' && f.fk)
    if (fkFields.length === 0) { setFkOptions({}); return }
    let active = true
    ;(async () => {
      const entries = await Promise.all(fkFields.map(async (f) => {
        const cfg = f.fk!
        const { data } = await supabase
          .from(cfg.table)
          .select([cfg.valueKey, ...cfg.labelKeys].join(', '))
        const options = ((data ?? []) as unknown as Row[]).map((r) => ({
          value: String(r[cfg.valueKey]),
          label: cfg.labelKeys.map((k) => r[k]).filter(Boolean).join(' · '),
        }))
        return [f.key, options] as const
      }))
      if (active) setFkOptions(Object.fromEntries(entries))
    })()
    return () => { active = false }
  }, [spec])

  /* ---- mutations ----
     Every write uses .select().single() and updates local state immediately.
     Relying on a refetch alone to reflect a write is unreliable here. */

  async function saveNew() {
    setBusy(true)
    try {
      const payload = fromDraft(spec, draft)
      const { data, error } = await supabase.from(spec.table).insert(payload).select().single()
      if (error) throw new Error(error.message)
      setRows((prev) => [...(prev ?? []), data as Row])
      if (spec.table === 'fr_pipeline_stages') invalidatePipelineStages()
      setAdding(false)
      setDraft({})
      toast.success(`${spec.title} entry added.`)
      void load() // re-sort
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(id: string) {
    setBusy(true)
    try {
      const payload = fromDraft(spec, draft)
      // Never send an immutable natural key back on update.
      for (const f of spec.fields) if (f.immutable) delete payload[f.key]
      const { data, error } = await supabase
        .from(spec.table).update(payload).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? (data as Row) : r)))
      if (spec.table === 'fr_pipeline_stages') invalidatePipelineStages()
      setEditingId(null)
      toast.success('Saved.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (!deleteTarget) return
    setBusy(true)
    const id = String(deleteTarget.id)
    const { error } = await supabase.from(spec.table).delete().eq('id', id)
    setBusy(false)
    if (error) {
      toast.error(
        error.message.includes('violates foreign key')
          ? 'In use by existing records — deactivate it instead of deleting.'
          : error.message,
      )
    } else {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id))
      toast.success('Deleted.')
    }
    setDeleteTarget(null)
  }

  const colCount = tableFields.length + (canEdit ? 1 : 0)

  return (
    <div className="stack">
      <div className="page__head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page__title">{spec.title}</h2>
          {spec.description ? <p className="page__sub">{spec.description}</p> : null}
        </div>
        {canEdit && !adding ? (
          <Button
            iconLeft={<Plus size={15} />}
            onClick={() => { setDraft(toDraft(spec, null)); setAdding(true); setEditingId(null) }}
          >
            Add
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <div className="card">
          <EmptyState
            title="Could not load this list"
            body={loadError}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={6} cols={colCount} />
      ) : rows.length === 0 && !adding ? (
        <div className="card">
          <EmptyState
            title="Nothing here yet"
            body={canEdit ? undefined : 'Only an FR manager can add reference data.'}
            action={canEdit ? (
              <Button
                iconLeft={<Plus size={15} />}
                onClick={() => { setDraft(toDraft(spec, null)); setAdding(true) }}
              >
                Add the first entry
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                {tableFields.map((f) => (
                  <th key={f.key} style={f.width ? { width: f.width } : undefined}>{f.label}</th>
                ))}
                {canEdit ? <th className="col-actions">&nbsp;</th> : null}
              </tr>
            </thead>
            <tbody>
              {adding ? (
                <tr>
                  {tableFields.map((f) => (
                    <td key={f.key} className="is-editing">
                      <FieldControl
                        field={f}
                        value={draft[f.key] ?? ''}
                        onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                        fkOptions={fkOptions}
                        isNew
                      />
                    </td>
                  ))}
                  <td className="col-actions is-editing">
                    <span className="rowactions">
                      <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
                        <X size={15} />
                      </Button>
                      <Button size="sm" onClick={() => void saveNew()} disabled={busy}>
                        {busy ? 'Saving…' : 'Save'}
                      </Button>
                    </span>
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => {
                const id = String(row.id)
                const isEditing = editingId === id
                const inactive = row.is_active === false
                return (
                  <tr key={id}>
                    {tableFields.map((f) => (
                      <td
                        key={f.key}
                        className={[isEditing ? 'is-editing' : '', inactive && !isEditing ? 'cell-inactive' : '']
                          .filter(Boolean).join(' ')}
                      >
                        {isEditing ? (
                          <FieldControl
                            field={f}
                            value={draft[f.key] ?? ''}
                            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                            fkOptions={fkOptions}
                            isNew={false}
                          />
                        ) : (
                          displayValue(f, row, fkOptions)
                        )}
                      </td>
                    ))}
                    {canEdit ? (
                      <td className={`col-actions${isEditing ? ' is-editing' : ''}`}>
                        <span className="rowactions">
                          {isEditing ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={busy}>
                                <X size={15} />
                              </Button>
                              <Button size="sm" onClick={() => void saveEdit(id)} disabled={busy}>
                                {busy ? 'Saving…' : 'Save'}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Edit"
                                onClick={() => { setDraft(toDraft(spec, row)); setEditingId(id); setAdding(false) }}
                              >
                                <Pencil size={15} />
                              </Button>
                              {spec.deleteProtected ? null : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label="Delete"
                                  onClick={() => setDeleteTarget(row)}
                                >
                                  <Trash2 size={15} />
                                </Button>
                              )}
                            </>
                          )}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this entry?"
        body="If anything already references it the database will refuse — deactivate it instead."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

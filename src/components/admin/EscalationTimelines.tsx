import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { BellRing } from 'lucide-react'
import { Badge, Button, EmptyState, Input, TableSkeleton, useToast } from '../ui'
import { usePipelineStages } from '../../hooks/usePipelineStages'
import { useAccess } from '../../lib/accessContext'
import { ESCALATION_RECIPIENTS, recipientLabel } from '../../lib/notifications'

/**
 * How long a deal may sit at each stage before someone is chased, and who gets
 * chased — the FR team's escalation matrix, made editable.
 *
 * Amber is the first nudge and red the escalation above it. A blank threshold
 * means that stage never nudges, which is how the two closed stages are meant
 * to sit: they still list who to tell, but nothing is overdue about them.
 */

type Row = {
  stage_id: string
  amber_days: string
  amber_notify: string[]
  red_days: string
  red_notify: string[]
}

type Stored = {
  stage_id: string
  amber_days: number | null
  amber_notify: string[] | null
  red_days: number | null
  red_notify: string[] | null
}

const blank = (stageId: string): Row => ({
  stage_id: stageId, amber_days: '', amber_notify: [], red_days: '', red_notify: [],
})

export function EscalationTimelines() {
  const toast = useToast()
  const access = useAccess()
  const { stages } = usePipelineStages()

  const [rows, setRows] = useState<Record<string, Row> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  // Nucleus-wide roles only. A fundraising manager may read this but not
  // change thresholds that apply to the whole team.
  const canEdit = access.erpRole === 'super_admin' || access.erpRole === 'admin'

  const load = useCallback(async () => {
    if (stages.length === 0) return
    setRows(null)
    setError(null)
    const { data, error: err } = await supabase
      .from('fr_stage_escalations')
      .select('stage_id, amber_days, amber_notify, red_days, red_notify')
    if (err) { setError(err.message); return }

    const stored = new Map((data ?? []).map((d) => [(d as Stored).stage_id, d as Stored]))
    setRows(Object.fromEntries(stages.map((s) => {
      const hit = stored.get(s.id)
      return [s.id, hit ? {
        stage_id: s.id,
        amber_days: hit.amber_days != null ? String(hit.amber_days) : '',
        amber_notify: hit.amber_notify ?? [],
        red_days: hit.red_days != null ? String(hit.red_days) : '',
        red_notify: hit.red_notify ?? [],
      } : blank(s.id)]
    })))
  }, [stages])

  useEffect(() => { void load() }, [load])

  async function persist(row: Row) {
    setSavingId(row.stage_id)
    const { error: err } = await supabase
      .from('fr_stage_escalations')
      .upsert({
        stage_id: row.stage_id,
        amber_days: row.amber_days === '' ? null : Number(row.amber_days),
        amber_notify: row.amber_notify,
        red_days: row.red_days === '' ? null : Number(row.red_days),
        red_notify: row.red_notify,
        updated_by: access.employeeId,
      }, { onConflict: 'stage_id' })
    setSavingId(null)
    if (err) { toast.error(err.message); void load(); return }
  }

  function edit(stageId: string, patch: Partial<Row>, save: boolean) {
    setRows((prev) => {
      if (!prev) return prev
      const next = { ...prev[stageId], ...patch }
      if (save) void persist(next)
      return { ...prev, [stageId]: next }
    })
  }

  /**
   * The same pass the nightly job makes. Safe to press repeatedly: each
   * notification is keyed on deal, stage visit, level and recipient, so a
   * second run only adds what has newly crossed a threshold.
   */
  async function runNow() {
    setRunning(true)
    const { data, error: err } = await supabase.rpc('fr_run_stage_nudges')
    setRunning(false)
    if (err) { toast.error(err.message); return }
    const sent = Number(data ?? 0)
    toast.success(sent === 0
      ? 'Nothing new has crossed a threshold.'
      : `${sent} ${sent === 1 ? 'notification' : 'notifications'} sent.`)
  }

  function toggle(stageId: string, field: 'amber_notify' | 'red_notify', who: string) {
    const current = rows?.[stageId]?.[field] ?? []
    const next = current.includes(who)
      ? current.filter((w) => w !== who)
      : [...current, who]
    edit(stageId, { [field]: next }, true)
  }

  if (error) {
    return (
      <div className="card">
        <EmptyState
          title="Could not load the escalation timelines"
          body={`${error} — the fr_stage_escalations table may not exist yet.`}
        />
      </div>
    )
  }

  if (!rows) return <TableSkeleton rows={8} cols={5} />

  return (
    <div className="stack">
      {!canEdit ? (
        <p className="chartsub">
          These apply to the whole team, so only an admin or super admin can change them.
        </p>
      ) : null}

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Stage</th>
              <th style={{ width: '110px' }}>Amber after</th>
              <th>Notify</th>
              <th style={{ width: '110px' }}>Red after</th>
              <th>Notify</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => {
              const row = rows[s.id] ?? blank(s.id)
              return (
                <tr key={s.id} data-saving={savingId === s.id || undefined}>
                  <td>
                    {s.label}
                    {s.is_terminal ? <> <Badge tone="outline">Closed</Badge></> : null}
                  </td>
                  <td>
                    <DayCell
                      value={row.amber_days}
                      disabled={!canEdit}
                      onChange={(v) => edit(s.id, { amber_days: v }, false)}
                      onCommit={(v) => edit(s.id, { amber_days: v }, true)}
                    />
                  </td>
                  <td>
                    <Who
                      selected={row.amber_notify}
                      disabled={!canEdit}
                      onToggle={(w) => toggle(s.id, 'amber_notify', w)}
                    />
                  </td>
                  <td>
                    <DayCell
                      value={row.red_days}
                      disabled={!canEdit}
                      onChange={(v) => edit(s.id, { red_days: v }, false)}
                      onCommit={(v) => edit(s.id, { red_days: v }, true)}
                    />
                  </td>
                  <td>
                    <Who
                      selected={row.red_notify}
                      disabled={!canEdit}
                      onToggle={(w) => toggle(s.id, 'red_notify', w)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="chartsub" style={{ margin: 0 }}>
          Days count from when the deal entered its stage or last had an activity logged,
          whichever is later. Checked every morning at 9:00. Leave a threshold blank to never
          nudge at that stage.
        </p>
        {canEdit ? (
          <Button
            variant="secondary"
            iconLeft={<BellRing size={14} />}
            onClick={() => void runNow()}
            disabled={running}
          >
            {running ? 'Checking…' : 'Run now'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Writes on blur rather than per keystroke, so "15" is not saved as "1". */
function DayCell({
  value, disabled, onChange, onCommit,
}: {
  value: string
  disabled: boolean
  onChange: (v: string) => void
  onCommit: (v: string) => void
}) {
  return (
    <Input
      type="number"
      min={0}
      max={365}
      aria-label="Days"
      value={value}
      disabled={disabled}
      placeholder="—"
      onChange={(e) => onChange(e.currentTarget.value)}
      onBlur={(e) => onCommit(e.currentTarget.value)}
    />
  )
}

function Who({
  selected, disabled, onToggle,
}: {
  selected: string[]
  disabled: boolean
  onToggle: (who: string) => void
}) {
  if (disabled) {
    return selected.length === 0
      ? <span className="faint">—</span>
      : <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {selected.map(recipientLabel).join(', ')}
      </span>
  }
  return (
    <div className="pillrow">
      {ESCALATION_RECIPIENTS.map((r) => (
        <button
          key={r.value}
          type="button"
          className="pill pill--sm"
          data-active={selected.includes(r.value)}
          aria-pressed={selected.includes(r.value)}
          onClick={() => onToggle(r.value)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

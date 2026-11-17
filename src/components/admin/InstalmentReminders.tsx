import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, Checkbox, Input, Skeleton, useToast } from '../ui'
import { useAccess } from '../../lib/accessContext'

/**
 * The daily instalment reminders (sql/phase5/tranche_reminders.sql): the
 * switch that lets the job send anything, and the days it works from. The
 * job itself is scheduled in the database; while switched off it sends nothing.
 */

type Draft = { far: string; near: string; risk: string; lookback: string }

const KEYS = ['tranche_reminders_enabled', 'reminder_offset_days', 'tranche_at_risk_days', 'tranche_reminder_lookback_days']

export function InstalmentReminders() {
  const toast = useToast()
  const access = useAccess()
  const canEdit = access.isManager
  const [on, setOn] = useState<boolean | null>(null)
  const [draft, setDraft] = useState<Draft>({ far: '30', near: '7', risk: '15', lookback: '90' })
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void supabase.from('fr_settings').select('key, value').in('key', KEYS).then(({ data }) => {
      const v = new Map(((data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]))
      const offsets = Array.isArray(v.get('reminder_offset_days')) ? (v.get('reminder_offset_days') as number[]) : [30, 7]
      setOn(v.get('tranche_reminders_enabled') === true)
      setDraft({
        far: String(offsets[0] ?? 30),
        near: String(offsets[1] ?? 7),
        risk: String(v.get('tranche_at_risk_days') ?? 15),
        lookback: String(v.get('tranche_reminder_lookback_days') ?? 90),
      })
    })
  }, [])

  async function put(key: string, value: unknown): Promise<boolean> {
    const { error } = await supabase.from('fr_settings').upsert({ key, value }, { onConflict: 'key' }).select('key').single()
    if (error) { toast.error(error.message); return false }
    return true
  }

  async function toggle(next: boolean) {
    setBusy(true)
    const ok = await put('tranche_reminders_enabled', next)
    setBusy(false)
    if (!ok) return
    setOn(next)
    toast.success(next ? 'Instalment reminders are on. The job runs daily at 09:15.' : 'Instalment reminders are off.')
  }

  /** Days are saved when the field is left, so "15" is not saved as "1". */
  async function commit(field: keyof Draft) {
    const n = Number(draft[field])
    if (!Number.isInteger(n) || n < 0 || n > 365) { toast.error('Use a whole number of days, 0 to 365.'); return }
    const far = Number(draft.far), near = Number(draft.near)
    if ((field === 'far' || field === 'near') && near >= far) { toast.error('The second reminder must come after the first.'); return }
    if (field === 'far' || field === 'near') await put('reminder_offset_days', [far, near])
    if (field === 'risk') await put('tranche_at_risk_days', n)
    if (field === 'lookback') await put('tranche_reminder_lookback_days', n)
  }

  async function runNow() {
    setRunning(true)
    const { data, error } = await supabase.rpc('fr_run_tranche_reminders')
    setRunning(false)
    if (error) { toast.error(error.message); return }
    const sent = Number(data ?? 0)
    toast.success(sent === 0 ? 'No instalment needs a reminder today.' : `${sent} ${sent === 1 ? 'reminder' : 'reminders'} sent.`)
  }

  if (on === null) return <Skeleton height={120} />

  const day = (field: keyof Draft, label: string) => (
    <div className="remfield">
      <Input
        label={label}
        type="number"
        min={0}
        max={365}
        value={draft[field]}
        disabled={!canEdit}
        onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => ({ ...d, [field]: v })) }}
        onBlur={() => void commit(field)}
      />
    </div>
  )

  return (
    <div className="stack">
      <Checkbox
        label="Send instalment reminders"
        checked={on}
        disabled={!canEdit || busy}
        onChange={(v) => void toggle(v)}
      />
      <div className="remfields">
        {day('far', 'First reminder, days before')}
        {day('near', 'Second reminder, days before')}
        {day('risk', 'At risk after, days overdue')}
        {day('lookback', 'Skip if overdue over, days')}
      </div>
      {canEdit && on ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" iconLeft={<BellRing size={14} />} onClick={() => void runNow()} disabled={running}>
            {running ? 'Checking…' : 'Run now'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

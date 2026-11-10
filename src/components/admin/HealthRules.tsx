import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Skeleton, useToast } from '../ui'
import {
  DEFAULT_HEALTH_RULES, HEALTH_RULES_KEY, loadHealthRules, type HealthRules as Rules,
} from '../../lib/healthRules'

/**
 * The thresholds behind the organisation Overview's health colours. One
 * settings row for the whole team; anything a person sets by hand on an
 * organisation still overrides these.
 */

type NumKey = Exclude<keyof Rules, 'relationship_rule'>

export function HealthRules() {
  const toast = useToast()
  const [saved, setSaved] = useState<Rules | null>(null)
  const [draft, setDraft] = useState<Record<NumKey, string> & { relationship_rule: Rules['relationship_rule'] } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadHealthRules().then((r) => { setSaved(r); setDraft(toDraft(r)) })
  }, [])

  if (!saved || !draft) return <div className="card stack"><Skeleton height={28} /><Skeleton height={28} /><Skeleton height={28} /></div>

  const set = (k: NumKey, v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved))

  async function save() {
    if (!draft) return
    const next = { ...DEFAULT_HEALTH_RULES, relationship_rule: draft.relationship_rule } as Rules
    for (const k of Object.keys(draft) as Array<keyof typeof draft>) {
      if (k === 'relationship_rule') continue
      const n = Number(draft[k])
      if (draft[k].trim() === '' || !Number.isFinite(n) || n < 0) { toast.error('Every threshold needs a number of 0 or more.'); return }
      next[k] = n
    }
    if (next.collection_green_pct > 100 || next.collection_amber_pct > next.collection_green_pct) {
      toast.error('Collection: amber must be at or below green, and green at most 100%.')
      return
    }
    setBusy(true)
    const { data, error } = await supabase
      .from('fr_settings')
      .upsert({ key: HEALTH_RULES_KEY, value: next }, { onConflict: 'key' })
      .select('value')
      .single()
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const stored = (data as { value: Rules }).value
    setSaved(stored)
    setDraft(toDraft(stored))
    toast.success('Health rules saved.')
  }

  const num = (k: NumKey, unit: string) => (
    <span className="rulenum">
      <input
        className="input tn-num"
        inputMode="numeric"
        aria-label={`${k.replace(/_/g, ' ')}`}
        value={draft[k]}
        onChange={(e) => set(k, e.currentTarget.value)}
      />
      <span className="muted">{unit}</span>
    </span>
  )

  return (
    <div className="stack">
      <div className="tablewrap">
        <table className="table rulestable">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Measure</th>
              <th><span className="ragdot" data-rag="green" /> Green</th>
              <th><span className="ragdot" data-rag="amber" /> Amber</th>
              <th><span className="ragdot" data-rag="red" /> Red</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Collection
                <div className="faint rulesub">Received ÷ due so far</div>
              </td>
              <td><span className="rulerow">At or above {num('collection_green_pct', '%')}</span></td>
              <td><span className="rulerow">At or above {num('collection_amber_pct', '%')}</span></td>
              <td className="muted">Below amber</td>
            </tr>
            <tr>
              <td>
                Compliance
                <div className="faint rulesub">Reports and milestones</div>
              </td>
              <td className="muted">Nothing late or due soon</td>
              <td><span className="rulerow">Due within {num('compliance_amber_within_days', 'days')}</span></td>
              <td><span className="rulerow">Overdue over {num('compliance_red_after_days', 'days')}</span></td>
            </tr>
            <tr>
              <td>
                Renewal / upsell
                <div className="faint rulesub">Grants and open deals</div>
              </td>
              <td className="muted">An open renewal or upsell deal</td>
              <td><span className="rulerow">Grant ends within {num('renewal_amber_within_days', 'days')}</span></td>
              <td className="muted">—</td>
            </tr>
            <tr>
              <td>
                Relationship
                <div className="faint rulesub">Contact ratings</div>
              </td>
              <td colSpan={3}>
                <select
                  className="select rulesel"
                  aria-label="How contact ratings combine"
                  value={draft.relationship_rule}
                  onChange={(e) => {
                    const v = e.currentTarget.value === 'majority' ? 'majority' : 'worst'
                    setDraft((d) => (d ? { ...d, relationship_rule: v } : d))
                  }}
                >
                  <option value="worst">Worst contact rating</option>
                  <option value="majority">Most common contact rating</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Button onClick={() => void save()} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</Button>
        {dirty ? <Button variant="ghost" onClick={() => setDraft(toDraft(saved))} disabled={busy}>Discard</Button> : null}
      </div>
    </div>
  )
}

function toDraft(r: Rules) {
  return {
    collection_green_pct: String(r.collection_green_pct),
    collection_amber_pct: String(r.collection_amber_pct),
    compliance_red_after_days: String(r.compliance_red_after_days),
    compliance_amber_within_days: String(r.compliance_amber_within_days),
    renewal_amber_within_days: String(r.renewal_amber_within_days),
    relationship_rule: r.relationship_rule,
  }
}

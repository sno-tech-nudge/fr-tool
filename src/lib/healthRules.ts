import { supabase } from './supabase'

/**
 * The thresholds behind the organisation Overview's health colours, kept in
 * fr_settings under one key so a super admin can tune them without a deploy.
 * Missing or partial settings fall back to these defaults key by key.
 */

export type HealthRules = {
  /** Received ÷ due so far, as a percentage: at or above this is green. */
  collection_green_pct: number
  /** …at or above this is amber; below it, red. */
  collection_amber_pct: number
  /** A report overdue by more than this many days turns compliance red. */
  compliance_red_after_days: number
  /** Overdue within the grace above, or due within this many days: amber. */
  compliance_amber_within_days: number
  /** A grant ending within this many days with no open renewal or upsell: amber. */
  renewal_amber_within_days: number
  /** How contact ratings combine: the worst one, or the most common one. */
  relationship_rule: 'worst' | 'majority'
}

export const HEALTH_RULES_KEY = 'org_health_rules'

export const DEFAULT_HEALTH_RULES: HealthRules = {
  collection_green_pct: 90,
  collection_amber_pct: 60,
  compliance_red_after_days: 0,
  compliance_amber_within_days: 30,
  renewal_amber_within_days: 180,
  relationship_rule: 'worst',
}

export function withDefaults(value: unknown): HealthRules {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<HealthRules>
  const num = (k: keyof HealthRules) => {
    const raw: unknown = v[k]
    const n = Number(raw)
    return raw != null && raw !== '' && Number.isFinite(n) ? n : (DEFAULT_HEALTH_RULES[k] as number)
  }
  return {
    collection_green_pct: num('collection_green_pct'),
    collection_amber_pct: num('collection_amber_pct'),
    compliance_red_after_days: num('compliance_red_after_days'),
    compliance_amber_within_days: num('compliance_amber_within_days'),
    renewal_amber_within_days: num('renewal_amber_within_days'),
    relationship_rule: v.relationship_rule === 'majority' ? 'majority' : 'worst',
  }
}

/** Never throws: without the settings row the defaults apply. */
export async function loadHealthRules(): Promise<HealthRules> {
  const { data } = await supabase.from('fr_settings').select('value').eq('key', HEALTH_RULES_KEY).maybeSingle()
  return withDefaults((data as { value: unknown } | null)?.value)
}

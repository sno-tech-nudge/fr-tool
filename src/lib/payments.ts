import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAccess } from './accessContext'

/**
 * Who may confirm receipts, and who may record them. The database enforces
 * both (sql/phase5/payments_finance_guard.sql); this only keeps the screen
 * from offering what would be refused.
 */

export const FINANCE_ONLY_KEY = 'payments_finance_only'

let cached: boolean | null = null

export async function loadFinanceOnly(): Promise<boolean> {
  const { data } = await supabase.from('fr_settings').select('value').eq('key', FINANCE_ONLY_KEY).maybeSingle()
  cached = (data as { value: unknown } | null)?.value === true
  return cached
}

/** Saves the switch; returns the stored value. */
export async function saveFinanceOnly(next: boolean): Promise<boolean> {
  const { data, error } = await supabase
    .from('fr_settings')
    .upsert({ key: FINANCE_ONLY_KEY, value: next }, { onConflict: 'key' })
    .select('value')
    .single()
  if (error) throw new Error(error.message)
  cached = (data as { value: unknown }).value === true
  return cached
}

export function usePaymentAccess() {
  const access = useAccess()
  const [financeOnly, setFinanceOnly] = useState<boolean | null>(cached)

  useEffect(() => {
    if (cached !== null) return
    let active = true
    void loadFinanceOnly().then((v) => { if (active) setFinanceOnly(v) })
    return () => { active = false }
  }, [])

  const canConfirm = access.isManager || access.frSubRole === 'finance'
  return {
    canConfirm,
    // Until the switch has loaded, assume entry is open, as it is by default.
    canEnter: canConfirm || !financeOnly,
  }
}

/**
 * Confirm and lock. Who confirmed and when are stamped by the database from
 * the session; the values sent here only fill the row until it is re-read.
 */
export async function confirmReceipt(id: string, employeeId: string | null) {
  return supabase
    .from('fr_remittances')
    .update({
      confirmed_by_finance: true,
      confirmed_by_user_id: employeeId,
      confirmed_at: new Date().toISOString(),
      is_locked: true,
      updated_by: employeeId,
    })
    .eq('id', id)
    .select()
    .single()
}

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

/**
 * Keeps an instalment's status in step with what has come in against it:
 * fully covered → received; no longer covered after a correction → pending.
 * Delayed and cancelled are someone's call, so they are left alone.
 */
export async function syncTrancheStatus(
  tranche: { id: string; status?: string | null; amount: number; amount_inr_expected: number | null },
  receivedInr: number,
  employeeId: string | null,
) {
  const expected = Number(tranche.amount_inr_expected ?? tranche.amount ?? 0)
  if (expected <= 0) return
  const covered = receivedInr >= expected
  // The status on screen can be stale after an earlier change; read it fresh.
  const { data } = await supabase.from('fr_tranches').select('status').eq('id', tranche.id).maybeSingle()
  const status = (data as { status: string } | null)?.status ?? tranche.status ?? null
  if (covered && status !== 'received') {
    await supabase.from('fr_tranches').update({ status: 'received', updated_by: employeeId }).eq('id', tranche.id)
  } else if (!covered && status === 'received') {
    await supabase.from('fr_tranches').update({ status: 'pending', updated_by: employeeId }).eq('id', tranche.id)
  }
}

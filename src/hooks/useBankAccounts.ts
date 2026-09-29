import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type BankAccount = {
  id: string
  key: string
  label: string
  full_name: string | null
  is_fcra: boolean
  is_active: boolean
}

let cache: BankAccount[] | null = null

/**
 * The 7 receiving entities. Only TNF and NLF FCRA are FCRA-designated, and the
 * DB enforces that routing with a trigger on remittances — this hook exists so
 * the UI can filter the dropdown to the legal options *before* the write fails.
 */
export function useBankAccounts() {
  const [accounts, setAccounts] = useState<BankAccount[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    if (cache !== null) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_bank_accounts')
        .select('id, key, label, full_name, is_fcra, is_active')
        .eq('is_active', true)
        .order('sort_order')
      if (!active) return
      cache = (data ?? []) as BankAccount[]
      setAccounts(cache)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  return { accounts, loading }
}

/** Foreign money must land in an FCRA account; domestic money must not. */
export function accountsFor(accounts: BankAccount[], isFcra: boolean) {
  return accounts.filter((a) => a.is_fcra === isFcra)
}

import { useEffect, useState } from 'react'
import { Checkbox, Skeleton, useToast } from '../ui'
import { loadFinanceOnly, saveFinanceOnly } from '../../lib/payments'

/** Whether recording receipts is left to finance and managers. */
export function PaymentEntrySetting({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const [value, setValue] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void loadFinanceOnly().then(setValue) }, [])

  if (value === null) return <Skeleton height={44} />

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      setValue(await saveFinanceOnly(next))
      toast.success(next ? 'Only finance can record receipts now.' : 'The whole team can record receipts now.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <Checkbox
        label="Only finance and managers can record receipts"
        checked={value}
        disabled={!canEdit || busy}
        onChange={(v) => void toggle(v)}
      />
    </div>
  )
}

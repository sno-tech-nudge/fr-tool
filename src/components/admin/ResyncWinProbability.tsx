import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, ConfirmDialog, useToast } from '../ui'
import { usePipelineStages } from '../../hooks/usePipelineStages'
import { useAccess } from '../../lib/accessContext'

/**
 * Pushes each stage's configured win % onto every deal sitting at that stage.
 *
 * `probability_pct` is stored per deal, written when it is created and on each
 * stage move, so editing the config here does not reach deals that already
 * exist — most of ours still carry the percentages Zoho shipped with. This is
 * the deliberate catch-up, kept separate from Save because it rewrites the
 * whole pipeline rather than one row.
 */
export function ResyncWinProbability({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const access = useAccess()
  const { stages } = usePipelineStages()

  const [drift, setDrift] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  /** How many deals disagree with their stage right now. */
  const count = useCallback(async () => {
    if (stages.length === 0) return
    const results = await Promise.all(stages.map(async (s) => {
      const { count: n } = await supabase
        .from('fr_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('stage_id', s.id)
        .is('deleted_at', null)
        .or(`probability_pct.neq.${s.probability_pct},probability_pct.is.null`)
      return n ?? 0
    }))
    setDrift(results.reduce((a, b) => a + b, 0))
  }, [stages])

  useEffect(() => { void count() }, [count])

  async function resync() {
    setBusy(true)
    let changed = 0
    const failed: string[] = []

    for (const s of stages) {
      const { error, count: n } = await supabase
        .from('fr_opportunities')
        .update({ probability_pct: s.probability_pct, updated_by: access.employeeId }, { count: 'exact' })
        .eq('stage_id', s.id)
        .is('deleted_at', null)
        .or(`probability_pct.neq.${s.probability_pct},probability_pct.is.null`)
      if (error) failed.push(s.label)
      else changed += n ?? 0
    }

    setBusy(false)
    setConfirming(false)
    void count()
    if (failed.length > 0) {
      toast.error(`Could not update ${failed.join(', ')}.`)
      return
    }
    toast.success(`${changed} deals brought in line.`)
  }

  if (!canEdit) return null

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="chartsub" style={{ margin: 0 }}>
          {drift === null
            ? 'Checking which deals match their stage…'
            : drift === 0
              ? 'Every deal matches the win % set for its stage.'
              : `${drift} deals carry a different win % from the stage they sit at — usually the value Zoho imported. Applying the config overwrites those.`}
        </p>
        <Button
          variant="secondary"
          iconLeft={<RefreshCw size={14} />}
          disabled={busy || drift === 0 || drift === null}
          onClick={() => setConfirming(true)}
        >
          {busy ? 'Applying…' : 'Apply win % to existing deals'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Overwrite the win % on ${drift ?? 0} deals?`}
        body="Each deal takes the percentage set for the stage it is on. Any figure someone set by hand on an individual deal is lost, and weighted pipeline totals will move."
        confirmLabel="Apply"
        destructive
        busy={busy}
        onConfirm={() => void resync()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

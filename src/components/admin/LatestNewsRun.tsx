import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, useToast } from '../ui'
import { useAccess } from '../../lib/accessContext'
import { describeRun, refreshAllNews, runFailed, type NewsRun } from '../../lib/news'

/**
 * Fetches news for every organisation not checked in the last 6 hours, with
 * a bar showing how far it has got. Super admins only — a full run spends the
 * most Gemini tokens.
 */
export function LatestNewsRun() {
  const toast = useToast()
  const access = useAccess()
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<NewsRun | null>(null)

  if (access.erpRole !== 'super_admin') return null

  async function start() {
    setBusy(true)
    setRun(null)
    try {
      const r = await refreshAllNews((t) => setRun({ ...t }), 'all')
      setRun(r)
      if (runFailed(r)) toast.error(describeRun(r))
      else toast.success(describeRun(r))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch news.')
    } finally {
      setBusy(false)
    }
  }

  const total = run ? run.checked + run.remaining : 0
  const pct = total > 0 ? Math.round((run!.checked / total) * 100) : busy ? 0 : 100

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="tn-micro">News for every organisation</div>
        <Button variant="secondary" iconLeft={<RefreshCw size={14} />} onClick={() => void start()} disabled={busy}>
          {busy ? 'Fetching…' : 'Get latest news'}
        </Button>
      </div>
      {busy || run ? (
        <div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%`, transition: 'width 300ms ease' }} />
          </div>
          <span className="muted tn-num" style={{ fontSize: 'var(--text-sm)' }}>
            {busy
              ? total > 0 ? `${run!.checked} of ${total} organisations · ${run!.kept} worth keeping` : 'Starting…'
              : run ? describeRun(run) : null}
          </span>
        </div>
      ) : null}
    </section>
  )
}

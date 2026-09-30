import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, useToast } from '../ui'
import { useAccess } from '../../lib/accessContext'
import { newsStatus, startAllNews } from '../../lib/news'

/** How often the bar asks the server how far it has got. */
const POLL_MS = 3000
/** No progress for this long means the background run has stopped. */
const STALL_MS = 90_000

type Progress = { start: number; remaining: number; kept: number }

/**
 * Fetches news for every organisation not checked in the last 6 hours. The
 * work runs on the server in the background, so the bar only watches: leaving
 * the page does not stop it. Super admins only — a full run spends the most
 * Gemini tokens.
 */
export function LatestNewsRun() {
  const toast = useToast()
  const access = useAccess()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  if (access.erpRole !== 'super_admin') return null

  function finish(message: string, ok: boolean) {
    setBusy(false)
    setNote(message)
    if (ok) toast.success(message)
    else toast.error(message)
  }

  async function start() {
    setBusy(true)
    setNote(null)
    setProgress(null)
    const since = new Date().toISOString()
    try {
      const r = await startAllNews()
      if (!r.started || r.remaining === 0) {
        finish('Already up to date — every organisation was checked in the last 6 hours.', true)
        return
      }
      let last = { remaining: r.remaining, at: Date.now() }
      setProgress({ start: r.remaining, remaining: r.remaining, kept: 0 })

      const poll = async () => {
        try {
          const s = await newsStatus('all', since)
          setProgress({ start: r.remaining, remaining: s.remaining, kept: s.kept })
          if (s.remaining === 0) {
            finish(`Done: ${r.remaining} organisations checked, ${s.kept} headlines worth keeping.`, true)
            return
          }
          if (s.remaining < last.remaining) last = { remaining: s.remaining, at: Date.now() }
          else if (Date.now() - last.at > STALL_MS) {
            finish(`Stopped with ${s.remaining} still to check — the news sources may be refusing. Press again to retry.`, false)
            return
          }
        } catch { /* a missed poll is fine; try again next tick */ }
        timer.current = window.setTimeout(() => void poll(), POLL_MS)
      }
      timer.current = window.setTimeout(() => void poll(), POLL_MS)
    } catch (e) {
      finish(e instanceof Error ? e.message : 'Could not start the news fetch.', false)
    }
  }

  const done = progress ? progress.start - progress.remaining : 0
  const pct = progress && progress.start > 0 ? Math.round((done / progress.start) * 100) : 0

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="tn-micro">News for every organisation</div>
        <Button variant="secondary" iconLeft={<RefreshCw size={14} />} onClick={() => void start()} disabled={busy}>
          {busy ? 'Fetching…' : 'Get latest news'}
        </Button>
      </div>
      {busy || note ? (
        <div>
          {progress ? (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%`, transition: 'width 300ms ease' }} />
            </div>
          ) : null}
          <span className="muted tn-num" style={{ fontSize: 'var(--text-sm)' }}>
            {busy
              ? progress
                ? `${done} of ${progress.start} organisations · ${progress.kept} worth keeping · carries on if you leave this page`
                : 'Starting…'
              : note}
          </span>
        </div>
      ) : null}
    </section>
  )
}

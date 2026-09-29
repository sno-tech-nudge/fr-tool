import { useState } from 'react'
import { Download, Eye } from 'lucide-react'
import { Button, useToast } from './ui'
import { documentUrl } from '../lib/documents'

/**
 * View or save a file held in the private bucket.
 *
 * Every click mints a fresh signed URL that expires in ten minutes, so there is
 * no long-lived link to a donor agreement sitting in browser history.
 */
export function DocumentLink({ path, label = 'View' }: { path: string; label?: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function view() {
    // The tab is opened on the click itself; a window.open after the await has
    // lost the user gesture and gets swallowed by the popup blocker.
    //
    // It cannot ask for 'noopener' — that feature is defined as returning null
    // instead of a handle, and the handle is what the signed URL gets loaded
    // into. The child's back-reference is cut by hand instead, which has to
    // happen while it is still the same-origin blank page.
    const tab = window.open('', '_blank')
    if (!tab) {
      toast.error('Allow pop-ups for this site to open the file.')
      return
    }
    tab.opener = null

    setBusy(true)
    try {
      tab.location.href = await documentUrl(path)
    } catch (e) {
      tab.close()
      toast.error(e instanceof Error ? e.message : 'Could not open that file.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      const url = await documentUrl(path, true)
      const a = document.createElement('a')
      a.href = url
      a.download = path.split('/').pop() ?? 'document'
      a.click()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download that file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="row" style={{ gap: 'var(--space-2)' }}>
      <Button size="sm" variant="secondary" iconLeft={<Eye size={14} />} onClick={() => void view()} disabled={busy}>
        {label}
      </Button>
      <Button size="sm" variant="ghost" iconLeft={<Download size={14} />} onClick={() => void save()} disabled={busy}>
        Download
      </Button>
    </span>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Button, useToast } from './ui'

/**
 * An Export button. With both formats it opens a small menu (PDF or Excel);
 * with only Excel it just downloads. Marked data-export-skip so the button
 * never appears in the PDF it produces.
 */
export function ExportMenu({
  onPdf, onExcel, size = 'sm',
}: {
  onPdf?: () => Promise<void>
  onExcel: () => Promise<void>
  size?: 'sm' | 'md'
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function run(kind: 'pdf' | 'excel') {
    const job = kind === 'pdf' ? onPdf : onExcel
    if (!job) return
    setOpen(false)
    setBusy(kind)
    try {
      await job()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The export failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="exportmenu" ref={box} data-export-skip>
      <Button
        variant="secondary"
        size={size}
        iconLeft={<Download size={14} />}
        disabled={busy !== null}
        aria-haspopup={onPdf ? 'menu' : undefined}
        aria-expanded={onPdf ? open : undefined}
        onClick={() => (onPdf ? setOpen((o) => !o) : void run('excel'))}
      >
        {busy ? 'Exporting…' : 'Export'}
      </Button>
      {open ? (
        <div className="exportmenu__panel" role="menu">
          <button type="button" role="menuitem" className="exportmenu__item" onClick={() => void run('pdf')}>
            <FileText size={15} /> Download as PDF
          </button>
          <button type="button" role="menuitem" className="exportmenu__item" onClick={() => void run('excel')}>
            <FileSpreadsheet size={15} /> Download as Excel
          </button>
        </div>
      ) : null}
    </div>
  )
}

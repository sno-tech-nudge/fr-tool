import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, X } from 'lucide-react'
import { Button, Select, useToast } from '../ui'
import { readableSize } from '../../lib/documents'
import { DOC_TYPES, checkFile, uploadDealDocument } from '../../lib/dealDocuments'
import { useAccess } from '../../lib/accessContext'

const EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'txt', 'zip',
]
const ACCEPT = EXTENSIONS.map((e) => `.${e}`).join(',')

/** Adds one or more files of one type to a deal's documents. */
export function AddDocumentDialog({
  open, opportunityId, onClose, onAdded,
}: {
  open: boolean
  opportunityId: string
  onClose: () => void
  /** Called once the uploads finish, so the list can reload. */
  onAdded: () => void
}) {
  const toast = useToast()
  const access = useAccess()
  const pickRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDocType('')
    setFiles([])
    setError(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // busy is read at keypress time; reopening resets the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  function pick(list: FileList | null) {
    const picked = Array.from(list ?? [])
    if (pickRef.current) pickRef.current.value = ''
    const ok = picked.filter((f) => {
      const problem = checkFile(f, EXTENSIONS)
      if (problem) toast.error(problem)
      return !problem
    })
    setFiles((prev) => [...prev, ...ok])
    setError(null)
  }

  async function add() {
    if (!docType) { setError('Choose the document type.'); return }
    if (files.length === 0) { setError('Choose at least one file.'); return }
    setBusy(true)
    let added = 0
    const failed: File[] = []
    for (const file of files) {
      try {
        await uploadDealDocument({
          opportunityId, docType, file,
          employeeId: access.employeeId, employeeName: access.employeeName,
        })
        added += 1
      } catch (e) {
        failed.push(file)
        toast.error(e instanceof Error ? e.message : `${file.name}: could not upload.`)
      }
    }
    setBusy(false)
    if (added > 0) {
      toast.success(added === 1 ? 'Document added' : `${added} documents added`)
      onAdded()
    }
    // Anything that failed stays in the list to try again.
    if (failed.length) setFiles(failed)
    else onClose()
  }

  return (
    <div className="scrim" role="presentation" onClick={() => { if (!busy) onClose() }}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add document"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="dialog__title">Add document</p>

        <div className="stack" style={{ marginBottom: 'var(--space-5)' }}>
          <Select
            label="Type"
            required
            value={docType}
            onChange={(e) => { setDocType(e.currentTarget.value); setError(null) }}
          >
            <option value="">—</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>

          <div className="field">
            <span className="field__label">Files<span className="field__req"> *</span></span>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="row" style={{ gap: 'var(--space-2)', alignItems: 'center', minWidth: 0 }}>
                  <FileText size={16} style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
                    {f.name}
                  </span>
                  <span className="faint tn-num" style={{ flexShrink: 0 }}>{readableSize(f.size)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Take out ${f.name}`}
                    title="Take out"
                    iconLeft={<X size={14} />}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    disabled={busy}
                    style={{ marginLeft: 'auto', flexShrink: 0 }}
                  />
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={<Upload size={14} />}
                  onClick={() => pickRef.current?.click()}
                  disabled={busy}
                >
                  {files.length ? 'Add more' : 'Choose files'}
                </Button>
              </div>
            </div>
            <input
              ref={pickRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => pick(e.currentTarget.files)}
            />
          </div>

          {error ? <p className="field__error">{error}</p> : null}
        </div>

        <div className="dialog__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void add()} disabled={busy}>
            {busy ? 'Uploading…' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  )
}

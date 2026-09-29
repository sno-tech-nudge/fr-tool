import { useRef, useState } from 'react'
import { FileText, Trash2, Wand2 } from 'lucide-react'
import { Button, useToast } from '../ui'
import {
  CONTRACT_TYPES, MAX_CONTRACT_BYTES, extractContract, readableSize, removeDocument,
  uploadDocument, type ContractFields,
} from '../../lib/documents'

/**
 * Attaches the signed contract or MoU to a grant, and optionally reads the
 * terms out of it.
 *
 * Attaching and reading are separate on purpose: the document is worth keeping
 * whether or not the OCR makes sense of it, and a scanned fax of a 40-page
 * agreement often will not.
 */
export function ContractUpload({
  path, onAttached, onExtracted,
}: {
  path: string | null
  onAttached: (path: string | null, fileName: string | null) => void
  onExtracted: (fields: ContractFields) => void
}) {
  const toast = useToast()
  const [name, setName] = useState<string | null>(null)
  const [size, setSize] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<'attach' | 'read' | null>(null)
  const pickRef = useRef<HTMLInputElement>(null)

  async function accept(file: File | undefined) {
    if (!file) return
    if (!CONTRACT_TYPES.includes(file.type)) {
      toast.error('Attach a PDF or a photo of the signed contract.')
      return
    }
    if (file.size > MAX_CONTRACT_BYTES) {
      toast.error(`That file is ${readableSize(file.size)}. Keep it under 12 MB.`)
      return
    }
    setBusy('attach')
    try {
      const stored = await uploadDocument('contracts', file)
      setName(file.name)
      setSize(file.size)
      onAttached(stored, file.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload that file.')
    } finally {
      setBusy(null)
    }
  }

  async function read() {
    if (!path) return
    setBusy('read')
    try {
      onExtracted(await extractContract(path))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that contract.')
    } finally {
      setBusy(null)
    }
  }

  function clear() {
    if (path) void removeDocument(path)
    setName(null)
    setSize(0)
    onAttached(null, null)
  }

  if (!path) {
    return (
      <div
        className="dropzone"
        data-dragging={dragging}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void accept(e.dataTransfer.files?.[0])
        }}
      >
        <FileText size={22} />
        <p className="dropzone__title">Signed contract or MoU (optional)</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => pickRef.current?.click()}
          disabled={busy === 'attach'}
        >
          {busy === 'attach' ? 'Uploading…' : 'Choose a PDF or photo'}
        </Button>
        <input
          ref={pickRef}
          type="file"
          accept=".pdf,image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => void accept(e.currentTarget.files?.[0])}
        />
      </div>
    )
  }

  return (
    <div className="card stack" style={{ gap: 'var(--space-3)' }}>
      {/* The name takes whatever width is left and wraps inside it; the size
          and Remove never shrink, so a long filename can't push them out. */}
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <FileText size={15} style={{ flex: 'none' }} />
        <span
          title={name ?? undefined}
          style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--text-sm)' }}
        >
          {name ?? 'Contract attached'}
        </span>
        {size > 0 ? (
          <span className="faint tn-num" style={{ flex: 'none', whiteSpace: 'nowrap', fontSize: 'var(--text-sm)' }}>
            {readableSize(size)}
          </span>
        ) : null}
        <span style={{ flex: 'none' }}>
          <Button size="sm" variant="ghost" iconLeft={<Trash2 size={14} />} onClick={clear} disabled={busy !== null}>
            Remove
          </Button>
        </span>
      </div>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Wand2 size={14} />}
          onClick={() => void read()}
          disabled={busy !== null}
        >
          {busy === 'read' ? 'Reading…' : 'Read the contract'}
        </Button>
        <span className="chartsub" style={{ margin: 0 }}>
          Fills in the terms below. Check them against the document before creating the grant.
        </span>
      </div>
    </div>
  )
}

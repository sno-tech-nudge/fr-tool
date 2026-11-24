import { useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { Button, useToast } from '../ui'
import { DocumentLink } from '../DocumentLink'
import { readableSize, uploadDocument } from '../../lib/documents'

export const PROPOSAL_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx'
const PROPOSAL_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']
const MAX_PROPOSAL_BYTES = 25 * 1024 * 1024

/** A stored proposal is a file path in the bucket; older ones are web links. */
export function ProposalOpen({ value, label = 'Open' }: { value: string; label?: string }) {
  if (/^https?:\/\//i.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer noopener" className="celllink">{label}</a>
  }
  return <DocumentLink path={value} label={label} />
}

/**
 * Upload box for a proposal file (PDF, Word, PowerPoint or Excel). Hands the
 * stored path back through onChange; the caller saves it on the proposal.
 */
export function ProposalFileField({
  label, required, value, onChange,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (path: string) => void
}) {
  const toast = useToast()
  const pickRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!PROPOSAL_EXTENSIONS.includes(ext)) {
      toast.error('Upload a PDF, Word, PowerPoint or Excel file.')
      return
    }
    if (file.size > MAX_PROPOSAL_BYTES) {
      toast.error(`That file is ${readableSize(file.size)}. Keep it under 25 MB.`)
      return
    }
    setBusy(true)
    try {
      onChange(await uploadDocument('proposals', file))
      setFileName(file.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload that file.')
    } finally {
      setBusy(false)
      if (pickRef.current) pickRef.current.value = ''
    }
  }

  return (
    <div className="field">
      <span className="field__label">
        {label}{required ? <span className="field__req"> *</span> : null}
      </span>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        {value ? (
          <span className="row" style={{ gap: 'var(--space-2)', alignItems: 'center', minWidth: 0 }}>
            <FileText size={16} />
            {fileName
              ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
              : <ProposalOpen value={value} label="Current proposal" />}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Upload size={14} />}
          onClick={() => pickRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Uploading…' : value ? 'Replace' : 'Upload proposal'}
        </Button>
        <input
          ref={pickRef}
          type="file"
          accept={PROPOSAL_ACCEPT}
          hidden
          onChange={(e) => void pick(e.currentTarget.files?.[0])}
        />
      </div>
    </div>
  )
}

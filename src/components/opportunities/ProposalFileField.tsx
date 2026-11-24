import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Trash2, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, ConfirmDialog, Skeleton, useToast } from '../ui'
import { DocumentLink } from '../DocumentLink'
import { documentUrl, readableSize } from '../../lib/documents'
import { checkFile, uploadDealDocument, type DealDocument } from '../../lib/dealDocuments'
import { useAccess } from '../../lib/accessContext'

const PROPOSAL_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx'
const PROPOSAL_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']

/** A stored proposal is a file path in the bucket; older ones are web links. */
export function ProposalOpen({ value, label = 'Open' }: { value: string; label?: string }) {
  if (/^https?:\/\//i.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer noopener" className="celllink">{label}</a>
  }
  return <DocumentLink path={value} label={label} />
}

type ProposalFile = DealDocument

/**
 * The deal's proposal files (PDF, Word, PowerPoint or Excel). Each upload is
 * saved straight away as a Proposal document on the deal, so it also shows on
 * the Documents tab; removing one takes it off the deal.
 * Reports how many proposals the deal has through onCountChange.
 */
export function ProposalFileField({
  opportunityId, organisationId, legacyLink, label, required, onCountChange, onUploaded,
}: {
  opportunityId: string
  organisationId: string | null
  /** An older proposal saved as a web link, shown alongside the files. */
  legacyLink?: string | null
  label: string
  required?: boolean
  onCountChange: (count: number) => void
  /** Each file as it is saved, so a cancelled move can undo it. */
  onUploaded?: (doc: DealDocument) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const pickRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<ProposalFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<ProposalFile | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('fr_documents')
      .select('id, name, file_path, size_bytes')
      .eq('opportunity_id', opportunityId)
      .eq('doc_type', 'Proposal')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) { toast.error(error.message); setFiles([]); return }
    setFiles((data ?? []) as ProposalFile[])
  }, [opportunityId, toast])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (files) onCountChange(files.length + (legacyLink ? 1 : 0))
  }, [files, legacyLink, onCountChange])

  async function upload(list: FileList | null) {
    const picked = Array.from(list ?? [])
    if (pickRef.current) pickRef.current.value = ''
    if (picked.length === 0) return

    const ok = picked.filter((f) => {
      const problem = checkFile(f, PROPOSAL_EXTENSIONS)
      if (problem) toast.error(problem)
      return !problem
    })

    setBusy(true)
    for (const file of ok) {
      try {
        const doc = await uploadDealDocument({
          opportunityId, organisationId, docType: 'Proposal', file,
          employeeId: access.employeeId, employeeName: access.employeeName,
        })
        setFiles((prev) => [doc, ...(prev ?? [])])
        onUploaded?.(doc)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not upload that file.')
      }
    }
    setBusy(false)
  }

  async function openFile(file: ProposalFile) {
    // Open the tab on the click itself, or the popup blocker eats it.
    const tab = window.open('', '_blank')
    if (!tab) { toast.error('Allow pop-ups for this site to open the file.'); return }
    tab.opener = null
    try {
      tab.location.href = await documentUrl(file.file_path)
    } catch (e) {
      tab.close()
      toast.error(e instanceof Error ? e.message : 'Could not open that file.')
    }
  }

  async function remove(file: ProposalFile) {
    const { data, error } = await supabase
      .from('fr_documents')
      .update({ deleted_at: new Date().toISOString(), updated_by: access.employeeId })
      .eq('id', file.id)
      .select('id')
    setRemoving(null)
    if (error || !data?.length) { toast.error(`Could not remove: ${error?.message ?? 'not saved'}`); return }
    setFiles((prev) => (prev ?? []).filter((f) => f.id !== file.id))
  }

  return (
    <div className="field">
      <span className="field__label">
        {label}{required ? <span className="field__req"> *</span> : null}
      </span>

      {files === null ? <Skeleton height={36} /> : (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          {legacyLink ? (
            <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
              <FileText size={16} />
              <ProposalOpen value={legacyLink} label="Earlier proposal" />
            </div>
          ) : null}
          {files.map((f) => (
            <div key={f.id} className="row" style={{ gap: 'var(--space-2)', alignItems: 'center', minWidth: 0 }}>
              <FileText size={16} style={{ flexShrink: 0 }} />
              <button
                type="button"
                className="celllink"
                onClick={() => void openFile(f)}
                title={f.name}
                style={{
                  border: 0, background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {f.name}
              </button>
              {f.size_bytes ? <span className="faint tn-num" style={{ flexShrink: 0 }}>{readableSize(f.size_bytes)}</span> : null}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${f.name}`}
                title="Remove"
                iconLeft={<Trash2 size={14} />}
                onClick={() => setRemoving(f)}
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
              {busy ? 'Uploading…' : files.length || legacyLink ? 'Add more' : 'Upload proposal'}
            </Button>
          </div>
        </div>
      )}

      <input
        ref={pickRef}
        type="file"
        accept={PROPOSAL_ACCEPT}
        multiple
        hidden
        onChange={(e) => void upload(e.currentTarget.files)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? 'this file'}?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (removing) void remove(removing) }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

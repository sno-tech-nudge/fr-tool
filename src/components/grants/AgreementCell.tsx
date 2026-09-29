import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, useToast } from '../ui'
import { DocumentLink } from '../DocumentLink'
import {
  CONTRACT_TYPES, MAX_CONTRACT_BYTES, readableSize, removeDocument, uploadDocument,
} from '../../lib/documents'
import { useAccess } from '../../lib/accessContext'
import type { Grant } from './GrantForm'

/**
 * The agreement on a grant: view it, or attach one if it is missing.
 *
 * Only the Won wizard can attach a contract as a deal closes, which leaves
 * every grant that predates that — including the whole Zoho import — with no
 * way to get its paperwork in. This is that way in.
 */
export function AgreementCell({
  grant, onSaved,
}: {
  grant: Grant
  onSaved: (grant: Grant) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const [busy, setBusy] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)

  async function attach(file: File | undefined) {
    if (!file) return
    if (!CONTRACT_TYPES.includes(file.type)) {
      toast.error('Attach a PDF or a photo of the signed agreement.')
      return
    }
    if (file.size > MAX_CONTRACT_BYTES) {
      toast.error(`That file is ${readableSize(file.size)}. Keep it under 12 MB.`)
      return
    }

    setBusy(true)
    let path: string | null = null
    try {
      path = await uploadDocument('contracts', file)
      const { data, error } = await supabase
        .from('fr_grants')
        .update({ agreement_document_path: path, updated_by: access.employeeId })
        .eq('id', grant.id)
        .select()
        .single()
      if (error) throw new Error(error.message)
      onSaved(data as Grant)
      toast.success('Agreement attached.')
    } catch (e) {
      // The file uploaded but the grant did not take it, so it would sit in
      // the bucket belonging to nothing.
      if (path) void removeDocument(path)
      toast.error(e instanceof Error ? e.message : 'Could not attach that file.')
    } finally {
      setBusy(false)
    }
  }

  if (grant.agreement_document_path) {
    return <DocumentLink path={grant.agreement_document_path} label="View agreement" />
  }

  return (
    <span className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
      {grant.agreement_document_url ? (
        <a href={grant.agreement_document_url} target="_blank" rel="noreferrer noopener">
          Open document
        </a>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        iconLeft={<Upload size={14} />}
        onClick={() => pickRef.current?.click()}
        disabled={busy}
      >
        {busy ? 'Uploading…' : 'Upload'}
      </Button>
      <input
        ref={pickRef}
        type="file"
        accept=".pdf,image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => void attach(e.currentTarget.files?.[0])}
      />
    </span>
  )
}

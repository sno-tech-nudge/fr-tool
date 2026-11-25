import { supabase } from './supabase'
import { DOCS_BUCKET, readableSize } from './documents'

/** The team's six document groups, in the order people look for them. */
export const DOC_TYPES = ['MoU', 'Proposal', 'Budget', 'Receipt', 'Report', 'Other documents'] as const

export const MAX_DEAL_DOC_BYTES = 25 * 1024 * 1024

export type DealDocument = {
  id: string
  name: string
  file_path: string
  size_bytes: number | null
}

/** Why a file can't be taken, or null when it's fine. */
export function checkFile(file: File, allowed: string[]): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!allowed.includes(ext)) return `${file.name}: this file type isn't accepted.`
  if (file.size > MAX_DEAL_DOC_BYTES) return `${file.name} is ${readableSize(file.size)}. Keep each file under 25 MB.`
  return null
}

/**
 * Uploads one file into the deal's folder and records it on the deal's
 * documents. If the record can't be saved, the uploaded file is removed again.
 */
export async function uploadDealDocument(opts: {
  opportunityId: string
  organisationId?: string | null
  docType: string
  file: File
  employeeId: string | null
  employeeName: string | null
  /** Where on the deal it sits: a grant, its report period, the report itself. */
  links?: { grant_id?: string | null; report_period_id?: string | null; milestone_id?: string | null }
}): Promise<DealDocument> {
  const { opportunityId, docType, file, employeeId, employeeName } = opts
  let organisationId = opts.organisationId ?? null
  if (!organisationId) {
    const { data } = await supabase.from('fr_opportunities').select('organisation_id').eq('id', opportunityId).maybeSingle()
    organisationId = (data as { organisation_id: string | null } | null)?.organisation_id ?? null
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const path = `deals/${opportunityId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (upErr) throw new Error(`${file.name}: ${upErr.message}`)

  const { data, error } = await supabase
    .from('fr_documents')
    .insert({
      opportunity_id: opportunityId,
      organisation_id: organisationId,
      doc_type: docType,
      name: file.name,
      file_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      added_on: new Date().toLocaleDateString('en-CA'),
      added_by_user_id: employeeId,
      added_by_name: employeeName,
      source_detail: 'app',
      created_by: employeeId,
      ...(opts.links ?? {}),
    })
    .select('id, name, file_path, size_bytes')
    .single()
  if (error) {
    await supabase.storage.from(DOCS_BUCKET).remove([path])
    throw new Error(`${file.name}: ${error.message}`)
  }
  return data as DealDocument
}

/**
 * Undoes uploads that were never kept (a cancelled stage move): the records
 * and the files both go, since nothing else ever pointed at them.
 */
export async function discardDealDocuments(docs: Array<Pick<DealDocument, 'id' | 'file_path'>>) {
  if (docs.length === 0) return
  await supabase.from('fr_documents').delete().in('id', docs.map((d) => d.id))
  await supabase.storage.from(DOCS_BUCKET).remove(docs.map((d) => d.file_path))
}

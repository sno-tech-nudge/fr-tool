import { supabase } from './supabase'

/**
 * Files people upload — business cards and signed agreements — and the OCR
 * pass over them.
 *
 * The bucket is private: nothing is ever served by a public URL. Reading a
 * file means minting a short-lived signed URL, so a link pasted into a chat
 * stops working rather than leaking a donor contract indefinitely.
 *
 * Extraction itself runs in the `fr-extract` Edge Function, because the Gemini
 * key must never reach the browser bundle.
 */

export const DOCS_BUCKET = 'fr-documents'

/** Gemini takes the file inline, and base64 inflates it by a third. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_CONTRACT_BYTES = 12 * 1024 * 1024

export const CONTRACT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

export type ContactCardFields = {
  full_name: string | null
  designation: string | null
  organisation_name: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  website: string | null
  address: string | null
}

export type ContractTranche = {
  sequence_no: number | null
  due_date: string | null
  amount: number | null
  condition_note: string | null
}

export type ContractMilestone = {
  title: string | null
  due_date: string | null
}

export type ContractFields = {
  agreement_number: string | null
  donor_name: string | null
  total_value: number | null
  currency: string | null
  signed_date: string | null
  start_date: string | null
  end_date: string | null
  is_foreign_contribution: boolean | null
  programs: string[]
  tranches: ContractTranche[]
  /** The reporting/communication timeline — e.g. an Annexure of report names and due dates. */
  reporting_milestones: ContractMilestone[]
  /** True when the agreement mentions social media publicity, even if subject to approval. */
  social_media_mention: boolean | null
  /** Bulleted plain-text digest of the terms that matter, boilerplate left out. */
  summary: string | null
  notes: string | null
}

function extensionOf(file: File): string {
  const named = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : ''
  if (named && /^[a-z0-9]{1,5}$/.test(named)) return named
  return file.type === 'application/pdf' ? 'pdf' : 'bin'
}

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Returns the storage path, which is what gets stored on the record. */
export async function uploadDocument(
  folder: 'contact-cards' | 'contracts', file: File,
): Promise<string> {
  const path = `${folder}/${crypto.randomUUID()}.${extensionOf(file)}`
  const { error } = await supabase.storage.from(DOCS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

/** Abandoned uploads are cleaned up rather than left behind in the bucket. */
export async function removeDocument(path: string): Promise<void> {
  await supabase.storage.from(DOCS_BUCKET).remove([path])
}

export async function documentUrl(path: string, download = false): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(path, 600, download ? { download: true } : undefined)
  if (error || !data) throw new Error(error?.message ?? 'Could not open that file.')
  return data.signedUrl
}

/** supabase-js buries the function's own message inside a Response. */
async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json() as { error?: string }
      if (body?.error) return body.error
    } catch { /* not JSON — fall through */ }
  }
  return error instanceof Error ? error.message : 'The extraction service could not be reached.'
}

async function invokeExtract<T>(kind: 'contact_card' | 'contract', path: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fr-extract', { body: { kind, path } })
  if (error) throw new Error(await describeFunctionError(error))
  const payload = data as { ok?: boolean; error?: string; fields?: T } | null
  if (!payload?.ok || !payload.fields) {
    throw new Error(payload?.error ?? 'Nothing could be read from that file.')
  }
  return payload.fields
}

export const extractContactCard = (path: string) =>
  invokeExtract<ContactCardFields>('contact_card', path)

export const extractContract = (path: string) =>
  invokeExtract<ContractFields>('contract', path)

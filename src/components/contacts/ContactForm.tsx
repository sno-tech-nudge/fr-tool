import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  Button, Checkbox, ConfirmDialog, Drawer, Input, Select, Textarea, useToast,
} from '../ui'
import { SENIORITIES } from '../../lib/enums'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'
import { OrganisationPicker } from '../organisations/OrganisationPicker'
import { DocumentLink } from '../DocumentLink'

export type Contact = {
  id: string
  organisation_id: string | null
  full_name: string
  designation: string | null
  seniority: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  is_primary: boolean
  is_individual_donor: boolean
  relationship_owner_user_id: string | null
  confidential: boolean
  birthday: string | null
  personal_notes: string | null
  notes: string | null
  card_image_path: string | null
}

/** What a scanned card can fill in before the person checks it. */
export type ContactPrefill = {
  organisation_id?: string
  full_name?: string
  designation?: string
  email?: string
  phone?: string
  linkedin_url?: string
  notes?: string
}

const EMPTY = {
  organisation_id: '', full_name: '', designation: '', seniority: '', email: '', phone: '',
  linkedin_url: '', is_primary: false, is_individual_donor: false,
  relationship_owner_user_id: '', confidential: false, birthday: '', personal_notes: '', notes: '',
}
type Draft = typeof EMPTY

function toDraft(
  c: Contact | null,
  lockedOrgId: string | null,
  defaultOwner: string | null,
  prefill: ContactPrefill | null,
): Draft {
  if (!c) {
    return {
      ...EMPTY,
      organisation_id: lockedOrgId ?? '',
      relationship_owner_user_id: defaultOwner ?? '',
      ...prefill,
    }
  }
  return {
    organisation_id: c.organisation_id ?? '',
    full_name: c.full_name ?? '',
    designation: c.designation ?? '',
    seniority: c.seniority ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    linkedin_url: c.linkedin_url ?? '',
    is_primary: c.is_primary ?? false,
    is_individual_donor: c.is_individual_donor ?? false,
    relationship_owner_user_id: c.relationship_owner_user_id ?? '',
    confidential: c.confidential ?? false,
    birthday: c.birthday ?? '',
    personal_notes: c.personal_notes ?? '',
    notes: c.notes ?? '',
  }
}

/**
 * Add/edit a contact. Used both standalone (Contacts directory) and scoped to
 * an organisation (Org 360 → Contacts), where the org is fixed.
 */
export function ContactForm({
  open, contact, lockedOrganisationId = null, prefill = null, cardImagePath = null,
  onClose, onSaved, onDeleted,
}: {
  open: boolean
  contact: Contact | null
  lockedOrganisationId?: string | null
  /** Fields read off a scanned card, shown for checking rather than saved. */
  prefill?: ContactPrefill | null
  /** Storage path of the card that produced `prefill`, kept with the contact. */
  cardImagePath?: string | null
  onClose: () => void
  onSaved: (contact: Contact, isNew: boolean) => void
  onDeleted?: (id: string) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) setDraft(toDraft(contact, lockedOrganisationId, access.employeeId, prefill))
    // `prefill` is a fresh object each render, so it is deliberately not a
    // dependency — it would reset the form under the person as they type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact, lockedOrganisationId, access.employeeId])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    if (!draft.full_name.trim()) { toast.error('Name is required.'); return }
    if (!draft.email.trim() && !draft.phone.trim()) {
      toast.error('Give at least an email or a phone number.')
      return
    }
    setBusy(true)

    const payload = {
      organisation_id: draft.organisation_id || null,
      full_name: draft.full_name.trim(),
      designation: draft.designation.trim() || null,
      seniority: draft.seniority || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      linkedin_url: draft.linkedin_url.trim() || null,
      is_primary: draft.is_primary,
      is_individual_donor: draft.is_individual_donor,
      relationship_owner_user_id: draft.relationship_owner_user_id || null,
      confidential: draft.confidential,
      birthday: draft.birthday || null,
      personal_notes: draft.personal_notes.trim() || null,
      notes: draft.notes.trim() || null,
      updated_by: access.employeeId,
    }

    const isNew = !contact
    const res = isNew
      ? await supabase
          .from('fr_contacts')
          .insert({
            ...payload,
            card_image_path: cardImagePath,
            created_by: access.employeeId,
          })
          .select()
          .single()
      : await supabase
          .from('fr_contacts')
          .update(payload)
          .eq('id', contact.id)
          .select()
          .single()

    setBusy(false)
    if (res.error) {
      toast.error(res.error.message)
      return
    }
    toast.success(isNew ? 'Contact added.' : 'Saved.')
    onSaved(res.data as Contact, isNew)
    onClose()
  }

  async function softDelete() {
    if (!contact) return
    setBusy(true)
    const { error } = await supabase
      .from('fr_contacts')
      .update({ deleted_at: new Date().toISOString(), updated_by: access.employeeId })
      .eq('id', contact.id)
    setBusy(false)
    setConfirmDelete(false)
    if (error) { toast.error(error.message); return }
    toast.success('Contact deleted.')
    onDeleted?.(contact.id)
    onClose()
  }

  return (
    <>
      <Drawer
        open={open}
        title={contact ? 'Edit contact' : 'Add contact'}
        onClose={onClose}
        width={520}
        footer={
          <>
            {contact && onDeleted ? (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                aria-label="Delete contact"
              >
                <Trash2 size={15} />
              </Button>
            ) : null}
            <span className="grow" />
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div className="stack">
          {contact?.card_image_path ? (
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="tn-micro">Card on file</span>
              <DocumentLink path={contact.card_image_path} label="View card" />
            </div>
          ) : cardImagePath ? (
            <p className="chartsub">
              Read from the uploaded card. Check every field — photographed digits are the
              usual casualty.
            </p>
          ) : null}

          <Input
            label="Full name"
            required
            value={draft.full_name}
            onChange={(e) => set('full_name', e.currentTarget.value)}
          />

          {lockedOrganisationId ? null : (
            <OrganisationPicker
              label="Organisation"
              value={draft.organisation_id}
              onChange={(v) => set('organisation_id', v)}
              help="Leave blank for an unaffiliated individual."
            />
          )}

          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="grow">
              <Input
                label="Designation"
                value={draft.designation}
                onChange={(e) => set('designation', e.currentTarget.value)}
              />
            </div>
            <div className="grow">
              <Select
                label="Seniority"
                value={draft.seniority}
                onChange={(e) => set('seniority', e.currentTarget.value)}
              >
                <option value="">—</option>
                {SENIORITIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>

          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="grow">
              <Input
                label="Email"
                type="email"
                value={draft.email}
                onChange={(e) => set('email', e.currentTarget.value)}
              />
            </div>
            <div className="grow">
              <Input
                label="Phone"
                value={draft.phone}
                onChange={(e) => set('phone', e.currentTarget.value)}
              />
            </div>
          </div>

          <Input
            label="LinkedIn URL"
            value={draft.linkedin_url}
            onChange={(e) => set('linkedin_url', e.currentTarget.value)}
          />

          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="grow">
              <Select
                label="Relationship owner"
                value={draft.relationship_owner_user_id}
                onChange={(e) => set('relationship_owner_user_id', e.currentTarget.value)}
              >
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </div>
            <div className="grow">
              <Input
                label="Birthday"
                type="date"
                value={draft.birthday}
                onChange={(e) => set('birthday', e.currentTarget.value)}
              />
            </div>
          </div>

          <Textarea
            label="Cultivation notes"
            help="Informal, relationship-building context."
            value={draft.personal_notes}
            onChange={(e) => set('personal_notes', e.currentTarget.value)}
          />
          <Textarea label="Notes" value={draft.notes} onChange={(e) => set('notes', e.currentTarget.value)} />

          <Checkbox
            label="Primary contact for this organisation"
            checked={draft.is_primary}
            onChange={(v) => set('is_primary', v)}
          />
          <Checkbox
            label="Individual donor"
            checked={draft.is_individual_donor}
            onChange={(v) => set('is_individual_donor', v)}
          />
          <Checkbox
            label="Confidential"
            checked={draft.confidential}
            onChange={(v) => set('confidential', v)}
          />
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this contact?"
        body="It is a soft delete — the row is kept and can be restored with SQL."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={() => void softDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

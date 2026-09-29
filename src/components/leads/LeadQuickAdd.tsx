import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Drawer, Input, Select, Textarea, useToast } from '../ui'
import { DONOR_TYPES } from '../../lib/enums'
import { useAccess } from '../../lib/accessContext'

export type LeadSource = { id: string; key: string; label: string }

export type Lead = {
  id: string
  full_name: string
  org_name: string | null
  designation: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  donor_type_guess: string | null
  source_key: string | null
  source_detail: string | null
  owner_user_id: string | null
  status: string
  rejection_reason: string | null
  notes: string | null
  converted_organisation_id: string | null
  converted_at: string | null
  created_at: string
}

const EMPTY = {
  full_name: '', org_name: '', designation: '', email: '', phone: '',
  donor_type_guess: '', source_key: '', source_detail: '', notes: '',
}

/**
 * Quick-add form, deliberately kept to 8 visible fields (PRD FR-01) so a lead
 * captured at an event can be entered on a phone in seconds.
 */
export function LeadQuickAdd({
  open, onClose, onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: (lead: Lead) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const [draft, setDraft] = useState(EMPTY)
  const [sources, setSources] = useState<LeadSource[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setDraft(EMPTY)
  }, [open])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_lead_sources')
        .select('id, key, label')
        .eq('is_active', true)
        .order('sort_order')
      if (active) setSources((data ?? []) as LeadSource[])
    })()
    return () => { active = false }
  }, [])

  const set = (key: keyof typeof EMPTY, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    if (!draft.full_name.trim()) { toast.error('Name is required.'); return }
    if (!draft.email.trim() && !draft.phone.trim()) {
      toast.error('Give at least an email or a phone number.')
      return
    }
    setBusy(true)
    const { data, error } = await supabase
      .from('fr_leads')
      .insert({
        full_name: draft.full_name.trim(),
        org_name: draft.org_name.trim() || null,
        designation: draft.designation.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        donor_type_guess: draft.donor_type_guess || null,
        source_key: draft.source_key || null,
        source_detail: draft.source_detail.trim() || null,
        notes: draft.notes.trim() || null,
        // Captured leads land owned by whoever entered them, status 'new'.
        owner_user_id: access.employeeId,
        status: 'new',
        created_by: access.employeeId,
      })
      .select()
      .single()
    setBusy(false)
    if (error) { toast.error(error.message); return }
    toast.success('Lead captured.')
    onSaved(data as Lead)
    onClose()
  }

  return (
    <Drawer
      open={open}
      title="Capture lead"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="stack">
        <Input label="Full name" required value={draft.full_name} onChange={(e) => set('full_name', e.currentTarget.value)} />
        <Input
          label="Organisation"
          help="Free text — the organisation does not need to exist yet."
          value={draft.org_name}
          onChange={(e) => set('org_name', e.currentTarget.value)}
        />
        <Input label="Designation" value={draft.designation} onChange={(e) => set('designation', e.currentTarget.value)} />

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input label="Email" type="email" value={draft.email} onChange={(e) => set('email', e.currentTarget.value)} />
          </div>
          <div className="grow">
            <Input label="Phone" value={draft.phone} onChange={(e) => set('phone', e.currentTarget.value)} />
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Select label="Source" value={draft.source_key} onChange={(e) => set('source_key', e.currentTarget.value)}>
              <option value="">—</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
          <div className="grow">
            <Select
              label="Donor type"
              value={draft.donor_type_guess}
              onChange={(e) => set('donor_type_guess', e.currentTarget.value)}
            >
              <option value="">—</option>
              {DONOR_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </div>

        <Input
          label="Source detail"
          help="Event name, referrer, database…"
          value={draft.source_detail}
          onChange={(e) => set('source_detail', e.currentTarget.value)}
        />
        <Textarea label="Notes" value={draft.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
      </div>
    </Drawer>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { Badge, Button, DetailList, Drawer, Input, Select, useToast } from '../ui'
import { DictationTextarea } from '../DictationTextarea'
import { DONOR_TYPES, LEAD_REJECTION_REASONS, LEAD_STATUSES, labelOf } from '../../lib/enums'
import { formatDate } from '../../lib/format'
import { useAccess } from '../../lib/accessContext'
import type { Lead, LeadSource } from './LeadQuickAdd'

type Draft = {
  full_name: string
  org_name: string
  designation: string
  email: string
  phone: string
  linkedin_url: string
  source_key: string
  donor_type_guess: string
  source_detail: string
  owner_user_id: string
  notes: string
}

const toDraft = (l: Lead): Draft => ({
  full_name: l.full_name ?? '',
  org_name: l.org_name ?? '',
  designation: l.designation ?? '',
  email: l.email ?? '',
  phone: l.phone ?? '',
  linkedin_url: l.linkedin_url ?? '',
  source_key: l.source_key ?? '',
  donor_type_guess: l.donor_type_guess ?? '',
  source_detail: l.source_detail ?? '',
  owner_user_id: l.owner_user_id ?? '',
  notes: l.notes ?? '',
})

function statusTone(status: string) {
  switch (status) {
    case 'new': return 'amber' as const
    case 'assigned': return 'brown' as const
    case 'qualified_converted': return 'green' as const
    default: return 'outline' as const
  }
}

/**
 * Everything captured about one lead, editable in place. Status is not edited
 * here — it moves through the Convert and Reject actions, which stay available
 * while the lead is still open.
 */
export function LeadDrawer({
  lead, sources, employees, onClose, onSaved, onConvert, onReject,
}: {
  lead: Lead | null
  sources: LeadSource[]
  employees: Array<{ id: string; name: string }>
  onClose: () => void
  onSaved: (lead: Lead) => void
  onConvert: (lead: Lead) => void
  onReject: (lead: Lead) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setDraft(lead ? toDraft(lead) : null) }, [lead])

  if (!lead || !draft) return null

  const open = lead.status === 'new' || lead.status === 'assigned'
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(lead))
  const set = (key: keyof Draft, value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  /** Saves and returns the saved lead, or null when it could not. */
  async function save(): Promise<Lead | null> {
    if (!lead || !draft) return null
    if (!draft.full_name.trim()) { toast.error('Name is required.'); return null }
    if (!draft.email.trim() && !draft.phone.trim()) {
      toast.error('Give at least an email or a phone number.')
      return null
    }
    setBusy(true)
    const owner = draft.owner_user_id || null
    const { data, error } = await supabase
      .from('fr_leads')
      .update({
        full_name: draft.full_name.trim(),
        org_name: draft.org_name.trim() || null,
        designation: draft.designation.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        linkedin_url: draft.linkedin_url.trim() || null,
        source_key: draft.source_key || null,
        donor_type_guess: draft.donor_type_guess || null,
        source_detail: draft.source_detail.trim() || null,
        owner_user_id: owner,
        // Giving a new lead an owner moves it out of the untriaged state,
        // the same as assigning it from the table.
        status: owner && lead.status === 'new' ? 'assigned' : lead.status,
        notes: draft.notes.trim() || null,
        updated_by: access.employeeId,
      })
      .eq('id', lead.id)
      .select()
      .single()
    setBusy(false)
    if (error) { toast.error(error.message); return null }
    const saved = data as Lead
    onSaved(saved)
    return saved
  }

  async function saveAndClose() {
    if (!dirty) { onClose(); return }
    const saved = await save()
    if (saved) { toast.success('Lead saved.'); onClose() }
  }

  /** Converting or rejecting works from the saved lead, so unsaved edits are saved first. */
  async function then(action: (l: Lead) => void) {
    const current = dirty ? await save() : lead
    if (current) action(current)
  }

  return (
    <Drawer
      open
      title={lead.full_name}
      onClose={onClose}
      width={520}
      footer={
        <>
          {open ? (
            <>
              <Button variant="ghost" onClick={() => void then(onReject)} disabled={busy}>Reject</Button>
              <Button variant="secondary" onClick={() => void then(onConvert)} disabled={busy}>Convert</Button>
            </>
          ) : null}
          <Button onClick={() => void saveAndClose()} disabled={busy}>
            {busy ? 'Saving…' : dirty ? 'Save' : 'Close'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Badge tone={statusTone(lead.status)} dot>{labelOf(LEAD_STATUSES, lead.status)}</Badge>
          <span className="muted tn-num" style={{ fontSize: 'var(--text-sm)' }}>Captured {formatDate(lead.created_at)}</span>
        </div>

        {lead.status === 'rejected' || lead.converted_organisation_id ? (
          <DetailList
            items={[
              ...(lead.status === 'rejected'
                ? [{ label: 'Rejected because', value: labelOf(LEAD_REJECTION_REASONS, lead.rejection_reason) }]
                : []),
              ...(lead.converted_organisation_id
                ? [{
                    label: 'Converted',
                    value: (
                      <button
                        type="button"
                        className="celllink"
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                        onClick={() => navigate({ to: '/organisations/$id', params: { id: lead.converted_organisation_id! } })}
                      >
                        {lead.converted_at ? `${formatDate(lead.converted_at)} · ` : ''}View organisation
                      </button>
                    ),
                  }]
                : []),
            ]}
          />
        ) : null}

        <Input label="Full name" required value={draft.full_name} onChange={(e) => set('full_name', e.currentTarget.value)} />
        <Input label="Organisation" value={draft.org_name} onChange={(e) => set('org_name', e.currentTarget.value)} />
        <Input label="Designation" value={draft.designation} onChange={(e) => set('designation', e.currentTarget.value)} />

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input label="Email" type="email" value={draft.email} onChange={(e) => set('email', e.currentTarget.value)} />
          </div>
          <div className="grow">
            <Input label="Phone" value={draft.phone} onChange={(e) => set('phone', e.currentTarget.value)} />
          </div>
        </div>

        <Input label="LinkedIn" value={draft.linkedin_url} onChange={(e) => set('linkedin_url', e.currentTarget.value)} />

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Select label="Source" value={draft.source_key} onChange={(e) => set('source_key', e.currentTarget.value)}>
              <option value="">—</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
          <div className="grow">
            <Select label="Donor type" value={draft.donor_type_guess} onChange={(e) => set('donor_type_guess', e.currentTarget.value)}>
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

        <Select
          label="Owner"
          value={draft.owner_user_id}
          onChange={(e) => set('owner_user_id', e.currentTarget.value)}
          disabled={!open}
        >
          <option value="">Unassigned</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>

        <DictationTextarea label="Notes" rows={5} value={draft.notes} onChange={(v) => set('notes', v)} />
      </div>
    </Drawer>
  )
}

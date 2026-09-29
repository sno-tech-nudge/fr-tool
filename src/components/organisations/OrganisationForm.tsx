import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Checkbox, Drawer, Input, Select, Textarea, useToast } from '../ui'
import { DONOR_TYPES, RELATIONSHIP_STATUSES, normalizeName } from '../../lib/enums'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'

export type Organisation = {
  id: string
  name: string
  normalized_name: string | null
  website_domain: string | null
  donor_type: string | null
  segment: string | null
  geography_city: string | null
  geography_state: string | null
  geography_country: string | null
  csr_budget_annual_inr: number | null
  csr_focus_areas: string[] | null
  relationship_status: string | null
  relationship_owner_user_id: string | null
  confidential: boolean
  description: string | null
  notes: string | null
}

const EMPTY = {
  name: '', website_domain: '', donor_type: 'corporate', segment: '',
  geography_city: '', geography_state: '', geography_country: 'India',
  csr_budget_annual_inr: '', csr_focus_areas: '', relationship_status: 'prospect',
  relationship_owner_user_id: '', confidential: false, description: '', notes: '',
}

type Draft = typeof EMPTY

function toDraft(org: Organisation | null, defaultOwner: string | null): Draft {
  if (!org) return { ...EMPTY, relationship_owner_user_id: defaultOwner ?? '' }
  return {
    name: org.name ?? '',
    website_domain: org.website_domain ?? '',
    donor_type: org.donor_type ?? 'corporate',
    segment: org.segment ?? '',
    geography_city: org.geography_city ?? '',
    geography_state: org.geography_state ?? '',
    geography_country: org.geography_country ?? 'India',
    csr_budget_annual_inr: org.csr_budget_annual_inr != null ? String(org.csr_budget_annual_inr) : '',
    csr_focus_areas: (org.csr_focus_areas ?? []).join(', '),
    relationship_status: org.relationship_status ?? 'prospect',
    relationship_owner_user_id: org.relationship_owner_user_id ?? '',
    confidential: org.confidential ?? false,
    description: org.description ?? '',
    notes: org.notes ?? '',
  }
}

/**
 * Add/edit an organisation.
 *
 * `normalized_name` is a GENERATED column — never send it. It is read here only
 * to warn about probable duplicates before an insert (PRD FR-06).
 */
export function OrganisationForm({
  open, organisation, onClose, onSaved,
}: {
  open: boolean
  organisation: Organisation | null
  onClose: () => void
  onSaved: (org: Organisation, isNew: boolean) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const { employees } = useEmployees()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [dupes, setDupes] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (open) {
      setDraft(toDraft(organisation, access.employeeId))
      setDupes([])
    }
  }, [open, organisation, access.employeeId])

  const normalized = useMemo(() => normalizeName(draft.name), [draft.name])

  // Duplicate check on the generated column, skipping the record being edited.
  useEffect(() => {
    if (!open || normalized.length < 3) { setDupes([]); return }
    let active = true
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('fr_organisations')
        .select('id, name')
        .eq('normalized_name', normalized)
        .is('deleted_at', null)
        .limit(3)
      if (!active) return
      setDupes(((data ?? []) as Array<{ id: string; name: string }>)
        .filter((d) => d.id !== organisation?.id))
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [normalized, open, organisation?.id])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    if (!draft.name.trim()) { toast.error('Name is required.'); return }
    if (!draft.relationship_owner_user_id) { toast.error('Pick a relationship owner.'); return }
    setBusy(true)

    const payload = {
      name: draft.name.trim(),
      website_domain: draft.website_domain.trim() || null,
      donor_type: draft.donor_type || null,
      segment: draft.segment.trim() || null,
      geography_city: draft.geography_city.trim() || null,
      geography_state: draft.geography_state.trim() || null,
      geography_country: draft.geography_country.trim() || null,
      csr_budget_annual_inr: draft.csr_budget_annual_inr ? Number(draft.csr_budget_annual_inr) : null,
      csr_focus_areas: draft.csr_focus_areas
        ? draft.csr_focus_areas.split(',').map((s) => s.trim()).filter(Boolean)
        : null,
      relationship_status: draft.relationship_status || null,
      relationship_owner_user_id: draft.relationship_owner_user_id,
      confidential: draft.confidential,
      description: draft.description.trim() || null,
      notes: draft.notes.trim() || null,
      updated_by: access.employeeId,
    }

    const isNew = !organisation
    const res = isNew
      ? await supabase
          .from('fr_organisations')
          .insert({ ...payload, created_by: access.employeeId })
          .select()
          .single()
      : await supabase
          .from('fr_organisations')
          .update(payload)
          .eq('id', organisation.id)
          .select()
          .single()

    setBusy(false)
    if (res.error) { toast.error(res.error.message); return }
    toast.success(isNew ? 'Organisation added.' : 'Saved.')
    onSaved(res.data as Organisation, isNew)
    onClose()
  }

  return (
    <Drawer
      open={open}
      title={organisation ? 'Edit organisation' : 'Add organisation'}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="stack">
        <Input
          label="Name"
          required
          value={draft.name}
          onChange={(e) => set('name', e.currentTarget.value)}
        />

        {dupes.length > 0 ? (
          <p className="notice">
            Possible duplicate: {dupes.map((d) => d.name).join(', ')}
          </p>
        ) : null}

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Select
              label="Donor type"
              value={draft.donor_type}
              onChange={(e) => set('donor_type', e.currentTarget.value)}
            >
              {DONOR_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div className="grow">
            <Select
              label="Relationship status"
              value={draft.relationship_status}
              onChange={(e) => set('relationship_status', e.currentTarget.value)}
            >
              {RELATIONSHIP_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </div>

        <Select
          label="Relationship owner"
          required
          value={draft.relationship_owner_user_id}
          onChange={(e) => set('relationship_owner_user_id', e.currentTarget.value)}
        >
          <option value="">Select an owner</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Website domain"
              placeholder="example.com"
              value={draft.website_domain}
              onChange={(e) => set('website_domain', e.currentTarget.value)}
            />
          </div>
          <div className="grow">
            <Input
              label="Sector"
              value={draft.segment}
              onChange={(e) => set('segment', e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input label="City" value={draft.geography_city} onChange={(e) => set('geography_city', e.currentTarget.value)} />
          </div>
          <div className="grow">
            <Input label="State" value={draft.geography_state} onChange={(e) => set('geography_state', e.currentTarget.value)} />
          </div>
          <div className="grow">
            <Input label="Country" value={draft.geography_country} onChange={(e) => set('geography_country', e.currentTarget.value)} />
          </div>
        </div>

        <Input
          label="Annual CSR budget (₹)"
          type="number"
          value={draft.csr_budget_annual_inr}
          onChange={(e) => set('csr_budget_annual_inr', e.currentTarget.value)}
        />

        <Input
          label="CSR focus areas"
          help="Comma separated"
          value={draft.csr_focus_areas}
          onChange={(e) => set('csr_focus_areas', e.currentTarget.value)}
        />

        <Textarea label="Description" value={draft.description} onChange={(e) => set('description', e.currentTarget.value)} />
        <Textarea label="Notes" value={draft.notes} onChange={(e) => set('notes', e.currentTarget.value)} />

        <Checkbox
          label="Confidential"
          checked={draft.confidential}
          onChange={(v) => set('confidential', v)}
        />
      </div>
    </Drawer>
  )
}

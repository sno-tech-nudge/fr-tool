import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, Checkbox, Drawer, Input, Select, Textarea, useToast } from '../ui'
import { SearchSelect } from '../SearchSelect'
import { DONOR_TYPES, RELATIONSHIP_STATUSES, normalizeName } from '../../lib/enums'
import { useAccess } from '../../lib/accessContext'
import { useEmployees } from '../../hooks/useEmployees'
import { DictationTextarea } from '../DictationTextarea'
import { notifyMentions, useFrPeople } from '../../lib/mentions'

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
  /** The owner shown: a person in the tool or any name. */
  relationship_owner_name?: string | null
  confidential: boolean
  description: string | null
  notes: string | null
}

const EMPTY = {
  name: '', website_domain: '', donor_type: 'corporate', segment: '',
  geography_city: '', geography_state: '', geography_country: 'India',
  csr_budget_annual_inr: '', csr_focus_areas: '', relationship_status: 'prospect',
  relationship_owner_name: '', confidential: false, description: '', notes: '',
}

type Draft = typeof EMPTY

function toDraft(org: Organisation | null, defaultOwner: string, nameOf: (id: string | null) => string): Draft {
  if (!org) return { ...EMPTY, relationship_owner_name: defaultOwner }
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
    relationship_owner_name: org.relationship_owner_name || nameOf(org.relationship_owner_user_id),
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
  const people = useFrPeople()
  const { employees } = useEmployees()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [dupes, setDupes] = useState<Array<{ id: string; name: string }>>([])
  const [ownerNames, setOwnerNames] = useState<string[]>([])
  // Read through a ref so the staff list arriving does not reset the form.
  const employeesRef = useRef(employees)
  employeesRef.current = employees

  useEffect(() => {
    if (!open) return
    const nameOf = (id: string | null) => employeesRef.current.find((e) => e.id === id)?.name ?? ''
    setDraft(toDraft(organisation, access.employeeName ?? '', nameOf))
    setDupes([])
    void supabase.from('fr_org_owner_names').select('name').then(({ data }) =>
      setOwnerNames(((data ?? []) as Array<{ name: string }>).map((r) => r.name)))
  }, [open, organisation, access.employeeName])

  // People in the tool first, then names that only appear as owners.
  const ownerSuggestions = useMemo(() => {
    const team = employees.map((e) => e.name)
    const seen = new Set(team.map((n) => n.toLowerCase()))
    const others = ownerNames.filter((n) => !seen.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b))
    return [...team, ...others]
  }, [employees, ownerNames])

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
    const ownerName = draft.relationship_owner_name.trim()
    if (!ownerName) { toast.error('Add an owner.'); return }
    const ownerId = employees.find((e) => e.name.toLowerCase() === ownerName.toLowerCase())?.id
      ?? access.employeeId
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
      relationship_owner_name: ownerName,
      confidential: draft.confidential,
      description: draft.description.trim() || null,
      notes: draft.notes.trim() || null,
      updated_by: access.employeeId,
    }

    const isNew = !organisation
    const res = isNew
      ? await supabase
          .from('fr_organisations')
          .insert({ ...payload, relationship_owner_user_id: ownerId, created_by: access.employeeId })
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
    toast.success(isNew ? 'Company added.' : 'Saved.')
    void notifyMentions({
      before: organisation?.notes, after: draft.notes, people,
      parentType: 'organisation', parentId: (res.data as Organisation).id, selfId: access.employeeId,
    })
    onSaved(res.data as Organisation, isNew)
    onClose()
  }

  return (
    <Drawer
      open={open}
      title={organisation ? 'Edit company' : 'Add company'}
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

        <SearchSelect
          label="Relationship owner"
          required
          freeText
          value={draft.relationship_owner_name}
          options={ownerSuggestions.map((n) => ({ value: n, label: n }))}
          onChange={(v) => set('relationship_owner_name', v)}
        />

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
          placeholder="Comma separated"
          value={draft.csr_focus_areas}
          onChange={(e) => set('csr_focus_areas', e.currentTarget.value)}
        />

        <Textarea label="Description" value={draft.description} onChange={(e) => set('description', e.currentTarget.value)} />
        <DictationTextarea label="Notes" mentions value={draft.notes} onChange={(v) => set('notes', v)} />

        <Checkbox
          label="Confidential"
          checked={draft.confidential}
          onChange={(v) => set('confidential', v)}
        />
      </div>
    </Drawer>
  )
}

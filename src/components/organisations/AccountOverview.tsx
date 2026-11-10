import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DetailList, EmptyState, Skeleton, useToast } from '../ui'
import { DictationTextarea } from '../DictationTextarea'
import { useAccess } from '../../lib/accessContext'
import { notifyMentions, useFrPeople } from '../../lib/mentions'
import { DONOR_TYPES, labelOf } from '../../lib/enums'
import { formatMoney } from '../../lib/format'
import type { Organisation } from './OrganisationForm'
import { ContactForm, type Contact } from '../contacts/ContactForm'
import { ContactSearch } from './ContactSearch'
import { CollectionCard, WalletShareCard } from './AccountCharts'
import {
  EMPTY_PLAN, useAccountData, type AccountPlan, type PlanContact, type Rag,
} from './useAccountData'

/**
 * The organisation's account plan: where the relationship stands, read off
 * its grants and deals, beside the parts only the team can fill in. Anything
 * worked out from the data is a default — typing over it saves the override.
 */

const SAVE_DELAY = 800
const RAGS: Rag[] = ['green', 'amber', 'red']
const SENIOR = new Set(['cxo', 'senior_leadership', 'trustee'])

function monthYear(d: string | null): string | null {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

type TextKey = 'reporting_cadence' | 'call_cadence' | 'next_steps' | 'top_partners'
  | 'renewal_cycle' | 'board_meeting' | 'aspiration_programs' | 'aspiration_notes'
type HealthKey = 'health_collection' | 'health_compliance' | 'health_relationship' | 'health_renewal'

export function AccountOverview({ org, ownerName }: { org: Organisation; ownerName: string }) {
  const toast = useToast()
  const access = useAccess()
  const people = useFrPeople()
  const { data, error, setData } = useAccountData(org.id)
  const [draft, setDraft] = useState<AccountPlan>(EMPTY_PLAN(org.id))
  const saved = useRef<AccountPlan | null>(null)

  useEffect(() => {
    if (data?.plan && saved.current === null) { saved.current = data.plan; setDraft(data.plan) }
  }, [data?.plan])

  // Autosave: a pause in typing writes whatever changed since the last save.
  useEffect(() => {
    const base = saved.current
    if (!base || !data || data.planMissing) return
    const changed = (Object.keys(draft) as Array<keyof AccountPlan>).filter((k) => draft[k] !== base[k])
    if (changed.length === 0) return
    const t = window.setTimeout(async () => {
      const patch: Record<string, unknown> = { organisation_id: org.id, updated_by: access.employeeId }
      for (const k of changed) {
        const v = draft[k]
        patch[k] = typeof v === 'string' ? (v.trim() || null) : v
        // The month picker gives "YYYY-MM"; the column is a date.
        if (k === 'partner_since' && patch[k]) patch[k] = `${patch[k]}-01`
      }
      if (!base.id) patch.created_by = access.employeeId
      const { data: row, error: err } = await supabase
        .from('fr_org_account_plans')
        .upsert(patch, { onConflict: 'organisation_id' })
        .select()
        .single()
      if (err) { toast.error(err.message); return }
      if (changed.includes('next_steps')) {
        void notifyMentions({
          before: base.next_steps, after: draft.next_steps, people,
          parentType: 'organisation', parentId: org.id, selfId: access.employeeId,
        })
      }
      // Keep what is being typed; only the stored copy moves forward.
      saved.current = { ...(row as AccountPlan), ...Object.fromEntries(changed.map((k) => [k, draft[k]])) }
    }, SAVE_DELAY)
    return () => window.clearTimeout(t)
  }, [draft, data, org.id, access.employeeId, toast, people])

  if (error) return <div className="card"><EmptyState title="Could not load the account plan" body={error} /></div>
  if (!data) {
    return (
      <div className="stack">
        <Skeleton height={56} />
        <div className="acctgrid acctgrid--2"><Skeleton height={240} /><Skeleton height={240} /></div>
        <Skeleton height={72} />
      </div>
    )
  }

  const setText = (k: TextKey, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const text = (k: TextKey, auto?: string | null) => draft[k] ?? auto ?? ''
  const notReady = () => toast.error('The account plan tables are not set up yet.')
  const edit = data.planMissing ? notReady : null
  const { header: h, auto } = data

  const health: Array<{ key: HealthKey; label: string; auto: Rag | null }> = [
    { key: 'health_collection', label: 'Collection', auto: auto.collection },
    { key: 'health_compliance', label: 'Compliance', auto: auto.compliance },
    { key: 'health_relationship', label: 'Relationship', auto: auto.relationship },
    { key: 'health_renewal', label: 'Renewal / upsell', auto: auto.renewal },
  ]

  /** Replaces the contact, or adds it when it was just created. */
  function patchContact(next: PlanContact) {
    setData((d) => {
      if (!d) return d
      const known = d.contacts.some((c) => c.id === next.id)
      return { ...d, contacts: known ? d.contacts.map((c) => (c.id === next.id ? next : c)) : [...d.contacts, next] }
    })
  }

  return (
    <div className="stack acct">
      <section className="acctsummary">
        <dl className="acctstrip">
          <StripItem label="Period" value={h.from || h.to ? `${monthYear(h.from) ?? '—'} – ${monthYear(h.to) ?? '—'}` : null} />
          <StripItem label="Committed" value={h.committed ? formatMoney(h.committed) : null} num />
          <StripItem label="Received" value={h.committed ? formatMoney(h.received) : null} num />
          <StripItem label="Programs" value={h.programs.join(', ') || null} />
          <StripItem label="States" value={h.states.join(', ') || null} />
          <StripItem label="Owner" value={ownerName !== '—' ? ownerName : null} />
          <StripItem label="Entity" value={h.entities.join(', ') || null} />
        </dl>
        <div className="accthealth">
          {health.map((it) => (
            <div key={it.key} className="accthealth__item">
              <span className="tn-micro">{it.label}</span>
              <RagPicker
                value={draft[it.key]}
                auto={it.auto}
                onChange={(v) => (edit ? edit() : setDraft((d) => ({ ...d, [it.key]: v })))}
              />
            </div>
          ))}
          <div className="accthealth__item accthealth__delight">
            <span className="tn-micro">Donor delight</span>
            <span className="accthealth__score">
              <input
                className="input tn-num"
                type="number" min={0} max={10} step={0.5}
                aria-label="Donor delight score out of 10"
                value={draft.donor_delight_score ?? ''}
                onChange={(e) => {
                  if (edit) { edit(); return }
                  const raw = e.currentTarget.value
                  const n = raw === '' ? null : Math.min(10, Math.max(0, Number(raw)))
                  setDraft((d) => ({ ...d, donor_delight_score: n }))
                }}
              />
              <span className="faint tn-num">/ 10</span>
            </span>
          </div>
        </div>
      </section>

      <div className="acctgrid acctgrid--2">
        <WalletShareCard
          organisationId={org.id}
          years={data.years}
          onBudget={(fy, budget) => setData((d) => d && ({
            ...d,
            years: d.years.map((y) => (y.fy === fy
              ? { ...y, budget, share: budget ? Math.round((y.collected / budget) * 1000) / 10 : null }
              : y)),
          }))}
        />
        <CollectionCard years={data.years} />
      </div>

      <div className="acctgrid acctgrid--4">
        <section className="card acctcard acctcard--square">
          <div className="tn-micro">Relationship</div>
          <div className="kvlist kvlist--stack">
            <Kv label="Partner since">
              <input
                className="kv__input tn-num"
                // Empty, it reads "Add" like the other fields; the month picker appears on focus.
                type={draft.partner_since ?? h.partnerSince ? 'month' : 'text'}
                placeholder="Add"
                onFocus={(e) => { e.currentTarget.type = 'month' }}
                onBlur={(e) => { if (!e.currentTarget.value) e.currentTarget.type = 'text' }}
                aria-label="Partner since"
                value={draft.partner_since ?? h.partnerSince?.slice(0, 7) ?? ''}
                onChange={(e) => {
                  if (edit) { edit(); return }
                  const v = e.currentTarget.value
                  setDraft((d) => ({ ...d, partner_since: v || null }))
                }}
              />
            </Kv>
            <div className="kvpair">
              <PlanInput label="Reporting" value={text('reporting_cadence', auto.reportingCadence)} onChange={(v) => setText('reporting_cadence', v)} onBlocked={edit} />
              <PlanInput label="Calls" value={text('call_cadence')} onChange={(v) => setText('call_cadence', v)} onBlocked={edit} />
            </div>
            <PeopleList role="decision_maker" label="Decision makers" organisationId={org.id} contacts={data.contacts} onChange={patchContact} />
            <PeopleList role="influencer" label="Influencers" organisationId={org.id} contacts={data.contacts} onChange={patchContact} />
          </div>
        </section>

        <section className="card acctcard acctcard--square">
          <div className="tn-micro">Next steps</div>
          <div className="acctnotes" onFocusCapture={edit ? () => edit() : undefined}>
            <DictationTextarea
              label="Next steps"
              rows={9}
              mentions
              value={text('next_steps')}
              onChange={(v) => setText('next_steps', v)}
            />
          </div>
        </section>

        <section className="card acctcard acctcard--square">
          <div className="tn-micro">Partner overview</div>
          <div className="kvlist kvlist--stack">
            <PlanInput label="Other NGOs funded" multiline value={text('top_partners')} onChange={(v) => setText('top_partners', v)} onBlocked={edit} />
            <PlanInput label="Renewal cycle" value={text('renewal_cycle', auto.renewalCycle)} onChange={(v) => setText('renewal_cycle', v)} onBlocked={edit} />
            <PlanInput label="Board meeting" value={text('board_meeting')} onChange={(v) => setText('board_meeting', v)} onBlocked={edit} />
          </div>
        </section>

        <section className="card acctcard acctcard--square">
          <div className="tn-micro">Aspiration</div>
          <div className="kvlist kvlist--stack">
            <Kv label="Target">
              <span className="kv__money">
                <input
                  className="kv__input tn-num"
                  inputMode="decimal"
                  placeholder="Add"
                  aria-label="Aspiration target in crore"
                  value={draft.aspiration_target_inr == null ? '' : String(draft.aspiration_target_inr / 1e7)}
                  onChange={(e) => {
                    if (edit) { edit(); return }
                    const raw = e.currentTarget.value.trim()
                    const cr = raw === '' ? null : Number(raw)
                    if (cr != null && !Number.isFinite(cr)) return
                    setDraft((d) => ({ ...d, aspiration_target_inr: cr == null ? null : Math.round(cr * 1e7) }))
                  }}
                />
                <span className="faint">Cr</span>
              </span>
            </Kv>
            <PlanInput label="Programs" value={text('aspiration_programs')} onChange={(v) => setText('aspiration_programs', v)} onBlocked={edit} />
            <PlanInput label="Notes" multiline value={text('aspiration_notes')} onChange={(v) => setText('aspiration_notes', v)} onBlocked={edit} />
          </div>
        </section>
      </div>

      <section className="card">
        <DetailList
          items={[
            { label: 'Donor type', value: labelOf(DONOR_TYPES, org.donor_type) },
            { label: 'Sector', value: org.segment },
            {
              label: 'Location',
              value: [org.geography_city, org.geography_state, org.geography_country].filter(Boolean).join(', ') || null,
            },
            { label: 'CSR focus areas', value: org.csr_focus_areas?.length ? org.csr_focus_areas.join(', ') : null },
            { label: 'Description', value: org.description },
            { label: 'Notes', value: org.notes },
          ]}
        />
      </section>
    </div>
  )
}

function StripItem({ label, value, num }: { label: string; value: string | null; num?: boolean }) {
  return (
    <div className="acctstrip__item">
      <dt className="tn-micro">{label}</dt>
      <dd className={num ? 'tn-num' : undefined} data-empty={!value || undefined}>{value ?? '—'}</dd>
    </div>
  )
}

/** One label/value line. Values read as text and turn into a field on hover or focus. */
function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <div className="kv__value">{children}</div>
    </div>
  )
}

function PlanInput({
  label, value, onChange, onBlocked, multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlocked: (() => void) | null
  multiline?: boolean
}) {
  const props = {
    value,
    placeholder: 'Add',
    'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (onBlocked) { onBlocked(); return }
      onChange(e.currentTarget.value)
    },
  }
  return (
    <Kv label={label}>
      {multiline ? <textarea className="kv__input kv__input--multi" rows={2} {...props} /> : <input className="kv__input" {...props} />}
    </Kv>
  )
}

/** Three dots; the worked-out value shows faded until someone sets one. */
function RagPicker({ value, auto, onChange }: { value: Rag | null; auto: Rag | null; onChange: (v: Rag | null) => void }) {
  const shown = value ?? auto
  return (
    <div className="ragpick" role="radiogroup">
      {RAGS.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={shown === r}
          aria-label={r}
          title={shown === r && !value ? 'From the data' : undefined}
          className="ragpick__dot"
          data-rag={r}
          data-on={shown === r || undefined}
          data-auto={(shown === r && !value) || undefined}
          // Clicking the one you set hands it back to the data.
          onClick={() => onChange(value === r ? null : r)}
        />
      ))}
    </div>
  )
}

/** One dot that steps through the ratings on click: green, amber, red, none. */
function RagCycle({ value, name, onChange }: { value: Rag | null; name: string; onChange: (v: Rag | null) => void }) {
  const next: Rag | null = value === null ? 'green' : value === 'green' ? 'amber' : value === 'amber' ? 'red' : null
  return (
    <button
      type="button"
      className="ragpick__dot ragcycle"
      data-rag={value ?? undefined}
      data-on={value ? true : undefined}
      aria-label={`${name}: ${value ?? 'not rated'}. Change rating`}
      title={value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Not rated'}
      onClick={() => onChange(next)}
    />
  )
}

function PeopleList({
  role, label, organisationId, contacts, onChange,
}: {
  role: 'decision_maker' | 'influencer'
  label: string
  organisationId: string
  contacts: PlanContact[]
  onChange: (c: PlanContact) => void
}) {
  const toast = useToast()
  const access = useAccess()
  // Set to a name to open the add-contact form; null when closed.
  const [newName, setNewName] = useState<string | null>(null)
  const listed = contacts.filter((c) => c.influence_role === role)
  const free = contacts
    .filter((c) => !c.influence_role)
    .sort((a, b) => Number(SENIOR.has(b.seniority ?? '')) - Number(SENIOR.has(a.seniority ?? '')))

  async function update(c: PlanContact, patch: Partial<PlanContact>) {
    const { data, error } = await supabase
      .from('fr_contacts')
      .update({ ...patch, updated_by: access.employeeId })
      .eq('id', c.id)
      .select('id, full_name, designation, seniority, influence_role, relationship_rag')
      .single()
    if (error) { toast.error(error.message); return }
    onChange(data as PlanContact)
  }

  return (
    <Kv label={label}>
      {listed.length ? (
        <ul className="acctpeople">
          {listed.map((c) => (
            <li key={c.id}>
              <span className="acctpeople__name" title={c.designation ?? undefined}>
                {c.full_name}
                {c.designation ? <span className="faint"> · {c.designation}</span> : null}
              </span>
              <RagCycle value={c.relationship_rag} name={c.full_name} onChange={(v) => void update(c, { relationship_rag: v })} />
              <button type="button" className="acctpeople__x" aria-label={`Remove ${c.full_name}`}
                onClick={() => void update(c, { influence_role: null })}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ContactSearch
        label={label}
        contacts={free}
        onPick={(c) => void update(c, { influence_role: role })}
        onCreate={(name) => setNewName(name)}
      />
      <ContactForm
        open={newName !== null}
        contact={null}
        lockedOrganisationId={organisationId}
        prefill={newName ? { full_name: newName } : null}
        onClose={() => setNewName(null)}
        // A new contact joins this list as soon as it is saved.
        onSaved={(c: Contact) => void update({ id: c.id } as PlanContact, { influence_role: role })}
      />
    </Kv>
  )
}

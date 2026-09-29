import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, Checkbox, Drawer, Input, Select, useToast } from '../ui'
import { DONOR_TYPES, RELATIONSHIP_STATUSES, normalizeName } from '../../lib/enums'
import { useAccess } from '../../lib/accessContext'
import { OrganisationPicker } from '../organisations/OrganisationPicker'
import type { Lead } from './LeadQuickAdd'

type Step = 1 | 2

/**
 * Converts a lead into an Organisation + Contact, carrying source attribution
 * across (PRD FR-04).
 *
 * Step 3 of the full flow — creating the Opportunity — is deliberately absent:
 * fr_opportunities does not exist until Phase 2. The lead is marked
 * qualified_converted here, and the opportunity step gets added to this wizard
 * when the pipeline lands.
 */
export function LeadConvertWizard({
  open, lead, onClose, onConverted,
}: {
  open: boolean
  lead: Lead | null
  onClose: () => void
  onConverted: (leadId: string, organisationId: string) => void
}) {
  const toast = useToast()
  const access = useAccess()

  const [step, setStep] = useState<Step>(1)
  const [busy, setBusy] = useState(false)

  // Step 1 — organisation: reuse an existing one, or create from the lead.
  const [mode, setMode] = useState<'existing' | 'new'>('new')
  const [existingOrgId, setExistingOrgId] = useState('')
  const [orgName, setOrgName] = useState('')
  const [donorType, setDonorType] = useState('corporate')
  const [relStatus, setRelStatus] = useState('in_conversation')
  const [matches, setMatches] = useState<Array<{ id: string; name: string }>>([])

  // Step 2 — contact.
  const [fullName, setFullName] = useState('')
  const [designation, setDesignation] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [isPrimary, setIsPrimary] = useState(true)

  useEffect(() => {
    if (!open || !lead) return
    setStep(1)
    setMode('new')
    setExistingOrgId('')
    setOrgName(lead.org_name ?? '')
    setDonorType(lead.donor_type_guess ?? 'corporate')
    setRelStatus('in_conversation')
    setFullName(lead.full_name ?? '')
    setDesignation(lead.designation ?? '')
    setEmail(lead.email ?? '')
    setPhone(lead.phone ?? '')
    setIsPrimary(true)
  }, [open, lead])

  // Warn if an organisation with this name already exists, and offer to reuse it.
  useEffect(() => {
    const normalized = normalizeName(orgName)
    if (!open || normalized.length < 3) { setMatches([]); return }
    let active = true
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('fr_organisations')
        .select('id, name')
        .eq('normalized_name', normalized)
        .is('deleted_at', null)
        .limit(3)
      if (active) setMatches((data ?? []) as Array<{ id: string; name: string }>)
    }, 300)
    return () => { active = false; clearTimeout(t) }
  }, [orgName, open])

  if (!lead) return null

  async function convert() {
    setBusy(true)
    try {
      /* --- organisation --- */
      let organisationId = existingOrgId

      if (mode === 'new') {
        if (!orgName.trim()) throw new Error('Organisation name is required.')
        const { data: org, error: orgErr } = await supabase
          .from('fr_organisations')
          .insert({
            name: orgName.trim(),
            donor_type: donorType || null,
            relationship_status: relStatus || null,
            relationship_owner_user_id: lead!.owner_user_id ?? access.employeeId,
            created_by: access.employeeId,
            updated_by: access.employeeId,
          })
          .select()
          .single()
        if (orgErr) throw new Error(orgErr.message)
        organisationId = (org as { id: string }).id
      } else if (!organisationId) {
        throw new Error('Pick an organisation.')
      }

      /* --- contact --- */
      if (!fullName.trim()) throw new Error('Contact name is required.')
      const { error: contactErr } = await supabase
        .from('fr_contacts')
        .insert({
          organisation_id: organisationId,
          full_name: fullName.trim(),
          designation: designation.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          linkedin_url: lead!.linkedin_url ?? null,
          is_primary: isPrimary,
          relationship_owner_user_id: lead!.owner_user_id ?? access.employeeId,
          created_by: access.employeeId,
          updated_by: access.employeeId,
        })
        .select()
        .single()
      if (contactErr) throw new Error(contactErr.message)

      /* --- close the lead, preserving attribution --- */
      const { error: leadErr } = await supabase
        .from('fr_leads')
        .update({
          status: 'qualified_converted',
          converted_organisation_id: organisationId,
          converted_at: new Date().toISOString(),
          updated_by: access.employeeId,
        })
        .eq('id', lead!.id)
      if (leadErr) throw new Error(leadErr.message)

      toast.success('Lead converted.')
      onConverted(lead!.id, organisationId)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not convert this lead.')
    } finally {
      setBusy(false)
    }
  }

  const canAdvance = mode === 'new' ? orgName.trim().length > 0 : existingOrgId !== ''

  return (
    <Drawer
      open={open}
      title="Convert lead"
      onClose={onClose}
      width={520}
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => setStep(2)} disabled={!canAdvance || busy}>Next</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>Back</Button>
            <span className="grow" />
            <Button onClick={() => void convert()} disabled={busy}>
              {busy ? 'Converting…' : 'Convert'}
            </Button>
          </>
        )
      }
    >
      <div className="steps">
        <span className="step" data-state={step === 1 ? 'active' : 'done'}>
          <span className="step__num">{step > 1 ? <Check size={12} /> : '1'}</span> Organisation
        </span>
        <span className="step" data-state={step === 2 ? 'active' : undefined}>
          <span className="step__num">2</span> Contact
        </span>
      </div>

      {step === 1 ? (
        <div className="stack">
          <Select label="Organisation" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'existing' | 'new')}>
            <option value="new">Create a new organisation</option>
            <option value="existing">Link to an existing organisation</option>
          </Select>

          {mode === 'new' ? (
            <>
              <Input
                label="Name"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.currentTarget.value)}
              />

              {matches.length > 0 ? (
                <div className="notice">
                  <p style={{ margin: '0 0 var(--space-2)' }}>
                    {matches[0].name} already exists.
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setMode('existing'); setExistingOrgId(matches[0].id) }}
                  >
                    Link to it instead
                  </Button>
                </div>
              ) : null}

              <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
                <div className="grow">
                  <Select label="Donor type" value={donorType} onChange={(e) => setDonorType(e.currentTarget.value)}>
                    {DONOR_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div className="grow">
                  <Select label="Relationship status" value={relStatus} onChange={(e) => setRelStatus(e.currentTarget.value)}>
                    {RELATIONSHIP_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>
            </>
          ) : (
            <OrganisationPicker
              label="Organisation"
              required
              value={existingOrgId}
              onChange={setExistingOrgId}
            />
          )}
        </div>
      ) : (
        <div className="stack">
          <Input label="Full name" required value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
          <Input label="Designation" value={designation} onChange={(e) => setDesignation(e.currentTarget.value)} />
          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="grow">
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </div>
            <div className="grow">
              <Input label="Phone" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
            </div>
          </div>
          <Checkbox
            label="Primary contact for this organisation"
            checked={isPrimary}
            onChange={setIsPrimary}
          />
        </div>
      )}
    </Drawer>
  )
}

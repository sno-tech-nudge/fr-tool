import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { ImageUp, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  Badge, Button, EmptyState, Pagination, SearchInput, Select, TableSkeleton,
} from '../components/ui'
import { ContactForm, type Contact, type ContactPrefill } from '../components/contacts/ContactForm'
import { ContactScanDrawer } from '../components/contacts/ContactScanDrawer'
import type { ContactCardFields } from '../lib/documents'
import { SENIORITIES, labelOf } from '../lib/enums'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { sanitizeSearch } from '../lib/query'

export const Route = createFileRoute('/_app/contacts')({ component: ContactsPage })

const PAGE_SIZE = 50
const DEFAULTS = { q: '', seniority: '', individual: '', page: '1' }

type ContactRow = Contact & {
  fr_organisations: { id: string; name: string } | null
}

/**
 * Link the card's employer only when exactly one organisation matches. Two
 * candidates means a guess, and a contact filed under the wrong donor is
 * harder to notice than an empty field.
 */
async function matchOrganisation(name: string | null): Promise<string> {
  if (!name?.trim()) return ''
  const { data } = await supabase
    .from('fr_organisations')
    .select('id')
    .is('deleted_at', null)
    .ilike('name', `%${sanitizeSearch(name.trim())}%`)
    .limit(2)
  return data?.length === 1 ? (data[0] as { id: string }).id : ''
}

/** Whatever the card carried that has no field of its own. */
function leftoverNotes(f: ContactCardFields, orgLinked: boolean): string {
  const bits: string[] = []
  if (f.organisation_name && !orgLinked) bits.push(`Organisation on card: ${f.organisation_name}`)
  if (f.website) bits.push(f.website)
  if (f.address) bits.push(f.address)
  return bits.join('\n')
}

function ContactsPage() {
  const { filters, setFilter } = useUrlFilters(DEFAULTS)

  const [rows, setRows] = useState<ContactRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [prefill, setPrefill] = useState<ContactPrefill | null>(null)
  const [cardPath, setCardPath] = useState<string | null>(null)

  const page = Math.max(1, Number(filters.page) || 1)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)

    let q = supabase
      .from('fr_contacts')
      .select('*, fr_organisations(id, name)', { count: 'exact' })
      .is('deleted_at', null)

    if (filters.q) {
      // Match either the person's name or their email.
      const s = sanitizeSearch(filters.q)
      q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%`)
    }
    if (filters.seniority) q = q.eq('seniority', filters.seniority)
    if (filters.individual === 'yes') q = q.eq('is_individual_donor', true)

    const { data, error: err, count } = await q
      .order('full_name')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (err) { setError(err.message); setRows([]); return }
    setRows((data ?? []) as unknown as ContactRow[])
    setTotal(count ?? 0)
  }, [filters.q, filters.seniority, filters.individual, page])

  useEffect(() => { void load() }, [load])

  // Arriving via a `?contact=<id>` link (e.g. from an organisation's Contacts
  // tab) opens that person's edit drawer directly, independent of whatever
  // page/filters the directory itself is on.
  const linkedContactId = useRouterState({
    // The route has no validateSearch schema, so TanStack types `search` as
    // `{}` — the same untyped-search situation useUrlFilters works around.
    select: (s) => {
      const search = s.location.search as Record<string, unknown>
      return typeof search.contact === 'string' ? search.contact : null
    },
  })
  useEffect(() => {
    if (!linkedContactId) return
    let active = true
    ;(async () => {
      const { data } = await supabase.from('fr_contacts').select('*').eq('id', linkedContactId).maybeSingle()
      if (active && data) { setEditing(data as Contact); setFormOpen(true) }
    })()
    return () => { active = false }
  }, [linkedContactId])

  function openAdd() {
    setEditing(null)
    setPrefill(null)
    setCardPath(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setPrefill(null)
    setCardPath(null)
  }

  async function openFromCard(fields: ContactCardFields, path: string) {
    const organisationId = await matchOrganisation(fields.organisation_name)
    setEditing(null)
    setCardPath(path)
    setPrefill({
      organisation_id: organisationId,
      full_name: fields.full_name ?? '',
      designation: fields.designation ?? '',
      email: fields.email ?? '',
      phone: fields.phone ?? '',
      linkedin_url: fields.linkedin_url ?? '',
      notes: leftoverNotes(fields, Boolean(organisationId)),
    })
    setScanOpen(false)
    setFormOpen(true)
  }

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Contacts</h1>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            iconLeft={<ImageUp size={15} />}
            onClick={() => setScanOpen(true)}
          >
            Upload contact
          </Button>
          <Button iconLeft={<Plus size={15} />} onClick={openAdd}>Add contact</Button>
        </div>
      </div>

      <div className="filterbar">
        <SearchInput
          value={filters.q}
          onChange={(v) => setFilter('q', v)}
          placeholder="Search name or email"
        />
        <Select label="Seniority" value={filters.seniority} onChange={(e) => setFilter('seniority', e.currentTarget.value)}>
          <option value="">All</option>
          {SENIORITIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label="Type" value={filters.individual} onChange={(e) => setFilter('individual', e.currentTarget.value)}>
          <option value="">Everyone</option>
          <option value="yes">Individual donors</option>
        </Select>
      </div>

      {error ? (
        <div className="card">
          <EmptyState
            title="Could not load contacts"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={8} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No contacts found"
            body="Contacts are the people behind each donor organisation. Adjust the filters or add one."
            action={<Button iconLeft={<Plus size={15} />} onClick={openAdd}>Add contact</Button>}
          />
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: '220px' }}>Organisation</th>
                  <th>Designation</th>
                  <th style={{ width: '160px' }}>Seniority</th>
                  <th style={{ width: '220px' }}>Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="is-clickable"
                    onClick={() => { setEditing(c); setFormOpen(true) }}
                  >
                    <td>
                      {c.full_name}
                      {c.is_primary ? <> <Badge tone="brown">Primary</Badge></> : null}
                      {c.is_individual_donor ? <> <Badge tone="outline">Individual</Badge></> : null}
                    </td>
                    <td>
                      {c.fr_organisations ? (
                        <Link
                          to="/organisations/$id"
                          params={{ id: c.fr_organisations.id }}
                          className="celllink"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.fr_organisations.name}
                        </Link>
                      ) : <span className="faint">—</span>}
                    </td>
                    <td className="muted">{c.designation ?? '—'}</td>
                    <td>{labelOf(SENIORITIES, c.seniority)}</td>
                    <td className="muted">{c.email ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPage={(p) => setFilter('page', String(p))}
          />
        </>
      )}

      <ContactScanDrawer
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onEnterManually={() => { setScanOpen(false); openAdd() }}
        onExtracted={(fields, path) => void openFromCard(fields, path)}
      />

      <ContactForm
        open={formOpen}
        contact={editing}
        prefill={prefill}
        cardImagePath={cardPath}
        onClose={closeForm}
        onSaved={() => void load()}
        onDeleted={() => void load()}
      />
    </div>
  )
}

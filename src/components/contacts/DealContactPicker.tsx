import { useEffect, useId, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { Button, Input } from '../ui'

export type NewContact = { full_name: string; phone: string; email: string }

/**
 * The deal's primary contact: a search over the chosen company's contacts,
 * or a new person (name, with optional phone and email), created when the
 * deal is saved.
 */
export function DealContactPicker({
  contacts, value, onChange, newContact, onNewContact, companyChosen,
}: {
  /** The chosen company's contacts; empty for a new company. */
  contacts: Array<{ id: string; full_name: string }>
  value: string
  onChange: (contactId: string) => void
  newContact: NewContact | null
  onNewContact: (c: NewContact | null) => void
  /** False until a company (existing or new) is chosen. */
  companyChosen: boolean
}) {
  const fieldId = useId()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const typed = term.trim()
  const matches = contacts
    .filter((c) => !typed || c.full_name.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 20)
  const exact = contacts.some((c) => c.full_name.trim().toLowerCase() === typed.toLowerCase())
  const selected = contacts.find((c) => c.id === value) ?? null

  function pick(id: string) {
    onNewContact(null)
    onChange(id)
    setOpen(false)
    setTerm('')
  }

  function pickNew() {
    onChange('')
    onNewContact({ full_name: typed, phone: '', email: '' })
    setOpen(false)
    setTerm('')
  }

  function clear() {
    onChange('')
    onNewContact(null)
    setTerm('')
  }

  const shown = selected?.full_name ?? newContact?.full_name ?? null

  return (
    <div className="stack" style={{ gap: 'var(--space-3)' }}>
      <div className="field" ref={boxRef} style={{ position: 'relative' }}>
        <label className="field__label" htmlFor={fieldId}>Primary contact</label>

        {shown && !open ? (
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="grow" style={{ fontSize: 'var(--text-sm)' }}>
              {shown}
              {!selected && newContact ? <span className="faint"> · new contact</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Change</Button>
            <Button size="sm" variant="ghost" aria-label="Clear" onClick={clear}><X size={14} /></Button>
          </div>
        ) : (
          <>
            <div className="searchbox">
              <Search size={15} aria-hidden="true" />
              <input
                id={fieldId}
                className="searchbox__input"
                value={term}
                disabled={!companyChosen}
                placeholder={companyChosen ? 'Search or add a contact' : 'Choose a company first'}
                onFocus={() => setOpen(true)}
                onChange={(e) => { setTerm(e.currentTarget.value); setOpen(true) }}
              />
            </div>

            {open && companyChosen && (matches.length > 0 || typed.length >= 2) ? (
              <div className="picker__menu">
                {matches.map((c) => (
                  <button key={c.id} type="button" className="picker__item" onClick={() => pick(c.id)}>
                    {c.full_name}
                  </button>
                ))}
                {typed.length >= 2 && !exact ? (
                  <button type="button" className="picker__item picker__new" onClick={pickNew}>
                    <Plus size={13} aria-hidden="true" /> Add new contact “{typed}”
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {newContact && !open ? (
        <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          <div className="grow">
            <Input
              label="Phone"
              value={newContact.phone}
              onChange={(e) => onNewContact({ ...newContact, phone: e.currentTarget.value })}
            />
          </div>
          <div className="grow">
            <Input
              label="Email"
              type="email"
              value={newContact.email}
              onChange={(e) => onNewContact({ ...newContact, email: e.currentTarget.value })}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

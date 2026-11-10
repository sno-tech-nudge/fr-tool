import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import type { PlanContact } from './useAccountData'

/**
 * Type to find one of the organisation's contacts; the last option always
 * adds someone new under the typed name.
 */

const MAX_SHOWN = 8

export function ContactSearch({
  label, contacts, onPick, onCreate,
}: {
  label: string
  /** Contacts that can still be picked, best candidates first. */
  contacts: PlanContact[]
  onPick: (c: PlanContact) => void
  onCreate: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // The list floats above the page, so a scrolling card cannot clip it; it
  // follows the input and closes once the input scrolls away.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return }
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const q = query.trim().toLowerCase()
  const matches = contacts
    .filter((c) => !q || c.full_name.toLowerCase().includes(q) || (c.designation ?? '').toLowerCase().includes(q))
    .slice(0, MAX_SHOWN)
  // One list: the matches, then "add new" at the end.
  const count = matches.length + 1

  function choose(i: number) {
    if (i < matches.length) onPick(matches[i])
    else onCreate(query.trim())
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  return (
    <div className="contactsearch">
      <input
        ref={inputRef}
        className="kv__input"
        placeholder={contacts.length ? 'Search or add' : 'Add contact'}
        aria-label={`Add to ${label.toLowerCase()}`}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQuery(e.currentTarget.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % count) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + count) % count) }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(active) }
          else if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
        }}
      />
      {open && pos ? createPortal(
        <ul className="mentionlist contactsearch__list" role="listbox" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className="mentionlist__item"
                data-active={i === active}
                // mousedown, so the pick lands before the input's blur closes the list.
                onMouseDown={(e) => { e.preventDefault(); choose(i) }}
              >
                {c.full_name}
                {c.designation ? <span className="faint"> · {c.designation}</span> : null}
              </button>
            </li>
          ))}
          <li role="option" aria-selected={active === matches.length}>
            <button
              type="button"
              className="mentionlist__item contactsearch__new"
              data-active={active === matches.length}
              onMouseDown={(e) => { e.preventDefault(); choose(matches.length) }}
            >
              <Plus size={13} aria-hidden="true" />
              {query.trim() ? <>Add “{query.trim()}” as a new contact</> : 'Add a new contact'}
            </button>
          </li>
        </ul>,
        document.body,
      ) : null}
    </div>
  )
}

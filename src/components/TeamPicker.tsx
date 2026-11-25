import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TeamPerson } from '../hooks/useFrTeam'


/**
 * Type to find a fundraising team member. Shows the chosen person's name;
 * clearing the box and leaving it clears the choice.
 */
export function TeamPicker({
  people, value, onChange, label, placeholder = 'Search the team', disabled,
}: {
  people: TeamPerson[]
  value: string | null
  onChange: (id: string | null) => void
  label: string
  placeholder?: string
  disabled?: boolean
}) {
  const chosen = people.find((p) => p.id === value) ?? null
  const [query, setQuery] = useState<string | null>(null) // null = not typing
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return }
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const q = (query ?? '').trim().toLowerCase()
  const matches = people
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))

  function choose(p: TeamPerson) {
    onChange(p.id)
    setQuery(null)
    setOpen(false)
    setActive(0)
  }

  function leave() {
    // An emptied box clears the choice; anything else typed is dropped.
    if (query !== null && query.trim() === '' && value) onChange(null)
    setQuery(null)
    setOpen(false)
  }

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        style={{ minWidth: 0 }}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={disabled}
        value={query ?? chosen?.name ?? ''}
        onFocus={(e) => { setOpen(true); e.currentTarget.select() }}
        onBlur={leave}
        onChange={(e) => { setQuery(e.currentTarget.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]) }
          else if (e.key === 'Escape') { setQuery(null); setOpen(false); e.currentTarget.blur() }
        }}
      />
      {open && pos ? createPortal(
        <ul className="mentionlist contactsearch__list" role="listbox" style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: 320, overflowY: 'auto' }}>
          {matches.length === 0 ? (
            <li className="mentionlist__item faint">No one on the team matches</li>
          ) : matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className="mentionlist__item"
                data-active={i === active}
                // mousedown, so the pick lands before the input's blur.
                onMouseDown={(e) => { e.preventDefault(); choose(p) }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      ) : null}
    </>
  )
}

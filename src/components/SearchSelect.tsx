import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

export type SearchOption = { value: string; label: string }

/**
 * A select you can type into: shows the chosen option, filters as you type,
 * and goes back to the chosen option if you leave without picking.
 */
export function SearchSelect({
  label, value, options, onChange, width, placeholder,
}: {
  label: string
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
  width?: number
  placeholder?: string
}) {
  const id = useId()
  const chosen = options.find((o) => o.value === value) ?? null
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
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const q = (query ?? '').trim().toLowerCase()
  const matches = options.filter((o) => !q || o.label.toLowerCase().includes(q))

  function choose(o: SearchOption) {
    onChange(o.value)
    setQuery(null)
    setOpen(false)
  }

  return (
    <div className="field" style={width ? { width } : undefined}>
      <label className="field__label" htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          ref={inputRef}
          className="input"
          style={{ width: '100%', paddingRight: 30 }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={query ?? chosen?.label ?? ''}
          onFocus={(e) => {
            setOpen(true)
            setActive(Math.max(0, options.findIndex((o) => o.value === value)))
            e.currentTarget.select()
          }}
          onBlur={() => { setQuery(null); setOpen(false) }}
          onChange={(e) => { setQuery(e.currentTarget.value); setOpen(true); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]); e.currentTarget.blur() }
            else if (e.key === 'Escape') { setQuery(null); setOpen(false); e.currentTarget.blur() }
          }}
        />
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}
        />
      </div>
      {open && pos ? createPortal(
        <ul className="mentionlist contactsearch__list" role="listbox" style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: 320, overflowY: 'auto' }}>
          {matches.length === 0 ? (
            <li className="mentionlist__item faint">No match</li>
          ) : matches.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                className="mentionlist__item"
                data-active={i === active}
                // mousedown, so the pick lands before the input's blur.
                onMouseDown={(e) => { e.preventDefault(); choose(o); inputRef.current?.blur() }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      ) : null}
    </div>
  )
}

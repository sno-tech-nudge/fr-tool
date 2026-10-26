import { useRef, useState } from 'react'
import type { FrPerson } from '../lib/mentions'

/**
 * Typing "@" in a notes box opens a list of the fundraising team, narrowed as
 * you type; picking someone writes "@Their Name". Wire the returned handlers
 * onto the textarea and render `popup` next to it (inside a positioned box).
 */
export function useMentionPicker({
  value, onChange, people,
}: {
  value: string
  onChange: (next: string) => void
  people: FrPerson[]
}) {
  const el = useRef<HTMLTextAreaElement | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const matches = query === null
    ? []
    : people
      .filter((p) => {
        const q = query.toLowerCase()
        return !q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q)
      })
      .slice(0, 6)

  /** Re-reads the word under the caret: "@pri" means the picker is open for "pri". */
  function sync(target: HTMLTextAreaElement) {
    el.current = target
    const upto = target.value.slice(0, target.selectionStart ?? target.value.length)
    const m = /(^|[\s(])@([^\s@]{0,30})$/.exec(upto)
    if (m) { setQuery(m[2]); setActive(0) } else setQuery(null)
  }

  function pick(person: FrPerson) {
    const target = el.current
    if (!target) return
    const caret = target.selectionStart ?? value.length
    const before = value.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${person.name} `)
    const next = before + value.slice(caret)
    onChange(next)
    setQuery(null)
    // Put the caret after the inserted name once React has re-rendered.
    setTimeout(() => {
      target.focus()
      target.setSelectionRange(before.length, before.length)
    }, 0)
  }

  const open = query !== null && matches.length > 0

  return {
    open,
    handlers: {
      onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) && open) return
        sync(e.currentTarget)
      },
      onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => sync(e.currentTarget),
      onInput: (e: React.FormEvent<HTMLTextAreaElement>) => sync(e.currentTarget),
      onBlur: () => setTimeout(() => setQuery(null), 150),
      onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!open) return
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length) }
        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]) }
        else if (e.key === 'Escape') { e.preventDefault(); setQuery(null) }
      },
    },
    popup: open ? (
      <ul className="mentionlist" role="listbox" aria-label="Tag someone">
        {matches.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              className="mentionlist__item"
              data-active={i === active}
              // mousedown, not click: the textarea's blur would close the list first.
              onMouseDown={(e) => { e.preventDefault(); pick(p) }}
            >
              @{p.name}
            </button>
          </li>
        ))}
      </ul>
    ) : null,
  }
}

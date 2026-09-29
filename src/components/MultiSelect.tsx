import { useEffect, useRef, useState } from 'react'
import { Checkbox } from './ui'

/**
 * A select that takes several values — a button styled like the app's selects
 * that opens a list of tick boxes. Closes on an outside click or Escape.
 *
 * `value` keeps the options' own order, whatever order they were ticked in,
 * so the same selection always produces the same URL.
 */
export function MultiSelect({
  label, options, value, onChange, allLabel = 'All', width,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  value: string[]
  onChange: (next: string[]) => void
  allLabel?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(v: string, on: boolean) {
    const picked = on ? [...value, v] : value.filter((x) => x !== v)
    onChange(options.filter((o) => picked.includes(o.value)).map((o) => o.value))
  }

  const summary = value.length === 0
    ? allLabel
    : value.length === 1
      ? options.find((o) => o.value === value[0])?.label ?? value[0]
      : `${value.length} selected`

  return (
    <div className="field multiselect" ref={ref}>
      <span className="field__label">{label}</span>
      <button
        type="button"
        className="select multiselect__button"
        style={width ? { width } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
      </button>
      {open ? (
        <div className="multiselect__panel" role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={value.includes(o.value)}
              onChange={(on) => toggle(o.value, on)}
            />
          ))}
          {value.length > 0 ? (
            <button type="button" className="multiselect__clear" onClick={() => onChange([])}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

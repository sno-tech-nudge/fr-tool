import { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui'

type Hit = { id: string; name: string; donor_type: string | null }

/**
 * Typeahead organisation selector.
 *
 * A plain <select> is not an option here — there can be hundreds of
 * organisations and PostgREST caps reads at 1,000 rows, so this queries on
 * demand and caps each search at 20 hits.
 */
export function OrganisationPicker({
  value, onChange, label = 'Organisation', help, required = false,
}: {
  value: string
  onChange: (organisationId: string) => void
  label?: string
  help?: string
  required?: boolean
}) {
  const fieldId = useId()
  const [selected, setSelected] = useState<Hit | null>(null)
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Resolve an incoming id to a name (e.g. when editing an existing record).
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected?.id === value) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('fr_organisations')
        .select('id, name, donor_type')
        .eq('id', value)
        .maybeSingle()
      if (active && data) setSelected(data as Hit)
    })()
    return () => { active = false }
  }, [value, selected?.id])

  // Debounced search.
  useEffect(() => {
    if (!open || term.trim().length < 2) { setHits([]); return }
    let active = true
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('fr_organisations')
        .select('id, name, donor_type')
        .ilike('name', `%${term.trim()}%`)
        .is('deleted_at', null)
        .order('name')
        .limit(20)
      if (active) setHits((data ?? []) as Hit[])
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [term, open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(hit: Hit) {
    setSelected(hit)
    onChange(hit.id)
    setOpen(false)
    setTerm('')
  }

  function clear() {
    setSelected(null)
    onChange('')
    setTerm('')
  }

  return (
    <div className="field" ref={boxRef} style={{ position: 'relative' }}>
      <label className="field__label" htmlFor={fieldId}>
        {label}{required ? <span className="field__req"> *</span> : null}
      </label>

      {selected && !open ? (
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="grow" style={{ fontSize: 'var(--text-sm)' }}>{selected.name}</span>
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
              placeholder="Search organisations"
              onFocus={() => setOpen(true)}
              onChange={(e) => { setTerm(e.currentTarget.value); setOpen(true) }}
            />
          </div>

          {open && term.trim().length >= 2 ? (
            <div className="picker__menu">
              {hits.length === 0 ? (
                <p className="picker__empty">No matches</p>
              ) : (
                hits.map((h) => (
                  <button key={h.id} type="button" className="picker__item" onClick={() => pick(h)}>
                    {h.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </>
      )}

      {help ? <span className="field__help">{help}</span> : null}
    </div>
  )
}

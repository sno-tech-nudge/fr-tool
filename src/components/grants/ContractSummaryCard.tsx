import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, Textarea, useToast } from '../ui'
import { useAccess } from '../../lib/accessContext'
import type { Grant } from './GrantForm'

/**
 * The terms worth remembering from the contract, in the team's own words.
 *
 * Starts as the digest read off the document at creation, but it is plain
 * editable text — the place for "UC due within 15 days of each quarter end",
 * which no date field can hold.
 */
export function ContractSummaryCard({
  grant, onSaved,
}: {
  grant: Grant
  onSaved: (grant: Grant) => void
}) {
  const toast = useToast()
  const access = useAccess()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  function startEdit() {
    setDraft(grant.contract_summary ?? '')
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    const { data, error } = await supabase
      .from('fr_grants')
      .update({ contract_summary: draft.trim() || null, updated_by: access.employeeId })
      .eq('id', grant.id)
      .select()
      .single()
    setBusy(false)
    if (error) { toast.error(error.message); return }
    onSaved(data as Grant)
    setEditing(false)
    toast.success('Summary saved.')
  }

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tn-micro">Contract summary</span>
        {editing ? null : (
          <Button size="sm" variant="ghost" iconLeft={<Pencil size={14} />} onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <>
          <Textarea
            aria-label="Contract summary"
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </>
      ) : grant.contract_summary ? (
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)' }}>
          {grant.contract_summary}
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
          No summary yet. Reading the contract when the grant is created fills this in, or add
          the key terms by hand.
        </p>
      )}
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, FileText, FolderOpen, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, EmptyState, TableSkeleton, useToast } from '../ui'
import { AddDocumentDialog } from './AddDocumentDialog'
import { documentUrl, readableSize } from '../../lib/documents'
import { formatDate } from '../../lib/format'

/**
 * Files on a deal — or, for an organisation, on all its deals. Each row says
 * where on the deal the file sits (a tranche, a report, or the deal itself).
 */

type Doc = {
  id: string
  opportunity_id: string
  doc_type: string
  name: string
  file_path: string
  size_bytes: number | null
  found_in: string | null
  added_on: string | null
  added_by_name: string | null
  created_at: string
  fr_opportunities: { name: string } | null
  fr_tranches: { sequence_no: number | null } | null
  fr_compliance_report_periods: { period_label: string | null } | null
}

const SELECT = `id, opportunity_id, doc_type, name, file_path, size_bytes, found_in, added_on, added_by_name, created_at,
  fr_opportunities(name), fr_tranches(sequence_no), fr_compliance_report_periods(period_label)`

function placeOf(d: Doc): string {
  if (d.fr_tranches) return `Tranche ${d.fr_tranches.sequence_no ?? ''}`.trim()
  if (d.fr_compliance_report_periods) return d.fr_compliance_report_periods.period_label ?? 'Report'
  return 'Deal'
}

export function DocumentsTab({
  opportunityId, organisationId, folderUrl, zohoUrl,
}: {
  opportunityId?: string
  organisationId?: string
  /** The deal's own Drive folder and Zoho record, shown above its list. */
  folderUrl?: string | null
  zohoUrl?: string | null
}) {
  const toast = useToast()
  const [rows, setRows] = useState<Doc[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState('')
  const [adding, setAdding] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setRows(null)
    setError(null)
    let q = supabase.from('fr_documents').select(SELECT).is('deleted_at', null)
    q = opportunityId ? q.eq('opportunity_id', opportunityId) : q.eq('organisation_id', organisationId ?? '')
    void q
      .order('added_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) { setError(err.message); setRows([]); return }
        setRows((data ?? []) as unknown as Doc[])
      })
    return () => { active = false }
  }, [opportunityId, organisationId, reload])

  const types = useMemo(() => [...new Set((rows ?? []).map((d) => d.doc_type))].sort(), [rows])
  const shown = (rows ?? []).filter((d) => !type || d.doc_type === type)
  const showDeal = !opportunityId

  async function open(d: Doc) {
    // Opened before the await, or the browser treats it as a pop-up.
    const tab = window.open('', '_blank')
    try {
      const url = await documentUrl(d.file_path)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (e) {
      tab?.close()
      toast.error(e instanceof Error ? e.message : 'Could not open that file.')
    }
  }

  const links = folderUrl || zohoUrl || opportunityId ? (
    <div className="row" style={{ gap: 'var(--space-2)' }}>
      {opportunityId ? (
        <Button size="sm" iconLeft={<Plus size={14} />} onClick={() => setAdding(true)}>Add document</Button>
      ) : null}
      {folderUrl ? (
        <a className="btn btn--secondary btn--sm" href={folderUrl} target="_blank" rel="noreferrer noopener">
          <FolderOpen size={14} /> Drive folder
        </a>
      ) : null}
      {zohoUrl ? (
        <a className="btn btn--secondary btn--sm" href={zohoUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={14} /> Open in Zoho
        </a>
      ) : null}
    </div>
  ) : null

  return (
    <div className="stack">
      {opportunityId ? (
        <AddDocumentDialog
          open={adding}
          opportunityId={opportunityId}
          onClose={() => setAdding(false)}
          onAdded={() => setReload((n) => n + 1)}
        />
      ) : null}
      {links || types.length > 1 ? (
        <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {types.length > 1 ? (
            <div className="pillrow" role="group" aria-label="Document type">
              <button type="button" className="pill" data-active={!type || undefined} onClick={() => setType('')}>All</button>
              {types.map((t) => (
                <button key={t} type="button" className="pill" data-active={type === t || undefined} onClick={() => setType(t)}>{t}</button>
              ))}
            </div>
          ) : <span />}
          {links}
        </div>
      ) : null}

      {error ? (
        <div className="card"><EmptyState title="Could not load documents" body={error} /></div>
      ) : rows === null ? (
        <TableSkeleton rows={4} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="No documents yet" /></div>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th style={{ width: '170px' }}>Type</th>
                {showDeal ? <th>Deal</th> : null}
                <th style={{ width: '120px' }}>On</th>
                <th style={{ width: '120px' }}>Added</th>
                <th style={{ width: '150px' }}>By</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td>
                    <button type="button" className="doclink" onClick={() => void open(d)}>
                      <FileText size={14} aria-hidden="true" />
                      <span>{d.name}</span>
                    </button>
                    {d.size_bytes ? <span className="faint tn-num doclink__size">{readableSize(d.size_bytes)}</span> : null}
                  </td>
                  <td>{d.doc_type}</td>
                  {showDeal ? (
                    <td>
                      <Link to="/opportunities/$id" params={{ id: d.opportunity_id }} search={{ tab: 'documents' } as never} className="celllink">
                        {d.fr_opportunities?.name ?? '—'}
                      </Link>
                    </td>
                  ) : null}
                  <td title={d.found_in ?? undefined}>{placeOf(d)}</td>
                  <td className="tn-num" style={{ whiteSpace: 'nowrap' }}>{d.added_on ? formatDate(d.added_on) : '—'}</td>
                  <td className="muted">{d.added_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

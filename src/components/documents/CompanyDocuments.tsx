import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { EmptyState, TableSkeleton, useToast } from '../ui'
import { documentUrl, readableSize } from '../../lib/documents'
import { formatDate } from '../../lib/format'

/**
 * A company's documents, grouped under its deals. Every deal is listed; the
 * arrow opens its files, the name opens the deal. Files are the deals' own,
 * read in place.
 */

type Deal = { id: string; name: string }
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
  fr_tranches: { sequence_no: number | null } | null
  fr_compliance_report_periods: { period_label: string | null } | null
}

const SELECT = `id, opportunity_id, doc_type, name, file_path, size_bytes, found_in, added_on, added_by_name,
  fr_tranches(sequence_no), fr_compliance_report_periods(period_label)`

function placeOf(d: Doc): string {
  if (d.fr_tranches) return `Tranche ${d.fr_tranches.sequence_no ?? ''}`.trim()
  if (d.fr_compliance_report_periods) return d.fr_compliance_report_periods.period_label ?? 'Report'
  return 'Deal'
}

export function CompanyDocuments({ organisationId }: { organisationId: string }) {
  const toast = useToast()
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    setDeals(null)
    setError(null)
    ;(async () => {
      const { data: d, error: dErr } = await supabase
        .from('fr_opportunities')
        .select('id, name')
        .eq('organisation_id', organisationId)
        .is('deleted_at', null)
        .order('name')
      if (!active) return
      if (dErr) { setError(dErr.message); setDeals([]); return }
      const list = (d ?? []) as Deal[]
      let files: Doc[] = []
      if (list.length) {
        const { data: f, error: fErr } = await supabase
          .from('fr_documents')
          .select(SELECT)
          .in('opportunity_id', list.map((x) => x.id))
          .is('deleted_at', null)
          .order('added_on', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
        if (!active) return
        if (fErr) { setError(fErr.message); setDeals([]); return }
        files = (f ?? []) as unknown as Doc[]
      }
      setDocs(files)
      setDeals(list)
    })()
    return () => { active = false }
  }, [organisationId])

  const byDeal = useMemo(() => {
    const m = new Map<string, Doc[]>()
    for (const d of docs) {
      m.set(d.opportunity_id, [...(m.get(d.opportunity_id) ?? []), d])
    }
    return m
  }, [docs])
  // Deals with files first, each group in name order.
  const ordered = useMemo(
    () => [...(deals ?? [])].sort((a, b) => Number(byDeal.has(b.id)) - Number(byDeal.has(a.id))),
    [deals, byDeal],
  )

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  if (error) return <div className="card"><EmptyState title="Could not load documents" body={error} /></div>
  if (deals === null) return <TableSkeleton rows={4} cols={5} />
  if (deals.length === 0) return <div className="card"><EmptyState title="No deals yet" /></div>

  return (
    <div className="tablewrap">
        <table className="table table--docs">
          <thead>
            <tr>
              <th>Deal / document</th>
              <th style={{ width: '170px' }}>Type</th>
              <th style={{ width: '120px' }}>On</th>
              <th style={{ width: '120px' }}>Added</th>
              <th style={{ width: '150px' }}>By</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((deal) => {
              const files = byDeal.get(deal.id) ?? []
              const isOpen = openIds.has(deal.id)
              return (
                <Fragment key={deal.id}>
                  <tr>
                    <td colSpan={5}>
                      <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => toggle(deal.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `Hide ${deal.name} documents` : `Show ${deal.name} documents`}
                          disabled={files.length === 0}
                          style={{
                            border: 0, background: 'none', padding: 2, display: 'inline-flex',
                            cursor: files.length ? 'pointer' : 'default', color: 'var(--text)',
                            opacity: files.length ? 1 : 0.3,
                          }}
                        >
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <Link to="/opportunities/$id" params={{ id: deal.id }} search={{ tab: 'documents' } as never} className="celllink">
                          {deal.name}
                        </Link>
                        <span className="faint tn-num">{files.length}</span>
                      </div>
                    </td>
                  </tr>
                  {isOpen ? files.map((d) => (
                    <tr key={d.id} className="docrow">
                      <td>
                        <button type="button" className="doclink" onClick={() => void open(d)}>
                          <FileText size={14} aria-hidden="true" />
                          <span>{d.name}</span>
                        </button>
                        {d.size_bytes ? <span className="faint tn-num doclink__size">{readableSize(d.size_bytes)}</span> : null}
                      </td>
                      <td>{d.doc_type}</td>
                      <td title={d.found_in ?? undefined}>{placeOf(d)}</td>
                      <td className="tn-num" style={{ whiteSpace: 'nowrap' }}>{d.added_on ? formatDate(d.added_on) : '—'}</td>
                      <td className="muted">{d.added_by_name ?? '—'}</td>
                    </tr>
                  )) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
    </div>
  )
}

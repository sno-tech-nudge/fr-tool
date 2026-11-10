import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, useToast } from '../ui'
import { BarsWithLine } from '../charts'
import { useAccess } from '../../lib/accessContext'
import type { FyRow } from './useAccountData'

const CRORE = 1e7
const toCr = (v: number | null) => (v == null ? '' : String(Math.round((v / CRORE) * 100) / 100))

/**
 * CSR wallet share — the donor's CSR budget each year against what reached
 * us. With no budget on record the chart is drawn faded behind the boxes
 * that ask for it.
 */
export function WalletShareCard({
  organisationId, years, onBudget,
}: {
  organisationId: string
  years: FyRow[]
  onBudget: (fy: string, budgetInr: number | null) => void
}) {
  const hasBudget = years.some((y) => y.budget != null)
  const [editing, setEditing] = useState(false)
  const asking = !hasBudget || editing

  return (
    <section className="card acctchart">
      <div className="acctchart__head">
        <div className="tn-micro">CSR wallet share</div>
        {hasBudget ? (
          <Button size="sm" variant="ghost" iconLeft={<Pencil size={13} />} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Budgets'}
          </Button>
        ) : null}
      </div>
      <div className="acctchart__body" data-ghost={!hasBudget || undefined}>
        <BarsWithLine
          data={years.map((y) => ({
            label: y.label,
            budget: hasBudget ? y.budget : Math.max(y.collected * 4, CRORE),
            collected: y.collected,
            share: hasBudget ? y.share : null,
          }))}
          series={[
            { key: 'budget', label: 'CSR budget', color: 'var(--chart-5)' },
            { key: 'collected', label: 'Collections', color: 'var(--chart-1)' },
          ]}
          line={{ key: 'share', label: 'Wallet share', color: 'var(--chart-3)' }}
        />
      </div>
      {asking ? <BudgetInputs organisationId={organisationId} years={years} onBudget={onBudget} overlay={!hasBudget} /> : null}
    </section>
  )
}

function BudgetInputs({
  organisationId, years, onBudget, overlay,
}: {
  organisationId: string
  years: FyRow[]
  onBudget: (fy: string, budgetInr: number | null) => void
  overlay: boolean
}) {
  const toast = useToast()
  const access = useAccess()
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(years.map((y) => [y.fy, toCr(y.budget)])),
  )

  async function save(fy: string) {
    const raw = values[fy]?.trim() ?? ''
    const cr = raw === '' ? null : Number(raw)
    if (cr != null && (!Number.isFinite(cr) || cr < 0)) { toast.error('Enter the budget in crore.'); return }
    const budget = cr == null ? null : Math.round(cr * CRORE)
    if (budget === (years.find((y) => y.fy === fy)?.budget ?? null)) return
    const { data, error } = await supabase
      .from('fr_org_csr_budgets')
      .upsert(
        { organisation_id: organisationId, fiscal_year: fy, budget_inr: budget, updated_by: access.employeeId },
        { onConflict: 'organisation_id,fiscal_year' },
      )
      .select()
      .single()
    if (error) { toast.error(error.message); return }
    const saved = (data as { budget_inr: number | null }).budget_inr
    onBudget(fy, saved == null ? null : Number(saved))
  }

  return (
    <div className={overlay ? 'acctchart__ask' : 'acctchart__budgets'}>
      {overlay ? <div className="acctchart__asktitle">Add the CSR budget</div> : null}
      <div className="acctchart__inputs">
        {years.map((y) => (
          <label key={y.fy} className="acctchart__input">
            <span className="tn-micro">{y.label}</span>
            <span className="acctchart__cr">
              <input
                className="input tn-num"
                inputMode="decimal"
                placeholder="₹ Cr"
                value={values[y.fy] ?? ''}
                onChange={(e) => { const v = e.currentTarget.value; setValues((p) => ({ ...p, [y.fy]: v })) }}
                onBlur={() => void save(y.fy)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              />
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

/** Instalments due each year against what came in, with collection to date. */
export function CollectionCard({ years }: { years: FyRow[] }) {
  const has = years.some((y) => y.due > 0 || y.received > 0)
  return (
    <section className="card acctchart">
      <div className="acctchart__head">
        <div className="tn-micro">Collection status</div>
      </div>
      <div className="acctchart__body" data-ghost={!has || undefined}>
        <BarsWithLine
          data={years.map((y, i) => ({
            label: y.label,
            due: has ? y.due : (i + 2) * CRORE,
            received: has ? y.received : (i + 1) * CRORE,
            cumulative: has ? y.cumulativePct : null,
          }))}
          series={[
            { key: 'due', label: 'Due', color: 'var(--chart-5)' },
            { key: 'received', label: 'Collected', color: 'var(--chart-1)' },
          ]}
          line={{ key: 'cumulative', label: 'Cumulative collection', color: 'var(--chart-3)' }}
        />
      </div>
      {has ? null : (
        <div className="acctchart__ask">
          <div className="acctchart__asktitle">No instalments scheduled</div>
        </div>
      )}
    </section>
  )
}

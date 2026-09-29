import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { EmptyState, Skeleton } from '../ui'
import { formatMoney } from '../../lib/format'

/**
 * The Proof System's chart ramp: brown tints only, darkest first. Charts are
 * never a rainbow — the one sanctioned exception is RAG status, which has its
 * own tokens and is applied per-cell rather than through this ramp.
 */
export const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)',
]

export const RAG_COLORS: Record<string, string> = {
  green: 'var(--rag-green)',
  amber: 'var(--rag-amber)',
  red: 'var(--rag-red)',
}

export type Datum = {
  label: string
  value: number
  /** Overrides the ramp — only for RAG status, never for decoration. */
  color?: string
}

const AXIS = {
  stroke: 'var(--border)',
  tick: { fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-sans)' },
  tickLine: false,
}

/** Money on an axis has to stay short, so crore/lakh with no decimals. */
function axisMoney(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e7) return `${Math.round(v / 1e7)}Cr`
  if (abs >= 1e5) return `${Math.round(v / 1e5)}L`
  if (abs === 0) return '0'
  return String(Math.round(v))
}

function ChartTooltip({ active, payload, label, valueLabel }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
  valueLabel: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="charttip">
      <div className="charttip__label">{label}</div>
      <div className="charttip__value tn-num">
        {formatMoney(payload[0].value)} <span className="faint">{valueLabel}</span>
      </div>
    </div>
  )
}

/** Same for counts — the tooltip shouldn't render "₹12" for 12 deals. */
function CountTooltip({ active, payload, label, valueLabel }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
  valueLabel: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="charttip">
      <div className="charttip__label">{label}</div>
      <div className="charttip__value tn-num">
        {payload[0].value} <span className="faint">{valueLabel}</span>
      </div>
    </div>
  )
}

export function ChartCard({
  title, subtitle, loading, data, height = 260, emptyBody, actions, children,
}: {
  title: string
  subtitle?: string
  loading?: boolean
  /** When empty (and not loading) the card shows its empty state instead. */
  data: unknown[] | null
  height?: number
  emptyBody?: string
  /** Right-aligned controls in the header row — a group-by toggle, a filter. */
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <div className="tn-micro">{title}</div>
          {subtitle ? <p className="chartsub">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {loading || data === null ? (
        <Skeleton height={height} />
      ) : data.length === 0 ? (
        <EmptyState title="Nothing to show yet" body={emptyBody} />
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  )
}

/**
 * Horizontal bars for categorical breakdowns — stage, capital category,
 * program, geography. Horizontal because these labels are words, and a
 * vertical chart would either truncate or rotate them.
 */
export function HBar({
  data, valueLabel = 'total', money = true,
}: {
  data: Datum[]
  valueLabel?: string
  money?: boolean
}) {
  const Tip = money ? ChartTooltip : CountTooltip
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          type="number"
          {...AXIS}
          axisLine={{ stroke: 'var(--border)' }}
          tickFormatter={money ? axisMoney : undefined}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={132}
          {...AXIS}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-sunken)' }}
          content={<Tip valueLabel={valueLabel} />}
        />
        <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Columns for anything ordered by time — the 12-month cash-in calendar. */
export function VBar({
  data, valueLabel = 'total',
}: {
  data: Datum[]
  valueLabel?: string
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: 'var(--border)' }} interval={0} />
        <YAxis {...AXIS} axisLine={false} tickFormatter={axisMoney} />
        <Tooltip
          cursor={{ fill: 'var(--surface-sunken)' }}
          content={<ChartTooltip valueLabel={valueLabel} />}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={34}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** A single headline figure. Same visual language as the record-360 cards. */
export function Kpi({
  label, value, note, loading, compact,
}: {
  label: string
  value: React.ReactNode
  note?: string
  loading?: boolean
  /** Smaller padding/type for a dashboard row with several KPIs across. */
  compact?: boolean
}) {
  return (
    <div className={compact ? 'kpi kpi--compact' : 'kpi'}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value tn-num">
        {loading ? <Skeleton height={compact ? 16 : 20} width={90} /> : value}
      </div>
      {note && !loading ? <div className="kpi__note tn-num">{note}</div> : null}
    </div>
  )
}

export type PairDatum = { label: string; committed: number; received: number }

function PairTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="charttip">
      <div className="charttip__label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="charttip__value tn-num" style={{ color: p.color }}>
          {formatMoney(p.value)} <span className="faint">{p.dataKey === 'committed' ? 'committed' : 'received'}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Committed vs received, paired per category. Brown for committed keeps the
 * ramp; green for received borrows the RAG "good" meaning — money actually in
 * hand — rather than adding a second decorative colour to the palette.
 */
export function GroupedHBar({ data }: { data: PairDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          type="number"
          {...AXIS}
          axisLine={{ stroke: 'var(--border)' }}
          tickFormatter={axisMoney}
          allowDecimals={false}
        />
        <YAxis type="category" dataKey="label" width={116} {...AXIS} axisLine={false} />
        <Tooltip cursor={{ fill: 'var(--surface-sunken)' }} content={<PairTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-sans)' }}
          formatter={(v: string) => (v === 'committed' ? 'Committed' : 'Received')}
        />
        <Bar dataKey="committed" fill="var(--chart-1)" radius={[0, 2, 2, 0]} maxBarSize={14} />
        <Bar dataKey="received" fill="var(--rag-green)" radius={[0, 2, 2, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}

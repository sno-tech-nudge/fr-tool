import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
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
  title, subtitle, loading, data, height = 260, emptyBody, actions, fill, children,
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
  /**
   * Let the chart take whatever height the card has (it stretches to its row),
   * with `height` as the minimum — so a card that sits beside a taller one
   * grows its chart instead of ending in empty space.
   */
  fill?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <div className="tn-micro">{title}</div>
          {subtitle ? <p className="chartsub">{subtitle}</p> : null}
        </div>
        {/* Never shrunk: a clipped toggle is worse than one that wraps under the title. */}
        {actions ? <div style={{ flex: '0 0 auto' }}>{actions}</div> : null}
      </div>
      {loading || data === null ? (
        <Skeleton height={height} />
      ) : data.length === 0 ? (
        <EmptyState title="Nothing to show yet" body={emptyBody} />
      ) : (
        <div style={fill ? { flex: '1 1 auto', minHeight: height, display: 'flex', flexDirection: 'column' } : { height }}>
          {children}
        </div>
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
  // The label column fits its longest label (up to 132px) instead of always
  // reserving 132px — a lone "India" would otherwise leave the bar floating
  // in the right half of the card.
  const labelWidth = Math.min(132, Math.max(44, Math.ceil(Math.max(0, ...data.map((d) => d.label.length)) * 6.4) + 12))
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
          width={labelWidth}
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
  label, value, note, loading, compact, alert,
}: {
  label: string
  value: React.ReactNode
  note?: string
  loading?: boolean
  /** Smaller padding/type for a dashboard row with several KPIs across. */
  compact?: boolean
  /** A red outline for money that has gone wrong (overdue), never decoration. */
  alert?: boolean
}) {
  const cls = ['kpi', compact ? 'kpi--compact' : '', alert ? 'kpi--alert' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
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

/**
 * Share of a whole, as a ring. Callers pass each slice's colour so a category
 * keeps its colour whatever its rank. The legend beside it carries the label,
 * amount and share, so the slices never rely on colour alone.
 */
export function Donut({
  data, centerLabel, money = true,
}: {
  data: Datum[]
  centerLabel: string
  money?: boolean
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const fmt = (v: number) => (money ? formatMoney(v) : String(v))
  return (
    <div className="donut">
      <div className="donut__ring">
        <div className="donut__plot">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<SliceTooltip money={money} total={total} />} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="92%"
                startAngle={90}
                endAngle={-270}
                stroke="var(--surface-card)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {data.map((d, i) => (
                  <Cell key={d.label} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="donut__center" aria-hidden="true">
          <span className="donut__total tn-num">{fmt(total)}</span>
          <span className="donut__caption">{centerLabel}</span>
        </div>
      </div>
      <ul className="donut__legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <span className="donut__swatch" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="donut__name">{d.label}</span>
            <span className="donut__value tn-num">{fmt(d.value)}</span>
            <span className="donut__share tn-num">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SliceTooltip({ active, payload, money, total }: {
  active?: boolean
  payload?: Array<{ name: string; value: number }>
  money: boolean
  total: number
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="charttip">
      <div className="charttip__label">{p.name}</div>
      <div className="charttip__value tn-num">
        {money ? formatMoney(p.value) : p.value}{' '}
        <span className="faint">{total > 0 ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
      </div>
    </div>
  )
}

export type Series = { key: string; label: string; color: string }

function SeriesTooltip({ active, payload, label, series }: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string }>
  label?: string
  series: Series[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="charttip">
      <div className="charttip__label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="charttip__value tn-num">
          {formatMoney(p.value)} <span className="faint">{series.find((s) => s.key === p.dataKey)?.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Side-by-side columns per period — e.g. open vs won by fiscal year. */
export function GroupedVBar({
  data, series,
}: {
  data: Array<Record<string, string | number>>
  series: Series[]
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: 'var(--border)' }} interval={0} />
        <YAxis {...AXIS} axisLine={false} tickFormatter={axisMoney} />
        <Tooltip cursor={{ fill: 'var(--surface-sunken)' }} content={<SeriesTooltip series={series} />} />
        <Legend
          wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-sans)' }}
          formatter={(v: string) => series.find((s) => s.key === v)?.label ?? v}
        />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[2, 2, 0, 0]} maxBarSize={22} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

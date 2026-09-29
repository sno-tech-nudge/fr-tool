import { toISODate } from './format'
import { fiscalYear } from './fy'

/**
 * The money-splitting and reporting-template maths shared by every place a
 * grant gets created — the Won-wizard and the standalone Add grant form.
 *
 * Kept in one file rather than duplicated: a grant's tranche schedule is real
 * money, and this codebase has already shipped one FX bug from the same
 * calculation living in two places and drifting apart.
 */

/** Round to paisa/cents — the one rounding rule every split below uses. */
export const round2 = (n: number) => Math.round(n * 100) / 100

export function addMonths(d: Date, n: number) {
  const out = new Date(d)
  out.setMonth(out.getMonth() + n)
  return out
}

/** An instalment as the UI edits it — amount stays a string until submit. */
export type ScheduleRow = { due_date: string; amount: string; condition_note: string }

export type EvenInstalment = { due_date: string; amount: number; amountInr: number }

/**
 * Splits a grant's value into `count` evenly spaced instalments across its
 * term, in both the grant's own currency and INR. The last instalment absorbs
 * rounding in EACH column independently, so a foreign-currency schedule sums
 * exactly in both currencies rather than one column drifting by a paisa.
 */
export function evenSchedule(
  count: number, valueNative: number, valueInr: number, start: string, end: string,
): EvenInstalment[] {
  const from = new Date(start).getTime()
  const to = new Date(end).getTime()
  const gap = count > 1 ? (to - from) / (count - 1) : 0
  const each = round2(valueNative / count)
  const eachInr = round2(valueInr / count)
  return Array.from({ length: count }, (_, i) => {
    const last = i === count - 1
    return {
      due_date: toISODate(new Date(from + gap * i)),
      amount: last ? round2(valueNative - each * (count - 1)) : each,
      amountInr: last ? round2(valueInr - eachInr * (count - 1)) : eachInr,
    }
  })
}

export type MilestoneDraft = {
  milestone_type_id: string | null
  title: string
  due_date: string
  include: boolean
}

export type MilestoneTemplate = {
  id: string
  capital_category: string
  milestone_type_id: string | null
  name: string
  recurrence: string
  offset_months: number
}

/** Expands one template into the dates it falls due across the grant term. */
export function expandTemplate(t: MilestoneTemplate, start: string, end: string): MilestoneDraft[] {
  const step = t.recurrence === 'quarterly' ? 3
    : t.recurrence === 'half_yearly' ? 6
      : t.recurrence === 'annually' ? 12
        : 0
  const endAt = new Date(end)
  const first = addMonths(new Date(start), t.offset_months ?? 0)
  if (step === 0) {
    return [{
      milestone_type_id: t.milestone_type_id,
      title: t.name,
      due_date: toISODate(first > endAt ? endAt : first),
      include: true,
    }]
  }
  const out: MilestoneDraft[] = []
  let cursor = first
  let guard = 0
  while (cursor <= endAt && guard++ < 40) {
    out.push({
      milestone_type_id: t.milestone_type_id,
      title: `${t.name} · ${fiscalYear(cursor) ?? ''}`.trim(),
      due_date: toISODate(cursor),
      include: true,
    })
    cursor = addMonths(cursor, step)
  }
  return out
}

/** A reporting row read off a contract — no template type, so it starts blank. */
export function milestonesFromContractRows(
  rows: Array<{ title: string | null; due_date: string | null }>,
): MilestoneDraft[] {
  return rows
    .filter((r) => r.title || r.due_date)
    .map((r) => ({
      milestone_type_id: null,
      title: r.title ?? '',
      due_date: r.due_date ?? '',
      include: true,
    }))
}

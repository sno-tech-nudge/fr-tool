/**
 * Excel export. A workbook is a list of sheets; each sheet is a header row
 * plus rows of plain values. Numbers stay numbers and dates stay dates, so the
 * team can sum, filter and pivot them — nothing is pre-formatted into text.
 *
 * The writer is loaded on first use, so it costs nothing until someone exports.
 */

export type CellValue = string | number | boolean | Date | null
export type ColumnKind = 'text' | 'int' | 'inr' | 'pct' | 'date'
/** A cell can override its column's kind — a Summary sheet mixes money and counts. */
export type Cell = CellValue | { value: CellValue; kind: ColumnKind }

export type SheetSpec = {
  /** Up to 31 characters; Excel rejects some punctuation, which is stripped. */
  name: string
  columns: Array<{ header: string; kind?: ColumnKind; width?: number }>
  rows: Cell[][]
}

const FORMAT: Record<ColumnKind, string | undefined> = {
  text: undefined,
  int: '#,##0',
  inr: '#,##0',
  pct: '0.0"%"',
  date: 'dd mmm yyyy',
}

/**
 * "2026-10-14" → midnight UTC on that day. The writer turns a Date into a whole
 * Excel day number from its UTC value, so anything else (local midnight, east
 * of Greenwich) lands on the previous evening and shows the day before.
 */
export function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
}

const sheetName = (name: string) => name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet'

function toCell(cell: Cell, kind: ColumnKind) {
  const isWrapped = cell !== null && typeof cell === 'object' && !(cell instanceof Date)
  const value = isWrapped ? (cell as { value: CellValue }).value : (cell as CellValue)
  const k = isWrapped ? (cell as { kind: ColumnKind }).kind : kind
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return { value, type: Date, format: FORMAT.date }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, type: Number, format: FORMAT[k === 'text' ? 'int' : k] ?? '#,##0.##' } : null
  }
  return value
}

/** The sheets in the shape the Excel writer takes. Separate so it can be tested. */
export function toWriterSheets(sheets: SheetSpec[]) {
  const header = (text: string) => ({ value: text, fontWeight: 'bold' as const, backgroundColor: '#ddd0cc', textColor: '#693d30' })
  return sheets.map((s) => ({
    sheet: sheetName(s.name),
    stickyRowsCount: 1,
    columns: s.columns.map((c) => ({ width: c.width ?? Math.max(12, Math.min(48, c.header.length + 4)) })),
    data: [
      s.columns.map((c) => header(c.header)),
      ...s.rows.map((row) => row.map((cell, i) => toCell(cell, s.columns[i]?.kind ?? 'text'))),
    ],
  }))
}

export async function downloadWorkbook(fileName: string, sheets: SheetSpec[]): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const book = toWriterSheets(sheets)
  // The writer's own types are strict about cell shapes; the values above are
  // plain strings, numbers, dates and nulls, which it accepts.
  await (writeExcelFile as unknown as (sheets: unknown) => { toFile: (name: string) => Promise<void> })(book)
    .toFile(fileName)
}

/** A name safe to use as a file name, without spaces. */
export function fileSlug(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => !!p && p.trim() !== '')
    .map((p) => p.trim().replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .join('_')
}

/**
 * How a dashboard hands its page data to the Export button: the dashboard sets
 * `current` to a function returning its sheets, or null while still loading.
 */
export type ExportRef = { current: (() => SheetSpec[] | null) | null }

export const today = () => new Date().toISOString().slice(0, 10)

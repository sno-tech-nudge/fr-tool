import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react'
import { Search, X } from 'lucide-react'

/* ============================================================
   Button
   ============================================================ */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  iconLeft?: React.ReactNode
  iconRight?: React.ReactNode
}

export function Button({
  variant = 'primary', size = 'md', iconLeft, iconRight, className = '', children, ...rest
}: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, size === 'sm' ? 'btn--sm' : '', className]
    .filter(Boolean).join(' ')
  return (
    <button className={cls} type={rest.type ?? 'button'} {...rest}>
      {iconLeft}
      {children ? <span>{children}</span> : null}
      {iconRight}
    </button>
  )
}

/* ============================================================
   Badge
   ============================================================ */
export function Badge({
  tone = 'brown', dot = false, children,
}: {
  tone?: 'brown' | 'outline' | 'green' | 'amber' | 'red' | 'fcra' | 'domestic'
  dot?: boolean
  children: React.ReactNode
}) {
  return (
    <span className={`badge${tone === 'brown' ? '' : ` badge--${tone}`}`}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** green / amber / red health or RAG value -> a badge. */
export function RagBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="faint">—</span>
  const tone = value === 'green' ? 'green' : value === 'amber' ? 'amber' : value === 'red' ? 'red' : 'outline'
  return <Badge tone={tone} dot>{value.charAt(0).toUpperCase() + value.slice(1)}</Badge>
}

/* ============================================================
   Fields
   ============================================================ */
type FieldShellProps = {
  label?: string
  help?: string
  error?: string | null
  required?: boolean
  htmlFor?: string
  children: React.ReactNode
}

function FieldShell({ label, help, error, required, htmlFor, children }: FieldShellProps) {
  return (
    <div className="field">
      {label ? (
        <label className="field__label" htmlFor={htmlFor}>
          {label}{required ? <span className="field__req"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <span className="field__error">{error}</span> : help ? <span className="field__help">{help}</span> : null}
    </div>
  )
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string; help?: string; error?: string | null
}
export function Input({ label, help, error, required, id, className = '', ...rest }: InputProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <FieldShell label={label} help={help} error={error} required={required} htmlFor={fieldId}>
      <input
        id={fieldId}
        className={`input ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      />
    </FieldShell>
  )
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string; help?: string; error?: string | null
}
export function Select({ label, help, error, required, id, className = '', children, ...rest }: SelectProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <FieldShell label={label} help={help} error={error} required={required} htmlFor={fieldId}>
      <select
        id={fieldId}
        className={`select ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  )
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string; help?: string; error?: string | null
}
export function Textarea({ label, help, error, required, id, className = '', ...rest }: TextareaProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <FieldShell label={label} help={help} error={error} required={required} htmlFor={fieldId}>
      <textarea id={fieldId} className={`textarea ${className}`} required={required} {...rest} />
    </FieldShell>
  )
}

export function Checkbox({
  label, checked, onChange, disabled,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

/* ============================================================
   Skeleton / empty state
   ============================================================ */
export function Skeleton({ height = 14, width = '100%' }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} />
}

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="tablewrap">
      <table className="table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((__, c) => (
                <td key={c}><Skeleton width={c === 0 ? '55%' : '75%'} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EmptyState({
  title, body, action,
}: {
  title: string
  body?: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {body ? <p className="empty__body">{body}</p> : null}
      {action}
    </div>
  )
}

/* ============================================================
   ConfirmDialog — in-app only. Never window.confirm().
   ============================================================ */
export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', destructive = false, busy = false,
  onConfirm, onCancel,
}: {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="scrim" role="presentation" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="dialog__title">{title}</p>
        {body ? <p className="dialog__body">{body}</p> : null}
        <div className="dialog__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            autoFocus
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Toasts
   ============================================================ */
type Toast = { id: number; message: string; tone: 'info' | 'success' | 'error' }
type ToastApi = {
  toast: (message: string) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((message: string, tone: Toast['tone']) => {
    const id = ++seq.current
    setItems((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 5000)
  }, [])

  const api = useMemo<ToastApi>(() => ({
    toast: (m) => push(m, 'info'),
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'info' ? '' : ` toast--${t.tone}`}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

/* ============================================================
   Drawer — right-hand side panel for detail/edit without a route change
   ============================================================ */
export function Drawer({
  open, title, onClose, footer, children, width = 460,
}: {
  open: boolean
  title: string
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="scrim scrim--drawer" role="presentation" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer__head">
          <p className="drawer__title">{title}</p>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </Button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer ? <footer className="drawer__foot">{footer}</footer> : null}
      </aside>
    </div>
  )
}

/* ============================================================
   Search input + pagination
   ============================================================ */
export function SearchInput({
  value, onChange, placeholder = 'Search',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <div className="searchbox">
      <Search size={15} aria-hidden="true" />
      <input
        className="searchbox__input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  )
}

export function Pagination({
  page, pageSize, total, onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (next: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="pager">
      <span className="pager__count tn-num">{from}–{to} of {total}</span>
      <span className="row" style={{ gap: 'var(--space-2)' }}>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </span>
    </div>
  )
}

/** Label/value pairs for a record's Overview panel. */
export function DetailList({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="detaillist">
      {items.map((it) => (
        <div key={it.label} className="detaillist__row">
          <dt>{it.label}</dt>
          <dd>{it.value ?? <span className="faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

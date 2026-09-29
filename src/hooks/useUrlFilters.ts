import { useCallback, useMemo } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'

/**
 * Filter state lives in the URL query string so a filtered view is shareable
 * (a standing UX rule for this module). Empty values are dropped from the URL
 * rather than serialised as blanks.
 */
/**
 * TanStack types `navigate` against the concrete route tree, which a generic
 * filter hook cannot satisfy — every caller has a different search shape. The
 * loose signature is confined to this file rather than leaking casts into
 * every list route.
 */
type LooseNavigate = (opts: {
  to?: string
  search?: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)
  replace?: boolean
}) => void

export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const navigate = useNavigate() as unknown as LooseNavigate
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, unknown>

  const filters = useMemo(() => {
    const out = { ...defaults }
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const v = search[key as string]
      if (v != null && v !== '') out[key] = String(v) as T[keyof T]
    }
    return out
  }, [search, defaults])

  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev, [key]: value || undefined }
          // Any filter change resets paging.
          if (key !== 'page') next.page = undefined
          return next
        },
        replace: true,
      })
    },
    [navigate],
  )

  const reset = useCallback(() => {
    navigate({ to: '.', search: {}, replace: true })
  }, [navigate])

  return { filters, setFilter, reset }
}

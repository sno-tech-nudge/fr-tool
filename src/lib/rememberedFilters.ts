import { useEffect, useState } from 'react'
import { redirect, useRouterState } from '@tanstack/react-router'

/**
 * List pages remember their filters for a while, so leaving for a record and
 * coming back (or clicking the page in the sidebar) lands on the same view.
 *
 * - Saved in this browser only, per page, for 12 hours after the last change.
 * - A URL that already carries filters (a shared link) always wins.
 * - Clearing the filters back to the defaults clears the saved copy too.
 */
const TTL_MS = 12 * 60 * 60 * 1000
const storageKey = (page: string) => `fr:filters:${page}`

type Search = Record<string, unknown>

/** The params worth keeping: non-empty, minus ones that open a record (a drawer). */
function keep(search: Search, skip: string[]) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(search)) {
    if (skip.includes(k) || v == null || v === '') continue
    out[k] = String(v)
  }
  return out
}

function read(page: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(storageKey(page))
    if (!raw) return null
    const saved = JSON.parse(raw) as { at: number; values: Record<string, string> }
    if (Date.now() - saved.at > TTL_MS) {
      localStorage.removeItem(storageKey(page))
      return null
    }
    return saved.values
  } catch {
    return null
  }
}

/**
 * For a route's `beforeLoad`: arriving on the page with no params at all →
 * send the person to their saved view instead of the defaults. Only on arrival
 * (`cause` 'enter'): clearing the filters while on the page must stay cleared.
 */
export function restoreFilters(
  page: string, to: string, opts: { search: unknown; cause: string }, skip: string[] = [],
) {
  if (opts.cause !== 'enter') return
  if (Object.keys(keep(opts.search as Search, [])).length > 0) return
  const saved = read(page)
  if (saved && Object.keys(keep(saved, skip)).length > 0) {
    throw redirect({ to, search: saved as never, replace: true })
  }
}

/** Saves the page's current params whenever they change. */
export function useRememberFilters(page: string, skip: string[] = []) {
  const search = useRouterState({ select: (s) => s.location.search }) as Search
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // On the way out the location changes a moment before the page unmounts;
  // only save while the URL is still this page's own.
  const [ownPath] = useState(pathname)
  const values = JSON.stringify(keep(search, skip))
  useEffect(() => {
    if (pathname !== ownPath) return
    try {
      if (values === '{}') localStorage.removeItem(storageKey(page))
      else localStorage.setItem(storageKey(page), JSON.stringify({ at: Date.now(), values: JSON.parse(values) }))
    } catch {
      // Storage blocked (private window): the page still works, it just forgets.
    }
  }, [page, values, pathname, ownPath])
}

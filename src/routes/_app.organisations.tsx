import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * Layout only — it MUST render an <Outlet/> and nothing else. The directory
 * lives in _app.organisations.index.tsx. If the list rendered here instead,
 * /organisations/$id would silently show the list with no error.
 */
export const Route = createFileRoute('/_app/organisations')({
  component: () => <Outlet />,
})

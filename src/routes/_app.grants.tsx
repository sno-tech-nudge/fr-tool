import { Outlet, createFileRoute } from '@tanstack/react-router'

/** Layout only — the directory lives in .index.tsx so /$id can render. */
export const Route = createFileRoute('/_app/grants')({
  component: () => <Outlet />,
})

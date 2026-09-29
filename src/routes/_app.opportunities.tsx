import { Outlet, createFileRoute } from '@tanstack/react-router'

/** Layout only — the board/list lives in .index.tsx so /$id can render. */
export const Route = createFileRoute('/_app/opportunities')({
  component: () => <Outlet />,
})

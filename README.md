# Fundraising CRM — The/Nudge

Standalone fundraising CRM, built to merge into Nucleus later.
Built with Vite, React, TanStack Router and Supabase.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run build` typechecks then builds. `npm run typecheck` alone is faster.

Requires `.env` (copy `.env.example`):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Database

SQL lives in [`sql/`](sql/README.md), phase by phase, run manually in the Supabase SQL editor.
Phase 0 (foundation: config tables, seeds, access helpers, RLS) is applied.

## Auth

Email/password for now; Google SSO later. Because every RLS policy resolves identity by **JWT
email**, swapping in SSO touches only the sign-in screen.

To sign in, an `auth.users` row must exist whose email matches an active `employees` row.
Create it in the Supabase dashboard → Authentication → Users → Add user (tick *Auto Confirm*).

## Layout

```
src/
  routes/          TanStack file-based routes (flat naming, _app = protected layout)
  components/ui/   design-system primitives (Button, Badge, fields, toasts, dialogs)
  components/admin/ PicklistEditor + specs, TeamMembers
  lib/             supabase client, auth, access context, money/date/FY formatting
  hooks/           useFrAccess
public/design-system/  brand tokens, fonts, logos (linked from index.html)
```

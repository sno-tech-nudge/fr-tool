-- =====================================================================
-- PHASE 0 / 00 — employees STUB
-- =====================================================================
-- `employees` is a SHARED Nucleus table. FR does not own it and must never
-- alter it beyond reading (plus setting managed_module for the one FR manager).
--
-- This is a local STUB so the standalone build has something for every
-- owner_user_id / created_by / updated_by FK to point at. It deliberately
-- mirrors the Nucleus column NAMES exactly, so the eventual merge is a
-- data-level swap, never a schema rewrite:
--     id (NOT user_id) · email · name (NOT full_name)
--     erp_role (NOT role) · managed_module · is_active (there is NO deleted_at)
--
-- !! The real Nucleus table has MORE columns than these six. FR must depend
--    on only these six.
-- !! These stub UUIDs will NOT match Nucleus's employee UUIDs. If/when an
--    export of (id, email, name, erp_role, managed_module, is_active) arrives
--    from Nucleus, reseed with the REAL ids before any FR data accumulates —
--    otherwise every owner_user_id needs a remap-by-email pass later.
-- =====================================================================

-- ---------- BLOCK 1: table ----------
create table if not exists public.employees (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  erp_role       text not null default 'member'
                 check (erp_role in ('super_admin','admin','manager','member')),
  managed_module text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Identity is resolved by lower(email) everywhere, so enforce it there too.
create unique index if not exists employees_email_lower_uidx
  on public.employees (lower(email));

create index if not exists employees_active_idx
  on public.employees (is_active) where is_active;

-- ---------- BLOCK 2: seed the solo builder ----------
-- Solo build for now: one super_admin, full access. Devadas + the rest of the
-- FR team get seeded when auth is done properly (see CLAUDE.md 5).
-- Re-runnable: existing rows are left untouched.
insert into public.employees (email, name, erp_role, managed_module, is_active) values
  ('achintya.rao@thenudge.org', 'Achintya Rao', 'super_admin', null, true)
on conflict (email) do nothing;

-- ---------- BLOCK 3: RLS ----------
-- The staff directory is readable by any signed-in user (FR needs it for owner
-- pickers and name lookups). No write policies exist, so only service_role can
-- mutate it — which is the intended "FR never writes to employees" guarantee.
alter table public.employees enable row level security;

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated using (true);

-- ---------- VERIFY ----------
-- select email, name, erp_role, managed_module, is_active from public.employees order by email;

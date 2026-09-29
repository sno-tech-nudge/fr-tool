-- =====================================================================
-- PHASE 0 / 02 — FR team membership
-- =====================================================================
-- The FR sub-role layer. It sits ON TOP of the global ERP roles and never
-- disturbs them, so the FR team can be managed independently.
-- Any active row here grants access to the module via is_fr_authorised().
-- =====================================================================

-- ---------- BLOCK 1: table ----------
create table if not exists public.fr_team_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.employees(id) on delete cascade,
  fr_sub_role text not null default 'member'
              check (fr_sub_role in ('lead','member','finance')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (user_id)
);

create index if not exists fr_team_members_active_idx
  on public.fr_team_members (user_id) where is_active and deleted_at is null;

-- ---------- BLOCK 2: seed — the solo builder as FR lead ----------
-- super_admin already satisfies is_fr_authorised()/is_fr_manager() on its own
-- (block 3), so this row isn't load-bearing for access — it just gives the UI
-- a sensible fr_sub_role to display. Swap to Devadas + the real team when
-- auth is done properly (see CLAUDE.md 5).
insert into public.fr_team_members (user_id, fr_sub_role, is_active)
select e.id, 'lead', true
from public.employees e
where lower(e.email) = 'achintya.rao@thenudge.org'
on conflict (user_id) do nothing;

-- ---------- VERIFY ----------
-- select e.email, e.erp_role, t.fr_sub_role, t.is_active
-- from public.fr_team_members t join public.employees e on e.id = t.user_id;

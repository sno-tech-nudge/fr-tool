-- =====================================================================
-- PHASE 0 / 03 — Access-control helpers  (THE most important file)
-- =====================================================================
-- These three functions are the SINGLE point of control for FR security.
-- Every FR RLS policy calls them, so changing access = changing one body
-- here and every table updates at once.
--
-- !! ALL THREE RESOLVE IDENTITY BY EMAIL FROM THE JWT — never by auth.uid().
--    auth.users.id is DELIBERATELY different from employees.id; email is the
--    bridge. Using auth.uid() = employees.id returns ZERO ROWS with NO ERROR.
--
-- !! auth.jwt() ->> 'email' is NULL in the Supabase SQL editor, so these
--    return false there by default. 07_verify.sql shows how to impersonate an
--    email in the editor — but the real check is always in the running app.
-- =====================================================================

-- ---------- BLOCK 1: can this user use the FR module at all? ----------
create or replace function public.is_fr_authorised()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.jwt() ->> 'email')
      and e.is_active = true
      and (
        e.erp_role in ('super_admin','admin')
        or (e.erp_role = 'manager' and e.managed_module = 'fundraising')
        or exists (
          select 1 from public.fr_team_members ftm
          where ftm.user_id = e.id
            and ftm.is_active = true
            and ftm.deleted_at is null
        )
      )
  );
$$;

-- ---------- BLOCK 2: can this user administer FR? ----------
-- Edits settings/picklists, sees ALL confidential records, manages the team.
create or replace function public.is_fr_manager()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.jwt() ->> 'email')
      and e.is_active = true
      and (
        e.erp_role in ('super_admin','admin')
        or (e.erp_role = 'manager' and e.managed_module = 'fundraising')
      )
  );
$$;

-- ---------- BLOCK 3: the row-level gate ----------
-- Managers see everything. Everyone else sees a confidential record only if
-- they own it. Confidentiality is PER-RECORD, never team-wide.
create or replace function public.fr_can_see_record(p_confidential boolean, p_owner_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_fr_manager()
    or (
      public.is_fr_authorised()
      and (
        not coalesce(p_confidential, false)
        or p_owner_id = (
          select e.id from public.employees e
          where lower(e.email) = lower(auth.jwt() ->> 'email')
          limit 1
        )
      )
    );
$$;

-- ---------- BLOCK 4: current user's employees.id ----------
-- Convenience used by write policies so they don't repeat the email lookup.
create or replace function public.fr_current_employee_id()
returns uuid language sql security definer stable set search_path = public as $$
  select e.id from public.employees e
  where lower(e.email) = lower(auth.jwt() ->> 'email')
    and e.is_active = true
  limit 1;
$$;

-- ---------- BLOCK 5: grants ----------
grant execute on function public.is_fr_authorised()                to authenticated;
grant execute on function public.is_fr_manager()                   to authenticated;
grant execute on function public.fr_can_see_record(boolean, uuid)   to authenticated;
grant execute on function public.fr_current_employee_id()           to authenticated;

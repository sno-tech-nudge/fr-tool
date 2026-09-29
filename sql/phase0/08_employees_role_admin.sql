-- =====================================================================
-- PHASE 0 / 08 — super-admin role administration on `employees`
-- =====================================================================
-- `employees` is a SHARED Nucleus table and the stub (00) deliberately gives
-- it a SELECT policy only, so nothing in FR can write to it. This file opens
-- the narrowest possible hole in that: a super admin may change TWO columns,
-- erp_role and managed_module, and nothing else.
--
-- It is deliberately one grant + one policy so the whole capability can be
-- revoked in two statements when Nucleus takes employee administration back:
--     revoke update on public.employees from authenticated;
--     drop policy employees_update_roles on public.employees;
--
-- Not editable through this: id, email, name, is_active. Creating a person is
-- still a Supabase dashboard job (auth user) plus an employees row.
-- =====================================================================

-- ---------- BLOCK 1: helpers ----------
-- Both are SECURITY DEFINER on purpose. A policy ON employees that reads
-- employees directly would recurse; a definer function bypasses RLS and
-- breaks the cycle. Same shape as the three access helpers in 03.

create or replace function public.fr_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.jwt() ->> 'email')
      and e.erp_role = 'super_admin'
      and e.is_active
  )
$$;

create or replace function public.fr_current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  where lower(e.email) = lower(auth.jwt() ->> 'email')
  limit 1
$$;

-- ---------- BLOCK 2: column-scoped grant ----------
-- UPDATE is granted on exactly two columns. Postgres refuses the statement
-- outright if any other column is targeted, so the UI cannot rename or
-- deactivate anyone even if it tried.
grant update (erp_role, managed_module) on public.employees to authenticated;

-- ---------- BLOCK 3: policy ----------
-- A super admin may edit anyone EXCEPT themselves. Self-editing is blocked so
-- the last super admin cannot demote themselves and lock everyone out — the
-- one failure mode here that has no in-app recovery.
drop policy if exists employees_update_roles on public.employees;
create policy employees_update_roles on public.employees
  for update to authenticated
  using (
    public.fr_is_super_admin()
    and id <> public.fr_current_employee_id()
  )
  with check (
    public.fr_is_super_admin()
    and id <> public.fr_current_employee_id()
  );

-- ---------- VERIFY ----------
-- Run signed in as a super admin, not in the SQL editor — auth.jwt() is NULL
-- there, so fr_is_super_admin() returns false and every check below fails.
--
-- select public.fr_is_super_admin();            -- true for Achintya
-- select public.fr_current_employee_id();       -- your employees.id
--
-- Should succeed (someone else):
-- update public.employees set erp_role = 'manager'
-- where email = 'devadas.krishnan@thenudge.org';
--
-- Should affect 0 rows (yourself — blocked by the policy):
-- update public.employees set erp_role = 'admin'
-- where email = 'achintya.rao@thenudge.org';
--
-- Should ERROR with "permission denied for column name":
-- update public.employees set name = 'x'
-- where email = 'devadas.krishnan@thenudge.org';

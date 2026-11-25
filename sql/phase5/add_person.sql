-- ============================================================================
-- Add person: a super admin adds someone to the staff list (employees)
-- ============================================================================
-- While the tool runs on its own, people are added here (Configuration →
-- People → Add person). employees stays closed to direct inserts; this one
-- function is the only way in. It checks:
--   * the caller is a super admin
--   * the email is on a permitted domain and not already on the list
--   * the role is member, manager or super_admin
-- A manager is scoped to fundraising. The person still needs a sign-in
-- (Supabase → Authentication → Add user, same email) and, for FR access
-- without a manager role, a row in Team members.
--
-- To retire when the tool joins Nucleus:
--   drop function public.fr_add_person(text, text, text);
-- Idempotent; run as one block.

create or replace function public.fr_add_person(p_name text, p_email text, p_erp_role text default 'member')
returns public.employees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_name  text := btrim(p_name);
  v_row   public.employees;
begin
  if not public.fr_is_super_admin() then
    raise exception 'Only a super admin can add people';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'Enter a name';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$'
     or split_part(v_email, '@', 2) not in ('thenudge.org', 'thedelta.org.in', 'thespark.org.in', 'thenudge.us') then
    raise exception 'Use a thenudge.org, thedelta.org.in, thespark.org.in or thenudge.us email';
  end if;
  if p_erp_role not in ('member', 'manager', 'super_admin') then
    raise exception 'Unknown role';
  end if;
  if exists (select 1 from employees e where lower(e.email) = v_email) then
    raise exception '% is already on the list', v_email;
  end if;

  insert into employees (id, email, name, erp_role, managed_module, is_active)
  values (gen_random_uuid(), v_email, v_name, p_erp_role,
          case when p_erp_role = 'manager' then 'fundraising' end, true)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.fr_add_person(text, text, text) from public, anon;
grant execute on function public.fr_add_person(text, text, text) to authenticated;

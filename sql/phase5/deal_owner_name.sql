-- ============================================================================
-- Deals: owner as a name
-- ============================================================================
-- fr_opportunities.owner_name is the owner the app shows: a person in the tool
-- or any name (Zoho owners who have no account keep their name).
-- owner_user_id stays the account the deal sits with (access, reminders):
--   * name matches one active person  -> that person
--   * any other name                  -> whoever typed it
--   * owner_user_id changed alone     -> the name follows it
-- Idempotent; run block by block.

-- Block 1: the column ------------------------------------------------------
alter table public.fr_opportunities add column if not exists owner_name text;
create index if not exists fr_opportunities_owner_name_idx on public.fr_opportunities (owner_name);

-- Block 2: keep the name and the account in step ---------------------------
create or replace function public.fr_deal_owner_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  -- Bulk loads set both columns themselves.
  if current_setting('fr.owner_name_as_is', true) = 'on' then return new; end if;

  new.owner_name := nullif(btrim(new.owner_name), '');

  if tg_op = 'UPDATE' and new.owner_name is not distinct from old.owner_name
     and new.owner_user_id is distinct from old.owner_user_id then
    new.owner_name := (select e.name from employees e where e.id = new.owner_user_id);
  elsif new.owner_name is null then
    new.owner_name := (select e.name from employees e where e.id = new.owner_user_id);
  elsif tg_op = 'INSERT' or new.owner_name is distinct from old.owner_name then
    select array_agg(e.id) into v_ids from employees e
    where e.is_active and lower(btrim(e.name)) = lower(new.owner_name);
    if coalesce(array_length(v_ids, 1), 0) = 1 then
      new.owner_user_id := v_ids[1];
      -- Their own spelling, so filters and lists group them together.
      new.owner_name := (select e.name from employees e where e.id = v_ids[1]);
    else
      new.owner_user_id := coalesce(public.fr_current_employee_id(), new.owner_user_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fr_deal_owner_name on public.fr_opportunities;
create trigger trg_fr_deal_owner_name
  before insert or update on public.fr_opportunities
  for each row execute function public.fr_deal_owner_name();

-- Block 3: fill in names ---------------------------------------------------
-- Zoho deals whose Zoho owner has no account, still sitting with a super admin
-- (where Apply left them): the Zoho owner's name. Everything else: the person
-- it sits with, so deals you already assigned stay as they are.
do $$
begin
  perform set_config('fr.owner_name_as_is', 'on', true);

  update public.fr_opportunities o
  set owner_name = z.zoho_owner
  from public.fr_zoho_owners z, public.employees e
  where z.kind = 'deal' and o.external_ref = 'zoho_deal:' || z.zoho_id
    and z.zoho_owner is not null
    and not exists (select 1 from public.fr_zoho_owner_map m
                    where m.zoho_owner = z.zoho_owner and m.employee_id is not null)
    and e.id = o.owner_user_id and e.erp_role = 'super_admin'
    and o.owner_name is null;

  update public.fr_opportunities o
  set owner_name = e.name
  from public.employees e
  where e.id = o.owner_user_id and o.owner_name is null;
end $$;

-- Block 4: Zoho owners Apply also writes the name --------------------------
create or replace function public.fr_apply_zoho_owners()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := public.fr_current_employee_id();
  v_deals  int;
  v_pm     int;
  v_orgs   int;
begin
  if not public.fr_is_super_admin() then
    raise exception 'Only a super admin can apply Zoho owners';
  end if;
  perform set_config('fr.owner_name_as_is', 'on', true);

  -- Deals: a mapped owner gets the deal and their name; an unmapped owner's
  -- deal still with a mapped person comes back to the caller under the Zoho name.
  with mapped as (select zoho_owner, employee_id from fr_zoho_owner_map where employee_id is not null),
  target as (
    select o.id, m.employee_id, e.name as emp_name, z.zoho_owner
    from fr_opportunities o
    join fr_zoho_owners z on z.kind = 'deal' and o.external_ref = 'zoho_deal:' || z.zoho_id
    left join mapped m on m.zoho_owner = z.zoho_owner
    left join employees e on e.id = m.employee_id
    where o.deleted_at is null
  )
  update fr_opportunities o
  set owner_user_id = coalesce(t.employee_id, v_me),
      owner_name = coalesce(t.emp_name, t.zoho_owner, o.owner_name),
      updated_by = v_me
  from target t
  where o.id = t.id
    and (t.employee_id is not null
         or o.owner_user_id in (select employee_id from mapped))
    and (o.owner_user_id is distinct from coalesce(t.employee_id, v_me)
         or o.owner_name is distinct from coalesce(t.emp_name, t.zoho_owner, o.owner_name));
  get diagnostics v_deals = row_count;

  -- PM owners: Zoho's PM Rep when mapped; a temporary PM who is mapped but
  -- not Zoho's PM Rep is cleared.
  with mapped as (select zoho_owner, employee_id from fr_zoho_owner_map where employee_id is not null),
  target as (
    select o.id, m.employee_id
    from fr_opportunities o
    join fr_zoho_owners z on z.kind = 'deal' and o.external_ref = 'zoho_deal:' || z.zoho_id
    left join mapped m on m.zoho_owner = z.zoho_pm
    where o.deleted_at is null
  )
  update fr_opportunities o
  set pm_owner_user_id = t.employee_id, updated_by = v_me
  from target t
  where o.id = t.id
    and (t.employee_id is not null
         or o.pm_owner_user_id in (select employee_id from mapped))
    and o.pm_owner_user_id is distinct from t.employee_id;
  get diagnostics v_pm = row_count;

  -- Companies: by Zoho ID, else by name when exactly one company has it.
  with mapped as (select zoho_owner, employee_id from fr_zoho_owner_map where employee_id is not null),
  z as (select * from fr_zoho_owners where kind = 'company'),
  src as (
    select org.id, z.zoho_owner
    from z join fr_organisations org on org.external_ref = 'zoho_company:' || z.zoho_id and org.deleted_at is null
    union
    select org.id, z.zoho_owner
    from z join fr_organisations org
      on lower(btrim(org.name)) = lower(btrim(z.record_name)) and org.deleted_at is null
    where not exists (select 1 from fr_organisations o2 where o2.external_ref = 'zoho_company:' || z.zoho_id)
      and (select count(*) from fr_organisations o3
           where lower(btrim(o3.name)) = lower(btrim(z.record_name)) and o3.deleted_at is null) = 1
  ),
  target as (
    select distinct on (s.id) s.id, m.employee_id
    from src s left join mapped m on m.zoho_owner = s.zoho_owner
    order by s.id, m.employee_id nulls last
  )
  update fr_organisations org
  set relationship_owner_user_id = coalesce(t.employee_id, v_me), updated_by = v_me
  from target t
  where org.id = t.id
    and (t.employee_id is not null
         or org.relationship_owner_user_id in (select employee_id from mapped))
    and org.relationship_owner_user_id is distinct from coalesce(t.employee_id, v_me);
  get diagnostics v_orgs = row_count;

  return jsonb_build_object('deals', v_deals, 'pm', v_pm, 'companies', v_orgs);
end;
$$;

revoke all on function public.fr_apply_zoho_owners() from public, anon;
grant execute on function public.fr_apply_zoho_owners() to authenticated;

-- Block 5: owner names for the Deals filter (aggregated here: 1,000+ deals) --
create or replace view public.fr_deal_owner_names with (security_invoker = on) as
select owner_name as name, count(*) as deals
from public.fr_opportunities
where deleted_at is null and owner_name is not null
group by owner_name;

-- Block 6: check -------------------------------------------------------------
select owner_name, count(*) as deals
from public.fr_opportunities where deleted_at is null
group by owner_name order by deals desc limit 25;

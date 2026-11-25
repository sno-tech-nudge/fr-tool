-- ============================================================================
-- Zoho owners: set each imported deal's and company's real owner from Zoho
-- ============================================================================
-- Temporary migration helper. Zoho's deal owner, company owner and PM Rep are
-- loaded into fr_zoho_owners (data from scripts/zoho_owners_data.sql). In
-- Configuration → Zoho owners, a super admin maps each Zoho name to a team
-- member and presses Apply. Drop all of this once everyone is mapped.
--
-- Apply only touches records imported from Zoho:
--   * a mapped Zoho owner            → that person
--   * an unmapped Zoho owner, while the record sits with someone who IS
--     mapped (a temporary assignment) → back to the super admin applying
--   * anything else                  → left alone
-- Idempotent; run block by block.

-- Block 1: tables -----------------------------------------------------------
create table if not exists public.fr_zoho_owners (
  kind         text not null check (kind in ('deal', 'company')),
  zoho_id      text not null,              -- the export's Record Id (zcrm_…)
  record_name  text,                       -- deal / company name, for matching by name
  zoho_owner   text,
  zoho_pm      text,                       -- deals only: PM Rep
  primary key (kind, zoho_id)
);

create table if not exists public.fr_zoho_owner_map (
  zoho_owner   text primary key,
  employee_id  uuid references public.employees(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.employees(id)
);

alter table public.fr_zoho_owners enable row level security;
alter table public.fr_zoho_owner_map enable row level security;

create or replace function public.fr_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where lower(e.email) = lower(auth.jwt() ->> 'email') and e.is_active and e.erp_role = 'super_admin'
  )
$$;

drop policy if exists fr_zoho_owners_read on public.fr_zoho_owners;
create policy fr_zoho_owners_read on public.fr_zoho_owners
  for select using (public.fr_is_super_admin());

drop policy if exists fr_zoho_owner_map_all on public.fr_zoho_owner_map;
create policy fr_zoho_owner_map_all on public.fr_zoho_owner_map
  for all using (public.fr_is_super_admin()) with check (public.fr_is_super_admin());

-- Block 2: per-name counts for the screen (aggregated here: 1,400+ rows) -----
create or replace view public.fr_zoho_owner_summary with (security_invoker = on) as
select name,
       count(*) filter (where role = 'deal')    as deals,
       count(*) filter (where role = 'company') as companies,
       count(*) filter (where role = 'pm')      as pm_deals
from (
  select zoho_owner as name, kind as role from public.fr_zoho_owners where zoho_owner is not null
  union all
  select zoho_pm, 'pm' from public.fr_zoho_owners where kind = 'deal' and zoho_pm is not null
) s
group by name;

-- Block 3: Apply ------------------------------------------------------------
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

  -- Deals
  with mapped as (select zoho_owner, employee_id from fr_zoho_owner_map where employee_id is not null),
  target as (
    select o.id, m.employee_id
    from fr_opportunities o
    join fr_zoho_owners z on z.kind = 'deal' and o.external_ref = 'zoho_deal:' || z.zoho_id
    left join mapped m on m.zoho_owner = z.zoho_owner
    where o.deleted_at is null
  )
  update fr_opportunities o
  set owner_user_id = coalesce(t.employee_id, v_me), updated_by = v_me
  from target t
  where o.id = t.id
    and (t.employee_id is not null
         or o.owner_user_id in (select employee_id from mapped))
    and o.owner_user_id is distinct from coalesce(t.employee_id, v_me);
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

-- Block 4: load the Zoho data -------------------------------------------------
-- Run scripts/zoho_owners_data.sql (generated from the two CSVs; kept out of git).

-- Block 5: check -------------------------------------------------------------
select kind, count(*) from public.fr_zoho_owners group by kind;          -- deal 1003, company 478
select * from public.fr_zoho_owner_summary order by deals desc limit 10;  -- empty in the SQL editor (super admin check); check in the app

-- Block 6: one-off — deals and companies created in the app (not from Zoho)
-- that sit with Saikrishna, Mrinalini, Ritika or Devadas go to Achintya.
-- Preview first:
select 'deal' as kind, o.name, e.name as owner
from fr_opportunities o join employees e on e.id = o.owner_user_id
where o.deleted_at is null
  and (o.external_ref is null or o.external_ref not like 'zoho_deal:%')
  and (e.name ilike 'saikrishna%' or e.name ilike 'mrinalini%' or e.name ilike 'ritika%' or e.name ilike 'devadas%')
union all
select 'company', org.name, e.name
from fr_organisations org join employees e on e.id = org.relationship_owner_user_id
where org.deleted_at is null
  and (org.external_ref is null or org.external_ref not like 'zoho_company:%')
  and (e.name ilike 'saikrishna%' or e.name ilike 'mrinalini%' or e.name ilike 'ritika%' or e.name ilike 'devadas%');

-- Then move them:
do $$
declare v_me uuid := (select id from employees where lower(email) = 'achintya.rao@thenudge.org');
begin
  update fr_opportunities o set owner_user_id = v_me
  from employees e
  where e.id = o.owner_user_id and o.deleted_at is null
    and (o.external_ref is null or o.external_ref not like 'zoho_deal:%')
    and (e.name ilike 'saikrishna%' or e.name ilike 'mrinalini%' or e.name ilike 'ritika%' or e.name ilike 'devadas%');

  update fr_organisations org set relationship_owner_user_id = v_me
  from employees e
  where e.id = org.relationship_owner_user_id and org.deleted_at is null
    and (org.external_ref is null or org.external_ref not like 'zoho_company:%')
    and (e.name ilike 'saikrishna%' or e.name ilike 'mrinalini%' or e.name ilike 'ritika%' or e.name ilike 'devadas%');
end $$;

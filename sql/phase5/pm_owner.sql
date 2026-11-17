-- ============================================================
-- NBD → PM handover. When a deal closes won, whoever closes it (normally
-- the NBD owner) names the PM owner. The deal keeps its NBD owner; the PM
-- owner also owns the grant, so everything after the win (instalments,
-- receipts, compliance, reminders) reaches them. Idempotent; run in order.
--
--   1. fr_opportunities.pm_owner_user_id
--   2. Visibility: a confidential deal is also visible (and editable) to its
--      PM owner; a confidential grant is also visible to its deal's NBD owner
--   3. Trigger: the PM owner is told when they are assigned
--
-- Policies here are added alongside the existing ones (Postgres ORs
-- permissive policies), so nothing already allowed is taken away.
-- ============================================================


-- ---------- 1. Who manages the partnership after the win ----------
alter table public.fr_opportunities
  add column if not exists pm_owner_user_id uuid references public.employees(id);

create index if not exists fr_opportunities_pm_owner_idx on public.fr_opportunities (pm_owner_user_id);


-- ---------- 2. Both owners see the record ----------
drop policy if exists fr_opportunities_select_pm_owner on public.fr_opportunities;
create policy fr_opportunities_select_pm_owner on public.fr_opportunities
  for select using (
    public.is_fr_authorised()
    and pm_owner_user_id = public.fr_current_employee_id()
  );

drop policy if exists fr_opportunities_update_pm_owner on public.fr_opportunities;
create policy fr_opportunities_update_pm_owner on public.fr_opportunities
  for update using (
    public.is_fr_authorised()
    and pm_owner_user_id = public.fr_current_employee_id()
  ) with check (public.is_fr_authorised());

-- The grant's owner is the PM; this keeps the NBD owner able to see it.
drop policy if exists fr_grants_select_deal_owner on public.fr_grants;
create policy fr_grants_select_deal_owner on public.fr_grants
  for select using (
    public.is_fr_authorised()
    and exists (
      select 1 from public.fr_opportunities o
      where o.id = opportunity_id
        and o.owner_user_id = public.fr_current_employee_id()
    )
  );


-- ---------- 3. Tell the PM owner ----------
create or replace function public.fr_opportunities_notify_pm_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := public.fr_current_employee_id();
  v_org text;
begin
  -- Only changes made by a person in the app; migrations stay quiet.
  if auth.jwt() ->> 'email' is null then return new; end if;
  if new.pm_owner_user_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.pm_owner_user_id is not distinct from old.pm_owner_user_id then return new; end if;
  if new.pm_owner_user_id = v_me then return new; end if;  -- assigned yourself

  if exists (
    select 1 from public.fr_notification_preferences p
    where p.employee_id = new.pm_owner_user_id and p.category = 'deal_assigned'
      and p.in_app = false and p.deleted_at is null
  ) then return new; end if;

  select o.name into v_org from public.fr_organisations o where o.id = new.organisation_id;

  insert into public.fr_notifications
    (recipient_user_id, category, severity, title, body, parent_type, parent_id, created_by, external_ref)
  values (
    new.pm_owner_user_id,
    'deal_assigned',
    'info',
    'You are the PM owner: ' || coalesce(v_org, new.name),
    new.name || coalesce(' · ₹' || to_char(new.amount_inr, 'FM99,99,99,99,999'), ''),
    'opportunity',
    new.id,
    v_me,
    'pm_assign:' || new.id || ':' || new.pm_owner_user_id
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_fr_opportunities_notify_pm_owner on public.fr_opportunities;
create trigger trg_fr_opportunities_notify_pm_owner
  after insert or update of pm_owner_user_id on public.fr_opportunities
  for each row execute function public.fr_opportunities_notify_pm_owner();


-- ---------- 4. Verify ----------
-- Expect: 1 column, 3 policies, 1 trigger.
select
  (select count(*) from information_schema.columns
    where table_name = 'fr_opportunities' and column_name = 'pm_owner_user_id')   as pm_owner_col,
  (select count(*) from pg_policies
    where policyname in ('fr_opportunities_select_pm_owner', 'fr_opportunities_update_pm_owner',
                         'fr_grants_select_deal_owner'))                           as policies,
  (select count(*) from pg_trigger
    where tgname = 'trg_fr_opportunities_notify_pm_owner')                        as notify_trigger;

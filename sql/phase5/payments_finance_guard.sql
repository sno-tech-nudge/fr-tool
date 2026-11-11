-- ============================================================
-- Payments (fr_remittances): finance confirms, the database enforces it.
-- PRD FR-33 / IA: only Finance confirms a receipt, and confirming locks it.
-- Until now that rule lived only in the screen. Idempotent; run block by block.
--
--   1. is_fr_finance()          finance team members, plus FR managers
--   2. fr_can_enter_payments()  who may record / change / delete receipts,
--                               governed by the payments_finance_only setting
--   3. RLS                      insert / update / delete use (2)
--   4. Trigger                  only (1) may confirm or lock; who confirmed
--                               and when are stamped from the session
--
-- The SQL editor and the service role carry no user email, so they pass the
-- trigger: historical migrations and a manager's manual unlock still work.
-- ============================================================


-- ---------- 1. Who counts as finance ----------
-- Resolves by email from the JWT, like the other three helpers.
create or replace function public.is_fr_finance()
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_fr_manager() or exists (
    select 1
    from public.employees e
    join public.fr_team_members ftm on ftm.user_id = e.id
    where lower(e.email) = lower(auth.jwt() ->> 'email')
      and e.is_active = true
      and ftm.is_active = true
      and ftm.deleted_at is null
      and ftm.fr_sub_role = 'finance'
  );
$$;


-- ---------- 2. Who may record receipts ----------
-- Off (the default): anyone on the FR team, as today.
-- On: finance and managers only, as the IA describes. Switched in
-- Configuration → Team members.
insert into public.fr_settings (key, value, description) values
  ('payments_finance_only', 'false'::jsonb,
   'Only finance and FR managers may record, change or delete receipts')
on conflict (key) do nothing;

create or replace function public.fr_can_enter_payments()
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_fr_finance()
    or (
      public.is_fr_authorised()
      and not coalesce(
        (select s.value = 'true'::jsonb from public.fr_settings s where s.key = 'payments_finance_only'),
        false)
    );
$$;


-- ---------- 3. RLS: writes go through fr_can_enter_payments() ----------
-- Reading is unchanged. A locked receipt still cannot be changed or deleted.
drop policy if exists fr_remittances_insert on public.fr_remittances;
create policy fr_remittances_insert on public.fr_remittances
  for insert with check (
    public.fr_can_enter_payments()
    and exists (select 1 from public.fr_tranches t where t.id = tranche_id)
  );

drop policy if exists fr_remittances_update on public.fr_remittances;
create policy fr_remittances_update on public.fr_remittances
  for update using (
    public.fr_can_enter_payments() and is_locked = false
  ) with check (public.fr_can_enter_payments());

drop policy if exists fr_remittances_delete on public.fr_remittances;
create policy fr_remittances_delete on public.fr_remittances
  for delete using (public.fr_can_enter_payments() and is_locked = false);


-- ---------- 4. Only finance confirms and locks ----------
create or replace function public.fr_remittances_guard_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No user email: the SQL editor, the service role, a migration. Trusted.
  if auth.jwt() ->> 'email' is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (new.confirmed_by_finance or new.is_locked) and not public.is_fr_finance() then
      raise exception 'Only finance or an FR manager can confirm a receipt.'
        using errcode = '42501';
    end if;
  elsif (new.confirmed_by_finance is distinct from old.confirmed_by_finance
         or new.is_locked is distinct from old.is_locked
         or new.confirmed_by_user_id is distinct from old.confirmed_by_user_id
         or new.confirmed_at is distinct from old.confirmed_at)
        and not public.is_fr_finance() then
    raise exception 'Only finance or an FR manager can confirm a receipt.'
      using errcode = '42501';
  end if;

  -- Who confirmed and when come from the session, not from the request.
  if new.confirmed_by_finance and (tg_op = 'INSERT' or not old.confirmed_by_finance) then
    new.confirmed_by_user_id := public.fr_current_employee_id();
    new.confirmed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fr_remittances_guard_confirm on public.fr_remittances;
create trigger trg_fr_remittances_guard_confirm
  before insert or update on public.fr_remittances
  for each row execute function public.fr_remittances_guard_confirm();


-- ---------- 5. Verify ----------
-- Expect: 3 policies using fr_can_enter_payments, the trigger present, the setting false.
select
  (select count(*) from pg_policies
    where tablename = 'fr_remittances'
      and (qual like '%fr_can_enter_payments%' or with_check like '%fr_can_enter_payments%')) as write_policies,
  (select count(*) from pg_trigger
    where tgname = 'trg_fr_remittances_guard_confirm') as guard_trigger,
  (select value from public.fr_settings where key = 'payments_finance_only') as finance_only;

-- Who is finance today (managers count too, but are not listed here):
-- select e.name, e.email from public.fr_team_members t
-- join public.employees e on e.id = t.user_id
-- where t.fr_sub_role = 'finance' and t.is_active and t.deleted_at is null;

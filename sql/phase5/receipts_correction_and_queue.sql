-- ============================================================
-- Receipts: correcting them before finance confirms, and telling finance
-- one is waiting. Run after payments_finance_guard.sql. Idempotent; run
-- block by block.
--
--   1. fr_remittances.deleted_at  removing a receipt is a soft delete
--   2. Views                      removed receipts drop out of every total;
--                                 the receipt view gains instalment number,
--                                 recorded-at and recorded-by for the
--                                 finance list. Replaced in place, so
--                                 nothing that depends on them is dropped.
--   3. Trigger                    a receipt recorded in the app notifies
--                                 finance (managers if there is no finance
--                                 person); confirming or removing it clears
--                                 those notifications
-- ============================================================


-- ---------- 1. Soft delete ----------
-- Locked receipts still cannot be removed: the UPDATE policy only lets an
-- unlocked row change.
alter table public.fr_remittances
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.employees(id);


-- ---------- 2. Views (same columns as before, new ones at the end) ----------
create or replace view public.v_fr_grant_facts with (security_invoker = on) as
with received as (
  select t.grant_id, sum(r.amount_inr) as received_inr
  from public.fr_tranches t
  join public.fr_remittances r on r.tranche_id = t.id
  where r.deleted_at is null
  group by t.grant_id
)
select
  g.id,
  g.opportunity_id,
  g.organisation_id,
  org.name                                as org_name,
  org.donor_type,
  g.agreement_number,
  g.capital_category,
  g.total_value_inr,
  coalesce(rc.received_inr, 0)            as received_inr,
  greatest(g.total_value_inr - coalesce(rc.received_inr, 0), 0)
                                          as outstanding_inr,
  case
    when coalesce(g.total_value_inr, 0) = 0 then 0
    else round(coalesce(rc.received_inr, 0) * 100.0 / g.total_value_inr, 2)
  end                                     as collection_pct,
  g.is_fcra,
  g.is_multi_year,
  g.signed_date,
  g.start_date,
  g.end_date,
  public.fr_fiscal_year(g.signed_date)    as signed_fiscal_year,
  public.fr_fiscal_year(g.end_date)       as ending_fiscal_year,
  g.status,
  g.owner_user_id,
  e.name                                  as owner_name,
  b.label                                 as bank_label
from public.fr_grants g
left join public.fr_organisations org on org.id = g.organisation_id
left join received rc                 on rc.grant_id = g.id
left join public.employees e          on e.id = g.owner_user_id
left join public.fr_bank_accounts b   on b.id = g.bank_account_id
where g.deleted_at is null;

create or replace view public.v_fr_tranche_facts with (security_invoker = on) as
with received as (
  select r.tranche_id, sum(r.amount_inr) as received_inr
  from public.fr_remittances r
  where r.deleted_at is null
  group by r.tranche_id
)
select
  t.id,
  t.grant_id,
  g.organisation_id,
  g.org_name,
  g.capital_category,
  g.is_fcra,
  t.sequence_no,
  t.due_date,
  t.revised_expected_date,
  coalesce(t.revised_expected_date, t.due_date)
                                          as effective_due_date,
  coalesce(t.amount_inr_expected, t.amount, 0)
                                          as amount_inr_expected,
  coalesce(rc.received_inr, 0)            as received_inr,
  greatest(coalesce(t.amount_inr_expected, t.amount, 0) - coalesce(rc.received_inr, 0), 0)
                                          as outstanding_inr,
  t.status,
  t.trigger_type,
  t.delay_rag,
  -- Computed, never stored: an unpaid instalment past its effective date.
  (t.status not in ('received', 'cancelled')
    and coalesce(t.revised_expected_date, t.due_date) < current_date)
                                          as is_overdue,
  -- Positive = days late, negative = days still to run. Null once the
  -- instalment is settled either way.
  case
    when t.status in ('received', 'cancelled') then null
    else current_date - coalesce(t.revised_expected_date, t.due_date)
  end                                     as days_from_due,
  (t.status not in ('received', 'cancelled')
    and coalesce(t.revised_expected_date, t.due_date)
        between current_date and current_date + 90)
                                          as due_next_90d,
  public.fr_fiscal_year(coalesce(t.revised_expected_date, t.due_date))
                                          as due_fiscal_year,
  public.fr_fiscal_quarter(coalesce(t.revised_expected_date, t.due_date))
                                          as due_fiscal_quarter,
  -- Month bucket for the 12-month cash-in calendar.
  date_trunc('month', coalesce(t.revised_expected_date, t.due_date))::date
                                          as due_month,
  g.owner_user_id,
  g.owner_name,
  g.status                                as grant_status
from public.fr_tranches t
join public.v_fr_grant_facts g on g.id = t.grant_id
left join received rc          on rc.tranche_id = t.id;

create or replace view public.v_fr_remittance_facts with (security_invoker = on) as
select
  r.id,
  r.tranche_id,
  t.grant_id,
  t.organisation_id,
  t.org_name,
  t.capital_category,
  r.received_date,
  public.fr_fiscal_year(r.received_date)    as received_fiscal_year,
  public.fr_fiscal_quarter(r.received_date) as received_fiscal_quarter,
  date_trunc('month', r.received_date)::date
                                            as received_month,
  r.amount,
  r.currency,
  r.fx_rate_to_inr,
  r.amount_inr,
  r.reference_number,
  r.receipt_type,
  r.bank_account_id,
  b.label                                   as bank_label,
  b.is_fcra                                 as bank_is_fcra,
  t.is_fcra                                 as grant_is_fcra,
  (b.is_fcra is distinct from t.is_fcra)    as fcra_mismatch,
  r.confirmed_by_finance,
  r.confirmed_at,
  r.is_locked,
  t.owner_user_id,
  t.owner_name,
  -- Appended for the finance "to confirm" list.
  t.sequence_no,
  r.created_at,
  cb.name                                   as recorded_by_name
from public.fr_remittances r
join public.v_fr_tranche_facts t    on t.id = r.tranche_id
left join public.fr_bank_accounts b on b.id = r.bank_account_id
left join public.employees cb       on cb.id = r.created_by
where r.deleted_at is null;


-- ---------- 3. Tell finance a receipt is waiting ----------
create or replace function public.fr_remittances_notify_finance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recorder uuid := public.fr_current_employee_id();
  v_grant_id uuid;
  v_org text;
  v_seq int;
  v_recipients uuid[];
begin
  -- Only receipts recorded by a person in the app; migrations stay quiet.
  if auth.jwt() ->> 'email' is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Confirmed or removed: the reminder has done its job.
    if (new.confirmed_by_finance and not old.confirmed_by_finance)
       or (new.deleted_at is not null and old.deleted_at is null) then
      update public.fr_notifications
      set dismissed_at = now()
      where external_ref like 'receipt:' || new.id || ':%'
        and dismissed_at is null;
    end if;
    return new;
  end if;

  if new.confirmed_by_finance then
    return new; -- recorded by finance and confirmed straight away
  end if;

  select t.grant_id, g.org_name, t.sequence_no
    into v_grant_id, v_org, v_seq
  from public.v_fr_tranche_facts t
  join public.v_fr_grant_facts g on g.id = t.grant_id
  where t.id = new.tranche_id;

  -- Finance team members; if there are none, the FR managers.
  select coalesce(array_agg(distinct e.id), '{}') into v_recipients
  from public.employees e
  join public.fr_team_members ftm on ftm.user_id = e.id
  where e.is_active and ftm.is_active and ftm.deleted_at is null
    and ftm.fr_sub_role = 'finance';

  if cardinality(v_recipients) = 0 then
    select coalesce(array_agg(e.id), '{}') into v_recipients
    from public.employees e
    where e.is_active
      and (e.erp_role = 'super_admin' or (e.erp_role = 'manager' and e.managed_module = 'fundraising'));
  end if;

  insert into public.fr_notifications
    (recipient_user_id, category, severity, title, body, parent_type, parent_id, created_by, external_ref)
  select r,
         'receipt_to_confirm',
         'info',
         'Receipt to confirm: ' || coalesce(v_org, 'grant'),
         '₹' || to_char(new.amount_inr, 'FM99,99,99,99,999') || ' · instalment ' || coalesce(v_seq::text, '?')
           || coalesce(' · ref ' || new.reference_number, ''),
         'grant',
         v_grant_id,
         v_recorder,
         'receipt:' || new.id || ':' || r
  from unnest(v_recipients) as r
  where r is distinct from v_recorder
    -- Respect anyone who switched this category off in the app.
    and not exists (
      select 1 from public.fr_notification_preferences p
      where p.employee_id = r and p.category = 'receipt_to_confirm' and p.in_app = false
    )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_fr_remittances_notify_finance on public.fr_remittances;
create trigger trg_fr_remittances_notify_finance
  after insert or update on public.fr_remittances
  for each row execute function public.fr_remittances_notify_finance();


-- ---------- 4. Verify ----------
-- Expect: deleted_at present, recorded_by_name on the view, the trigger present.
select
  (select count(*) from information_schema.columns
    where table_name = 'fr_remittances' and column_name = 'deleted_at')          as soft_delete_col,
  (select count(*) from information_schema.columns
    where table_name = 'v_fr_remittance_facts' and column_name = 'recorded_by_name') as view_col,
  (select count(*) from pg_trigger
    where tgname = 'trg_fr_remittances_notify_finance')                          as notify_trigger;

-- ============================================================
-- "Received" means confirmed by finance. Run after
-- receipts_correction_and_queue.sql. Idempotent; run in order.
--
--   1. Imported Zoho receipts are confirmed (money Zoho already recorded),
--      so history keeps counting once the views change. RUN THIS FIRST.
--   2. Views: received_inr counts confirmed receipts only; awaiting_inr is
--      the recorded-but-unconfirmed money. Replaced in place.
--   3. Trigger: an instalment turns "received" when confirmed receipts cover
--      it — whoever confirms, wherever (one receipt or a batch).
--   4. One-off: instalments the app marked received on an unconfirmed
--      receipt go back to pending.
-- ============================================================


-- ---------- 1. Confirm the imported history (one statement) ----------
-- The SQL editor passes the finance-only check and sends no notifications.
-- "Confirmed by" stays blank: nobody confirmed these in this tool.
with confirmed as (
  update public.fr_remittances
  set confirmed_by_finance = true,
      is_locked            = true,
      confirmed_at         = coalesce(received_date::timestamptz, created_at)
  where notes like '[zoho_remittance:%'
    and not confirmed_by_finance
    and deleted_at is null
  returning 1
)
select count(*) as imported_receipts_confirmed from confirmed;


-- ---------- 2. Views ----------
create or replace view public.v_fr_grant_facts with (security_invoker = on) as
with received as (
  select t.grant_id,
         sum(r.amount_inr) filter (where r.confirmed_by_finance)     as received_inr,
         sum(r.amount_inr) filter (where not r.confirmed_by_finance) as awaiting_inr
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
  b.label                                 as bank_label,
  -- Recorded but not yet confirmed by finance; not part of received_inr.
  coalesce(rc.awaiting_inr, 0)            as awaiting_inr
from public.fr_grants g
left join public.fr_organisations org on org.id = g.organisation_id
left join received rc                 on rc.grant_id = g.id
left join public.employees e          on e.id = g.owner_user_id
left join public.fr_bank_accounts b   on b.id = g.bank_account_id
where g.deleted_at is null;

create or replace view public.v_fr_tranche_facts with (security_invoker = on) as
with received as (
  select r.tranche_id,
         sum(r.amount_inr) filter (where r.confirmed_by_finance)     as received_inr,
         sum(r.amount_inr) filter (where not r.confirmed_by_finance) as awaiting_inr
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
  g.status                                as grant_status,
  coalesce(rc.awaiting_inr, 0)            as awaiting_inr
from public.fr_tranches t
join public.v_fr_grant_facts g on g.id = t.grant_id
left join received rc          on rc.tranche_id = t.id;


-- ---------- 3. Confirmed money settles the instalment ----------
-- Only promotes to received; never demotes. Imported instalments keep the
-- status Zoho gave them (rounding and FX differences would otherwise flip
-- some), so the rule acts on changes made in the app only.
create or replace function public.fr_remittances_settle_tranche()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tranche   uuid := coalesce(new.tranche_id, old.tranche_id);
  v_expected  numeric;
  v_status    text;
  v_confirmed numeric;
begin
  if auth.jwt() ->> 'email' is null then
    return null;
  end if;

  select coalesce(t.amount_inr_expected, t.amount, 0), t.status
    into v_expected, v_status
  from public.fr_tranches t where t.id = v_tranche;

  select coalesce(sum(r.amount_inr), 0) into v_confirmed
  from public.fr_remittances r
  where r.tranche_id = v_tranche and r.deleted_at is null and r.confirmed_by_finance;

  if v_expected > 0 and v_confirmed >= v_expected and v_status is distinct from 'received' then
    update public.fr_tranches
    set status = 'received', updated_by = public.fr_current_employee_id()
    where id = v_tranche;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_fr_remittances_settle_tranche on public.fr_remittances;
create trigger trg_fr_remittances_settle_tranche
  after insert or update or delete on public.fr_remittances
  for each row execute function public.fr_remittances_settle_tranche();


-- ---------- 4. Undo "received" set on unconfirmed money ----------
-- After step 1 the only unconfirmed receipts are ones recorded in the app.
with fixed as (
  update public.fr_tranches t
  set status = 'pending'
  where t.status = 'received'
    and exists (
      select 1 from public.fr_remittances r
      where r.tranche_id = t.id and r.deleted_at is null and not r.confirmed_by_finance
    )
    and coalesce((
      select sum(r.amount_inr) from public.fr_remittances r
      where r.tranche_id = t.id and r.deleted_at is null and r.confirmed_by_finance
    ), 0) < coalesce(t.amount_inr_expected, t.amount, 0)
  returning 1
)
select count(*) as instalments_back_to_pending from fixed;


-- ---------- 5. Verify ----------
-- awaiting should be only what has been recorded in the app and not yet confirmed.
select
  (select count(*) from public.fr_remittances
    where deleted_at is null and not confirmed_by_finance)                 as receipts_awaiting,
  (select coalesce(sum(awaiting_inr), 0) from public.v_fr_grant_facts)     as awaiting_inr,
  (select coalesce(sum(received_inr), 0) from public.v_fr_grant_facts)     as received_inr,
  (select count(*) from pg_trigger
    where tgname = 'trg_fr_remittances_settle_tranche')                    as settle_trigger;

-- =====================================================================
-- Phase 4 — analytics fact views
--
-- The appendix (§11) names these five but only points at
-- fr_v15_dashboard_views.sql for the DDL, which we do not have. This is
-- that DDL, written to the column contract the dashboards code against.
--
-- Idempotent and re-runnable. Run top to bottom: the grant/tranche/
-- remittance views build on each other, so order matters.
--
-- Three rules hold throughout:
--   1. security_invoker = on — RLS on the base tables applies as the
--      CALLING user, so confidential records drop out for non-managers
--      with no extra filtering. Needs Postgres 15+ (Supabase is fine).
--   2. Every view filters `deleted_at is null`. A soft-deleted record that
--      leaks into a view silently inflates every total on every dashboard.
--   3. Overdue is COMPUTED against current_date, never read from a stored
--      status — writing it down would make the row lie as soon as the
--      clock moved.
--
-- Verify AS A SIGNED-IN USER, not in the SQL editor: auth.jwt() ->> 'email'
-- is NULL there, so the access helpers fail closed and every view returns
-- zero rows. That is correct behaviour, not a broken view.
-- =====================================================================

-- ---------- 1. Opportunity facts ----------
-- One row per live opportunity, flattened for grouping by stage, category,
-- owner, geography and fiscal year.
drop view if exists public.v_fr_opportunity_facts cascade;
create view public.v_fr_opportunity_facts with (security_invoker = on) as
select
  o.id,
  o.name,
  o.organisation_id,
  org.name                                as org_name,
  org.donor_type,
  o.stage_id,
  s.key                                   as stage_key,
  s.label                                 as stage_label,
  s.sort_order                            as stage_sort_order,
  s.terminal_type,
  o.capital_category,
  o.deal_category,
  o.opportunity_type,
  o.source_detail,
  o.amount_inr,
  o.probability_pct,
  -- The IA's weighted-pipeline contract: amount x probability.
  round(coalesce(o.amount_inr, 0) * coalesce(o.probability_pct, 0) / 100.0, 2)
                                          as weighted_inr,
  o.expected_close_date,
  o.fiscal_year,
  o.fiscal_quarter,
  o.owner_user_id,
  e.name                                  as owner_name,
  -- The deal's own geography wins; the donor's country is the fallback.
  coalesce(nullif(o.geography, ''), org.geography_country)
                                          as geography,
  (s.is_terminal = false)                 as is_open,
  (s.terminal_type = 'won')               as is_won,
  (s.terminal_type = 'lost')              as is_lost,
  o.is_stale,
  o.last_activity_at
from public.fr_opportunities o
join public.fr_pipeline_stages s  on s.id = o.stage_id
join public.fr_organisations org  on org.id = o.organisation_id
left join public.employees e      on e.id = o.owner_user_id
where o.deleted_at is null
  and org.deleted_at is null;

comment on view public.v_fr_opportunity_facts is
  'One row per opportunity, flattened for dashboard grouping. RLS-aware.';


-- ---------- 2. Opportunity x program facts ----------
-- One row per (opportunity, program) so pipeline can be rolled up by
-- program. An opportunity with no programs attached does NOT appear —
-- summing this view therefore gives less than total pipeline, which is
-- the honest answer to "how much is attributable to a program".
drop view if exists public.v_fr_opportunity_program_facts cascade;
create view public.v_fr_opportunity_program_facts with (security_invoker = on) as
select
  op.id                                   as opportunity_program_id,
  op.opportunity_id,
  op.program_id,
  p.code                                  as program_code,
  p.name                                  as program_name,
  op.project_id,
  pr.code                                 as project_code,
  op.indicative_amount_inr,
  f.amount_inr,
  f.weighted_inr,
  f.capital_category,
  f.deal_category,
  f.fiscal_year,
  f.owner_user_id,
  f.stage_label,
  f.is_open,
  f.is_won,
  f.is_lost
from public.fr_opportunity_programs op
join public.v_fr_opportunity_facts f on f.id = op.opportunity_id
join public.fr_programs p            on p.id = op.program_id
left join public.fr_projects pr      on pr.id = op.project_id;

comment on view public.v_fr_opportunity_program_facts is
  'One row per (opportunity, program) for program rollups. RLS-aware.';


-- ---------- 3. Grant facts ----------
-- One row per grant with its money rolled up. received_inr is summed from
-- the remittances hanging off the grant's tranches — it is not a stored
-- column anywhere, by design.
drop view if exists public.v_fr_grant_facts cascade;
create view public.v_fr_grant_facts with (security_invoker = on) as
with received as (
  select t.grant_id, sum(r.amount_inr) as received_inr
  from public.fr_tranches t
  join public.fr_remittances r on r.tranche_id = t.id
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

comment on view public.v_fr_grant_facts is
  'One row per grant with received/outstanding/collection rolled up. RLS-aware.';


-- ---------- 4. Tranche facts ----------
-- One row per scheduled instalment, for the cash-in calendar and overdue
-- tracking. effective_due_date is the revised date when the tranche has
-- slipped, so the calendar reflects what finance actually expects.
drop view if exists public.v_fr_tranche_facts cascade;
create view public.v_fr_tranche_facts with (security_invoker = on) as
with received as (
  select r.tranche_id, sum(r.amount_inr) as received_inr
  from public.fr_remittances r
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

comment on view public.v_fr_tranche_facts is
  'One row per tranche with received/overdue/due-window flags. RLS-aware.';


-- ---------- 5. Remittance facts ----------
-- One row per receipt, with the bank context the FCRA panel and the
-- data-quality strip need. fcra_mismatch should always be false — the
-- trigger on fr_remittances rejects a mismatch — so any true row means
-- money landed the wrong side of the FCRA line while the guardrail was
-- disabled (as it is during historical migration) and needs correcting.
drop view if exists public.v_fr_remittance_facts cascade;
create view public.v_fr_remittance_facts with (security_invoker = on) as
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
  t.owner_name
from public.fr_remittances r
join public.v_fr_tranche_facts t    on t.id = r.tranche_id
left join public.fr_bank_accounts b on b.id = r.bank_account_id;

comment on view public.v_fr_remittance_facts is
  'One row per remittance with bank/FCRA context and mismatch flag. RLS-aware.';


-- ---------- verify ----------
-- Run these IN THE APP (or as a signed-in user), not in the SQL editor —
-- see the header note. Zero rows in the editor is expected.
--
-- select count(*) from public.v_fr_opportunity_facts;         -- ~997
-- select count(*) from public.v_fr_opportunity_program_facts; -- only linked deals
-- select count(*) from public.v_fr_grant_facts;
-- select count(*) from public.v_fr_tranche_facts;
-- select count(*) from public.v_fr_remittance_facts;
--
-- Weighted pipeline should match the figure in the Pipeline header:
-- select sum(weighted_inr) from public.v_fr_opportunity_facts where is_open;
--
-- Should return no rows — anything here is money on the wrong FCRA side:
-- select id, org_name, bank_label from public.v_fr_remittance_facts where fcra_mismatch;
--
-- Confirm security_invoker actually stuck on all five:
-- select c.relname, c.reloptions
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname like 'v_fr_%';

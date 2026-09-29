-- =====================================================================
-- Throwaway: removes the record Claude created while verifying phase 3.
-- Run once, then delete this file. Safe to skip — the data is harmless,
-- just clutter on the Boeing organisation.
--
-- Scoped entirely to the one opportunity named below, so it cannot touch
-- anything real. Hard deletes rather than soft, because this data should
-- leave no trace at all — the usual soft-delete rule is about protecting
-- the team's records, not test rows.
-- =====================================================================

begin;

with test_opp as (
  select id from public.fr_opportunities
  where name = 'ZZ TEST — won wizard verification (delete me)'
),
test_grant as (
  select g.id from public.fr_grants g join test_opp o on o.id = g.opportunity_id
),
-- The remittance was confirmed and locked during the test, so clear the
-- lock before anything tries to remove it.
unlocked as (
  update public.fr_remittances r set is_locked = false
  where r.tranche_id in (
    select t.id from public.fr_tranches t where t.grant_id in (select id from test_grant)
  )
  returning r.id
)
select count(*) as unlocked_receipts from unlocked;

-- Children first: allocations, tranches (remittances cascade), compliance.
delete from public.fr_grant_allocations
where grant_id in (
  select g.id from public.fr_grants g
  join public.fr_opportunities o on o.id = g.opportunity_id
  where o.name = 'ZZ TEST — won wizard verification (delete me)');

delete from public.fr_tranches
where grant_id in (
  select g.id from public.fr_grants g
  join public.fr_opportunities o on o.id = g.opportunity_id
  where o.name = 'ZZ TEST — won wizard verification (delete me)');

delete from public.fr_compliance_milestones
where grant_id in (
  select g.id from public.fr_grants g
  join public.fr_opportunities o on o.id = g.opportunity_id
  where o.name = 'ZZ TEST — won wizard verification (delete me)');

delete from public.fr_compliance_report_periods
where grant_id in (
  select g.id from public.fr_grants g
  join public.fr_opportunities o on o.id = g.opportunity_id
  where o.name = 'ZZ TEST — won wizard verification (delete me)');

-- Break the opportunity -> grant back-reference before dropping the grant.
update public.fr_opportunities
set won_grant_id = null
where name = 'ZZ TEST — won wizard verification (delete me)';

delete from public.fr_grants
where opportunity_id in (
  select id from public.fr_opportunities
  where name = 'ZZ TEST — won wizard verification (delete me)');

delete from public.fr_opportunity_stage_history
where opportunity_id in (
  select id from public.fr_opportunities
  where name = 'ZZ TEST — won wizard verification (delete me)');

delete from public.fr_opportunities
where name = 'ZZ TEST — won wizard verification (delete me)';

commit;

-- Should return 0.
-- select count(*) from public.fr_opportunities
-- where name = 'ZZ TEST — won wizard verification (delete me)';

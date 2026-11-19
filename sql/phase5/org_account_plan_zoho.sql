-- ============================================================
-- Account plan: the donor's CSR budget as a range ("11 Cr – 50 Cr"), for
-- organisations where Zoho had a range but no exact figure. Shown on the
-- wallet-share chart until someone enters the budget. Idempotent.
--
-- Run this before scripts/zoho_account_plan_backfill.sql (generated locally
-- from the Zoho exports by scripts/zohoAccountPlanBackfill.mjs).
-- ============================================================

alter table public.fr_org_account_plans
  add column if not exists csr_budget_range text;

-- Verify: expect 1.
select count(*) from information_schema.columns
where table_name = 'fr_org_account_plans' and column_name = 'csr_budget_range';

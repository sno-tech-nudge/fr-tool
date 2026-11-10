-- Organisation account plan: an editable "Partner since". Blank means the
-- Overview works it out from the first grant or won deal. Idempotent.
alter table public.fr_org_account_plans
  add column if not exists partner_since date;

-- Verify: expect 1.
select count(*) from information_schema.columns
where table_name = 'fr_org_account_plans' and column_name = 'partner_since';

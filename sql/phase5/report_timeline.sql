-- ============================================================================
-- Report timeline: files uploaded against a grant's reports
-- ============================================================================
-- The grant's Reports tab is one timeline: each row is a report due (a
-- milestone), usually sitting in its own period (From–To). "Upload report"
-- stores the file once as a Report document on the deal, linked to the grant,
-- the period and the report itself, so it shows on the Reports tab and on the
-- deal's Documents tab alike.
-- Idempotent; run block by block.

-- Block 1: which report a document belongs to -------------------------------
alter table public.fr_documents
  add column if not exists milestone_id uuid references public.fr_compliance_milestones(id) on delete set null;
create index if not exists fr_documents_milestone_idx on public.fr_documents (milestone_id)
  where milestone_id is not null;

-- Block 2: monthly and every-2-months timelines -----------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.fr_compliance_report_periods'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reporting_frequency%'
  loop
    execute format('alter table public.fr_compliance_report_periods drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.fr_compliance_report_periods
  add constraint fr_report_periods_frequency_check check (
    reporting_frequency is null or reporting_frequency in
      ('monthly', 'bi_monthly', 'quarterly', 'half_yearly', 'bi_annually', 'annually', 'ad_hoc'));

-- Block 3: check -------------------------------------------------------------
select column_name from information_schema.columns
where table_name = 'fr_documents' and column_name = 'milestone_id';            -- 1 row
select conname, pg_get_constraintdef(oid) from pg_constraint
where conname = 'fr_report_periods_frequency_check';                            -- includes monthly

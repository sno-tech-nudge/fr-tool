-- =====================================================================
-- PHASE 0 / 07 — Verification
-- =====================================================================
-- Run each block and eyeball the result. Nothing here mutates anything
-- (BLOCK 5 mutates inside a transaction it then rolls back).
--
-- WHAT THIS CAN AND CANNOT PROVE
--   The SQL editor connects as the table owner, so RLS is BYPASSED here.
--   These blocks therefore verify the LOGIC of the three helper functions,
--   not that the policies bite. Real proof is a signed-in browser session
--   returning the right rows.
--
--   auth.jwt() reads the `request.jwt.claims` GUC, so we can impersonate an
--   email in the editor with set_config(). That is the trick that makes the
--   "NULL email in the SQL editor" problem tractable.
-- =====================================================================

-- ---------- BLOCK 1: object inventory ----------
-- Expect 14 fr_* tables + employees.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       count(p.polname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
  and (c.relname like 'fr\_%' or c.relname = 'employees')
group by 1, 2
order by 1;

-- Expect 7 functions: fr_set_updated_at, fr_fiscal_year, fr_fiscal_quarter,
-- is_fr_authorised, is_fr_manager, fr_can_see_record, fr_current_employee_id.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'fr\_%' or p.proname like 'is\_fr\_%')
order by 1;

-- ---------- BLOCK 2: seed counts ----------
-- Expect 3, 10, 12, 1, 7, 9, 7, 7, 7, 8, 6, 8
select
  (select count(*) from public.fr_capital_categories)  as capital_categories,
  (select count(*) from public.fr_pipeline_stages)     as pipeline_stages,
  (select count(*) from public.fr_programs)            as programs,
  (select count(*) from public.fr_projects)            as projects,
  (select count(*) from public.fr_lead_sources)        as lead_sources,
  (select count(*) from public.fr_loss_reasons)        as loss_reasons,
  (select count(*) from public.fr_bank_accounts)       as bank_accounts,
  (select count(*) from public.fr_currencies)          as currencies,
  (select count(*) from public.fr_fx_rates)            as fx_rates,
  (select count(*) from public.fr_milestone_types)     as milestone_types,
  (select count(*) from public.fr_milestone_templates) as milestone_templates,
  (select count(*) from public.fr_settings)            as settings;

-- Critical invariants: exactly 2 FCRA accounts, exactly 1 won and 1 lost stage,
-- and no stage left with a null colour (the Kanban needs them).
select (select count(*) from public.fr_bank_accounts where is_fcra)                  as fcra_accounts,
       (select count(*) from public.fr_pipeline_stages where terminal_type = 'won')  as won_stages,
       (select count(*) from public.fr_pipeline_stages where terminal_type = 'lost') as lost_stages,
       (select count(*) from public.fr_pipeline_stages where color is null)          as stages_missing_colour;

-- The stage ladder, in board order.
select sort_order, key, label, probability_pct, terminal_type, color
from public.fr_pipeline_stages order by sort_order;

-- ---------- BLOCK 3: fiscal year / quarter ----------
-- Expect: FY 2026-27 Q2 | FY 2026-27 Q4 | FY 2025-26 Q4 | FY 2026-27 Q1 | FY 2026-27 Q3
select d,
       public.fr_fiscal_year(d)    as fy,
       public.fr_fiscal_quarter(d) as fq
from (values (date '2026-09-15'), (date '2027-02-10'), (date '2026-03-31'),
             (date '2026-04-01'), (date '2026-12-31')) v(d);

-- ---------- BLOCK 4: access helpers, by impersonated email ----------
-- Baseline: no JWT at all. Expect false / false / null — this is exactly what
-- you would see running the helpers cold in the editor.
select set_config('request.jwt.claims', '', false);
select 'no jwt' as persona, public.is_fr_authorised() as authorised,
       public.is_fr_manager() as manager, public.fr_current_employee_id() as employee_id;

-- The solo builder — super_admin, full access. Expect true / true / <uuid>
select set_config('request.jwt.claims', '{"email":"achintya.rao@thenudge.org"}', false);
select 'super_admin (solo)' as persona, public.is_fr_authorised() as authorised,
       public.is_fr_manager() as manager, public.fr_current_employee_id() as employee_id;

-- Case-insensitivity must hold (identity is matched on lower(email)).
select set_config('request.jwt.claims', '{"email":"ACHINTYA.RAO@ThenUdge.ORG"}', false);
select 'super_admin, mixed case' as persona, public.is_fr_authorised() as authorised,
       public.is_fr_manager() as manager;

-- A stranger. Expect false / false / null — fails closed.
select set_config('request.jwt.claims', '{"email":"nobody@example.com"}', false);
select 'stranger' as persona, public.is_fr_authorised() as authorised,
       public.is_fr_manager() as manager, public.fr_current_employee_id() as employee_id;

-- ---------- BLOCK 5: fr_can_see_record — the confidentiality gate ----------
-- Only one real employee exists right now (achintya.rao, super_admin), which
-- can't exercise "a plain member is blocked from someone else's confidential
-- record" — a manager sees everything by definition. So this block creates
-- TWO throwaway employees (a plain member + "someone else") inside a
-- transaction that is ROLLED BACK at the end, leaving no trace in real data.
-- Run the whole block in one go.
begin;

  insert into public.employees (email, name, erp_role, is_active) values
    ('phase0.test.member@thenudge.org', 'Phase 0 Test Member', 'member', true),
    ('phase0.test.other@thenudge.org',  'Phase 0 Test Other',  'member', true)
  on conflict (email) do nothing;

  insert into public.fr_team_members (user_id, fr_sub_role, is_active)
  select id, 'member', true from public.employees
  where email = 'phase0.test.member@thenudge.org'
  on conflict (user_id) do nothing;

  -- As a plain FR member.
  -- Expect: authorised true, manager FALSE,
  --   non-confidential            -> true
  --   confidential, owned by them -> true
  --   confidential, owned by other-> FALSE   <- the row that matters
  select set_config('request.jwt.claims', '{"email":"phase0.test.member@thenudge.org"}', false);
  select 'fr member' as persona,
         public.is_fr_authorised() as authorised,
         public.is_fr_manager()    as manager,
         public.fr_can_see_record(false, null)                                   as sees_public,
         public.fr_can_see_record(true,  public.fr_current_employee_id())        as sees_own_confidential,
         public.fr_can_see_record(true,  (select id from public.employees
                                          where email = 'phase0.test.other@thenudge.org')) as sees_others_confidential;

  -- As the super_admin: must see everything, including someone else's confidential row.
  select set_config('request.jwt.claims', '{"email":"achintya.rao@thenudge.org"}', false);
  select 'super_admin' as persona,
         public.fr_can_see_record(false, null)                                as sees_public,
         public.fr_can_see_record(true,  (select id from public.employees
                                          where email = 'phase0.test.other@thenudge.org')) as sees_others_confidential;

  -- A stranger sees nothing, confidential or not.
  select set_config('request.jwt.claims', '{"email":"nobody@example.com"}', false);
  select 'stranger' as persona,
         public.fr_can_see_record(false, null) as sees_public,
         public.fr_can_see_record(true,  null) as sees_confidential;

rollback;

-- ---------- BLOCK 6: reset the impersonation ----------
select set_config('request.jwt.claims', '', false);

-- ---------- BLOCK 7: who has FR access right now ----------
select e.email, e.name, e.erp_role, e.managed_module, t.fr_sub_role, e.is_active
from public.employees e
left join public.fr_team_members t on t.user_id = e.id and t.is_active and t.deleted_at is null
order by e.erp_role, e.email;

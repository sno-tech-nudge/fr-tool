-- =====================================================================
-- PHASE 0 / 06 — RLS policies and updated_at triggers
-- =====================================================================
-- Policy shape for config/picklist tables:
--     SELECT -> is_fr_authorised()      (anyone who may use the module)
--     WRITE  -> is_fr_manager()         (only FR managers edit reference data)
--
-- Entity tables (Phase 1 onward) use a different shape: SELECT gated by
-- fr_can_see_record(), writes by owner-or-manager. Not needed yet.
--
-- !! Remember: auth.jwt() ->> 'email' is NULL in the SQL editor, so every
--    policy here evaluates FALSE for you in the editor. That is correct
--    behaviour, not a bug. Verify in the app (or impersonate — see 07).
-- =====================================================================

-- ---------- BLOCK 1: enable RLS + the two standard policies ----------
do $$
declare
  t text;
  config_tables text[] := array[
    'fr_pipeline_stages',
    'fr_capital_categories',
    'fr_programs',
    'fr_projects',
    'fr_lead_sources',
    'fr_loss_reasons',
    'fr_bank_accounts',
    'fr_currencies',
    'fr_fx_rates',
    'fr_milestone_types',
    'fr_milestone_templates',
    'fr_settings',
    'fr_targets',
    'fr_team_members'
  ];
begin
  foreach t in array config_tables loop
    execute format('alter table public.%I enable row level security', t);

    -- Read: any authorised FR user.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (public.is_fr_authorised())
    $f$, t || '_select', t);

    -- Write: FR managers only. USING gates update/delete, WITH CHECK gates
    -- insert/update — both are required or inserts silently fail.
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (public.is_fr_manager())
        with check (public.is_fr_manager())
    $f$, t || '_write', t);

    -- Supabase sets these by default for new tables, but be explicit so the
    -- schema is not dependent on project-level default privileges.
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant select on public.employees to authenticated;

-- ---------- BLOCK 2: updated_at triggers ----------
-- Only the tables that actually carry an updated_at column.
do $$
declare
  t text;
  touched_tables text[] := array[
    'fr_pipeline_stages',
    'fr_programs',
    'fr_settings',
    'fr_targets',
    'fr_team_members',
    'employees'
  ];
begin
  foreach t in array touched_tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format($f$
      create trigger %I before update on public.%I
        for each row execute function public.fr_set_updated_at()
    $f$, t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------- VERIFY ----------
-- Every fr_* table should report rowsecurity = true and 2 policies.
-- select c.relname                                  as table_name,
--        c.relrowsecurity                           as rls_enabled,
--        count(p.polname)                           as policy_count
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- left join pg_policy p on p.polrelid = c.oid
-- where n.nspname = 'public' and c.relkind = 'r'
--   and (c.relname like 'fr_%' or c.relname = 'employees')
-- group by 1, 2 order by 1;

-- Triggers should be 6.
-- select tgrelid::regclass as table_name, tgname
-- from pg_trigger
-- where not tgisinternal and tgname like '%_set_updated_at'
-- order by 1;

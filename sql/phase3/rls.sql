-- =====================================================================
-- Phase 3 RLS — grants, allocations, tranches, remittances, compliance
--
-- Idempotent and re-runnable. Every policy carries BOTH `using` and
-- `with check`: a `for all` policy without `with check` reads fine but
-- rejects every INSERT with "new row violates row-level security policy",
-- which is the failure this file exists to prevent (it bit phase 1 and
-- phase 2 the same way).
--
-- Shape follows the appendix: SELECT gated by fr_can_see_record() on the
-- record's own (is_confidential, owner_user_id), or on its parent grant's
-- for child tables; writes allowed to the owner, any authorised FR user,
-- or a manager. Remittance UPDATE is additionally blocked once locked.
-- =====================================================================

-- ---------- fr_grants ----------
alter table public.fr_grants enable row level security;

drop policy if exists fr_grants_select on public.fr_grants;
create policy fr_grants_select on public.fr_grants
  for select using (
    deleted_at is null
    and public.fr_can_see_record(is_confidential, owner_user_id)
  );

drop policy if exists fr_grants_write on public.fr_grants;
create policy fr_grants_write on public.fr_grants
  for all using (
    public.is_fr_manager()
    -- Identity resolves by EMAIL from the JWT, never by auth.uid().
    or owner_user_id = (
      select e.id from public.employees e
      where lower(e.email) = lower(auth.jwt() ->> 'email') limit 1)
    or public.is_fr_authorised()
  ) with check (public.is_fr_authorised());

-- ---------- fr_grant_allocations (walks to the parent grant) ----------
alter table public.fr_grant_allocations enable row level security;

drop policy if exists fr_grant_allocations_select on public.fr_grant_allocations;
create policy fr_grant_allocations_select on public.fr_grant_allocations
  for select using (
    exists (
      select 1 from public.fr_grants g
      where g.id = grant_id
        and g.deleted_at is null
        and public.fr_can_see_record(g.is_confidential, g.owner_user_id)
    )
  );

drop policy if exists fr_grant_allocations_write on public.fr_grant_allocations;
create policy fr_grant_allocations_write on public.fr_grant_allocations
  for all using (public.is_fr_authorised())
  with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_grants g where g.id = grant_id)
  );

-- ---------- fr_tranches ----------
alter table public.fr_tranches enable row level security;

drop policy if exists fr_tranches_select on public.fr_tranches;
create policy fr_tranches_select on public.fr_tranches
  for select using (
    exists (
      select 1 from public.fr_grants g
      where g.id = grant_id
        and g.deleted_at is null
        and public.fr_can_see_record(g.is_confidential, g.owner_user_id)
    )
  );

drop policy if exists fr_tranches_write on public.fr_tranches;
create policy fr_tranches_write on public.fr_tranches
  for all using (public.is_fr_authorised())
  with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_grants g where g.id = grant_id)
  );

-- ---------- fr_remittances ----------
-- Split rather than `for all`, because UPDATE alone must respect the lock.
alter table public.fr_remittances enable row level security;

drop policy if exists fr_remittances_select on public.fr_remittances;
create policy fr_remittances_select on public.fr_remittances
  for select using (
    exists (
      select 1 from public.fr_tranches t join public.fr_grants g on g.id = t.grant_id
      where t.id = tranche_id
        and g.deleted_at is null
        and public.fr_can_see_record(g.is_confidential, g.owner_user_id)
    )
  );

drop policy if exists fr_remittances_insert on public.fr_remittances;
create policy fr_remittances_insert on public.fr_remittances
  for insert with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_tranches t where t.id = tranche_id)
  );

-- Confirm & Lock: once is_locked the row is immutable, so the OLD row must be
-- unlocked for the update to be allowed at all. Unlocking is deliberately not
-- possible from the app — a manager does it directly in SQL.
drop policy if exists fr_remittances_update on public.fr_remittances;
create policy fr_remittances_update on public.fr_remittances
  for update using (
    public.is_fr_authorised() and is_locked = false
  ) with check (public.is_fr_authorised());

drop policy if exists fr_remittances_delete on public.fr_remittances;
create policy fr_remittances_delete on public.fr_remittances
  for delete using (public.is_fr_authorised() and is_locked = false);

-- ---------- fr_compliance_report_periods ----------
alter table public.fr_compliance_report_periods enable row level security;

drop policy if exists fr_report_periods_select on public.fr_compliance_report_periods;
create policy fr_report_periods_select on public.fr_compliance_report_periods
  for select using (
    deleted_at is null
    and exists (
      select 1 from public.fr_grants g
      where g.id = grant_id
        and g.deleted_at is null
        and public.fr_can_see_record(g.is_confidential, g.owner_user_id)
    )
  );

drop policy if exists fr_report_periods_write on public.fr_compliance_report_periods;
create policy fr_report_periods_write on public.fr_compliance_report_periods
  for all using (public.is_fr_authorised())
  with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_grants g where g.id = grant_id)
  );

-- ---------- fr_compliance_milestones ----------
alter table public.fr_compliance_milestones enable row level security;

drop policy if exists fr_milestones_select on public.fr_compliance_milestones;
create policy fr_milestones_select on public.fr_compliance_milestones
  for select using (
    deleted_at is null
    and exists (
      select 1 from public.fr_grants g
      where g.id = grant_id
        and g.deleted_at is null
        and public.fr_can_see_record(g.is_confidential, g.owner_user_id)
    )
  );

drop policy if exists fr_milestones_write on public.fr_compliance_milestones;
create policy fr_milestones_write on public.fr_compliance_milestones
  for all using (public.is_fr_authorised())
  with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_grants g where g.id = grant_id)
  );

-- ---------- verify ----------
-- Every table below should report both a USING and a WITH CHECK where the
-- command allows one. A `for all` row with null with_check is the bug.
-- select tablename, policyname, cmd,
--        qual is not null as has_using,
--        with_check is not null as has_with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('fr_grants','fr_grant_allocations','fr_tranches',
--                     'fr_remittances','fr_compliance_report_periods',
--                     'fr_compliance_milestones')
-- order by tablename, cmd;

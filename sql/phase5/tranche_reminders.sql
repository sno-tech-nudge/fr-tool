-- ============================================================
-- Instalment reminders (IA §8: T-30, T-7, overdue; at risk after 15 days).
-- A daily job adds in-app notifications; nothing is emailed. Idempotent.
--
--   1. Settings   the on/off switch (OFF), and how far back overdue counts
--   2. Function   fr_run_tranche_reminders(): one pass; safe to rerun
--   3. Schedule   daily at 09:15 IST — it does nothing while switched off
--
-- Who hears what:
--   30 days before                     the grant owner
--   7 days before, overdue, at risk    the grant owner and finance
-- Each instalment gets each reminder once per due date (a revised date starts
-- again). Skipped: instalments already covered by recorded receipts (even if
-- finance has not confirmed them), grants that are not active, and anything
-- overdue for longer than the lookback (default 90 days), so switching it on
-- does not flood everyone with imported history. People who turned off
-- "Instalments due" in their notification settings are skipped too.
-- ============================================================


-- ---------- 1. Settings ----------
-- reminder_offset_days ([30, 7]) and tranche_at_risk_days (15) already exist
-- from the Phase 0 seed; Configuration → Notifications edits all four.
insert into public.fr_settings (key, value, description) values
  ('tranche_reminders_enabled', 'false'::jsonb, 'Send daily instalment reminders'),
  ('tranche_reminder_lookback_days', '90'::jsonb, 'Instalments overdue for longer than this get no reminders')
on conflict (key) do nothing;


-- ---------- 2. One pass ----------
create or replace function public.fr_run_tranche_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
  v_on boolean;
begin
  -- The scheduler has no JWT; a signed-in caller must be an FR manager.
  if auth.jwt() ->> 'email' is not null and not public.is_fr_manager() then
    raise exception 'Only an FR manager can run instalment reminders.';
  end if;

  select coalesce((select value = 'true'::jsonb from fr_settings where key = 'tranche_reminders_enabled'), false)
    into v_on;
  if not v_on then
    if auth.jwt() ->> 'email' is not null then
      raise exception 'Instalment reminders are switched off.';
    end if;
    return 0;
  end if;

  with cfg as (
    select
      coalesce((select (value ->> 0)::int from fr_settings where key = 'reminder_offset_days'), 30)        as far_days,
      coalesce((select (value ->> 1)::int from fr_settings where key = 'reminder_offset_days'), 7)         as near_days,
      coalesce((select (value #>> '{}')::int from fr_settings where key = 'tranche_at_risk_days'), 15)     as risk_days,
      coalesce((select (value #>> '{}')::int from fr_settings where key = 'tranche_reminder_lookback_days'), 90) as lookback_days
  ),
  due as (
    select t.id as tranche_id, t.grant_id, t.sequence_no, g.owner_user_id, o.name as org_name,
           coalesce(t.revised_expected_date, t.due_date) as due_on,
           coalesce(t.amount_inr_expected, t.amount, 0)  as expected,
           coalesce((select sum(r.amount_inr) from fr_remittances r
                     where r.tranche_id = t.id and r.deleted_at is null), 0) as recorded
    from fr_tranches t
    join fr_grants g on g.id = t.grant_id
    left join fr_organisations o on o.id = g.organisation_id
    where t.status not in ('received', 'cancelled')
      and g.deleted_at is null
      and g.status = 'active'
  ),
  staged as (
    select d.*, (d.due_on - current_date) as days_left,
      case
        when d.due_on - current_date between 0 and c.near_days                     then 'near'
        when d.due_on - current_date between c.near_days + 1 and c.far_days        then 'far'
        when current_date - d.due_on between 1 and c.risk_days                     then 'overdue'
        when current_date - d.due_on between c.risk_days + 1 and c.lookback_days   then 'at_risk'
      end as stage
    from due d cross join cfg c
    where d.due_on is not null and d.recorded < d.expected
  )
  insert into fr_notifications
    (recipient_user_id, category, severity, title, body, parent_type, parent_id, external_ref)
  select distinct on (s.tranche_id, r.employee_id)
         r.employee_id,
         'tranche_due',
         case s.stage when 'far' then 'info' when 'at_risk' then 'red' else 'amber' end,
         case s.stage
           when 'far'     then format('Instalment due in %s days: %s', s.days_left, coalesce(s.org_name, 'grant'))
           when 'near'    then case when s.days_left = 0 then format('Instalment due today: %s', coalesce(s.org_name, 'grant'))
                                    else format('Instalment due in %s days: %s', s.days_left, coalesce(s.org_name, 'grant')) end
           when 'overdue' then format('Instalment overdue: %s', coalesce(s.org_name, 'grant'))
           else                format('Instalment at risk: %s', coalesce(s.org_name, 'grant'))
         end,
         format('₹%s outstanding · instalment %s · due %s',
                to_char(s.expected - s.recorded, 'FM99,99,99,99,999'), s.sequence_no, to_char(s.due_on, 'DD Mon YYYY')),
         'grant',
         s.grant_id,
         format('tranche:%s:%s:%s:%s', s.tranche_id, s.stage, s.due_on, r.employee_id)
  from staged s
  cross join lateral (
    select s.owner_user_id
    union
    select ftm.user_id
    from fr_team_members ftm
    join employees e on e.id = ftm.user_id
    where s.stage <> 'far'
      and ftm.fr_sub_role = 'finance' and ftm.is_active and ftm.deleted_at is null and e.is_active
  ) as r(employee_id)
  left join fr_notification_preferences p
    on p.employee_id = r.employee_id and p.category = 'tranche_due' and p.deleted_at is null
  where s.stage is not null
    and r.employee_id is not null
    and coalesce(p.in_app, true)
  order by s.tranche_id, r.employee_id
  on conflict do nothing;

  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke execute on function public.fr_run_tranche_reminders() from public, anon;
grant  execute on function public.fr_run_tranche_reminders() to authenticated;


-- ---------- 3. Daily at 09:15 IST (it returns at once while switched off) ----------
select cron.unschedule(jobid) from cron.job where jobname = 'fr-tranche-reminders';
select cron.schedule('fr-tranche-reminders', '45 3 * * *', $$select public.fr_run_tranche_reminders()$$);


-- ---------- 4. Verify ----------
-- Expect: the switch false, the job scheduled.
select
  (select value from public.fr_settings where key = 'tranche_reminders_enabled') as reminders_on,
  (select count(*) from cron.job where jobname = 'fr-tranche-reminders')         as scheduled_job;

-- Before switching on, see how many would go out today:
-- select count(*) from fr_tranches t join fr_grants g on g.id = t.grant_id
-- where t.status not in ('received','cancelled') and g.status = 'active' and g.deleted_at is null
--   and coalesce(t.revised_expected_date, t.due_date) between current_date - 90 and current_date + 30;

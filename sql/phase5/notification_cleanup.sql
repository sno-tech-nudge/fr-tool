-- ============================================================================
-- Notification cleanup: delete notifications read or dismissed > 30 days ago
-- ============================================================================
-- Applies to the bell (mentions) and the Home list alike. Idempotent: re-run
-- freely. Run block by block.
--
-- One guard: instalment reminders dedupe on external_ref
-- ('tranche:<id>:<stage>:<due_on>:<employee>'). Deleting one while its stage
-- still applies would let tomorrow's run raise it again, so those wait until
-- the instalment is past the reminder lookback (due date + lookback days).
-- Stage nudges re-fire on their own ~15-day cycle regardless, and mentions,
-- receipts and handovers are raised once by an event, so none of them come
-- back when deleted.

-- Block 1: the cleanup function -------------------------------------------
create or replace function public.fr_cleanup_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff   timestamptz := now() - interval '30 days';
  v_lookback int := coalesce(
    (select (value #>> '{}')::int from fr_settings where key = 'tranche_reminder_lookback_days'), 90);
  v_deleted  int;
begin
  delete from fr_notifications n
  where (n.read_at < v_cutoff or n.dismissed_at < v_cutoff)
    and (
      n.category <> 'tranche_due'
      or (
        n.external_ref ~ '^tranche:[^:]+:[^:]+:\d{4}-\d{2}-\d{2}:'
        and split_part(n.external_ref, ':', 4)::date + v_lookback < current_date
      )
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Only the scheduler runs it.
revoke all on function public.fr_cleanup_notifications() from public, anon, authenticated;

-- Block 2: schedule daily at 04:15 UTC (re-runnable) ------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'fr-notification-cleanup') then
    perform cron.unschedule('fr-notification-cleanup');
  end if;
  perform cron.schedule('fr-notification-cleanup', '15 4 * * *', 'select public.fr_cleanup_notifications()');
end $$;

-- Block 3: check ----------------------------------------------------------
-- Roughly how many are old enough (ignores the instalment guard; deletes nothing):
select count(*) as would_delete_today
from fr_notifications
where (read_at < now() - interval '30 days' or dismissed_at < now() - interval '30 days');

select jobname, schedule, command from cron.job where jobname = 'fr-notification-cleanup';

-- ============================================================================
-- Collaborators as extra owners
-- ============================================================================
-- A deal's collaborators (fr_opportunity_collaborators) act as extra owners:
--   1. they can see the deal even when it is confidential
--   2. every reminder raised about the deal for someone else (stage nudges,
--      instalments due, reports due) is copied to each collaborator
-- The "Owner: me" filter on Deals also includes them (app side).
--
-- Built without touching the existing access policies or the nightly jobs:
-- (1) is an extra, additive policy and (2) a trigger on fr_notifications.
-- Idempotent; run block by block.

-- Block 1: is the signed-in person a collaborator on this deal? ---------------
-- Security definer, so the policy below never recurses through the
-- collaborators table's own policies.
create or replace function public.fr_is_collaborator(p_opportunity_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fr_opportunity_collaborators c
    where c.opportunity_id = p_opportunity_id
      and c.user_id = public.fr_current_employee_id()
  )
$$;
grant execute on function public.fr_is_collaborator(uuid) to authenticated;

-- Block 2: collaborators see the deal, confidential or not ------------------
-- Permissive policies add up, so this only widens access for collaborators.
drop policy if exists fr_opportunities_select_collaborator on public.fr_opportunities;
create policy fr_opportunities_select_collaborator on public.fr_opportunities
  for select using (public.is_fr_authorised() and public.fr_is_collaborator(id));

-- Block 3: copy deal reminders to its collaborators -------------------------
create or replace function public.fr_notify_collaborators()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal uuid;
begin
  -- Copies never fan out again.
  if new.external_ref like 'collab:%' then return new; end if;
  if new.category not in ('stage_nudge', 'tranche_due', 'report_due') then return new; end if;

  v_deal := case new.parent_type
    when 'opportunity' then new.parent_id
    when 'grant' then (select g.opportunity_id from fr_grants g where g.id = new.parent_id)
  end;
  if v_deal is null then return new; end if;

  insert into fr_notifications
    (recipient_user_id, category, severity, title, body, parent_type, parent_id, external_ref)
  select c.user_id, new.category, new.severity, new.title, new.body, new.parent_type, new.parent_id,
         -- One copy per collaborator, per reminder kind, per record, per day.
         format('collab:%s:%s:%s:%s', new.category, new.parent_id, current_date, c.user_id)
  from fr_opportunity_collaborators c
  join employees e on e.id = c.user_id and e.is_active
  where c.opportunity_id = v_deal
    and c.user_id is distinct from new.recipient_user_id
    and not exists (
      select 1 from fr_notification_preferences p
      where p.employee_id = c.user_id and p.category = new.category and p.in_app = false
    )
    and not exists (
      select 1 from fr_notifications n
      where n.external_ref = format('collab:%s:%s:%s:%s', new.category, new.parent_id, current_date, c.user_id)
    )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_fr_notify_collaborators on public.fr_notifications;
create trigger trg_fr_notify_collaborators
  after insert on public.fr_notifications
  for each row execute function public.fr_notify_collaborators();

-- Block 4: check -------------------------------------------------------------
select tgname from pg_trigger where tgname = 'trg_fr_notify_collaborators';     -- 1 row
select policyname from pg_policies
where tablename = 'fr_opportunities' and policyname = 'fr_opportunities_select_collaborator';  -- 1 row

-- ============================================================================
-- Escalation timelines per track: Hunting (NBD) and PM
-- ============================================================================
-- fr_stage_escalations gets one row per stage per track. A deal is checked
-- against its own track's thresholds; a deal with no NBD/PM set counts as
-- Hunting. PM starts as a copy of today's timelines, to be edited in
-- Configuration → Notifications.
-- Idempotent; run block by block.

-- Block 1: the track column ------------------------------------------------
alter table public.fr_stage_escalations
  add column if not exists deal_category text not null default 'NBD';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'fr_stage_escalations_deal_category_check') then
    alter table public.fr_stage_escalations
      add constraint fr_stage_escalations_deal_category_check check (deal_category in ('NBD', 'PM'));
  end if;
end $$;

-- Block 2: one row per stage per track (was one per stage) -----------------
-- Drops whatever made stage_id unique on its own, then keys on both.
do $$
declare r record; v_had_pk boolean := false;
begin
  for r in
    select c.conname, c.contype from pg_constraint c
    where c.conrelid = 'public.fr_stage_escalations'::regclass and c.contype in ('u', 'p')
      and c.conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.fr_stage_escalations'::regclass and attname = 'stage_id')]::int2[]
  loop
    if r.contype = 'p' then v_had_pk := true; end if;
    execute format('alter table public.fr_stage_escalations drop constraint %I', r.conname);
  end loop;

  for r in
    select i.indexrelid::regclass::text as idx from pg_index i
    where i.indrelid = 'public.fr_stage_escalations'::regclass and i.indisunique
      and i.indkey::text = (select attnum::text from pg_attribute
                            where attrelid = 'public.fr_stage_escalations'::regclass and attname = 'stage_id')
  loop
    execute format('drop index %s', r.idx);
  end loop;

  if v_had_pk and not exists (select 1 from pg_attribute
                              where attrelid = 'public.fr_stage_escalations'::regclass and attname = 'id' and not attisdropped) then
    alter table public.fr_stage_escalations add column id uuid not null default gen_random_uuid() primary key;
  end if;
end $$;

create unique index if not exists fr_stage_escalations_stage_track_key
  on public.fr_stage_escalations (stage_id, deal_category);

-- Block 3: PM starts as a copy of today's timelines -------------------------
insert into public.fr_stage_escalations
  (stage_id, deal_category, amber_days, amber_notify, red_days, red_notify)
select e.stage_id, 'PM', e.amber_days, e.amber_notify, e.red_days, e.red_notify
from public.fr_stage_escalations e
where e.deal_category = 'NBD' and e.deleted_at is null
  and not exists (select 1 from public.fr_stage_escalations p
                  where p.stage_id = e.stage_id and p.deal_category = 'PM');

-- Block 4: each deal is checked against its own track ----------------------
-- Same columns in the same order as before, with deal_category added last.
create or replace view public.fr_v_deal_staleness with (security_invoker = on) as
with d as (
  select o.id as opportunity_id, o.name, o.stage_id, o.owner_user_id, o.pre_sales_rep_user_id,
         s.label as stage_label,
         coalesce((select max(h.changed_at) from public.fr_opportunity_stage_history h
                   where h.opportunity_id = o.id and h.to_stage_id = o.stage_id),
                  o.created_at) as entered_at,
         o.last_activity_at,
         coalesce(o.deal_category, 'NBD') as deal_category
  from public.fr_opportunities o
  join public.fr_pipeline_stages s on s.id = o.stage_id
  where o.deleted_at is null and s.terminal_type is null
)
select d.opportunity_id, d.name, d.stage_id, d.owner_user_id, d.pre_sales_rep_user_id,
       d.stage_label, d.entered_at, d.last_activity_at,
       e.amber_days, e.red_days, e.amber_notify, e.red_notify, i.idle_days,
       case when e.red_days   is not null and i.idle_days >= e.red_days   then 'red'
            when e.amber_days is not null and i.idle_days >= e.amber_days then 'amber'
       end as level,
       d.deal_category
from d
join public.fr_stage_escalations e
  on e.stage_id = d.stage_id and e.deal_category = d.deal_category
 and e.is_active and e.deleted_at is null
cross join lateral (
  select current_date - greatest(d.entered_at, coalesce(d.last_activity_at, d.entered_at))::date
         as idle_days
) i;

-- Block 5: check — every stage should show once per track -------------------
select deal_category, count(*) from public.fr_stage_escalations
where deleted_at is null group by deal_category;

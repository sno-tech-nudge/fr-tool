-- ============================================================
-- Organisation account plan — the Overview tab's editable fields.
-- Idempotent; run block by block.
--
--   1. fr_org_account_plans   one row per organisation: cadences, next steps,
--                             partner overview, aspiration, health overrides,
--                             donor delight score
--   2. fr_org_csr_budgets     the donor's CSR budget per fiscal year, for the
--                             wallet-share chart
--   3. fr_contacts            influence_role + relationship_rag, for the
--                             decision makers / influencers list
--
-- Both new tables walk to the parent organisation for visibility, so a
-- confidential organisation's plan is hidden exactly as the organisation is.
-- ============================================================


-- ---------- 1. Account plan ----------
create table if not exists public.fr_org_account_plans (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null unique references public.fr_organisations(id),
  reporting_cadence      text,
  call_cadence           text,
  next_steps             text,
  top_partners           text,
  renewal_cycle          text,
  board_meeting          text,
  aspiration_target_inr  numeric,
  aspiration_programs    text,
  aspiration_notes       text,
  -- Null = use the value worked out from the data; set = someone overrode it.
  health_collection      text check (health_collection   in ('green', 'amber', 'red')),
  health_compliance      text check (health_compliance   in ('green', 'amber', 'red')),
  health_relationship    text check (health_relationship in ('green', 'amber', 'red')),
  health_renewal         text check (health_renewal      in ('green', 'amber', 'red')),
  donor_delight_score    numeric(3, 1) check (donor_delight_score between 0 and 10),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.employees(id),
  updated_by             uuid references public.employees(id)
);

drop trigger if exists trg_fr_org_account_plans_updated_at on public.fr_org_account_plans;
create trigger trg_fr_org_account_plans_updated_at
  before update on public.fr_org_account_plans
  for each row execute function public.fr_set_updated_at();

alter table public.fr_org_account_plans enable row level security;

drop policy if exists fr_org_account_plans_select on public.fr_org_account_plans;
create policy fr_org_account_plans_select on public.fr_org_account_plans
  for select using (
    exists (
      select 1 from public.fr_organisations o
      where o.id = organisation_id
        and o.deleted_at is null
        and public.fr_can_see_record(o.confidential, o.relationship_owner_user_id)
    )
  );

drop policy if exists fr_org_account_plans_write on public.fr_org_account_plans;
create policy fr_org_account_plans_write on public.fr_org_account_plans
  for all using (public.is_fr_authorised())
  with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_organisations o where o.id = organisation_id)
  );


-- ---------- 2. CSR budget per fiscal year ----------
create table if not exists public.fr_org_csr_budgets (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.fr_organisations(id),
  fiscal_year      text not null check (fiscal_year ~ '^FY \d{4}-\d{2}$'),
  budget_inr       numeric check (budget_inr >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.employees(id),
  updated_by       uuid references public.employees(id),
  unique (organisation_id, fiscal_year)
);

drop trigger if exists trg_fr_org_csr_budgets_updated_at on public.fr_org_csr_budgets;
create trigger trg_fr_org_csr_budgets_updated_at
  before update on public.fr_org_csr_budgets
  for each row execute function public.fr_set_updated_at();

alter table public.fr_org_csr_budgets enable row level security;

drop policy if exists fr_org_csr_budgets_select on public.fr_org_csr_budgets;
create policy fr_org_csr_budgets_select on public.fr_org_csr_budgets
  for select using (
    exists (
      select 1 from public.fr_organisations o
      where o.id = organisation_id
        and o.deleted_at is null
        and public.fr_can_see_record(o.confidential, o.relationship_owner_user_id)
    )
  );

drop policy if exists fr_org_csr_budgets_write on public.fr_org_csr_budgets;
create policy fr_org_csr_budgets_write on public.fr_org_csr_budgets
  for all using (public.is_fr_authorised())
  with check (
    public.is_fr_authorised()
    and exists (select 1 from public.fr_organisations o where o.id = organisation_id)
  );

-- The single annual figure already on the organisation becomes the current
-- year's budget, so organisations that have one show a chart straight away.
insert into public.fr_org_csr_budgets (organisation_id, fiscal_year, budget_inr)
select o.id, public.fr_fiscal_year(current_date), o.csr_budget_annual_inr
from public.fr_organisations o
where o.deleted_at is null
  and o.csr_budget_annual_inr is not null
on conflict (organisation_id, fiscal_year) do nothing;


-- ---------- 3. Contacts: decision makers and influencers ----------
alter table public.fr_contacts
  add column if not exists influence_role text,
  add column if not exists relationship_rag text;

alter table public.fr_contacts drop constraint if exists fr_contacts_influence_role_check;
alter table public.fr_contacts add constraint fr_contacts_influence_role_check
  check (influence_role in ('decision_maker', 'influencer'));

alter table public.fr_contacts drop constraint if exists fr_contacts_relationship_rag_check;
alter table public.fr_contacts add constraint fr_contacts_relationship_rag_check
  check (relationship_rag in ('green', 'amber', 'red'));


-- ---------- 4. Verify ----------
select
  (select count(*) from public.fr_org_account_plans) as plans,
  (select count(*) from public.fr_org_csr_budgets)   as budgets,
  (select count(*) from information_schema.columns
    where table_name = 'fr_contacts'
      and column_name in ('influence_role', 'relationship_rag')) as contact_cols;  -- expect 2

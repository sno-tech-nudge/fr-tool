-- =====================================================================
-- PHASE 0 / 04 — Configuration / picklist tables
-- =====================================================================
-- Reference data the whole module hangs off. All admin-editable at runtime
-- (PRD FR-63) — enums live in TABLES, not as hard-coded Postgres enums, so
-- they can be changed without a migration.
-- Seed data is in 05_seed.sql; RLS + updated_at triggers in 06.
-- =====================================================================

-- ---------- BLOCK 1: pipeline stages ----------
-- 10 stages, from the real working sheet. The PRD's 7 stages are indicative
-- only and are NOT what we build.
create table if not exists public.fr_pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  key             text unique not null,
  label           text not null,
  sort_order      int not null default 0,
  probability_pct int not null default 0,
  is_terminal     boolean not null default false,
  terminal_type   text check (terminal_type in ('won','lost')),  -- null when not terminal
  color           text,                                          -- hex, for the Kanban
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- BLOCK 2: capital categories (colour of money) ----------
create table if not exists public.fr_capital_categories (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null
             check (key in ('programmatic','unrestricted','corpus')),
  label      text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- ---------- BLOCK 3: programs and projects ----------
create table if not exists public.fr_programs (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  description text,
  status      text not null default 'active'
              check (status in ('active','paused','closed')),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Sub-projects under a program. ALWAYS resolve these by code, never by
-- name — names are not unique.
create table if not exists public.fr_projects (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.fr_programs(id) on delete cascade,
  code       text not null,
  name       text not null,
  geography  text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (program_id, code)
);

-- ---------- BLOCK 4: lead sources and loss reasons ----------
create table if not exists public.fr_lead_sources (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  label      text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists public.fr_loss_reasons (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  label      text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- ---------- BLOCK 5: bank accounts (the 7 real receiving entities) ----------
-- Colour-of-money routing. ONLY tnf and nlf_fcra are FCRA-designated.
-- A foreign grant's remittances MUST land in an FCRA account, and domestic
-- money in a domestic one — enforced by a trigger on fr_remittances in Phase 3.
create table if not exists public.fr_bank_accounts (
  id                 uuid primary key default gen_random_uuid(),
  key                text unique not null,
  label              text not null,
  full_name          text,
  is_fcra            boolean not null default false,
  allowed_categories text[] default array['programmatic','unrestricted','corpus'],
  sort_order         int not null default 0,
  is_active          boolean not null default true
);

-- ---------- BLOCK 6: currencies and FX ----------
create table if not exists public.fr_currencies (
  id         uuid primary key default gen_random_uuid(),
  code       char(3) unique not null,
  name       text not null,
  symbol     text,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- rate_to_inr is INR PER 1 UNIT of the foreign currency.
-- Zoho stored the inverse (foreign per 1 INR) — do not confuse the two.
create table if not exists public.fr_fx_rates (
  id                 uuid primary key default gen_random_uuid(),
  rate_date          date not null,
  currency_code      char(3) not null,
  rate_to_inr        numeric(14,6) not null,
  source             text,
  is_manual_override boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (rate_date, currency_code)
);

create index if not exists fr_fx_rates_lookup_idx
  on public.fr_fx_rates (currency_code, rate_date desc);

-- ---------- BLOCK 7: compliance milestone types and templates ----------
create table if not exists public.fr_milestone_types (
  id                    uuid primary key default gen_random_uuid(),
  key                   text unique not null,
  label                 text not null,
  applicable_categories text[] default array['programmatic','unrestricted','corpus'],
  sort_order            int not null default 0,
  is_active             boolean not null default true
);

-- Default milestone schedules per capital category. Used to preview/seed
-- milestones when a grant is created (Phase 3).
create table if not exists public.fr_milestone_templates (
  id                uuid primary key default gen_random_uuid(),
  capital_category  text not null,
  milestone_type_id uuid references public.fr_milestone_types(id) on delete set null,
  name              text not null,
  recurrence        text default 'once'
                    check (recurrence in ('once','quarterly','half_yearly','annually')),
  offset_months     int default 0,   -- due = grant.start_date + offset_months, then recurs
  is_active         boolean not null default true
);

-- Added (not in the handover appendix) purely so the seed is re-runnable.
create unique index if not exists fr_milestone_templates_uidx
  on public.fr_milestone_templates (capital_category, name);

-- ---------- BLOCK 8: module settings ----------
create table if not exists public.fr_settings (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  value       jsonb,
  description text,
  updated_at  timestamptz not null default now()
);

-- ---------- BLOCK 9: FY targets ----------
-- Table exists now; the Targets-vs-Actuals feature is Phase 5.
-- fiscal_quarter is an addition to the handover appendix, because IA FR-53
-- requires annual AND quarterly targets. NULL quarter means an annual target.
create table if not exists public.fr_targets (
  id                uuid primary key default gen_random_uuid(),
  fiscal_year       text not null,
  fiscal_quarter    int check (fiscal_quarter is null or fiscal_quarter between 1 and 4),
  capital_category  text,
  owner_user_id     uuid references public.employees(id),
  target_amount_inr numeric(16,2) not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.employees(id),
  updated_by        uuid references public.employees(id)
);

create index if not exists fr_targets_fy_idx on public.fr_targets (fiscal_year);

-- ---------- VERIFY ----------
-- Expect 13 fr_* tables after this file (12 config + fr_team_members).
-- select table_name from information_schema.tables
-- where table_schema = 'public' and table_name like 'fr_%' order by 1;

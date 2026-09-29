-- =====================================================================
-- PHASE 0 / 01 — Generic helper functions
-- =====================================================================
-- Indian fiscal year runs APRIL -> MARCH. Never hand-roll the Mar/Apr
-- boundary; always call these helpers.
-- =====================================================================

-- ---------- BLOCK 1: updated_at maintenance ----------
create or replace function public.fr_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- BLOCK 2: fiscal year ----------
-- 2026-09-15 -> 'FY 2026-27'   |   2027-02-10 -> 'FY 2026-27'
create or replace function public.fr_fiscal_year(d date)
returns text language sql immutable as $$
  select case
    when d is null then null
    when extract(month from d) >= 4
      then 'FY ' || (extract(year from d)::int)
                 || '-' || right(((extract(year from d)::int) + 1)::text, 2)
    else 'FY ' || ((extract(year from d)::int) - 1)
               || '-' || right((extract(year from d)::int)::text, 2)
  end;
$$;

-- ---------- BLOCK 3: fiscal quarter ----------
-- Apr-Jun = Q1, Jul-Sep = Q2, Oct-Dec = Q3, Jan-Mar = Q4
create or replace function public.fr_fiscal_quarter(d date)
returns text language sql immutable as $$
  select case
    when d is null then null
    else 'Q' || ((((extract(month from d)::int - 4 + 12) % 12) / 3) + 1)::text
  end;
$$;

-- ---------- VERIFY ----------
-- Expect: FY 2026-27 / Q2 , FY 2026-27 / Q4 , FY 2025-26 / Q4 , FY 2026-27 / Q1
-- select d,
--        public.fr_fiscal_year(d)    as fy,
--        public.fr_fiscal_quarter(d) as fq
-- from (values (date '2026-09-15'), (date '2027-02-10'),
--              (date '2026-03-31'), (date '2026-04-01')) v(d);

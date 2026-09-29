-- =====================================================================
-- Enable PostgREST aggregate functions (sum/count/avg in ?select=).
--
-- Without this every dashboard number would have to be summed in the
-- browser, which means fetching every row — and PostgREST silently caps
-- reads at 1,000. There are already 997 opportunities, so that approach
-- would start losing rows almost immediately, and silently.
--
-- With this on, `?select=stage_label,amount_inr.sum()` groups and sums in
-- Postgres and returns one row per group. RLS still applies as the calling
-- user, so confidential records stay excluded.
--
-- Run once. The NOTIFY is what makes PostgREST pick the setting up — the
-- ALTER ROLE alone does nothing until the config is reloaded.
-- =====================================================================

alter role authenticator set pgrst.db_aggregates_enabled = 'true';

notify pgrst, 'reload config';

-- ---------- verify ----------
-- Run in the APP (signed in), not the SQL editor. Should return one row per
-- stage rather than PGRST123 "Use of aggregate functions is not allowed":
--
--   /rest/v1/v_fr_opportunity_facts
--     ?select=stage_label,amount_inr.sum()&is_open=is.true
--
-- If it still errors after a minute, the reload has not landed; re-run just
-- the NOTIFY line.

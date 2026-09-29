-- =====================================================================
-- PHASE 0 / 05 — Seed reference data
-- =====================================================================
-- Every insert uses `on conflict (<natural key>) do nothing`, so this file is
-- safe to re-run and will NEVER overwrite an edit made in the admin UI.
--
-- Items marked [CONFIRM] are best-effort defaults that the handover did not
-- pin down. They are admin-editable, but the ones that feed money maths
-- (stage probabilities, FX rates) should be confirmed with Devadas/finance
-- before anyone trusts a weighted-pipeline number.
-- =====================================================================

-- ---------- BLOCK 1: capital categories ----------
insert into public.fr_capital_categories (key, label, sort_order) values
  ('programmatic', 'Programmatic', 1),
  ('unrestricted', 'Unrestricted', 2),
  ('corpus',       'Corpus',       3)
on conflict (key) do nothing;

-- ---------- BLOCK 2: the 10 pipeline stages ----------
-- Colours are the design system's monochrome brown ramp, deepening as the deal
-- advances (taupe-300 -> brown-900). Won/lost use the blessed semantic
-- green/red — the only permitted exception to brown-only.
-- [CONFIRM] probability_pct drives the weighted pipeline. The handover records
-- the 10 stages but not their probabilities; these are interpolated from the
-- PRD's 7-stage curve (10/25/40/60/80).
insert into public.fr_pipeline_stages
  (key, label, sort_order, probability_pct, is_terminal, terminal_type, color) values
  ('target',                'Target',                 1,   5, false, null,   '#ddd0cc'),
  ('contact_established',   'Contact Established',    2,  10, false, null,   '#cda99c'),
  ('pitched',               'Pitched',                3,  20, false, null,   '#b88e7f'),
  ('qualified',             'Qualified',              4,  30, false, null,   '#9a6655'),
  ('proposal_in_progress',  'Proposal in Progress',   5,  40, false, null,   '#7d4c3d'),
  ('proposal_sent',         'Proposal Sent',          6,  50, false, null,   '#693d30'),
  ('decision_maker_buy_in', 'Decision Maker Buy-in',  7,  70, false, null,   '#4d2c23'),
  ('mou_negotiation',       'MoU Negotiation',        8,  85, false, null,   '#36201a'),
  ('closed_won',            'Closed Won',             9, 100, true,  'won',  '#4a7c59'),
  ('closed_lost',           'Closed Lost',           10,   0, true,  'lost', '#a04036')
on conflict (key) do nothing;

-- ---------- BLOCK 3: programs ----------
-- EUP is the LEGACY name for EIP. Always map EUP -> EIP; never seed an EUP row.
insert into public.fr_programs (code, name, description, sort_order) values
  ('EIP',          'Economic Inclusion Program', 'Ultra-poor graduation and livelihoods', 1),
  ('AK',           'Asha Kiran',                 null, 2),
  ('SOCENT',       'Social Entrepreneurship',    'Social entrepreneurship accelerator (the/delta)', 3),
  ('INSIGHT',      'InSight',                    null, 4),
  ('UDGRAM',       'UdGram',                     null, 5),
  ('PRAGATI_AI',   'Pragati AI for Impact',      null, 6),
  ('SPARK',        'Spark',                      null, 7),
  ('SPARK_CENTER', 'Spark Center',               null, 8),
  ('PRIZE',        'Prize',                      null, 9),
  ('FORUM',        'Forum',                      null, 10),
  ('CHARCHA',      'Charcha',                    null, 11),
  ('SARATHI',      'Sarathi',                    null, 12)
on conflict (code) do nothing;

-- ---------- BLOCK 4: projects ----------
-- Only EIP-KA is documented in the handover. The rest of the project list has
-- to come from the FR team — do NOT invent codes, they are resolution keys.
insert into public.fr_projects (program_id, code, name, geography)
select p.id, 'EIP-KA', 'EIP Karnataka', 'Karnataka'
from public.fr_programs p where p.code = 'EIP'
on conflict (program_id, code) do nothing;

-- ---------- BLOCK 5: lead sources ----------
insert into public.fr_lead_sources (key, label, sort_order) values
  ('event',         'Event',         1),
  ('reference',     'Reference',     2),
  ('linkedin',      'LinkedIn',      3),
  ('database',      'Database',      4),
  ('inbound_email', 'Inbound email', 5),
  ('cold_outreach', 'Cold outreach', 6),
  ('other',         'Other',         7)
on conflict (key) do nothing;

-- ---------- BLOCK 6: loss reasons ----------
-- Union of the two keys the Zoho migration maps onto (not_a_fit, dormant) and
-- the fuller list in IA 3.4, so both sources land somewhere sensible.
insert into public.fr_loss_reasons (key, label, sort_order) values
  ('not_a_fit',              'Not a fit',                1),
  ('budget_unavailable',     'Budget unavailable',       2),
  ('thematic_mismatch',      'Thematic mismatch',        3),
  ('chose_another_ngo',      'Chose another NGO',        4),
  ('timing_deferred',        'Timing / deferred',        5),
  ('compliance_eligibility', 'Compliance / eligibility', 6),
  ('relationship_lapsed',    'Relationship lapsed',      7),
  ('dormant',                'Dormant',                  8),
  ('other',                  'Other',                    9)
on conflict (key) do nothing;

-- ---------- BLOCK 7: the 7 receiving entities ----------
-- ONLY tnf and nlf_fcra are FCRA-designated. Everything else is domestic.
-- Historical entity cleanups already agreed with the team:
--   AIC NCore -> aic      Goodville -> gtpl      EUP -> EIP (programs)
-- [CONFIRM] full_name is left NULL deliberately rather than guessed. The
-- design system does record the legal entity as "Nudge Lifeskills Foundation",
-- which very likely expands nlf / nlf_fcra — but that is an inference, and a
-- wrong legal name on an FCRA receipt is not a mistake worth risking.
insert into public.fr_bank_accounts (key, label, full_name, is_fcra, sort_order) values
  ('tnf',      'TNF',      null, true,  1),
  ('nlf_fcra', 'NLF FCRA', null, true,  2),
  ('nlf',      'NLF',      null, false, 3),
  ('gtpl',     'GTPL',     null, false, 4),
  ('ntpl',     'NTPL',     null, false, 5),
  ('nif',      'NIF',      null, false, 6),
  ('aic',      'AIC',      null, false, 7)
on conflict (key) do nothing;

-- ---------- BLOCK 8: currencies ----------
insert into public.fr_currencies (code, name, symbol, sort_order) values
  ('INR', 'Indian Rupee',        '₹',  1),
  ('USD', 'US Dollar',           '$',  2),
  ('EUR', 'Euro',                '€',  3),
  ('GBP', 'Pound Sterling',      '£',  4),
  ('SGD', 'Singapore Dollar',    'S$', 5),
  ('AED', 'UAE Dirham',          'AED',6),
  ('CHF', 'Swiss Franc',         'CHF',7)
on conflict (code) do nothing;

-- ---------- BLOCK 9: static FX seed ----------
-- rate_to_inr = INR per 1 unit of the currency. There is no auto-fetch Edge
-- Function; rates are static with a per-remittance manual override allowed.
-- [CONFIRM] Only USD @ 95 is documented in the handover. The other five are
-- PLACEHOLDERS in the right ballpark and MUST be confirmed by finance before
-- any non-USD grant is entered. Anchored at the FY 2026-27 start date.
insert into public.fr_fx_rates (rate_date, currency_code, rate_to_inr, source) values
  (date '2026-04-01', 'INR',   1.000000, 'seed_base'),
  (date '2026-04-01', 'USD',  95.000000, 'seed_handover'),
  (date '2026-04-01', 'EUR', 103.000000, 'seed_placeholder_confirm_with_finance'),
  (date '2026-04-01', 'GBP', 120.000000, 'seed_placeholder_confirm_with_finance'),
  (date '2026-04-01', 'SGD',  71.000000, 'seed_placeholder_confirm_with_finance'),
  (date '2026-04-01', 'AED',  26.000000, 'seed_placeholder_confirm_with_finance'),
  (date '2026-04-01', 'CHF', 108.000000, 'seed_placeholder_confirm_with_finance')
on conflict (rate_date, currency_code) do nothing;

-- ---------- BLOCK 10: the 8 compliance milestone types ----------
-- Keys keep the handover's exact spelling (utilization_, US) because they are
-- data keys; LABELS use the brand's UK spelling.
-- Utilisation certificates are a CSR/programmatic obligation (PRD 5), so that
-- type is scoped; the rest apply to all three capital categories.
insert into public.fr_milestone_types (key, label, applicable_categories, sort_order) values
  ('utilization_certificate', 'Utilisation certificate', array['programmatic'], 1),
  ('narrative_report',        'Narrative report',        array['programmatic','unrestricted','corpus'], 2),
  ('impact_report',           'Impact report',           array['programmatic','unrestricted','corpus'], 3),
  ('financial_report',        'Financial report',        array['programmatic','unrestricted','corpus'], 4),
  ('audit',                   'Audit',                   array['programmatic','unrestricted','corpus'], 5),
  ('board_update',            'Board update',            array['programmatic','unrestricted','corpus'], 6),
  ('site_visit',              'Site visit',              array['programmatic','unrestricted','corpus'], 7),
  ('other',                   'Other',                   array['programmatic','unrestricted','corpus'], 8)
on conflict (key) do nothing;

-- ---------- BLOCK 11: milestone templates ----------
-- [CONFIRM] The handover records that templates exist and are used to preview
-- milestones in the Won-Wizard, but not their contents. This is a minimal,
-- obviously-editable starting set derived from the PRD's per-category
-- compliance notes (PRD 5). Expect Devadas to rewrite it.
insert into public.fr_milestone_templates
  (capital_category, milestone_type_id, name, recurrence, offset_months)
select v.capital_category, mt.id, v.name, v.recurrence, v.offset_months
from (values
  ('programmatic', 'utilization_certificate', 'Utilisation certificate', 'annually',    12),
  ('programmatic', 'narrative_report',        'Progress report',         'half_yearly',  6),
  ('programmatic', 'impact_report',           'Impact report',           'once',        12),
  ('unrestricted', 'narrative_report',        'Annual narrative report', 'annually',    12),
  ('unrestricted', 'financial_report',        'Annual financial report', 'annually',    12),
  ('corpus',       'board_update',            'Annual board update',     'annually',    12)
) as v(capital_category, type_key, name, recurrence, offset_months)
join public.fr_milestone_types mt on mt.key = v.type_key
on conflict (capital_category, name) do nothing;

-- ---------- BLOCK 12: module settings ----------
-- Thresholds come from the IA automation rules (IA 8) and the handover.
insert into public.fr_settings (key, value, description) values
  ('fx_manual_override_enabled',      'true'::jsonb,     'Allow a per-remittance FX rate override'),
  ('renewal_auto_create_window_days', '180'::jsonb,      'Days before grant end_date to auto-create a renewal opportunity'),
  ('opportunity_stale_days',          '30'::jsonb,       'No activity for this many days flags is_stale'),
  ('opportunity_dormant_days',        '90'::jsonb,       'No activity for this many days prompts closing as lost (dormant)'),
  ('reminder_offset_days',            '[30, 7]'::jsonb,  'T-minus reminder offsets for tranches and milestones'),
  ('tranche_at_risk_days',            '15'::jsonb,       'Days overdue before a tranche is treated as at risk'),
  ('grant_health_red_days',           '15'::jsonb,       'Any tranche/milestone this many days overdue makes a grant red'),
  ('grant_health_amber_days',         '7'::jsonb,        'Anything overdue, or due within this many days, makes a grant amber')
on conflict (key) do nothing;

-- ---------- VERIFY ----------
-- Expect: 3, 10, 12, 1, 7, 9, 7, 7, 7, 8, 6, 8
-- select
--   (select count(*) from public.fr_capital_categories)   as capital_categories,
--   (select count(*) from public.fr_pipeline_stages)      as pipeline_stages,
--   (select count(*) from public.fr_programs)             as programs,
--   (select count(*) from public.fr_projects)             as projects,
--   (select count(*) from public.fr_lead_sources)         as lead_sources,
--   (select count(*) from public.fr_loss_reasons)         as loss_reasons,
--   (select count(*) from public.fr_bank_accounts)        as bank_accounts,
--   (select count(*) from public.fr_currencies)           as currencies,
--   (select count(*) from public.fr_fx_rates)             as fx_rates,
--   (select count(*) from public.fr_milestone_types)      as milestone_types,
--   (select count(*) from public.fr_milestone_templates)  as milestone_templates,
--   (select count(*) from public.fr_settings)             as settings;

-- Sanity: exactly 2 FCRA accounts, exactly 1 won + 1 lost terminal stage.
-- select (select count(*) from public.fr_bank_accounts where is_fcra) as fcra_accounts,
--        (select count(*) from public.fr_pipeline_stages where terminal_type = 'won')  as won_stages,
--        (select count(*) from public.fr_pipeline_stages where terminal_type = 'lost') as lost_stages;

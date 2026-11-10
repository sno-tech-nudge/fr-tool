-- ============================================================
-- Organisation health rules — the thresholds behind the Collection,
-- Compliance, Relationship and Renewal / upsell colours on the
-- organisation Overview. Edited in Configuration → Health rules.
-- Idempotent; existing values are never overwritten.
-- ============================================================

insert into public.fr_settings (key, value, description) values
  ('org_health_rules',
   '{
      "collection_green_pct": 90,
      "collection_amber_pct": 60,
      "compliance_red_after_days": 0,
      "compliance_amber_within_days": 30,
      "renewal_amber_within_days": 180,
      "relationship_rule": "worst"
    }'::jsonb,
   'Thresholds for the organisation Overview health colours')
on conflict (key) do nothing;

-- Verify: expect one row.
select key, value from public.fr_settings where key = 'org_health_rules';

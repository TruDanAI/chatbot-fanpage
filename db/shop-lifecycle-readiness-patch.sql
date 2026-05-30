-- Additive shop control-plane patch for package/lifecycle/live/readiness.
-- Apply only through an approved migration runbook.
-- Production policy:
-- - active adult-shop remains live: lifecycle='live' and live_enabled=true.
-- - all other shops keep safe missing defaults and are not promoted live.
-- - readiness is never falsely marked passed; missing readiness stays unknown.
-- - active adult-shop readiness is reset to unknown with no checked timestamp.
-- This patch is intentionally additive, idempotent, and does not touch
-- customer/order/message data.
--
-- Pre-check before an approved production apply:
-- SELECT
--   COUNT(*) FILTER (WHERE status = 'active') AS active_shop_count,
--   COUNT(*) FILTER (
--     WHERE (id = 'adult-shop' OR slug = 'adult-shop')
--       AND status = 'active'
--   ) AS active_adult_shop_count
-- FROM shops;
--
-- Post-check after an approved production apply:
-- SELECT
--   id,
--   slug,
--   status,
--   dry_run,
--   lifecycle,
--   live_enabled,
--   last_readiness_status,
--   last_readiness_checked_at,
--   last_ready_by
-- FROM shops
-- WHERE id = 'adult-shop' OR slug = 'adult-shop'
-- ORDER BY id;

BEGIN;

ALTER TABLE shops ADD COLUMN IF NOT EXISTS package TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS lifecycle TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_readiness_status TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_readiness_checked_at TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_manual_test_status TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_manual_test_at TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_ready_by TEXT;

UPDATE shops
SET package = COALESCE(NULLIF(package, ''), 'basic'),
    lifecycle = CASE
      WHEN (id = 'adult-shop' OR slug = 'adult-shop')
        AND status = 'active'
        THEN 'live'
      WHEN NULLIF(lifecycle, '') IS NOT NULL THEN lifecycle
      WHEN status = 'archived' THEN 'archived'
      ELSE 'draft'
    END,
    live_enabled = CASE
      WHEN (id = 'adult-shop' OR slug = 'adult-shop')
        AND status = 'active'
        THEN true
      ELSE COALESCE(live_enabled, false)
    END,
    last_readiness_status = CASE
      WHEN (id = 'adult-shop' OR slug = 'adult-shop')
        AND status = 'active'
        THEN 'unknown'
      ELSE COALESCE(NULLIF(last_readiness_status, ''), 'unknown')
    END,
    last_readiness_checked_at = CASE
      WHEN (id = 'adult-shop' OR slug = 'adult-shop')
        AND status = 'active'
        THEN NULL
      ELSE last_readiness_checked_at
    END,
    last_manual_test_status = COALESCE(NULLIF(last_manual_test_status, ''), 'unknown'),
    last_ready_by = CASE
      WHEN (id = 'adult-shop' OR slug = 'adult-shop')
        AND status = 'active'
        THEN ''
      ELSE COALESCE(last_ready_by, '')
    END;

ALTER TABLE shops ALTER COLUMN package SET DEFAULT 'basic';
ALTER TABLE shops ALTER COLUMN package SET NOT NULL;
ALTER TABLE shops ALTER COLUMN lifecycle SET DEFAULT 'draft';
ALTER TABLE shops ALTER COLUMN lifecycle SET NOT NULL;
ALTER TABLE shops ALTER COLUMN live_enabled SET DEFAULT false;
ALTER TABLE shops ALTER COLUMN live_enabled SET NOT NULL;
ALTER TABLE shops ALTER COLUMN last_readiness_status SET DEFAULT 'unknown';
ALTER TABLE shops ALTER COLUMN last_readiness_status SET NOT NULL;
ALTER TABLE shops ALTER COLUMN last_manual_test_status SET DEFAULT 'unknown';
ALTER TABLE shops ALTER COLUMN last_manual_test_status SET NOT NULL;
ALTER TABLE shops ALTER COLUMN last_ready_by SET DEFAULT '';
ALTER TABLE shops ALTER COLUMN last_ready_by SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shops'::regclass
      AND conname = 'shops_package_check'
  ) THEN
    ALTER TABLE shops ADD CONSTRAINT shops_package_check
      CHECK (package IN ('basic', 'sales_flow', 'self_closing_addons'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shops'::regclass
      AND conname = 'shops_lifecycle_check'
  ) THEN
    ALTER TABLE shops ADD CONSTRAINT shops_lifecycle_check
      CHECK (lifecycle IN ('draft', 'configuring', 'ready', 'live', 'paused', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shops'::regclass
      AND conname = 'shops_last_readiness_status_check'
  ) THEN
    ALTER TABLE shops ADD CONSTRAINT shops_last_readiness_status_check
      CHECK (last_readiness_status IN ('unknown', 'passed', 'failed', 'warnings'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shops'::regclass
      AND conname = 'shops_last_manual_test_status_check'
  ) THEN
    ALTER TABLE shops ADD CONSTRAINT shops_last_manual_test_status_check
      CHECK (last_manual_test_status IN ('unknown', 'passed', 'failed'));
  END IF;
END $$;

COMMIT;

-- Additive shop control-plane patch for package/lifecycle/live/readiness.
-- Apply only through an approved migration runbook.
-- This patch is intentionally additive and idempotent.

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
    lifecycle = COALESCE(NULLIF(lifecycle, ''), CASE
      WHEN status = 'active' THEN 'live'
      WHEN status = 'archived' THEN 'archived'
      ELSE 'paused'
    END),
    live_enabled = COALESCE(live_enabled, status = 'active'),
    last_readiness_status = COALESCE(NULLIF(last_readiness_status, ''), 'unknown'),
    last_manual_test_status = COALESCE(NULLIF(last_manual_test_status, ''), 'unknown'),
    last_ready_by = COALESCE(last_ready_by, '');

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

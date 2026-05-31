-- Additive per-shop Messenger dry-run patch.
-- Apply only through an approved migration runbook.
-- Production policy:
-- - active adult-shop remains live: dry_run=false.
-- - every other shop with missing/null dry_run is safe by default: dry_run=true.
-- - new shops default to dry_run=true unless the app explicitly changes them.
-- This patch is safe to rerun and does not touch customer/order/message data.
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
-- Post-check after an approved production apply of both shop control patches:
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

ALTER TABLE shops ADD COLUMN IF NOT EXISTS dry_run BOOLEAN;

UPDATE shops
SET dry_run = CASE
  WHEN (id = 'adult-shop' OR slug = 'adult-shop')
    AND status = 'active'
    THEN false
  ELSE COALESCE(dry_run, true)
END
WHERE dry_run IS NULL
  OR (
    (id = 'adult-shop' OR slug = 'adult-shop')
    AND status = 'active'
    AND dry_run IS DISTINCT FROM false
  );

ALTER TABLE shops ALTER COLUMN dry_run SET DEFAULT true;
ALTER TABLE shops ALTER COLUMN dry_run SET NOT NULL;

COMMIT;

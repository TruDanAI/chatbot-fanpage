-- Additive per-shop Messenger dry-run patch.
-- Apply only through an approved migration runbook.
-- Existing shops are backfilled to dry-run for safety.

BEGIN;

ALTER TABLE shops ADD COLUMN IF NOT EXISTS dry_run BOOLEAN;

UPDATE shops
SET dry_run = COALESCE(dry_run, true);

ALTER TABLE shops ALTER COLUMN dry_run SET DEFAULT true;
ALTER TABLE shops ALTER COLUMN dry_run SET NOT NULL;

COMMIT;

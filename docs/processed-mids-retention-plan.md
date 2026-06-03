# processed_mids Retention Plan

Last updated: 2026-06-03, Asia/Bangkok.

Purpose: keep webhook idempotency observable without adding destructive cleanup
until there is a reviewed runbook and explicit approval.

## Current State

- `processed_mids` stores Messenger webhook MID idempotency keys by
  `tenant_id`, `page_id`, and `mid`.
- `first_seen_at` is indexed with `(tenant_id, page_id, first_seen_at)`, so
  per-shop age counts can be read cheaply through the runtime page scope.
- P2.3 adds count-only visibility in the per-shop health API and shop detail
  health card:
  - total rows in scope;
  - rows older than 7 days;
  - rows older than 30 days;
  - cleanup candidate count, currently the same as rows older than 30 days;
  - oldest and newest `first_seen_at` timestamps.
- The visibility path does not return raw MID values, Page IDs, sender IDs, or
  metadata.

## Initial Policy

- Keep production MIDs for 30 days by default.
- Treat rows older than 7 days as an early growth signal only.
- Treat rows older than 30 days as cleanup candidates, not as automatic
  deletion approval.
- Do not add a cron, worker, manual delete script, or one-off production delete
  under P2.3.

The 30-day policy is intentionally conservative. Before any destructive cleanup
is enabled, re-check the current Meta webhook retry and delivery behavior and
choose a retention window that is longer than the maximum relevant retry window
plus an operational safety margin.

## Count-Only Check

Use count-only reads for staging and production reviews:

```sql
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE first_seen_at < now() - interval '7 days')::int AS older_than_7d,
  COUNT(*) FILTER (WHERE first_seen_at < now() - interval '30 days')::int AS older_than_30d,
  MIN(first_seen_at) AS oldest_first_seen_at,
  MAX(first_seen_at) AS newest_first_seen_at
FROM processed_mids
WHERE tenant_id = $1
  AND page_id = ANY($2::text[]);
```

Only report aggregate counts and timestamps.

## Future Cleanup Gates

Before any destructive cleanup exists:

1. Verify current Meta retry behavior from official docs.
2. Run the count-only check in staging and production.
3. Confirm a fresh production backup.
4. Confirm the target tenant/shop/page scope and retention window.
5. Prepare a bounded cleanup runbook that deletes only rows older than the
   approved retention window.
6. Stage-test the cleanup and verify webhook idempotency still works.
7. Get separate explicit production DB write approval for the cleanup window.

Cleanup remains blocked until these gates are satisfied.

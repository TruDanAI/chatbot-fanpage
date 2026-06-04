# Webhook Queue Rollout Runbook

Last updated: 2026-06-04, Asia/Bangkok.

This runbook is planning and approval guidance only. Reading or updating it is
not approval to deploy, change environment variables, write any database, touch
production data, call Meta Graph API, run a token health check, or send a
Messenger message.

## Purpose

The webhook queue moves Messenger webhook event processing from the current
inline async path to a PostgreSQL-backed queue. The goal is to make webhook
processing more durable without increasing wrong-shop routing, duplicate-send,
or recovery risk.

The rollout must stay staged and reversible:

- staging first;
- production only after staging success, fresh backup, and explicit approval;
- `WEBHOOK_QUEUE_ENABLED=false` remains the default and production-safe state;
- rollback disables the flag and leaves additive queue rows in place.

## Current Implementation

- `WEBHOOK_QUEUE_ENABLED=false` keeps the existing webhook behavior: the route
  returns `200` and processes events asynchronously in-process.
- `WEBHOOK_QUEUE_ENABLED=true` enqueues each request event after webhook
  signature validation. If enqueue fails, the route returns `500` so Meta can
  retry.
- `core/webhook-queue.js` stores rows in `webhook_queue` with statuses
  `queued`, `processing`, `done`, and `failed`.
- The worker claims jobs with `FOR UPDATE SKIP LOCKED`, marks successful jobs
  `done`, and retries failures until `attempt_count >= max_attempts`, then
  marks them `failed`.
- Non-retryable Messenger send blocks are handled in the queued path without
  retrying the job.
- Queue logs use safe error codes and safe refs; they must not print raw Page
  IDs, sender IDs, message bodies, tokens, credentials, or DB URLs.

Default runtime knobs:

| Variable | Default | Notes |
| --- | ---: | --- |
| `WEBHOOK_QUEUE_ENABLED` | `false` | Global queue gate. Keep false/unset until approved. |
| `WEBHOOK_QUEUE_BATCH_SIZE` | `10` | Worker claim size; code caps claims at 100. |
| `WEBHOOK_QUEUE_WORKER_INTERVAL_MS` | `1000` | Worker tick interval. |
| `WEBHOOK_QUEUE_MAX_ATTEMPTS` | `5` | Max attempts before `failed`. |
| `WEBHOOK_QUEUE_RETRY_DELAY_MS` | `15000` | Delay before retrying a failed processing attempt. |
| `WEBHOOK_QUEUE_WORKER_ID` | process-based | Optional safe worker label. |

## Preconditions

All environments:

- `npm test` passes.
- `npm audit --omit=dev` reports 0 vulnerabilities or documented mitigations.
- Public `/healthz` is green for the target environment.
- `WEBHOOK_QUEUE_ENABLED=false` is confirmed before starting rollout.
- The queue schema exists before enabling the flag:
  - table `webhook_queue`;
  - indexes `webhook_queue_queued_available_idx`,
    `webhook_queue_status_updated_idx`, and
    `webhook_queue_page_status_idx`;
  - status check for `queued`, `processing`, `done`, and `failed`;
  - non-empty `tenant_id` and `page_id` checks.
- Only count/status/timestamp SQL is used for inspection. Do not select or
  print `payload_json` or `event_json`.
- Admin health UI or API can show queue counts by status for the target shop.
- Failed queue count is 0 before rollout, unless the exception is explicitly
  reviewed and explained.

Production-only:

- A fresh production PostgreSQL backup exists outside this repo and has been
  verified.
- The exact production approval phrase is given in the current session:

  ```text
  duoc bat webhook queue production
  ```

- A separate approval exists for any production environment change needed to
  set or unset `WEBHOOK_QUEUE_ENABLED`.
- A rollback owner and monitoring owner are available for the full live window.
- The operator understands that the queue flag is global for the service, not
  per shop.
- All non-target shops must remain dry-run or otherwise intentionally reviewed
  before the production window.

## Safe Count-Only Checks

Use parameterized queries and report only aggregate counts/timestamps.

Queue status posture:

```sql
SELECT
  status,
  COUNT(*)::int AS total,
  MIN(created_at) AS oldest_created_at,
  MAX(updated_at) AS newest_updated_at
FROM webhook_queue
WHERE tenant_id = $1
GROUP BY status
ORDER BY status ASC;
```

Oldest queued job age:

```sql
SELECT
  COUNT(*)::int AS queued_count,
  MIN(available_at) AS oldest_available_at,
  EXTRACT(EPOCH FROM (now() - MIN(available_at)))::int AS oldest_age_seconds
FROM webhook_queue
WHERE tenant_id = $1
  AND status = 'queued';
```

Shop-scoped status posture:

```sql
SELECT
  q.status,
  COUNT(*)::int AS total
FROM webhook_queue q
JOIN (
  SELECT DISTINCT page_id
  FROM shop_pages
  WHERE shop_id = $1
    AND page_id <> ''
) sp ON sp.page_id = q.page_id
WHERE q.tenant_id = $2
GROUP BY q.status
ORDER BY q.status ASC;
```

Do not query or print raw queue payloads, message bodies, sender IDs, Page IDs,
tokens, credentials, or database URLs.

## Staging Rollout

Staging still writes queue rows, so it needs explicit staging write/env
approval in the session before it runs.

1. Re-check local state: `git status --short`, ahead/behind, latest commit.
2. Run `npm test` and `npm audit --omit=dev`.
3. Verify staging schema using a staging-only DB variable such as
   `CHATBOT_STAGING_DATABASE_URL`. Do not use `DATABASE_URL` for verification
   scripts.
4. Confirm `MESSENGER_DRY_RUN=true` for the staging process.
5. Confirm `MULTI_SHOP_DB_CONFIG_ENABLED=true` if the smoke uses DB-backed
   shop runtime resolution.
6. Confirm the target staging shop and Page mapping by safe refs/counts only.
7. Start or deploy staging with:
   - `WEBHOOK_QUEUE_ENABLED=true`;
   - conservative defaults for batch size, interval, max attempts, and retry
     delay unless a specific reason exists to override them.
8. Send one approved dry-run webhook simulation for menu text and one product
   code against the staging target Page.
9. Confirm:
   - webhook route returns `200` after enqueue;
   - queue counts move from `queued`/`processing` to `done`;
   - `failed=0`;
   - no wrong-shop routing;
   - no Messenger send because staging dry-run is on;
   - logs show safe refs/error codes only.
10. Return staging to `WEBHOOK_QUEUE_ENABLED=false` unless the owner explicitly
    approves a longer staging soak.

If any staging step fails, do not proceed to production. Keep or restore
`WEBHOOK_QUEUE_ENABLED=false`, record the safe error code and aggregate counts,
then fix in code or runbook before retrying.

## Production Rollout

Production enablement is blocked until the staging rollout passes and the
production-only preconditions above are satisfied.

1. Re-check production `/healthz`.
2. Verify the production backup timestamp/SHA outside this repo.
3. Confirm `WEBHOOK_QUEUE_ENABLED=false` before the change.
4. Confirm current queue count posture. Expected for first rollout:
   `queued=0`, `processing=0`, `failed=0`; `done` may be 0.
5. Confirm the live window, rollback owner, monitoring owner, and customer
   impact tolerance. This flag affects all webhook traffic reaching the
   service.
6. Apply the approved production environment change:
   `WEBHOOK_QUEUE_ENABLED=true`.
7. After restart/deploy, confirm public `/healthz` is still green.
8. Watch for at least 1 hour:
   - queue counts drain from `queued`/`processing` to `done`;
   - `failed` remains 0;
   - latest webhooks are followed by successful sends when appropriate;
   - 1h send error rate does not rise;
   - no credential or wrong-shop routing errors appear in safe logs;
   - no raw customer data appears in logs or UI.
9. Record a 24h follow-up checkpoint with the same aggregate fields.

Do not combine production queue enablement with Page cutover, credential
rotation, Basic Sales v2 activation, schema changes, or product/menu changes.

## Rollback

Rollback is intentionally simple:

1. Get explicit production environment rollback approval if production is
   involved.
2. Set `WEBHOOK_QUEUE_ENABLED=false`.
3. Restart/deploy only as needed for the env change.
4. Re-check public `/healthz`.
5. Confirm new webhooks are handled by the inline path.
6. Leave existing `webhook_queue` rows in place. Do not delete, truncate,
   rewrite, or manually retry rows during rollback.
7. Record aggregate queue counts and safe error codes for follow-up analysis.

Rows that are already `done` or `failed` are historical records. Rows stuck in
`processing` after rollback should be investigated through a separate recovery
runbook; do not manually flip statuses during the live incident.

## Failure Handling

- **Enqueue returns 500:** Meta may retry. Disable the flag if this happens in
  production, then inspect schema/database availability using safe error codes.
- **`failed` count becomes non-zero:** stop rollout progression. In production,
  roll back if failures are increasing or customer impact is possible.
- **Queued jobs do not drain:** inspect worker startup, DB connection, worker
  interval, and logs. Roll back production if live traffic is affected.
- **Processing jobs appear stuck:** do not hand-edit queue rows. This needs a
  stale-lock recovery design before manual recovery is approved.
- **Wrong-shop routing or credential errors:** roll back immediately and inspect
  runtime mapping/credential state using safe refs only.
- **Send error rate rises:** roll back if errors persist or are not clearly
  non-retryable customer availability blocks.

## Future Work Before Larger Rollout

- Keep the P4.2 shop health queue observability in place: status counts,
  oldest queued job age, failed count, and last safe error code without
  returning payloads.
- Add a stale `processing` recovery policy or requeue runbook.
- Decide whether a separate dead-letter table is needed or whether `failed`
  rows plus alerts are enough for the expected shop count.
- Consider whether queue enablement should become per-shop instead of global.

## Safety Boundary For This Checkpoint

- No deployment was performed by writing this runbook.
- No environment variable was changed.
- No staging or production database write was performed.
- No production data or `/data` path was touched.
- No Meta Graph API call, token health check, or Messenger send was performed.
- `WEBHOOK_QUEUE_ENABLED` remains disabled unless a future approved rollout
  explicitly changes it.

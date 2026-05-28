# Multi-Shop MVP Rollout

This document records the current multi-shop MVP staging state and the required
production rollout order. It is not approval to deploy, change production
environment variables, write production PostgreSQL, or run authenticated
production smoke.

## Current Staging Status

Verified on branch `feature/multi-shop-dashboard` after commit
`e98ad73 Fail product writes on aborted transactions`:

- `MULTI_SHOP_DB_CONFIG_ENABLED=true` is enabled in staging.
- `db/multi-shop-proposal.sql` has been applied to staging.
- `db/admin-auth-rbac-audit-proposal.sql` has been applied to staging.
- `adult-shop` has been seeded into staging PostgreSQL.
- Runtime DB config resolution passed in staging.
- Admin shops read-only routes passed in staging.
- Product CRUD smoke passed in staging:
  create `ZB-SMOKE-001`, verify visible, update, disable, enable, archive.
- Product audit rows are working in staging.
- Product CRUD smoke produced `admin_audit_log` delta `+5`.
- The original 13 non-smoke products remained unchanged.
- The smoke product was archived at the end of the smoke.
- There was no duplicate active `ZB-SMOKE-001` product code after cleanup.

Latest local verification before the commit:

- `node --check` on changed JavaScript files passed.
- `npm test` passed with `422 passed, 0 failed`.
- `npm audit --omit=dev` found `0 vulnerabilities`.
- `git diff --check` passed.

Latest local safety-foundation update after runtime admission guard:

- Runtime admission now supports `RUNTIME_ALLOWED_SHOP_IDS` and
  `RUNTIME_ALLOWED_PAGE_IDS`.
- Webhook/runtime fail-closed logs use `page_ref=p:<hash>` instead of raw
  `page_id`.
- Latest local verification for that update: `npm test` passed with
  `469 passed, 0 failed`; `git diff --check` passed.

Latest local per-page credential phase 1 update:

- `db/multi-shop-proposal.sql` now includes additive/idempotent
  `shop_page_credentials` for active encrypted `fb_page_token` credentials by
  shop/page mapping.
- `core/credentials/page-credentials.js` encrypts/decrypts credentials using
  `CREDENTIAL_MASTER_KEY`.
- DB-backed runtime resolves the credential for the resolved shop/page and
  uses that page token for Messenger sends.
- Missing DB-backed credentials fail closed and do not fallback to
  `FB_PAGE_TOKEN`; file-backed legacy runtime still uses `FB_PAGE_TOKEN`.
- Runtime logs continue to use `page_ref=p:<hash>` and do not log raw tokens or
  raw `page_id`.
- Latest local verification for this update: `npm test` passed with
  `479 passed, 0 failed`; `git diff --check` passed.
- Production deploy/env/DB/data remain untouched.

Latest local atomic message idempotency phase 1 update:

- Storage adapters now expose `tryMarkMid()` instead of the
  `seenMid()`/`markMid()` pair.
- PostgreSQL idempotency uses one atomic
  `INSERT ... ON CONFLICT DO NOTHING RETURNING` against `processed_mids`.
- Runtime webhook awaits MID marking before processing; duplicate MIDs skip the
  event, and MID storage errors fail closed without sending a customer reply.
- File storage preserves the previous in-memory MID dedupe behavior behind the
  new interface.
- Latest local verification for this update: `npm test` passed with
  `481 passed, 0 failed`.
- Production deploy/env/DB/data remain untouched.

Latest local feature flag facade phase 1 update:

- `core/shops/feature-flags.js` now provides `getFeatureFlag()` and
  `getRuleToggle()` with explicit defaults for the current runtime rule
  toggles.
- Runtime bot-mode helpers use the facade instead of reading behavior flags
  directly from `settings_json.ruleToggles` or legacy `botMode` options.
- DB-backed shop config normalization uses the facade as a bridge before any
  future schema migration.
- No schema migration, plan billing, adult-shop behavior change, durable queue,
  production deploy, production env change, production DB write, or production
  `/data` touch was done.
- Latest local verification for this update: `npm test` passed with
  `489 passed, 0 failed`.
- Production deploy/env/DB/data remain untouched.

Latest local durable webhook queue phase 1 update:

- `db/multi-shop-proposal.sql` now includes additive/idempotent
  `webhook_queue` with states `queued`, `processing`, `done`, and `failed`,
  `payload_json`/`event_json`, bounded `attempt_count`/`max_attempts`,
  `available_at`, `locked_at`, `locked_by`, `last_error`, and lifecycle
  timestamps.
- `core/webhook-queue.js` provides PostgreSQL enqueue, claim-next-batch with
  `FOR UPDATE SKIP LOCKED`, mark-done, and bounded retry/fail behavior.
- `WEBHOOK_QUEUE_ENABLED=false` is the default. With the flag off, webhook
  behavior stays on the current inline async processing path. With the flag on,
  enqueue happens only after signature validation and before worker processing.
- Queue logs use safe error codes and `page_ref`; they do not log raw customer
  message bodies, raw tokens, or raw `page_id`.
- Latest local verification for this update: `npm test` passed with
  `499 passed, 0 failed`.
- Production deploy/env/DB/data remain untouched; production queue rollout has
  not started.

Latest local per-shop health phase 1 update:

- `GET /admin/api/shops/:shopId/health` is implemented as a JSON-only admin
  read endpoint using existing admin auth/RBAC and the read-only dashboard
  reader.
- The health response returns shop status, page mapping status counts, last
  webhook timestamp, last successful bot send timestamp when message data is
  available, 1h send error rate when event/message counters are available,
  active handoff count, webhook queue status counts, and credential status
  counts.
- The response does not return raw page IDs, tokens, encrypted credential
  values, customer rows, message bodies, or raw order rows.
- Missing additive `webhook_queue` or `shop_page_credentials` schema is handled
  as an unavailable section instead of a 500. Missing multi-shop schema returns
  `schemaReady=false`.
- Latest local verification for this update: `npm test` passed with
  `504 passed, 0 failed`.
- Production deploy/env/DB/data remain untouched; authenticated production
  smoke was not run.

Latest local admin shop onboarding phase 1 update:

- Admin now has `GET /admin/shops/new` and create actions for a shop shell.
- `POST /admin/api/shops` and the HTML form post create only a `shops` row,
  a default `shop_settings` row, and an `admin_audit_log` row in one
  transaction.
- The phase intentionally does not create page mappings, page credentials,
  products, assets, raw tokens, or raw `page_id` values.
- Create requires the existing admin write permission used by shop/product
  admin writes. Readers can still list and view shops, but cannot create.
- The default shell values are `status=active`, `bot_mode=menu_code_handoff`,
  `locale=vi-VN`, and `timezone=Asia/Ho_Chi_Minh`.
- Next phase: page mapping management for the created shop.
- Production deploy/env/DB/data remain untouched; authenticated production
  smoke was not run.

## Staging Canary Runtime Smoke Checkpoint - 2026-05-16

This checkpoint is staging-only. It is not approval to deploy, change
production environment variables, write production PostgreSQL, touch
production `/data`, or run authenticated production smoke.

Staging runtime state for this checkpoint:

- `MULTI_SHOP_DB_CONFIG_ENABLED=true`.
- `WEBHOOK_QUEUE_ENABLED=false`.
- `MESSENGER_DRY_RUN=false`, so real Messenger sends are enabled on staging.
- The test page resolves to `test-shop` through DB-backed runtime config.
- The `test-shop` minimal catalog and M7/menu assets are seeded.
- The user observed the Messenger flow as mostly OK from another Facebook
  account.

Aggregate recent staging logs from a 3h window:

- Webhook `POST /webhook` count: `14`.
- Reply marker count: `4`.
- Image marker count: `5`.
- Menu image marker count: `4`.
- Product image marker count: `1`.
- Handoff marker count: `8`.
- DB config fail-closed count: `0`.
- `page_not_found` count: `0`.
- Credential error count: `0`.
- Messenger send error count: `0`.

Public staging `GET /healthz` passed:

- HTTP `200`, `ok=true`, `storage.adapter=postgres`,
  `storage.ready=true`, `messenger.dryRun=false`.

Safety boundary:

- No raw page IDs, tokens, database URLs, customer IDs, or message bodies were
  printed.
- No production deploy, production environment change, production DB write,
  production `/data` access, authenticated production smoke, commit, or push
  was performed.

## Staging Onboarding Demo Shop E2E Checkpoint - 2026-05-17

This checkpoint is staging-only. It records the completed
`onboarding-demo-shop` pass from the provided staging state. It is not approval
to deploy, change environment variables, write any database, touch `/data`, run
authenticated smoke, or touch production.

Staging onboarding state for this checkpoint:

- Admin onboarding API/UI created a second shop end-to-end on staging:
  `onboarding-demo-shop`.
- The shop used a real second staging test fanpage.
- The onboarding readiness checklist passed.
- `WEBHOOK_QUEUE_ENABLED=false`; webhook processing remains on the inline path.
- Production deployment is still not updated with the latest admin UI unless a
  manual deploy is separately approved and performed.

Messenger flow passed for `onboarding-demo-shop`:

- Webhook `POST /webhook` count: `2`.
- Inbound/customer marker count: `2`.
- Reply marker count: `1`.
- Image marker count: `2`.
- Menu image marker count: `1`.
- Product image marker count: `1`.
- Handoff marker count: `1`.
- DB config fail-closed count: `0`.
- `page_not_found` count: `0`.
- Credential error count: `0`.
- Messenger send error count: `0`.

Routing and isolation:

- Incoming `page_ref` matched `p:3d651b6548`.
- The request routed to `onboarding-demo-shop` only.
- No wrong-shop routing to `test-shop` or `adult-shop` was observed.

Product bulk CSV import smoke passed for `onboarding-demo-shop` after the
feature was deployed to staging:

- The import created product codes `M8` and `M9`.
- `rows_received=2`.
- `products_created=2`.
- `products_updated=0`.
- `product_images_created=2`.
- `errors_count=0`.
- Active product image count increased from `1` to `3`.
- Onboarding readiness remained pass after the import.
- The bulk import form still rendered after the smoke.

Safety boundary:

- Production was untouched.
- No deploy, environment change, database write, `/data` touch,
  authenticated smoke, commit, or push was performed as part of this
  documentation update.
- `WEBHOOK_QUEUE_ENABLED` remains false and is a separate future gate.

## Basic E2E Staging Checkpoint - 2026-05-24

Staging-only checkpoint recorded after the completed Basic E2E test:

- Staging `demo-shop` readiness passed.
- Real Messenger menu test passed.
- Real Messenger code `11` test passed.
- No Messenger send errors were observed.
- Staging was restored to `MESSENGER_DRY_RUN=true`.
- Production and `adult-shop` were untouched.

## nem-bui-xa Basic Staging Ready Checkpoint - 2026-05-25

This checkpoint records the completed Basic staging dry-run E2E pass for
`nem-bui-xa`. It is documentation-only and is not approval to deploy, change
environment variables, write a database, touch `/data`, call Meta Graph API,
run token health checks, send Messenger messages, or enable live traffic.

Staging shop readiness:

- `nem-bui-xa` shop shell created.
- Products imported: `5`.
- Imported product codes: `1`, `2`, `3`, `4`, `5`.
- Menu image uploaded.
- Product image for code `1` uploaded.
- Page mapping created.
- Credential created.
- `handoff` active.
- `manual_test_status=passed`.
- `readiness_status=passed`.
- `dry_run=true`.
- `live_enabled=false`.

Dry-run webhook E2E checks:

- Dry-run webhook menu passed.
- Dry-run webhook code `1` passed.
- Product image marker passed.
- No real Messenger sends were performed.

Routing and isolation:

- No wrong-shop routing was observed.
- No `adult-shop` or `demo-shop` config, data, or asset side effects were
  introduced.
- `adult-shop` and `demo-shop` remain out of scope for this checkpoint.

## nem-bui-xa Real Messenger Staging Test Checkpoint - 2026-05-25

This checkpoint records the completed `nem-bui-xa` real Messenger staging test
and rollback to safe dry-run mode. It is documentation-only and is not approval
to deploy, change environment variables, write a database, touch `/data`, call
Meta Graph API, run token health checks, send Messenger messages, enable
`live_enabled`, or modify `adult-shop` or `demo-shop` config, data, or assets.

Real Messenger staging test results:

- `nem-bui-xa` real Messenger menu test passed.
- Real Messenger code `1` test passed.
- Menu image was sent.
- Product image and product info were sent.
- Handoff was active.
- No Messenger send errors were observed.
- No wrong-shop routing was observed.
- No `adult-shop` or `demo-shop` side effects were observed.

Rollback and final safe state:

- Rollback completed after the real Messenger test.
- Final staging `MESSENGER_DRY_RUN=true`.
- Final `nem-bui-xa` `dry_run=true`.
- Final `nem-bui-xa` `live_enabled=false`.
- `nem-bui-xa` readiness remained `passed`.

## P0.2 Shop Pause/Resume Emergency Control Checkpoint - 2026-05-26

This checkpoint records the staging deployment and verification of the
shop-level pause/resume emergency control. It is documentation-only and is not
approval to deploy, change environment variables, write a database, touch
`/data`, call Meta Graph API, run token health checks, send Messenger messages,
or modify `adult-shop` or `demo-shop` config, data, or assets.

Staging deployment:

- Commit `2ea325b Add shop pause and resume controls`.
- Railway staging deployment `b7818f64-6358-4057-a04f-8bdb7c58f922`:
  `SUCCESS`.

`nem-bui-xa` pause/resume verification:

- Pause/resume was tested on `nem-bui-xa`.
- Pause sets `status=paused` and `lifecycle=paused`.
- Pause keeps `dry_run=true` and `live_enabled=false`.
- Runtime fails closed for the paused shop.
- Resume returns `status=active` and `lifecycle=configuring`.
- Resume keeps `dry_run=true` and `live_enabled=false`.
- Readiness check after resume passed with a `product_assets_ready` warning
  only.

Isolation and safety boundary:

- `adult-shop` and `demo-shop` config, data, and assets were unchanged.
- No Messenger sends were performed.
- No production action was taken.

## P0.3 Shop Dry-Run Controls Checkpoint - 2026-05-26

This checkpoint records the staging deployment and verification of the per-shop dry-run operator controls. It is documentation-only and is not approval to deploy, change environment variables, write a database, touch `/data`, call Meta Graph API, run token health checks, send Messenger messages, or modify `adult-shop` or `demo-shop` config, data, or assets.

Staging deployment:

- Commit `980928c Add safe shop dry-run controls`.
- Railway staging deployment `74465cb2-4854-4ffb-ba9a-59f76f896994`: `SUCCESS`.
- Full tests: `786 passed` (`npm test`).
- Focused tests: `174 passed` (`shop-control-writes` and `admin-routes`).
- Staging health check `/healthz`: HTTP 200, `messenger.dryRun=true`, `storage.ready=true`.
- Staging admin UI `/admin/login`: HTTP 200.

`nem-bui-xa` dry-run control verification:

- Precheck: `status=active`, `lifecycle=configuring`, `last_readiness_status=passed`, `dry_run=true`, `live_enabled=false`.
- Disable dry-run: `POST /admin/api/shops/nem-bui-xa/dry-run/disable` with strict confirmation successfully disabled dry-run (`dry_run=false` persisted in DB).
- Re-enable dry-run: `POST /admin/api/shops/nem-bui-xa/dry-run/enable` with confirmation successfully re-enabled dry-run (`dry_run=true` persisted in DB).
- live_enabled stayed `false` throughout the sequence.
- lifecycle stayed `configuring` (non-live) throughout the sequence.
- Global `MESSENGER_DRY_RUN` stayed `true` (no actual sends).

Isolation and safety boundary:

- `adult-shop` and `demo-shop` config, data, and assets were completely unchanged.
- No Messenger sends were performed.
- No production action was taken.
- P0.1 (readiness checks), P0.2 (emergency brake), and P0.3 (safe dry-run controls) are completely implemented and verified.

## Closed Pre-Shop-2 Isolation Gates - 2026-05-24

The three pre-shop-2 isolation blockers are implemented and covered by local
tests:

- Per-shop `dry_run`: global `MESSENGER_DRY_RUN=true` remains the kill switch;
  shop `dry_run=true` keeps that shop on the dry-run path; shop
  `dry_run=false` is only for a controlled live test or live switch on the
  target shop.
- Unmapped Page fail-closed: DB-backed webhook requests for an unmapped Page
  return HTTP `200`, fail closed, and produce no Messenger send, typing, or
  storage side effects.
- Two-shop isolation regression: `tests/multi-shop-isolation.test.js` covers
  two mapped shops with different `dry_run` values plus an unmapped Page.

Required local pre-flight before shop #2 readiness, manual Messenger testing,
or go-live:

1. Run the isolation regression:

   ```bash
   node -e "require('./tests/multi-shop-isolation.test.js'); require('./tests/harness').run().then(code => process.exit(code))"
   ```

2. Run `npm test`.
3. Continue only if both pass.

Shop #2 go-live remains blocked until readiness passes, the manual test passes,
active mapping count is exactly `1`, active credential count is exactly `1`,
the target shop is the only shop with `dry_run=false`, and all other shops
remain `dry_run=true`.

## Required Staging Environment

The staging admin/product-write path needs these environment variables set with
safe, non-production values:

- `SESSION_SECRET`: required for browser admin sessions.
- `ADMIN_EXPORT_TOKEN`: required for Bearer automation and smoke access.
- `ADMIN_ROLES`: should include `maintainer` or `owner` for product writes.
- `ADMIN_PRINCIPAL_ID`: safe actor id for audit entries.
- `ADMIN_PRINCIPAL_DISPLAY_NAME`: safe display name for audit/admin context.
- `MULTI_SHOP_DB_CONFIG_ENABLED=true`: enables DB-backed runtime config.
- `CREDENTIAL_MASTER_KEY`: required only when DB-backed runtime decrypts
  `shop_page_credentials`; use a long random value and do not change in
  production without a rotation/re-encryption plan.
- `RUNTIME_ALLOWED_SHOP_IDS`: optional runtime admission allowlist for
  `shops.id` values during staged rollout.
- `RUNTIME_ALLOWED_PAGE_IDS`: optional post-resolution page override. It only
  applies after `shop_pages` resolves the page to a shop; unknown pages still
  fail closed and do not fallback because of this variable.
- `WEBHOOK_QUEUE_ENABLED=false`: durable webhook queue gate; keep false outside
  an approved queue rollout.
- `WEBHOOK_QUEUE_BATCH_SIZE`: optional queue worker claim size when the queue
  gate is enabled.

Do not print any value for these variables in logs, chat, or runbooks.

## Known Staging Difference And Fix

Staging initially had the multi-shop schema but lacked `admin_audit_log`.
Product create inserted into `shop_products`, then the audit insert failed.
PostgreSQL marked the transaction as aborted, so `COMMIT` effectively returned
`ROLLBACK` while the API still returned a fake `201`.

The issue is fixed by two measures:

- Apply the admin audit schema to staging before product write smoke.
- Guard product write transactions so `COMMIT` must report command `COMMIT`;
  any aborted transaction or non-`COMMIT` command throws
  `product_commit_failed` and does not return success.

Audit writes remain fail-closed for product writes. Missing or broken audit
schema must fail the product transaction safely instead of persisting a product
without an audit record.

## Completed Engineering Foundation Before Shop #2

This section records engineering foundation already implemented before shop #2.
It is not approval to deploy, change production environment variables, or write
production data.

1. Per-page credential resolution: phase 1 deployed in
   `67efcbef921f5bf326f4e78120ea0c1d70c0295c` but gated.
   It stores encrypted page credentials by shop/page and makes Messenger sends
   select the resolved page token. Keep `FB_PAGE_TOKEN` only as the legacy
   file-backed fallback.
2. Atomic message idempotency: phase 1 deployed in
   `67efcbef921f5bf326f4e78120ea0c1d70c0295c`.
   Runtime awaits `tryMarkMid()` before processing. PostgreSQL uses
   `INSERT ... ON CONFLICT DO NOTHING RETURNING`; file storage preserves the
   previous behavior behind the same interface.
3. Feature flag facade: phase 1 deployed in
   `67efcbef921f5bf326f4e78120ea0c1d70c0295c`.
   Runtime bot-mode helpers now use the facade bridge and keep existing
   defaults/overrides before any schema migration.
4. Durable webhook queue: phase 1 deployed in
   `67efcbef921f5bf326f4e78120ea0c1d70c0295c` but disabled.
   PostgreSQL queue rows, bounded retry, `FOR UPDATE SKIP LOCKED`, and the
   opt-in `WEBHOOK_QUEUE_ENABLED=false` default are implemented. Redis is not
   needed for the current 5-20 shop target.
5. Per-shop health: phase 1 deployed in
   `67efcbef921f5bf326f4e78120ea0c1d70c0295c` but not authenticated-smoked in
   production.
   `GET /admin/api/shops/:shopId/health` exposes last webhook, last successful
   send, send error rate, active handoffs, queue counts, and credential status
   without raw tokens, raw page IDs, customer rows, messages, or orders.

## Production Rollout Order

Production rollout needs separate approval for each production-impacting gate.
Approval for one gate does not imply approval for later gates.

Production currently has a partial multi-shop schema from the verified backup
`20260515-162718-multi-shop-predeploy`:

- `shops`: 1 row.
- `shop_pages`: 1 row.
- `shop_settings`: 1 row.
- `shop_products`: 14 rows.
- `shop_assets`: 16 rows.
- `shop_page_credentials`: missing.
- `webhook_queue`: missing.

Because production already has the first five multi-shop tables, the preferred
schema path is the targeted additive patch
`db/production-missing-multishop-tables-patch.sql`. Do not re-apply the full
`db/multi-shop-proposal.sql` to production as the default path for this state.
Any production DB write, including this targeted patch, still needs fresh
approval in the same session before it is run.

1. Re-check git state, latest production deployment, and public `/healthz`.
2. Create a fresh production PostgreSQL backup outside this repository.
3. Verify backup SHA256 and count-only summaries.
4. Confirm whether production still has the partial multi-shop schema above.
5. If only `shop_page_credentials` and `webhook_queue` are missing, review and
   apply `db/production-missing-multishop-tables-patch.sql` after explicit
   production DB write approval.
6. Review `db/multi-shop-proposal.sql` only as the full baseline reference; do
   not use it as the preferred production apply path while the first five
   tables already exist.
7. Review `db/admin-auth-rbac-audit-proposal.sql`; confirm it is additive and
   idempotent.
8. Apply the admin audit schema to production PostgreSQL if production does
   not already have it.
9. Seed `adult-shop` into production PostgreSQL from the current production
   file-backed catalog/config.
10. Seed encrypted `shop_page_credentials` only after separate production secret
    handling/env approval. Do not print token plaintext, encrypted values, or
    `CREDENTIAL_MASTER_KEY`.
11. Keep `MULTI_SHOP_DB_CONFIG_ENABLED=false` while preparing and validating
    credentials. Do not enable DB-backed runtime until the credential seed and
    validation gates below pass.
12. Verify count-only table state:
   `shops`, `shop_pages`, `shop_settings`, `shop_products`, `shop_assets`,
   `shop_page_credentials`, `webhook_queue`, `admin_roles`, `admin_users`,
   `admin_user_roles`, and `admin_audit_log`.
13. Deploy the reviewed runtime/dashboard commit only after deploy approval.
14. Set `CREDENTIAL_MASTER_KEY` only after separate production environment
    approval.
15. Enable `MULTI_SHOP_DB_CONFIG_ENABLED=true` only after separate production
    environment approval.
16. Keep `WEBHOOK_QUEUE_ENABLED=false` until a separate queue rollout approval
    covers worker behavior, retry visibility, rollback, and production DB
    write expectations.
17. Smoke public `/healthz` without auth.
18. Smoke admin shops read routes only after approval, because authenticated
    admin reads can write audit rows.
19. Smoke product CRUD with a test product code such as `ZB-SMOKE-001` only
    after explicit production DB write approval.
20. Archive the smoke product as cleanup and verify there is no duplicate
    active smoke code.
21. Verify count-only audit delta and product counts. Do not print raw audit,
    product, customer, order, or message rows.

Expected post-rollout product checks:

- Original production product count remains unchanged except for the archived
  smoke row.
- The smoke product is archived.
- There is no active duplicate smoke code.
- Product CRUD audit delta matches the approved smoke steps.

## Production Readiness Checkpoint - 2026-05-15

This checkpoint records local rollout-readiness review plus read-only
production metadata and public endpoint checks. It is not approval to deploy,
change production environment variables, write production PostgreSQL, touch
production `/data`, or run authenticated production smoke. No deploy, env
change, production DB write, production `/data` touch, or authenticated smoke
was performed during this checkpoint.

Local verification from this checkpoint:

- `git status --short --untracked-files=all`: clean before this doc update.
- `git rev-list --left-right --count origin/main...HEAD`: `0 0`.
- `npm test`: `504 passed, 0 failed`.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.

Read-only production metadata verified for this checkpoint:

- Railway latest production deployment:
  `bc1bc015-6205-4c3d-9c28-0e50dc988da8`.
- Deployment status: `SUCCESS`.
- Deployment commit: `fb415af`.
- Deployment message:
  `Deploy fb415af sequential webhook event processing hotfix`.
- Deployment created at: `2026-05-14T14:43:45.954Z`.
- Public `GET /healthz` passed earlier:
  `ok=true`, `storage.adapter=postgres`, `storage.ready=true`,
  `messenger.dryRun=false`.
- Public `GET /admin/login` passed earlier:
  HTTP `200`, title `Admin Login`, form present `true`.

Origin `main` contains newer safety commits through `0b45f6d` that are not
deployed to production yet:

- `0b45f6d Add per-shop health admin API phase 1`
- `d47c3e2 Add durable webhook queue phase 1`
- `29f03d7 Add feature flag facade for runtime rule toggles`
- `179953e Add atomic MID idempotency`
- `117e745 Add per-page credential resolution`

Schema required before enabling DB-backed multi-shop in production:

- Production currently has a partial multi-shop schema: `shops`,
  `shop_pages`, `shop_settings`, `shop_products`, and `shop_assets` exist with
  the count-only state recorded above, while `shop_page_credentials` and
  `webhook_queue` are missing.
- `db/production-missing-multishop-tables-patch.sql` is the preferred targeted
  production patch for this partial state. It creates only
  `shop_page_credentials` and `webhook_queue`, plus their expected indexes and
  CHECK constraints.
- `db/multi-shop-proposal.sql` remains the full baseline reference and staging
  proposal. Applying the full file to production is no longer the preferred
  path while production already has the first five multi-shop tables.
- `db/admin-auth-rbac-audit-proposal.sql` present and applied if production
  does not already have the audit schema.
- Existing storage tables remain intact; do not reset or rewrite production
  runtime data.
- `adult-shop` seeded from the current production catalog/config into
  `shops`, `shop_pages`, `shop_settings`, `shop_products`, and `shop_assets`.
- Encrypted active `shop_page_credentials` seeded only after the secret
  handling gate is approved. Do not print token plaintext, encrypted values,
  or the master key.
- Count-only verification after schema/seed for:
  `shops`, `shop_pages`, `shop_settings`, `shop_products`, `shop_assets`,
  `shop_page_credentials`, `webhook_queue`, `admin_roles`, `admin_users`,
  `admin_user_roles`, and `admin_audit_log`.

Environment required or expected before enabling DB-backed multi-shop:

- Existing production storage remains `STORAGE_ADAPTER=postgres` with
  `ALLOW_PRODUCTION_DB_WRITES=true`.
- `ADMIN_AUDIT_LOG_ENABLED=true` remains available before product/admin writes.
- `CREDENTIAL_MASTER_KEY` is set only after separate environment approval; do
  not rotate it without a credential re-encryption plan.
- `MULTI_SHOP_DB_CONFIG_ENABLED=true` is set only after schema, seed,
  credential, deploy, and rollback gates are approved.
- `RUNTIME_ALLOWED_SHOP_IDS` should initially restrict rollout to the intended
  production shop, for example `adult-shop`.
- `RUNTIME_ALLOWED_PAGE_IDS` is optional and only a post-resolution transition
  override; it does not allow unknown pages to fall back.
- `WEBHOOK_QUEUE_ENABLED=false` remains the production default until a separate
  queue rollout approves worker behavior, retry visibility, and rollback.
- `SESSION_SECRET`, `ADMIN_PUBLIC_BASE_URL`, `ADMIN_SESSION_COOKIE_NAME`,
  `ADMIN_EXPORT_TOKEN`, `ADMIN_ROLES`, `ADMIN_PRINCIPAL_ID`, and
  `ADMIN_PRINCIPAL_DISPLAY_NAME` should be verified by metadata only; do not
  print secret values.

Safe smoke checks that do not require authenticated admin access:

- Railway deployment metadata was verified read-only in this checkpoint; future
  re-checks should report commit/status only.
- Public `GET /healthz` was checked earlier in this checkpoint; future
  re-checks should report only `ok`, `storage.adapter`, `storage.ready`, and
  `messenger.dryRun`.
- Public `GET /admin/login` was checked earlier in this checkpoint; future
  re-checks should report HTTP status, title, and form presence only.

Smoke checks that need separate approval:

- Any authenticated admin route, including `/admin/dashboard`,
  `/admin/audit`, `/admin/api/shops`, `/admin/shops/:shopId`, and
  `/admin/api/shops/:shopId/health`, because audit logging can write
  `admin_audit_log` rows.
- Any product create/update/status/archive smoke, because it writes business
  data and audit rows.
- Any production internal-notes smoke, because reads write audit rows and POST
  writes business data.
- Any live webhook/Messenger smoke, because it can write runtime state and may
  send customer-visible replies.
- Any queue rollout smoke with `WEBHOOK_QUEUE_ENABLED=true`, because it writes
  `webhook_queue` rows and changes webhook processing behavior.

Rollback plan:

- If DB-backed runtime is unsafe, disable `MULTI_SHOP_DB_CONFIG_ENABLED` after
  production environment approval, restart or redeploy as needed, and keep the
  file-backed config path available.
- If runtime admission blocks the intended shop/page, adjust
  `RUNTIME_ALLOWED_SHOP_IDS` or `RUNTIME_ALLOWED_PAGE_IDS` only after
  environment approval; prefer shop IDs as the primary control.
- If credential resolution fails, disable DB-backed runtime rather than falling
  back to another page token. Do not rotate `CREDENTIAL_MASTER_KEY` without a
  re-encryption plan.
- If queue behavior is unsafe after a separately approved queue rollout,
  disable `WEBHOOK_QUEUE_ENABLED` after environment approval and leave additive
  queue rows in place.
- If product write smoke is unsafe, stop the smoke immediately, redeploy the
  previous known-good commit if needed, and do not delete product or audit rows.
- Leave additive tables in place unless a destructive cleanup has a fresh
  backup, reviewed rollback plan, and explicit approval.
- Archive only approved smoke products when cleanup is in scope.

Readiness blockers before production enablement:

- Latest Railway production deployment, public `/healthz`, and public
  `/admin/login` have been verified read-only, but this does not approve or
  replace any deployment, backup, schema, seed, env, authenticated smoke, or
  production write gate.
- Origin `main` contains newer safety commits through `0b45f6d` that are not
  deployed to production yet.
- A fresh production PostgreSQL backup has not been created for this rollout.
- Production multi-shop schema and credential schema have not been applied in
  this checkpoint.
- `adult-shop` production seed and encrypted page credential seed are not yet
  approved or verified.
- Production `CREDENTIAL_MASTER_KEY` and `MULTI_SHOP_DB_CONFIG_ENABLED` are
  not approved for change.
- Authenticated admin/shop/product smokes are not approved for this checkpoint.
- Queue production rollout remains out of scope; keep
  `WEBHOOK_QUEUE_ENABLED=false`.

## Production DB Patch Checkpoint - 2026-05-15

The targeted production DB patch
`db/production-missing-multishop-tables-patch.sql` has been applied to
production PostgreSQL. The apply output reported two table creations and five
index creations.

Post-apply count-only verification passed:

- `shops`: 1 row.
- `shop_pages`: 1 row.
- `shop_settings`: 1 row.
- `shop_products`: 14 rows.
- `shop_assets`: 16 rows.
- `shop_page_credentials`: created, 0 rows.
- `webhook_queue`: created, 0 rows.

Post-apply structure verification passed:

- `shop_page_credentials` indexes and constraints exist.
- `webhook_queue` indexes and constraints exist.

No deploy, production environment change, authenticated production smoke, or
production `/data` touch was performed during this checkpoint. No additional
production writes should be run as part of post-apply cleanup.

Next step completed by the production deploy checkpoint below. Remaining
credential, environment, authenticated smoke, and flag-enable gates still need
separate approval.

## Production Deploy Checkpoint - 2026-05-15

Production was deployed with the safety foundation present and dangerous flags
still off.

- Production deployed commit:
  `67efcbef921f5bf326f4e78120ea0c1d70c0295c`.
- Railway deployment:
  `5fe6036a-d728-4271-9f17-0572e6d79c8f`.
- Deployment status: `SUCCESS`.
- Deployment created at: `2026-05-15T10:23:06.761Z`.
- Deployment message: `Deploy 67efcbe safety foundation flags off`.
- The first `railway up` attempt timed out and created no deployment; the
  retry succeeded.

Post-deploy public checks passed:

- Public `GET /healthz`: HTTP `200`, `ok=true`, `shop=adult-shop`,
  `products=13`, `storage.adapter=postgres`, `storage.ready=true`,
  `messenger.dryRun=false`.
- Public `GET /admin/login`: HTTP `200`, `Admin Login` present, form action
  `/admin/login` present, password input `adminToken` present.

Safety boundary for this checkpoint:

- No production environment changes.
- No DB schema, data, or seed commands.
- No production `/data` access.
- No authenticated production smoke.
- No flag changes.
- No credential key changes.

Next step: treat the code deploy as complete, but keep DB-backed multi-shop,
credential seeding, queue rollout, environment changes, authenticated admin
smoke, and product CRUD smoke behind separate approvals.

## Production Incident Recovery Checkpoint - 2026-05-15

Railway production logs showed DB-backed multi-shop credential fail-closed
events after the safety foundation deploy. Adult-shop was restored by disabling
the DB-backed runtime flag and returning runtime page credentials to the safe
legacy fallback path.

- Changed production environment variable:
  `MULTI_SHOP_DB_CONFIG_ENABLED=false`.
- No credential master key was added.
- No credential rows were seeded.
- Webhook queue was not enabled.
- Railway deployment after the env change:
  `e5413261-87a9-4556-a5c4-53ab65f05666`.
- Deployment status: `SUCCESS`.
- Deployment created at: `2026-05-15T10:53:07.077Z`.

Post-recovery public checks passed:

- Public `GET /healthz`: HTTP `200`, `ok=true`, `shop=adult-shop`,
  `products=13`, `storage.adapter=postgres`, `storage.ready=true`,
  `messenger.dryRun=false`.
- Public `GET /admin/login`: HTTP `200`, login form present.
- Filtered Railway logs since the recovery deployment showed
  `credential_master_key_missing` count `0`.

Safety boundary for this checkpoint:

- No production DB writes.
- No production `/data` access.
- No authenticated production admin smoke.
- No raw secrets, env values, tokens, customer data, message payloads, or raw
  page IDs printed.
- No commit or push performed.

## Adult-Shop Credential Seed Preparation - 2026-05-15

This section is a local preparation plan only. It is not approval to set
`CREDENTIAL_MASTER_KEY`, seed production credentials, enable DB-backed runtime,
deploy, touch production `/data`, or run authenticated smoke.

Exact `shop_page_credentials` write target:

- `shop_id`: active `shops.id`, expected `adult-shop` for the first rollout.
- `page_mapping_id`: active `shop_pages.id` for the intended page mapping.
- `credential_type`: `fb_page_token`.
- `encrypted_value`: AES-GCM envelope from
  `core/credentials/page-credentials.js`; never print this value.
- `encryption_key_id`: default `default` unless a rotation plan chooses a
  different safe label.
- `key_version`: positive integer, default `1`.
- `status`: `active`.
- `metadata_json`: safe object metadata only; no tokens, raw page IDs, or
  customer data.

Local/staging helper:

```bash
node scripts/prepare-page-credential-seed.js --dry-run --shop-id adult-shop --page-id <page-id>
```

The helper uses `CHATBOT_TEST_DATABASE_URL` or `CHATBOT_STAGING_DATABASE_URL`
outside production. It intentionally ignores `DATABASE_URL` unless an approved
production apply is explicitly requested. It requires `CREDENTIAL_MASTER_KEY`
and a token from `PAGE_CREDENTIAL_TOKEN` or `FB_PAGE_TOKEN`, but prints neither
the token nor the encrypted value.

Safe seed flow for adult-shop:

1. Confirm a fresh production PostgreSQL backup exists and was verified.
2. Confirm `MULTI_SHOP_DB_CONFIG_ENABLED=false` remains the safe production
   runtime state.
3. Confirm `shop_page_credentials` exists and has no active credential for the
   intended active `adult-shop` page mapping.
4. Resolve exactly one active shop/page mapping with a count/query-safe lookup:
   active `shops.id = adult-shop`, active `shop_pages.page_id = <page-id>`.
5. Refuse to continue if the shop/page mapping is missing or ambiguous.
6. Refuse to continue if an active `fb_page_token` credential already exists.
   Rotation needs a separate explicit rotate mode/runbook; the initial helper
   is fail-safe and does not archive or replace existing credentials.
7. Encrypt the page token with `CREDENTIAL_MASTER_KEY` locally in process.
8. Insert exactly one active `shop_page_credentials` row only after explicit
   production DB write approval.
9. Print only safe summary fields: shop found, page found, active credential
   exists, credential inserted or dry-run no write.
10. Do not print token plaintext, encrypted value, `CREDENTIAL_MASTER_KEY`,
    `DATABASE_URL`, raw page ID, customer rows, messages, orders, or audit rows.

Approved production apply shape, for a future session only:

```bash
CONFIRM_PRODUCTION_WRITE="seed adult-shop page credential" \
node scripts/prepare-page-credential-seed.js --production --apply --shop-id adult-shop --page-id <page-id>
```

Do not run the production command until there is explicit approval for all of:
fresh backup, production secret handling, production DB write, and follow-up
count-only validation. After the seed, keep
`MULTI_SHOP_DB_CONFIG_ENABLED=false` until `CREDENTIAL_MASTER_KEY` is set,
credential resolution is validated, rollback is ready, and enabling the
DB-backed runtime has separate production environment approval.

## Production DB-Backed Runtime Real-Traffic Checkpoint - 2026-05-16

Production DB-backed runtime is enabled and real adult-shop traffic has been
observed healthy from the provided production state and log excerpts.

Runtime state for this checkpoint:

- `MULTI_SHOP_DB_CONFIG_ENABLED=true`.
- `WEBHOOK_QUEUE_ENABLED=false`; webhook processing remains on the inline path.
- `MESSENGER_DRY_RUN=false`, so production Messenger sends are live.
- Adult-shop live traffic is working on the DB-backed runtime path.

Observed production logs show the expected customer flow:

- `customer_message` received.
- Menu reply sent.
- `adult-shop-asset-menu-1` sent.
- `adult-shop-asset-menu-2` sent.
- Product images sent for `MÃ13` and `MÃ10`.
- Handoff started after product code.
- Later messages skipped due to handoff.

No visible DB fail-closed event, `page_not_found`, credential error, or
Messenger send error appeared in the provided logs for this checkpoint.

Rollback remains disabling `MULTI_SHOP_DB_CONFIG_ENABLED=false` after production
environment approval and restart or redeploy as needed. Keep
`WEBHOOK_QUEUE_ENABLED=false`; the next production-impacting gate should be
webhook queue enablement only after separate staging and production readiness
approval.

## Safety Rules

- Do not write production PostgreSQL before a fresh backup exists and is
  verified.
- Do not deploy production without explicit approval in the same session.
- Do not change production environment variables without separate approval.
- Do not run authenticated production admin smoke without approval because it
  writes audit rows.
- Do not print raw secrets, `DATABASE_URL`, tokens, cookies, customer data,
  order data, message rows, or audit metadata.
- Product writes must fail closed on aborted transactions.
- Runtime page resolution must fail closed for unknown pages instead of sending
  another shop's content.
- DB-backed runtime with a missing/decrypt-failed page credential must fail
  closed instead of using another shop's token or the legacy `FB_PAGE_TOKEN`.
- `FB_PAGE_TOKEN` remains only the file-backed legacy fallback.
- If `RUNTIME_ALLOWED_SHOP_IDS` or `RUNTIME_ALLOWED_PAGE_IDS` is set, resolved
  shops/pages outside those lists must fail closed. Use shop IDs as the primary
  control; page IDs are only a transition override.
- Product updates, status changes, and archive actions must stay shop-scoped;
  no cross-shop updates.
- Product code uniqueness is enforced per shop for active products.
- Keep `WEBHOOK_QUEUE_ENABLED=false` in production until schema apply, worker
  operation, retry observability, and rollback have separate approval.
- Keep file-backed config as rollback fallback until production DB-backed
  runtime has been proven safe.

## Rollback Notes

The multi-shop and admin audit schemas are additive. Default rollback stance is
non-destructive:

- If runtime behavior is wrong after deploy, disable
  `MULTI_SHOP_DB_CONFIG_ENABLED` after production env approval and redeploy or
  restart as needed.
- If queue behavior is wrong after an approved queue rollout, disable
  `WEBHOOK_QUEUE_ENABLED` after production env approval; leave additive queue
  rows in place unless a destructive cleanup is separately approved.
- If product writes show unsafe behavior, stop product write smoke immediately
  and redeploy the previous known-good commit.
- Leave additive tables in place unless a destructive rollback plan, fresh
  backup, and explicit approval exist.
- Do not delete audit rows or product rows as a rollback shortcut. Archive only
  approved smoke products when cleanup is in scope.

## Setup Wizard P1.1 MVP Completion Checkpoint - 2026-05-28

This checkpoint records the successful E2E staging implementation and verification of the P1.1 Admin Setup Wizard MVP in safe dry-run mode.

- **Status**: Completed and E2E Verified
- **Commit**: `0614e17 Add setup wizard dry-run simulation step`
- **Staging Verification URL**: `https://chatbot-fanpage-staging-staging.up.railway.app`
- **Setup Steps Completed**:
  - **Step 0 Pre-flight**: Env, dry-run, DB configuration, and connection checks.
  - **Step 1 Shop Shell**: Creation form with custom slug routing.
  - **Step 2 Products/Menu**: Bulk catalog seeding and welcoming settings.
  - **Step 3 Page Mapping**: Safe Facebook Page mapping in draft status.
  - **Step 4 Page Credential**: Secure context-bound credentials encryption.
  - **Step 5 Readiness Gate**: Integrity check separating hard blockers.
  - **Step 6 Dry-Run Simulation**: Sandbox deterministic webhook testing.
- **wizard-smoke-shop Final State**:
  - `dry_run = true`
  - `live_enabled = false`
  - `lifecycle = draft`
  - `last_manual_test_status = passed`
- **Incident Handling**: Addressed a staging database credential leak prior to E2E verification by rotating the database password programmatically, updating Postgres service variables, and propagating changes safely to all linked containers.
- **Safety Boundary**: No production actions, Meta Graph API calls, Messenger sends, or token health checks were executed. Credentials are strictly locked in dry-run mode.

## Open TODOs

- Asset upload and media direct integration enhancements.
- Dashboard UX for multi-shop operations is still basic.
- Multi-tenant admin identity separation is future work; current auth remains the static-token/session bridge.
- Product/admin pagination and search can be expanded after production MVP safety is proven.
- Metrics and analytics for multi-shop operations are future work.

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

## Next Engineering Steps Before Shop #2

This section is an engineering roadmap, not approval to deploy, change
production environment variables, or write production data.

1. Per-page credential resolution: local phase 1 done.
   store encrypted page credentials by shop/page and make Messenger sends select
   the resolved page token. Keep `FB_PAGE_TOKEN` only as the legacy file-backed
   fallback.
2. Atomic message idempotency: local phase 1 done.
   Runtime awaits `tryMarkMid()` before processing. PostgreSQL uses
   `INSERT ... ON CONFLICT DO NOTHING RETURNING`; file storage preserves the
   previous behavior behind the same interface.
3. Feature flag facade: local phase 1 done.
   Runtime bot-mode helpers now use the facade bridge and keep existing
   defaults/overrides before any schema migration.
4. Durable webhook queue:
   implement next. Use PostgreSQL queue rows with bounded retry and
   `FOR UPDATE SKIP LOCKED`; Redis is not needed for the current 5-20 shop
   target.
5. Per-shop health:
   expose last webhook, last successful send, send error rate, and credential
   status without raw tokens, raw page IDs, customer rows, messages, or orders.

## Production Rollout Order

Production rollout needs separate approval for each production-impacting gate.
Approval for one gate does not imply approval for later gates.

1. Re-check git state, latest production deployment, and public `/healthz`.
2. Create a fresh production PostgreSQL backup outside this repository.
3. Verify backup SHA256 and count-only summaries.
4. Review `db/multi-shop-proposal.sql`; confirm it is additive and
   idempotent.
5. Apply the multi-shop schema to production PostgreSQL.
6. Review `db/admin-auth-rbac-audit-proposal.sql`; confirm it is additive and
   idempotent.
7. Apply the admin audit schema to production PostgreSQL if production does
   not already have it.
8. Seed `adult-shop` into production PostgreSQL from the current production
   file-backed catalog/config.
9. Seed encrypted `shop_page_credentials` only after separate production secret
   handling/env approval. Do not print token plaintext, encrypted values, or
   `CREDENTIAL_MASTER_KEY`.
10. Verify count-only table state:
   `shops`, `shop_pages`, `shop_settings`, `shop_products`, `shop_assets`,
   `shop_page_credentials`, `admin_roles`, `admin_users`, `admin_user_roles`,
   and `admin_audit_log`.
11. Deploy the reviewed runtime/dashboard commit only after deploy approval.
12. Set `CREDENTIAL_MASTER_KEY` only after separate production environment
    approval.
13. Enable `MULTI_SHOP_DB_CONFIG_ENABLED=true` only after separate production
    environment approval.
14. Smoke public `/healthz` without auth.
15. Smoke admin shops read routes only after approval, because authenticated
    admin reads can write audit rows.
16. Smoke product CRUD with a test product code such as `ZB-SMOKE-001` only
    after explicit production DB write approval.
17. Archive the smoke product as cleanup and verify there is no duplicate
    active smoke code.
18. Verify count-only audit delta and product counts. Do not print raw audit,
    product, customer, order, or message rows.

Expected post-rollout product checks:

- Original production product count remains unchanged except for the archived
  smoke row.
- The smoke product is archived.
- There is no active duplicate smoke code.
- Product CRUD audit delta matches the approved smoke steps.

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
- Keep file-backed config as rollback fallback until production DB-backed
  runtime has been proven safe.

## Rollback Notes

The multi-shop and admin audit schemas are additive. Default rollback stance is
non-destructive:

- If runtime behavior is wrong after deploy, disable
  `MULTI_SHOP_DB_CONFIG_ENABLED` after production env approval and redeploy or
  restart as needed.
- If product writes show unsafe behavior, stop product write smoke immediately
  and redeploy the previous known-good commit.
- Leave additive tables in place unless a destructive rollback plan, fresh
  backup, and explicit approval exist.
- Do not delete audit rows or product rows as a rollback shortcut. Archive only
  approved smoke products when cleanup is in scope.

## Open TODOs

- Asset upload and asset management UI are still pending.
- Dashboard UX for multi-shop operations is still basic.
- Multi-tenant admin identity separation is future work; current auth remains
  the static-token/session bridge.
- Product/admin pagination and search can be expanded after production MVP
  safety is proven.
- Metrics and analytics for multi-shop operations are future work.

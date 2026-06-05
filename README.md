# ZenBot

ZenBot is a production-pilot Messenger operations system for running multiple
shops from one controlled backend. It is built for a practical shop workflow:
send menu/product information, route product-code interest into human handoff,
keep each Facebook Page isolated to the correct shop, and give the operator
clear safety gates before anything reaches real customers.

This repository is not a self-serve SaaS signup product yet. It is an internal
operations system in production pilot, with the roadmap intentionally frozen
around reliability, monitoring, rollback, and paid-customer validation.

## Current Status

Status as of the latest recorded runbooks, 2026-06-04:

- Production pilot is active.
- `adult-shop` is live on Messenger using the classic `menu_code_handoff`
  flow.
- Production health was verified with PostgreSQL storage ready, 13 products,
  and Messenger dry-run off for the live `adult-shop` runtime.
- Nem Bùi Xá completed controlled live verification: `menu` reached the live
  send path, menu text and image were sent, product code `TS01` sent the
  product image, handoff activated, no bot spam was observed after handoff, and
  observed send errors were `0`.
- Nem Bùi Xá was rolled back after the approved test window to non-live state:
  `dry_run=true`, `live_enabled=false`, and `lifecycle=configuring`.
- `WEBHOOK_QUEUE_ENABLED=false` remains the production-safe queue posture.
- Basic Sales v2 exists as a staging pilot overlay only; production customer
  traffic stays on classic `menu_code_handoff` unless separately approved.
- Production Page cutover remains blocked by design and is runbook-only.

## Product Freeze Policy

Major new features are frozen unless a paid customer validates demand.

Allowed work during the freeze:

- production safety fixes;
- monitoring, health, audit, and rollback improvements;
- operator UX that reduces onboarding or live-traffic mistakes;
- narrowly scoped pilot work with explicit approval and a rollback path.

Not allowed by default:

- self-serve signup or billing;
- payment or checkout integration;
- broad AI selling mode;
- new messaging channels such as WhatsApp or Instagram DM;
- analytics dashboards that are not needed for current pilot operations;
- major workflow expansion without a validated paying customer need.

## Case Study

### Problem

Small Messenger-first shops often need the same operational pattern: customers
ask for the menu, send a product code, receive a product image/detail, and then
staff take over the sale. The hard part is not the reply logic itself. The hard
part is preventing wrong-shop routing, accidental live sends, token mistakes,
uncontrolled production changes, and undocumented rollback under real Page
traffic.

### Solution

ZenBot turns the chatbot into an operator-controlled Messenger shop system:

- one backend can serve multiple shops;
- each Facebook Page resolves to exactly one active shop mapping;
- each Page uses its own encrypted Page token;
- runtime resolution fails closed when mapping, credential, mode, products, or
  admission checks are unsafe;
- global and per-shop dry-run gates control whether a message is logged or
  sent;
- admin screens expose readiness, health, safe next actions, and reversible
  controls.

### Outcome

The system has moved beyond a demo:

- live production shop operating on Messenger;
- PostgreSQL-backed production storage;
- second real shop verified through dry-run-first and controlled live windows;
- documented rollback artifacts and safety checkpoints;
- admin operations for setup, readiness, products/menu, Page connection,
  credential replacement, shop pause/resume, and dry-run control;
- runbooks for production backup, Page cutover, webhook queue rollout,
  Messenger policy boundaries, and Basic Sales v2 staging smoke.

## Architecture

ZenBot is a modular monolith on Node.js/Express. This is deliberate: at the
current 1-5 shop scale, a single deployable service keeps routing, rollback,
and data ownership simpler than microservices.

Core runtime:

- `index.js` wires Express, health, webhook, media, admin, storage, runtime
  resolution, and background workers.
- `core/webhook.js` receives Meta webhooks, verifies requests, deduplicates
  message IDs, skips stale or bot echo events, resolves the shop runtime, and
  dispatches replies.
- `core/shops/db-shop-config.js` resolves DB-backed shop configuration from
  the incoming Page mapping.
- `core/credentials/page-credentials.js` encrypts and decrypts per-Page
  credentials using the runtime credential master key.
- `core/messenger-client.js` is the single wrapper for Graph Send API calls,
  dry-run behavior, image sends, quick replies, typing, and token health
  support.
- `core/storage` supports PostgreSQL-backed runtime storage with legacy file
  fallback retained for rollback.

Admin and operations:

- Server-rendered admin routes live under `core/admin-*` and `core/admin/`.
- Shop onboarding, product/menu management, Page connection, credential
  replacement, readiness, safety controls, health, and audit are managed from
  the admin surface.
- Current admin identity is a static-token/session bridge with RBAC/audit
  foundations. Multi-admin real identity is future work.

Data model highlights:

- `shops` stores lifecycle, dry-run, live, and readiness state.
- `shop_pages` maps one Facebook Page to one active shop.
- `shop_page_credentials` stores one active encrypted Page token for the
  active mapping.
- `shop_products` and `shop_assets` hold the shop catalog and images.
- `processed_mids` provides webhook idempotency.
- `webhook_queue` exists as an additive queue table but the runtime queue gate
  remains disabled until a separate rollout approval.

## Safety Gates

Production operations follow a fail-closed posture:

- no deploy without same-session approval;
- no push without same-session approval;
- no production environment change without separate approval;
- no production PostgreSQL write without a fresh verified backup and separate
  DB write approval;
- no Meta Graph call, token health check, or Messenger send unless the target
  environment and action are explicit;
- no raw tokens, Page IDs, sender IDs, database URLs, message bodies, or
  customer records in logs or docs;
- DB-backed runtime with unknown Page, ambiguous mapping, inactive shop,
  missing credential, decrypt failure, unsupported mode, or empty catalog fails
  closed instead of falling back to another shop.

Production `adult-shop` is also protected from dangerous onboarding, cutover,
delete, and casual control paths.

## Dry-Run To Live Workflow

The real Page pilot flow is dry-run first:

1. Confirm owner approval, product/menu scope, staff availability, rollback
   owner, pilot operator, and monitoring owner.
2. Confirm the target Page has exactly one active mapping and one active
   credential.
3. Keep the target shop in `dry_run=true` and `live_enabled=false`.
4. Run the approved dry-run simulation for menu and the exact product code.
5. Confirm product, image, credential, handoff, and wrong-shop isolation.
6. Open a controlled live window only after separate approval.
7. Test only the approved triggers.
8. Roll back immediately on send error, wrong product/image, wrong-shop
   routing, or staff unavailability.
9. Return the target to non-live state after the approved window unless a
   separate live-traffic approval exists.

Nem Bùi Xá followed this process and completed the controlled live verification
for `menu` and `TS01`, then returned to non-live state.

## Rollback

Rollback is designed to be reversible and non-destructive:

- per-shop pause/resume fails closed while preserving data;
- per-shop dry-run can be re-enabled without deleting mappings or credentials;
- live flags return the shop to configuring/non-live state after a test window;
- queue rollout rollback is `WEBHOOK_QUEUE_ENABLED=false`, leaving queue rows
  in place;
- DB-backed runtime rollback can use the documented
  `MULTI_SHOP_DB_CONFIG_ENABLED` control after production env approval;
- Page cutover rollback is planned as a reverse cutover, not manual row flips;
- product, audit, credential, message, queue, and runtime data rows are not
  deleted as rollback shortcuts.

Production backup policy requires verified backups outside the repo before
approved production DB writes. The recorded production rollout used a verified
PostgreSQL backup and retained a previous deployment rollback target.

## Health And Observability

ZenBot exposes both global and per-shop health posture:

- public `/healthz` for service, active shop, product count, storage adapter,
  storage readiness, and Messenger dry-run posture;
- per-shop admin health API/card for last webhook, last successful send, 1h
  send error rate, active handoff count, Page mapping counts, credential status
  counts, queue status counts, oldest queued job age, failed queue count, and
  last safe failed error code;
- `processed_mids` retention visibility with count-only totals and age buckets;
- operational warnings for send errors, queue failures, stale/unavailable
  credential posture, and recent webhooks without later successful sends.

Health views are intentionally redacted: they report safe counts, timestamps,
statuses, and error codes, not raw customer payloads or secrets.

## Audit And Compliance Posture

Admin write paths are designed to be audited and scoped:

- product writes, shop creation, Page/credential operations, and future cutover
  flows use safe audit metadata;
- audit records store actor, action, resource, outcome, tenant/page context,
  request ID, hashed IP, user agent, and redacted JSON metadata;
- audit rows must not contain raw tokens, database URLs, Page IDs, full phone
  numbers, addresses, customer exports, or message bodies;
- writes fail closed when required audit transactions fail.

The current production posture is suitable for a controlled pilot. Full
multi-admin identity and production-grade user provisioning are intentionally
future work.

## Messenger Policy Boundary

Basic shops keep automated Messenger sends inside the standard response flow.
Product-code lookup, product image/detail, and staff handoff are the primary
sales path.

Blocked until separately reviewed:

- automated sales reminders outside the standard Messenger window;
- message tags for promotional content;
- Human Agent tag automation;
- One-Time Notification or recurring notification flows;
- AI-generated free-form sales replies.

## Key Runbooks

- `docs/active-delivery-plan.md` - current project stage, safety rules, and
  next work.
- `docs/production-rollout-checkpoint.md` - verified production rollout state.
- `docs/real-page-pilot-checklist.md` - dry-run-first and controlled live Page
  pilot record.
- `docs/production-page-cutover-runbook.md` - future Page cutover procedure and
  approval gates.
- `docs/webhook-queue-rollout-runbook.md` - staged queue rollout and rollback.
- `docs/production-data-backup-runbook.md` - production data backup discipline.
- `docs/basic-sales-v2-behavior-contract.md` - staging-only v2 behavior
  contract.
- `docs/messenger-outside-24h-review.md` - Messenger standard-window policy
  posture.
- `docs/processed-mids-retention-plan.md` - idempotency retention visibility
  and cleanup gates.

## Near-Term Priorities

1. Keep the current production pilot stable.
2. Preserve the `adult-shop` live path and file-backed fallback boundary.
3. Keep Nem Bùi Xá in non-live state unless a new approved live window exists.
4. Keep Basic Sales v2 staging-only until a production approval path exists.
5. Keep webhook queue production enablement blocked until staged rollout,
   backup, approval, and monitoring gates pass.
6. Improve operator productivity only where it reduces mistakes or supports a
   paid-customer-validated need.

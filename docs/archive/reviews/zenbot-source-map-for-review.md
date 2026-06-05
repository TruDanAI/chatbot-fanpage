# ZenBot Source Map For External Review

Generated from static code and documentation inspection on 2026-05-25.

This report is docs-only. It intentionally excludes secrets, raw Page IDs,
tokens, customer data, database URLs, and message bodies. No deploy, environment
change, database write, `/data` access, token health check, Meta Graph API call,
or Messenger send was performed for this report.

## Architecture Overview

ZenBot is a Node.js/Express Messenger chatbot with a legacy file-backed shop
runtime and an opt-in DB-backed multi-shop runtime.

The current architecture has three major surfaces:

- Runtime webhook path: `index.js`, `core/webhook.js`,
  `core/messenger-client.js`.
- Multi-shop resolution and runtime materialization:
  `core/shops/db-shop-config.js`, `core/credentials/page-credentials.js`,
  `core/storage-config.js`, `core/webhook-queue.js`.
- Admin control plane: `core/admin-routes.js`, `core/admin/views.js`,
  `core/admin/read-routes.js`, and the write services under `core/admin/`.

The runtime still boots a file-backed shop config from `shops/<SHOP_ID>`, but
when `MULTI_SHOP_DB_CONFIG_ENABLED=true`, webhook events can resolve a shop by
incoming Page mapping from PostgreSQL. The DB-backed runtime uses per-shop
products, assets, behavior flags, storage context, and encrypted page
credentials. Unknown or unsafe runtime resolution is designed to fail closed.

Important architectural pattern:

- Admin writes are service objects with explicit validation, transactions,
  commit-result checks, and audit rows.
- Runtime sends go through `createMessengerClient()`, which has global and
  per-page dry-run behavior.
- Identifiers in logs are generally reduced to safe refs through
  `core/utils/log-refs.js`.

## Key Files

| Area | Files | Role |
|---|---|---|
| App entry | `index.js` | Loads env, file shop config, storage, Messenger client, webhook, reminders, admin routes, DB runtime resolver, optional webhook queue. |
| Webhook | `core/webhook.js` | Verifies webhook signature, handles GET verification and POST events, resolves runtime per Page, dedupes MIDs, handles stale events, menu-code handoff, images, fallback, handoff, queue integration. |
| Messenger | `core/messenger-client.js` | Wraps Graph send calls, chunking, images, carousel, quick replies, typing, dry-run behavior, page-scoped token override. |
| DB shop config | `core/shops/db-shop-config.js` | Resolves active `shop_pages` mapping to shop/settings/products/assets and normalizes into runtime config. |
| Credentials | `core/credentials/page-credentials.js` | AES-GCM envelope encryption/decryption for active page credentials; DB runtime fails closed if credential lookup/decrypt fails. |
| Admin routes | `core/admin-routes.js` | Registers HTML and JSON admin routes, auth, sessions, audit, dashboard reads, shop/page/credential/product/asset/settings/control writes. |
| Admin views | `core/admin/views.js` | Server-rendered admin UI, onboarding checklist, tabs for overview/pages/settings/products/assets, safe masking helpers. |
| Admin reads | `core/admin/read-routes.js` | Authenticated dashboard/shop/user/audit/internal-note read handlers and safe presentation setup. |
| Admin writes | `core/admin/*.js` | Transactional write services for shop shell, settings, control plane, products, imports, assets, uploads, page mappings, credentials. |
| DB schema | `db/schema.sql`, `db/multi-shop-proposal.sql`, patch files | Runtime storage schema, multi-shop control schema, targeted additive production patches. |

## Runtime Flow

Startup in `index.js`:

1. Loads `.env` and core modules.
2. Loads a file-backed shop from `shops/<SHOP_ID>` or `ACTIVE_SHOP`, with a
   legacy default.
3. Builds rule engine, AI client, notification service, image service,
   Messenger client, reminder workers, and admin routes.
4. If DB-backed runtime is enabled, configures `resolveDbShopRuntimeForPage()`.
5. If webhook queue is enabled, creates a PostgreSQL queue repository and
   worker.
6. Starts Express and registers `/webhook`, `/healthz`, media routes, and
   `/admin` routes.

Webhook request flow in `core/webhook.js`:

1. `GET /webhook` validates the verify token and returns the challenge.
2. `POST /webhook` validates the app secret signature when configured.
3. If queue mode is on, events are enqueued after signature validation and
   Meta gets a `200`; a worker processes jobs later.
4. If queue mode is off, Meta gets a `200` immediately and events are handled
   inline in the background.
5. Each event resolves a runtime:
   - no resolver: use file config, optionally fail closed if Page allowlist is
     configured and the Page is not known;
   - DB resolver: lookup active `shop_pages`, shop, settings, active products,
     active assets, active encrypted credential, runtime storage context, and
     dry-run decision.
6. MID idempotency is marked before processing. Storage errors fail closed.
7. Stale events are skipped.
8. Bot echoes are skipped; human Page replies trigger handoff.
9. In `menu_code_handoff` mode, the specialized handler sends menu/product
   images, product info, and handoff message, then returns without full AI/order
   side effects.
10. In full mode, lead/order capture, handoff, deterministic rules, AI fallback,
    quick replies, image sends, Sheets push, and Telegram alerts can run.

DB runtime fail-closed reasons include missing/ambiguous Page mapping, resolved
shop not allowed by runtime allowlist, live-gate failure, empty products,
unsupported/disabled bot mode, credential lookup failure, missing/decrypt-failed
credential, and unavailable storage context.

## Multi-Shop Config

`core/shops/db-shop-config.js` reads:

- `shops`: shop identity, status, package, lifecycle, live gate, dry-run, locale,
  timezone, readiness fields.
- `shop_pages`: Page-to-shop mapping. Runtime requires active mapping and active
  shop.
- `shop_settings`: bot mode, handoff settings, menu intro, fallback text,
  `settings_json`.
- `shop_products`: active catalog rows ordered by sort/code/id.
- `shop_assets`: active menu/product/shop image assets.

The normalized runtime config includes:

- `botMode` with behavior toggles.
- `ruleToggles`.
- policies/templates/intents/recommendations.
- `__dbShop` metadata for tenant/shop/page/lifecycle/live/dry-run.
- `__assets.menuImages` and `__assets.productImagesByCode`.
- `__products`.

The resolver tolerates missing newer control-plane columns by retrying with a
reduced select and marking column availability. This is useful during staged
migration but should be reviewed as technical debt after schema convergence.

## Admin Onboarding Flow

Admin is implemented as server-rendered HTML plus JSON API endpoints under
`/admin`.

Typical onboarding path:

1. Create shop shell:
   - `GET /admin/shops/new`
   - `POST /admin/shops`
   - `POST /admin/api/shops`
   - writes one `shops` row, one default `shop_settings` row, and one audit row.
2. Configure chat behavior:
   - `POST /admin/shops/:shopId/settings`
   - supports bot mode, handoff, menu intro, fallback, and rule toggles.
3. Add/import products:
   - individual product create/update/status/archive;
   - bulk CSV import via `product-import-writes.js`.
4. Add assets:
   - public URL asset writes through `asset-writes.js`;
   - bulk menu image URL import;
   - optional Cloudinary upload MVP through `asset-uploads.js`.
5. Preview Page setup:
   - mapping preview validates format/conflict without accepting tokens;
   - credential preview validates prerequisites without accepting tokens or
     running health checks.
6. Create Page mapping:
   - validates Page ID shape;
   - prevents duplicate active mapping;
   - protected preview-only behavior exists for certain configuring/non-live
     demo states.
7. Create or rotate Page credential:
   - validates token length and master key presence;
   - encrypts credential;
   - rotate mode archives active scoped credentials and inserts replacement.
8. Readiness/control:
   - control plane supports package, lifecycle, live flag, manual test status;
   - readiness checks shop active, bot mode, active mapping, active credential,
     active products, active menu image, manual test, and product-image warning.

Page mapping archive:

- Implemented in `page-mapping-writes.js`.
- Staging-only by runtime check.
- Requires explicit confirmation text.
- Rejects raw Page ID in archive body.
- Archives scoped active credentials with the mapping.
- Protects the legacy protected shop from archive.

Cloudinary upload MVP:

- Behind `ADMIN_IMAGE_UPLOAD_ENABLED`.
- Requires valid Cloudinary config.
- Accepts JPEG/PNG/WebP only.
- Rejects SVG, wrong MIME/extension/magic bytes, oversized files, unsupported
  product-code upload linkage, and non-active/wrong-shop product image targets.
- Cleans up Cloudinary best-effort if DB/audit persistence fails.

## DB Model Summary

`db/schema.sql` is the runtime storage schema:

- `profiles`: customer profile per tenant/page/sender.
- `conversations`: session state, last product, handoff, timeout, draft state.
- `messages`: conversation turns and Facebook MID uniqueness.
- `orders`: draft/ready/confirmed/abandoned order state.
- `order_items`: order line items.
- `events`: operational/customer event stream and sheet sync metadata.
- `processed_mids`: idempotency table for webhook MIDs.

`db/multi-shop-proposal.sql` is the full multi-shop baseline:

- `shops`: shop identity, status, package, lifecycle, live flag, dry-run,
  readiness/manual-test fields, locale/timezone.
- `shop_pages`: Page mapping to shop with active/paused/archived status.
- `shop_settings`: behavior mode and JSON settings.
- `shop_products`: per-shop products with active/hidden/archived status.
- `shop_assets`: product/menu/shop images via public URL or object storage.
- `shop_page_credentials`: encrypted active/paused/archived page credentials.
- `webhook_queue`: durable queue rows for async webhook processing.

Recent patches:

- `db/production-missing-multishop-tables-patch.sql`: adds only
  `shop_page_credentials` and `webhook_queue` plus indexes for environments
  that already have the first five multi-shop tables.
- `db/shop-lifecycle-readiness-patch.sql`: adds package/lifecycle/live/readiness
  and manual-test columns/checks to `shops`; active `adult-shop` is the only
  migration-time live backfill, while other missing rows stay non-live by
  default and readiness stays `unknown`.
- `db/shop-dry-run-patch.sql`: adds per-shop `dry_run`, backfilled true for
  safety except active `adult-shop`, which is preserved as
  `dry_run=false` for live Messenger behavior.

## Env And Feature Flags

| Flag/env | Current code behavior |
|---|---|
| `MESSENGER_DRY_RUN` | Global Messenger dry-run. When true, `postFb()` returns a dry-run result and does not call Graph. Per-shop dry-run can also force scoped DB runtime sends into dry-run. `storage-config.js` currently refuses this flag in detected production, which conflicts with runbook language that treats it as a kill switch. |
| `MULTI_SHOP_DB_CONFIG_ENABLED` | Enables DB-backed runtime resolution by incoming Page mapping. Also forbids file storage through `assertStorageAdapterAllowed()` when enabled. |
| `SHOP_LIVE_GATE_ENABLED` | When enabled, DB runtime requires active shop, lifecycle `live`, and `live_enabled=true`; missing control-plane schema also fails closed. |
| `WEBHOOK_QUEUE_ENABLED` | Default false. When true, webhook POST enqueues events after signature validation and worker claims jobs from `webhook_queue`. |
| `ADMIN_IMAGE_UPLOAD_ENABLED` | Enables admin image upload forms/API and Cloudinary-backed upload service. Disabled returns not found/feature unavailable behavior. |
| `RUNTIME_ALLOWED_PAGE_IDS` | Optional post-resolution allowlist. It does not make unknown pages valid and does not permit fallback to another shop. |
| `RUNTIME_ALLOWED_SHOP_IDS` | Optional primary runtime allowlist for resolved shop IDs. Startup validates configured shop IDs against active DB shops when DB runtime is enabled. |
| `ONBOARDING_DEMO_PAGE_ID` / `ONBOARDING_DEMO_PAGE_TOKEN` | No direct references found in the inspected code. Current code uses admin page setup flows plus script-specific variables such as test/credential page envs. |
| `FB_PAGE_TOKEN` | Required legacy file-backed token. DB-backed runtime uses encrypted `shop_page_credentials`; missing DB credential fails closed and does not fall back to this token. |
| `CREDENTIAL_MASTER_KEY` | Required to decrypt DB-backed page credentials and to write encrypted admin credentials. Missing key causes credential lookup/write fail-closed behavior. |

## Test Coverage Summary

Tests were inspected but not re-run for this report.

Relevant coverage includes:

- `tests/multi-shop-isolation.test.js`
  - two mapped shops with different per-shop dry-run values;
  - unmapped Page fail-closed with no storage/send side effects;
  - global dry-run kill switch behavior in mocked sends.
- `tests/webhook.test.js`
  - file config path, DB runtime resolver path, MID idempotency, stale events,
    non-retryable Messenger send blocks, queue on/off behavior, queue signature
    validation, referral/menu dedupe, minimal mode side-effect suppression.
- `tests/messenger-client.test.js`
  - dry-run does not call Graph;
  - scoped dry-run and page-scoped token behavior;
  - missing scoped token does not fall back to legacy token.
- `tests/asset-uploads.test.js`
  - upload disabled/misconfigured fail before DB/provider;
  - MIME/extension/magic-byte/SVG validation;
  - same-shop active product checks;
  - Cloudinary cleanup on unsafe URL, DB failure, or audit failure;
  - runtime compatibility of uploaded URLs.
- `tests/page-mapping-writes.test.js`
  - create mapping transaction and safe audit;
  - duplicate active mapping rejection;
  - preview-only protection;
  - staging-only archive;
  - scoped credential archive;
  - rollback on audit failure;
  - protected shop archive rejection.
- `tests/page-credential-writes.test.js`
  - missing key/token pre-transaction rejection;
  - encryption and safe response/audit;
  - duplicate active credential rejection;
  - rotate behavior;
  - demo-shop staging dry-run unlock constraints.
- `tests/product-import-writes.test.js`
  - product upsert and image asset upsert;
  - validation-only preview;
  - row-level validation errors without unsafe value echo;
  - readiness-count impact.
- `tests/shop-control-writes.test.js`
  - control-plane validation;
  - readiness blockers/warnings;
  - live confirmation and readiness override behavior.

## Current Milestones

Recorded project milestones from docs:

- Demo-shop Basic staging E2E passed: readiness, real Messenger menu flow, code
  test, no send errors, staging restored to dry-run state.
- Onboarding demo shop staging E2E passed: admin API/UI created a second shop,
  readiness passed, Messenger flow passed, product CSV import smoke created
  products/images, no wrong-shop routing observed.
- `nem-bui-xa` Basic dry-run E2E passed: shop shell, products, menu image,
  product image, Page mapping, credential, readiness, dry-run menu/code checks,
  no real sends.
- `nem-bui-xa` real Messenger staging test passed: menu and code test, menu and
  product image sent, handoff active, no send errors, rollback to dry-run and
  non-live state recorded.
- `nem-bui-xa` P3.3 second controlled production live window passed for the
  approved scope: `menu` reached live path `send_allowed`, menu text/image
  sent, product code `TS01` sent product image and activated handoff, extra
  inbound after handoff was skipped, send errors were `0`, staff takeover was
  manually confirmed by Trung in Page inbox, and rollback returned the target
  to `dry_run=true`, `live_enabled=false`, `lifecycle=configuring` with no live
  state remaining.
- Cloudinary upload MVP implemented and covered by tests.
- Page mapping archive control implemented as staging-only with confirmation,
  scoped credential archive, protected-shop guard, and safe audit.

Note: `.agent/project-state.md` is older than the latest rollout checklist and
contains volatile flag state. Treat live environment state as out of scope for
this static report unless re-verified in an approved operational session.

## Current Risks And Pain Points

- Admin UX complexity: onboarding is spread across shop shell, settings,
  products, assets, Page mapping, credential, readiness, and control-plane
  forms. A setup wizard would reduce operator error.
- Env confusion: runbooks describe dry-run as a safety switch, while
  `assertMessengerDryRunAllowed()` refuses `MESSENGER_DRY_RUN=true` in
  production. This needs an explicit design decision.
- File-backed and DB-backed runtime coexistence: useful for rollback, but
  increases mental overhead and requires strong fail-closed guarantees.
- Schema compatibility retries in DB config hide missing columns at runtime.
  This helps migrations but can mask incomplete rollout state.
- Shop archive/pause UX is incomplete as an operator workflow. Lifecycle values
  exist in the control plane, but the admin experience is still not a clear
  first-class pause/archive flow.
- Page mapping archive is staging-only. Real Page pilot and production cleanup
  may need an approved, safer production-capable equivalent or a separate
  runbook.
- Webhook queue is implemented but not rolled out. Enabling it changes failure,
  retry, and observability behavior and writes queue rows.
- Credential lifecycle is basic: create/rotate active scoped credential is
  present, but broader rotation/re-encryption, expiry, and health visibility
  need review.
- Audit metadata is generally safer than raw payloads, but some admin write
  services still include shop/product/asset IDs in audit metadata. Confirm
  whether that is acceptable for the external review threat model.
- Product and asset admin writes are powerful. Strong RBAC, audit fail-closed,
  and rollback runbooks are central to safety.

## Questions For External Reviewer

1. Should the file-backed runtime remain as a long-term rollback path, or should
   the architecture converge to DB-backed-only once multi-shop is proven?
2. Is the current fail-closed policy correct for every DB runtime failure, or
   should any failures degrade to a staff-only alert path?
3. How should production dry-run be modeled, given the code currently refuses
   `MESSENGER_DRY_RUN=true` in production while operations docs treat it as a
   kill switch?
4. Should `RUNTIME_ALLOWED_PAGE_IDS` exist at all, or should rollout admission
   use only shop IDs to reduce Page-ID handling risk?
5. Is the admin onboarding flow ready for real operators, or should a setup
   wizard become a blocking milestone before more shops are onboarded?
6. Should page mapping archive become a production-capable guarded operation,
   or remain staging-only with separate manual production runbooks?
7. Is the readiness model sufficient for live gating, especially with
   product-image warnings instead of blockers?
8. Is the webhook queue design acceptable for the expected 5-20 shop scale, or
   should queue rollout wait for stronger monitoring and dead-letter handling?
9. Are credential create/rotate semantics enough, or should the project add
   explicit credential expiry, rotation windows, and re-encryption tooling?
10. Are admin audit contents safe enough for long-term retention, especially
    IDs, product codes, URL hosts, and changed-field metadata?
11. Should Cloudinary uploads stay inside admin, or should object storage be
    abstracted before more providers or tenants are added?
12. What is the minimum production pilot scope for the real Page: dry-run only,
    controlled live window, or full live gate with monitoring?

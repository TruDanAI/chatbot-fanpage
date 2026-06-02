# Source Map Current

Static snapshot: 2026-06-02. This is a sprint handoff map, not an
architecture review.

Boundary for this doc pass: docs only. No deploy, env change, DB write,
`/data` access, Meta Graph API call, token health check, or Messenger send was
performed.

## Runtime Entrypoints

- `package.json`
  - `npm start` runs `node index.js`.
  - `npm test` runs `node tests/index.js`.
- `index.js`
  - Loads `.env`, storage, file shop runtime, rule engine, AI client, image
    service, Messenger client, reminders, webhook, admin, and wizard routes.
  - Registers `/`, `/healthz`, `/webhook`, media routes, `/admin`, and
    `/admin/wizard`.
  - If `MULTI_SHOP_DB_CONFIG_ENABLED=true`, resolves incoming Pages through
    DB-backed shop config.
  - If `WEBHOOK_QUEUE_ENABLED=true`, starts a PostgreSQL webhook queue worker.
  - Important: `startServer()` calls `checkPageToken()` and starts background
    workers. Do not boot runtime when token health checks or data writes are
    out of scope.
- `core/webhook.js`
  - Registers `GET /webhook` and `POST /webhook`.
  - Verifies app secret when configured, handles queue/inline processing,
    resolves runtime per Page, dedupes MIDs, skips stale/bot echo events, and
    sends replies through the runtime Messenger facade.
- `core/messenger-client.js`
  - Single Graph send wrapper for text, quick replies, images, carousel,
    typing, scoped page token, dry-run, and token health check.
- `core/image-service.js`
  - Registers media routes and resolves file/DB image URLs for menu and
    product image sends.
- `core/sheets-webhook.js`
  - Pushes leads to a Google Sheet webhook and replays an outbox file under the
    storage data directory when workers run.
- `core/reminder-service.js`
  - Abandoned cart and engaged follow-up workers. Adult classic has follow-up
    enabled in config.

## Adult-Shop Classic Dependency Chain

Current live classic path is file-backed and defaults to `adult-shop`.

1. Env `SHOP_ID` or `ACTIVE_SHOP` selects `shops/<id>`; empty or unsafe id
   falls back to `adult-shop`.
2. `index.js` loads:
   - `shops/adult-shop/config.js`
   - `shops/adult-shop/products.csv`
   - `shops/adult-shop/custom-intents.js`
   - local images under `shops/adult-shop/images/`
3. `applyBotModeConfig()` normalizes the shop config.
4. `createRuleEngine()` combines products, templates, custom intents, state,
   and product-code lookup.
5. `createImageService()` resolves local menu/product images.
6. `createMessengerClient()` uses legacy `FB_PAGE_TOKEN` unless DB runtime
   supplies a scoped token.
7. `createWebhook()` uses the file runtime when DB runtime resolution is not
   enabled or no resolver is injected.

Adult classic config notes:

- `botMode.name` is `menu_code_handoff`.
- AI fallback, order flow, lead capture, recommendation flow are disabled.
- Product-code lookup, menu sending, post-product handoff, and follow-up are
  active.
- `custom-intents.js` prepends 18+ age, gel, experience, and vibration intents.

## DB-Backed V2 Pilot Chain

Target pilot path is DB-backed, per-shop, and fail-closed.

1. Incoming webhook Page id enters `resolveDbShopRuntimeForPage()`.
2. `core/shops/db-shop-config.js` loads active shop, active page mapping,
   settings, products, and assets.
3. Runtime admission checks active shop, optional allowlists, and live gate.
4. Only `menu_code_handoff` is supported by current DB runtime.
5. `core/credentials/page-credentials.js` decrypts one active
   `fb_page_token` credential for the mapped Page.
6. `storage.forContext({ tenantId, pageId, shopId })` scopes runtime state.
7. Effective Messenger dry-run is global `MESSENGER_DRY_RUN` OR shop
   `dry_run`; missing shop dry-run column currently falls back to legacy live
   behavior.
8. Runtime-specific rule, image, AI, notification, lead, storage, and
   Messenger facades are built for that Page/shop.

DB runtime fails closed for unknown Page, ambiguous mapping, inactive shop,
allowlist miss, live-gate miss, empty products, unsupported/disabled bot mode,
credential lookup/decrypt failure, or missing storage context.

## Admin Modules

- `core/admin-routes.js`: main admin route aggregator, auth wiring, API/HTML
  handlers, presenters, and write service creation.
- `core/admin/wizard-routes.js`: setup wizard routes and guards. Blocks
  `adult-shop` and reserved slugs.
- `core/admin/wizard-ui.js`: wizard layout, safety badges, requirement UI.
- `core/admin/views.js`: server-rendered admin views and shop detail UI.
- `core/admin/read-routes.js`: dashboard, shop detail, health, audit,
  internal notes, and legacy read handlers.
- `core/admin/reader.js` and `dashboard-repository.js`: read-only dashboard
  and shop-health SQL.
- `core/admin/session.js`, `route-auth.js`, `admin-auth.js`: sessions,
  principals, roles, permissions, and bearer compatibility.
- `core/admin/audit.js`: audit log insert helpers.
- Write services:
  - `shop-writes.js`, `shop-settings-writes.js`, `shop-control-writes.js`,
    `shop-delete-writes.js`
  - `product-writes.js`, `product-import-writes.js`
  - `asset-writes.js`, `asset-uploads.js`
  - `page-setup-preview.js`, `page-mapping-writes.js`
  - `page-credential-writes.js`, `page-cutover-writes.js`
  - `internal-notes.js`
- `core/admin/legacy-routes.js`: legacy exports/state compatibility.

## Dormant Or Gated Features

- Full AI/order/lead capture flow exists but is not active for adult classic
  `menu_code_handoff`.
- Webhook queue is gated by `WEBHOOK_QUEUE_ENABLED=false` by default.
- Cloudinary image upload is gated by `ADMIN_IMAGE_UPLOAD_ENABLED`.
- Page token health code exists in `core/messenger-client.js`,
  `core/credentials/page-token-health.js`, and scripts/tests, but must not run
  during this sprint.
- Page cutover service is staging-only and protects `adult-shop`, `demo-shop`,
  and `nem-bui-xa`.
- Legacy file storage remains available unless DB runtime is enabled; it can
  create/write the project `data/` directory on require/startup.
- Legacy admin routes remain registered for exports/state compatibility.

## Do-Not-Touch List

- `shops/adult-shop/**`
- `core/webhook.js`
- `core/messenger-client.js`
- `core/storage.js`, `core/storage/**`, and any runtime data directory
- `core/credentials/**`
- `core/shops/db-shop-config.js`
- `db/**` production patch files
- Railway/env configuration and secrets
- Production DB, backups, `/data`, and any storage volume
- Meta Graph API, token health checks, and Messenger sends
- Runtime code during this Day 1 docs sprint

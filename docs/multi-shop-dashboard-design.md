# Multi-Shop Dashboard Design

Status: Phase A design only.

This document proposes the architecture for managing multiple Messenger shops
from the admin dashboard without requiring a code commit, push, or redeploy for
routine shop configuration changes.

## Goals

- Allow the owner to add or update shop configuration from the dashboard.
- Avoid redeploying production just to add a shop, update product/menu data,
  change images, or switch the bot mode for one shop.
- Resolve each incoming Messenger event to the correct shop by `page_id`.
- Keep the current file-based shop configuration available as a rollback
  fallback while the DB-backed runtime is rolled out.
- Keep production migration gated by backup and explicit approval.

## Current Problem

The current shop configuration is tied to code and repository files. Adding a
new shop or changing an existing shop requires a manual edit, commit, push, and
deploy before the runtime can use the new settings.

That is acceptable for a single controlled shop, but it becomes risky and slow
when the owner needs to operate multiple shops or make routine catalog changes.
Product data, image metadata, bot behavior, and page-to-shop mapping should be
stored as operational data instead of being hard-coded into the runtime.

## Target Architecture

### Page-to-Shop Resolution

Incoming Messenger webhook payloads include the Facebook `page_id`. The runtime
should use that value as the first lookup key:

```txt
page_id -> shop_pages -> shop_id -> shop configuration
```

`shop_pages` allows one shop to own one or more Facebook pages over time. A page
must resolve to exactly one active shop for runtime handling.

### Shop Settings DB

Shop-level settings should live in PostgreSQL and be loaded by `shop_id`.
Settings include display name, locale, timezone, operating flags, default bot
mode, staff handoff text, and other runtime options that are not secrets.

Secrets and platform tokens should remain in environment-managed secret storage
until there is a separately designed secret-management flow.

### Products DB

Products should be stored as shop-scoped records instead of code constants.
The bot can then load active products for the resolved shop and answer product
code/menu flows without redeploying.

### Assets and Images DB or Storage Metadata

Images should not be embedded in code. The database should store safe metadata:
asset type, storage provider, storage key or public URL, content type, size, and
status. Actual image bytes can live in object storage or another approved asset
store.

The runtime should only use active assets attached to the resolved shop and
product.

### Bot Mode per Shop

Each shop should have its own bot mode. Initial modes can map to the existing
runtime behavior, such as:

- `menu_code_handoff`
- `menu_only`
- `handoff_only`
- `disabled`

Mode selection must be shop-scoped so one page can stay on a conservative mode
while another shop tests a newer flow in staging.

## Proposed Tables

These are design-level table shapes only. They are not a migration proposal yet.
Column names and constraints should be finalized in Phase B.

### `shops`

Stores one logical shop/business.

Suggested fields:

- `id`: stable shop identifier.
- `slug`: unique human-readable key, for example `adult-shop`.
- `name`: display name for admin and runtime logs.
- `status`: `active`, `paused`, or `archived`.
- `default_locale`: default language/locale.
- `timezone`: shop timezone.
- `created_at`, `updated_at`.

### `shop_pages`

Maps Facebook pages to shops.

Suggested fields:

- `id`: stable mapping identifier.
- `shop_id`: references `shops.id`.
- `page_id`: Facebook page id from Messenger webhook payloads.
- `page_name`: optional admin display name.
- `status`: `active`, `paused`, or `archived`.
- `created_at`, `updated_at`.

Rules:

- A `page_id` must have at most one active mapping.
- Runtime lookup should ignore archived mappings.

### `shop_settings`

Stores shop-scoped runtime settings that can change without redeploy.

Suggested fields:

- `shop_id`: references `shops.id`.
- `bot_mode`: current runtime mode for this shop.
- `handoff_enabled`: boolean.
- `handoff_message`: safe staff handoff copy.
- `menu_intro_text`: optional menu greeting text.
- `fallback_text`: optional fallback text.
- `settings_json`: bounded JSON for low-risk future settings.
- `created_at`, `updated_at`.

Rules:

- Avoid storing secrets in `settings_json`.
- Validate allowed `bot_mode` values.
- Keep unknown settings ignored by runtime until explicitly supported.

### `shop_products`

Stores shop-scoped product catalog entries.

Suggested fields:

- `id`: stable product identifier.
- `shop_id`: references `shops.id`.
- `code`: customer-facing product code.
- `name`: product name.
- `description`: product description or sales copy.
- `price`: optional numeric price.
- `currency`: optional ISO currency code.
- `status`: `active`, `hidden`, or `archived`.
- `sort_order`: optional dashboard/menu ordering.
- `metadata_json`: bounded JSON for product attributes.
- `created_at`, `updated_at`.

Rules:

- `(shop_id, code)` should be unique for non-archived products.
- Runtime should only use active products by default.

### `shop_assets`

Stores shop and product asset metadata.

Suggested fields:

- `id`: stable asset identifier.
- `shop_id`: references `shops.id`.
- `product_id`: optional reference to `shop_products.id`.
- `asset_type`: `product_image`, `menu_image`, or other approved type.
- `storage_provider`: `public_url`, `object_storage`, or another approved
  provider.
- `storage_key`: provider-specific key or path.
- `public_url`: optional externally reachable URL.
- `content_type`: expected media type.
- `size_bytes`: optional file size.
- `status`: `active`, `hidden`, or `archived`.
- `sort_order`: optional ordering for multiple images.
- `created_at`, `updated_at`.

Rules:

- Do not store image bytes directly in the relational table unless a later
  storage decision explicitly requires it.
- Runtime should only send active assets for the resolved shop.

## Runtime Flow

```txt
Messenger webhook
  -> extract page_id
  -> resolve page_id in shop_pages
  -> load shop settings by shop_id
  -> load active products/assets for shop_id as needed
  -> run the configured bot mode
  -> keep file-config fallback available for rollback
```

Expected behavior:

- If `page_id` resolves to an active shop, DB configuration is the source of
  truth for that shop.
- If DB configuration is missing during the staged rollout, the runtime can
  fall back to the existing file config for known shops.
- If neither DB config nor file fallback exists, the runtime should fail closed:
  log a safe event and avoid sending incorrect shop content.
- Runtime logs should include safe `shop_id` and `page_id` metadata but never
  tokens or raw customer-sensitive content.

## Dashboard Flow

The dashboard should eventually provide CRUD for shop configuration, but only
after the DB schema and staging seed phases are complete.

Initial dashboard capabilities:

- List shops and connected pages.
- View effective bot mode and active page mapping.
- View products and assets for a shop.
- Add or edit shop settings with validation and audit.
- Add, edit, hide, or archive products and assets with validation and audit.

Every write action needs confirmation, RBAC checks, audit logging, and tests.

## Rollout Phases

### Phase A: Design Only

- Create this architecture document.
- Do not write runtime code.
- Do not add DB migrations.
- Do not deploy.
- Do not change production env.
- Do not write production DB.
- Do not run authenticated production smoke.

### Phase B: DB Schema Proposal Only

- Draft an additive SQL proposal for the new tables.
- Add static SQL checks and a non-production verifier.
- Verification must use explicit non-production variables such as
  `CHATBOT_TEST_DATABASE_URL` or `CHATBOT_STAGING_DATABASE_URL`.
- Do not use `DATABASE_URL` for schema verification.
- Do not apply the schema to production.

### Phase C: Staging Seed `adult-shop` into DB

- Apply the approved schema only to staging.
- Seed the existing `adult-shop` configuration into staging DB.
- Verify count-only and configuration-shape checks in staging.
- Keep production untouched.

### Phase D: Runtime Reads Config from DB with File Fallback

- Add runtime reads for DB-backed shop config in staging first.
- Keep the existing file config fallback for rollback.
- Ensure missing or invalid DB config fails closed instead of sending another
  shop's content.
- Add tests for page resolution, mode selection, DB config, and fallback.
- Do not deploy production until staging behavior is reviewed.

### Phase E: Dashboard CRUD

- Add dashboard CRUD for shops, pages, settings, products, and assets.
- Require RBAC, confirmation, validation, and audit records for every write.
- Keep write scopes narrow and shop-scoped.
- Test read/write behavior against non-production databases first.

### Phase F: Production Migration after Backup/Approval

- Create a fresh production PostgreSQL backup outside the repo.
- Verify backup counts and SHA256.
- Apply the additive schema only after explicit production DB approval.
- Seed production shop config only after separate approval.
- Deploy runtime/dashboard changes only after explicit deploy approval.
- Keep file-config fallback available until production rollback confidence is
  high.

## Safety Rules

- Production remains on `main` and manual deploy.
- Staging uses `feature/multi-shop-dashboard`.
- Do not deploy without explicit approval.
- Do not push without explicit approval.
- Do not change production environment variables without explicit approval.
- Do not write production DB without a fresh backup and explicit approval.
- Do not run authenticated production smoke without explicit approval because
  it writes audit rows.
- Do not store production secrets in shop settings or product metadata.
- Keep file-config fallback for rollback until the production migration is
  proven safe.
- Prefer additive, idempotent migrations with clear rollback notes.
- Use safe count-only or metadata-only verification for production checks.

## Non-Goals

- No AI, RAG, or agent workflow yet.
- No public customer self-serve onboarding yet.
- No production migration in this slice.
- No production deploy in this slice.
- No production env change in this slice.
- No production DB write in this slice.
- No runtime code change in this slice.

## Open Questions for Phase B

- Should `shops.id` reuse an existing tenant-style identifier or introduce a
  new shop-specific id namespace?
- Should `shop_settings` be one row per shop or versioned settings revisions?
- Which storage provider should own product images in staging?
- How much product metadata belongs in normalized columns versus bounded JSON?
- Which admin roles can create shops versus only edit existing shop content?

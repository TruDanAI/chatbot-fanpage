-- Phase B multi-shop schema proposal.
-- Apply only to an approved non-production database during this phase.
-- This file is intentionally additive and idempotent.

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  default_locale TEXT NOT NULL DEFAULT 'vi-VN',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (slug <> ''),
  CHECK (status IN ('active', 'paused', 'archived')),
  CHECK (default_locale <> ''),
  CHECK (timezone <> '')
);

CREATE TABLE IF NOT EXISTS shop_pages (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (shop_id <> ''),
  CHECK (page_id <> ''),
  CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE TABLE IF NOT EXISTS shop_settings (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  bot_mode TEXT NOT NULL DEFAULT 'disabled',
  handoff_enabled BOOLEAN NOT NULL DEFAULT false,
  handoff_message TEXT NOT NULL DEFAULT '',
  menu_intro_text TEXT NOT NULL DEFAULT '',
  fallback_text TEXT NOT NULL DEFAULT '',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (shop_id <> ''),
  CHECK (bot_mode IN ('menu_code_handoff', 'menu_only', 'handoff_only', 'disabled')),
  CHECK (jsonb_typeof(settings_json) = 'object')
);

CREATE TABLE IF NOT EXISTS shop_products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (shop_id <> ''),
  CHECK (code <> ''),
  CHECK (name <> ''),
  CHECK (price IS NULL OR price >= 0),
  CHECK (currency = '' OR char_length(currency) = 3),
  CHECK (status IN ('active', 'hidden', 'archived')),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE TABLE IF NOT EXISTS shop_assets (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  product_id TEXT REFERENCES shop_products(id),
  asset_type TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL DEFAULT '',
  public_url TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (shop_id <> ''),
  CHECK (asset_type IN ('product_image', 'menu_image', 'shop_image')),
  CHECK (storage_provider IN ('public_url', 'object_storage')),
  CHECK (storage_key <> '' OR public_url <> ''),
  CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CHECK (status IN ('active', 'hidden', 'archived'))
);

CREATE TABLE IF NOT EXISTS shop_page_credentials (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  page_mapping_id TEXT NOT NULL REFERENCES shop_pages(id),
  credential_type TEXT NOT NULL DEFAULT 'fb_page_token',
  encrypted_value TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (shop_id <> ''),
  CHECK (page_mapping_id <> ''),
  CHECK (credential_type IN ('fb_page_token')),
  CHECK (encrypted_value <> ''),
  CHECK (encryption_key_id <> ''),
  CHECK (status IN ('active', 'paused', 'archived')),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE TABLE IF NOT EXISTS webhook_queue (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CHECK (tenant_id <> ''),
  CHECK (page_id <> ''),
  CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  CHECK (jsonb_typeof(payload_json) = 'object'),
  CHECK (jsonb_typeof(event_json) = 'object'),
  CHECK (attempt_count >= 0),
  CHECK (max_attempts > 0),
  CHECK (attempt_count <= max_attempts)
);

CREATE UNIQUE INDEX IF NOT EXISTS shops_active_slug_uidx
  ON shops (slug)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS shop_pages_active_page_id_uidx
  ON shop_pages (page_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS shop_pages_shop_status_idx
  ON shop_pages (shop_id, status);

CREATE INDEX IF NOT EXISTS shop_settings_bot_mode_idx
  ON shop_settings (bot_mode);

CREATE UNIQUE INDEX IF NOT EXISTS shop_products_active_code_uidx
  ON shop_products (shop_id, lower(code))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS shop_products_shop_status_sort_idx
  ON shop_products (shop_id, status, sort_order, code);

CREATE INDEX IF NOT EXISTS shop_assets_shop_type_status_idx
  ON shop_assets (shop_id, asset_type, status, sort_order, id);

CREATE INDEX IF NOT EXISTS shop_assets_product_status_idx
  ON shop_assets (product_id, status, sort_order, id)
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shop_page_credentials_active_type_uidx
  ON shop_page_credentials (shop_id, page_mapping_id, credential_type)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS shop_page_credentials_lookup_idx
  ON shop_page_credentials (page_mapping_id, credential_type, status);

CREATE INDEX IF NOT EXISTS webhook_queue_queued_available_idx
  ON webhook_queue (tenant_id, available_at, id)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS webhook_queue_status_updated_idx
  ON webhook_queue (tenant_id, status, updated_at, id);

CREATE INDEX IF NOT EXISTS webhook_queue_page_status_idx
  ON webhook_queue (tenant_id, page_id, status, created_at);

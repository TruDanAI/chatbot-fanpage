-- Production missing multi-shop tables patch.
-- Use only after a fresh verified production backup and explicit DB write approval.
-- Intended for production databases that already have:
-- shops, shop_pages, shop_settings, shop_products, and shop_assets.
-- This patch is additive and idempotent.

CREATE TABLE IF NOT EXISTS shop_page_credentials (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  page_mapping_id TEXT NOT NULL REFERENCES shop_pages(id),
  credential_type TEXT NOT NULL DEFAULT 'fb_page_token',
  encrypted_value TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL DEFAULT 'default',
  key_version INTEGER NOT NULL DEFAULT 1,
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
  CHECK (key_version > 0),
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

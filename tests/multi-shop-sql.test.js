const fs = require('fs');
const path = require('path');
const { describe, it, expect } = require('./harness');
const {
  chooseVerificationDatabaseUrl,
  createVerificationSchemaName,
  isPostgresUrl,
  sanitizeMessage
} = require('../scripts/verify-multi-shop-sql');

const SQL_PATH = path.join(__dirname, '..', 'db', 'multi-shop-proposal.sql');
const PRODUCTION_MISSING_TABLES_PATCH_PATH = path.join(
  __dirname,
  '..',
  'db',
  'production-missing-multishop-tables-patch.sql'
);

function readSql(filePath = SQL_PATH) {
  return fs.readFileSync(filePath, 'utf8');
}

function stripSqlComments(sql) {
  return String(sql || '')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function statements(sql) {
  return stripSqlComments(sql)
    .split(';')
    .map(item => item.trim())
    .filter(Boolean);
}

describe('multi-shop SQL proposal', () => {
  it('exists in db/multi-shop-proposal.sql', () => {
    expect(fs.existsSync(SQL_PATH)).toBeTrue();
  });

  it('uses only additive idempotent table and index creation statements', () => {
    const sql = stripSqlComments(readSql());
    const normalized = normalizeSql(sql);
    const destructive = /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER)\b/i;

    expect(destructive.test(normalized)).toBeFalse();

    for (const statement of statements(sql)) {
      const isTableCreate = /^CREATE TABLE IF NOT EXISTS [a-z_]+ \(/i.test(statement);
      const isIndexCreate = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [a-z_]+/i.test(statement);
      expect(isTableCreate || isIndexCreate).toBeTrue();
    }
  });

  it('creates the seven multi-shop tables including page credentials and webhook queue', () => {
    const normalized = normalizeSql(readSql());

    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shops\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_pages\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_settings\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_products\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_assets\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_page_credentials\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS webhook_queue\b/i);
    expect((normalized.match(/\bCREATE TABLE IF NOT EXISTS\b/gi) || []).length).toBe(7);
  });

  it('defines non-empty identity fields and core status constraints', () => {
    const normalized = normalizeSql(readSql());

    expect(normalized).toContain("CHECK (id <> '')");
    expect(normalized).toContain("CHECK (slug <> '')");
    expect(normalized).toContain("CHECK (page_id <> '')");
    expect(normalized).toContain("CHECK (code <> '')");
    expect(normalized).toContain("CHECK (status IN ('active', 'paused', 'archived'))");
    expect(normalized).toContain("CHECK (status IN ('active', 'hidden', 'archived'))");
  });

  it('defines bot mode, asset type, and storage provider constraints', () => {
    const normalized = normalizeSql(readSql());

    expect(normalized).toContain("CHECK (bot_mode IN ('menu_code_handoff', 'menu_only', 'handoff_only', 'disabled'))");
    expect(normalized).toContain("CHECK (asset_type IN ('product_image', 'menu_image', 'shop_image'))");
    expect(normalized).toContain("CHECK (storage_provider IN ('public_url', 'object_storage'))");
    expect(normalized).toContain("CHECK (storage_key <> '' OR public_url <> '')");
    expect(normalized).toContain("CHECK (credential_type IN ('fb_page_token'))");
    expect(normalized).toContain("CHECK (encrypted_value <> '')");
    expect(normalized).toContain('key_version INTEGER NOT NULL DEFAULT 1');
    expect(normalized).toContain('CHECK (key_version > 0)');
    expect(normalized).toContain("CHECK (status IN ('queued', 'processing', 'done', 'failed'))");
    expect(normalized).toContain("CHECK (attempt_count >= 0)");
    expect(normalized).toContain("CHECK (max_attempts > 0)");
    expect(normalized).toContain("CHECK (attempt_count <= max_attempts)");
  });

  it('defines the key lookup and partial uniqueness indexes', () => {
    const normalized = normalizeSql(readSql());

    expect(normalized).toMatch(/\bCREATE UNIQUE INDEX IF NOT EXISTS shop_pages_active_page_id_uidx\b/i);
    expect(normalized).toMatch(/shop_pages_active_page_id_uidx ON shop_pages \(page_id\) WHERE status = 'active'/i);
    expect(normalized).toMatch(/\bCREATE UNIQUE INDEX IF NOT EXISTS shop_products_active_code_uidx\b/i);
    expect(normalized).toMatch(/shop_products_active_code_uidx ON shop_products \(shop_id, lower\(code\)\) WHERE status = 'active'/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS shop_pages_shop_status_idx\b/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS shop_products_shop_status_sort_idx\b/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS shop_assets_shop_type_status_idx\b/i);
    expect(normalized).toMatch(/\bCREATE UNIQUE INDEX IF NOT EXISTS shop_page_credentials_active_type_uidx\b/i);
    expect(normalized).toMatch(/shop_page_credentials_active_type_uidx ON shop_page_credentials \(shop_id, page_mapping_id, credential_type\) WHERE status = 'active'/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS shop_page_credentials_lookup_idx\b/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS webhook_queue_queued_available_idx\b/i);
    expect(normalized).toMatch(/webhook_queue_queued_available_idx ON webhook_queue \(tenant_id, available_at, id\) WHERE status = 'queued'/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS webhook_queue_status_updated_idx\b/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS webhook_queue_page_status_idx\b/i);
  });
});

describe('production missing multi-shop tables SQL patch', () => {
  function readPatchSql() {
    return readSql(PRODUCTION_MISSING_TABLES_PATCH_PATH);
  }

  it('exists in db/production-missing-multishop-tables-patch.sql', () => {
    expect(fs.existsSync(PRODUCTION_MISSING_TABLES_PATCH_PATH)).toBeTrue();
  });

  it('does not contain destructive SQL', () => {
    const normalized = normalizeSql(stripSqlComments(readPatchSql()));
    const destructive = /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER)\b/i;

    expect(destructive.test(normalized)).toBeFalse();
  });

  it('creates exactly the two production-missing tables', () => {
    const normalized = normalizeSql(readPatchSql());
    const tableCreates = [...normalized.matchAll(/\bCREATE TABLE IF NOT EXISTS ([a-z_]+)\b/gi)]
      .map(match => match[1])
      .sort();

    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_page_credentials\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS webhook_queue\b/i);
    expect(tableCreates).toEqual(['shop_page_credentials', 'webhook_queue']);
  });

  it('does not create or alter the five existing production multi-shop tables', () => {
    const sql = stripSqlComments(readPatchSql());
    const existingTables = ['shops', 'shop_pages', 'shop_settings', 'shop_products', 'shop_assets'];

    for (const tableName of existingTables) {
      expect(new RegExp(`\\bCREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i').test(sql)).toBeFalse();
      expect(new RegExp(`\\bCREATE (?:UNIQUE )?INDEX IF NOT EXISTS [a-z_]+\\s+ON ${tableName}\\b`, 'i').test(sql)).toBeFalse();
      expect(new RegExp(`\\bALTER TABLE ${tableName}\\b`, 'i').test(sql)).toBeFalse();
    }
  });

  it('defines the expected patch indexes only on the two missing tables', () => {
    const normalized = normalizeSql(readPatchSql());

    expect(normalized).toMatch(/\bCREATE UNIQUE INDEX IF NOT EXISTS shop_page_credentials_active_type_uidx\b/i);
    expect(normalized).toMatch(/shop_page_credentials_active_type_uidx ON shop_page_credentials \(shop_id, page_mapping_id, credential_type\) WHERE status = 'active'/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS shop_page_credentials_lookup_idx\b/i);
    expect(normalized).toMatch(/shop_page_credentials_lookup_idx ON shop_page_credentials \(page_mapping_id, credential_type, status\)/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS webhook_queue_queued_available_idx\b/i);
    expect(normalized).toMatch(/webhook_queue_queued_available_idx ON webhook_queue \(tenant_id, available_at, id\) WHERE status = 'queued'/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS webhook_queue_status_updated_idx\b/i);
    expect(normalized).toMatch(/webhook_queue_status_updated_idx ON webhook_queue \(tenant_id, status, updated_at, id\)/i);
    expect(normalized).toMatch(/\bCREATE INDEX IF NOT EXISTS webhook_queue_page_status_idx\b/i);
    expect(normalized).toMatch(/webhook_queue_page_status_idx ON webhook_queue \(tenant_id, page_id, status, created_at\)/i);
    expect((normalized.match(/\bCREATE (?:UNIQUE )?INDEX IF NOT EXISTS\b/gi) || []).length).toBe(5);
  });

  it('keeps credential and queue status CHECK constraints', () => {
    const normalized = normalizeSql(readPatchSql());

    expect(normalized).toContain("CHECK (status IN ('active', 'paused', 'archived'))");
    expect(normalized).toContain("CHECK (status IN ('queued', 'processing', 'done', 'failed'))");
    expect(normalized).toContain("CHECK (credential_type IN ('fb_page_token'))");
    expect(normalized).toContain('key_version INTEGER NOT NULL DEFAULT 1');
    expect(normalized).toContain('CHECK (key_version > 0)');
    expect(normalized).toContain("CHECK (attempt_count <= max_attempts)");
  });
});

describe('multi-shop SQL verifier safety', () => {
  it('ignores DATABASE_URL when an explicit verification URL is missing', () => {
    const url = 'postgres://prod:secret@example.test/prod';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeTrue();
    expect(result.reason).toBe('missing_explicit_database_url');
    expect(result.message.includes(url)).toBeFalse();
    expect(result.message).toContain('DATABASE_URL is intentionally ignored');
  });

  it('does not select DATABASE_URL in Railway production without printing the URL', () => {
    const url = 'postgres://prod:secret@example.test/prod';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      RAILWAY_ENVIRONMENT: 'production'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeTrue();
    expect(result.reason).toBe('missing_explicit_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('does not select DATABASE_URL in Railway staging', () => {
    const url = 'postgres://stage-user:stage-pass@example.test/stagedb';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      RAILWAY_ENVIRONMENT_NAME: 'staging'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeTrue();
    expect(result.reason).toBe('missing_explicit_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('does not validate or print invalid DATABASE_URL when explicit URL is missing', () => {
    const url = 'not-a-postgres-url-with-secret';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      RAILWAY_ENVIRONMENT: 'staging'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeTrue();
    expect(result.reason).toBe('missing_explicit_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('prefers CHATBOT_TEST_DATABASE_URL over staging and DATABASE_URL', () => {
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_TEST_DATABASE_URL: 'postgres://test-user:test-pass@example.test/testdb',
      CHATBOT_STAGING_DATABASE_URL: 'postgres://stage-user:stage-pass@example.test/stagedb',
      DATABASE_URL: 'postgres://database-user:database-pass@example.test/database',
      RAILWAY_ENVIRONMENT: 'staging'
    });

    expect(result.ok).toBeTrue();
    expect(result.envName).toBe('CHATBOT_TEST_DATABASE_URL');
    expect(result.sourceName).toBe('CHATBOT_TEST_DATABASE_URL');
    expect(result.value).toBe('postgres://test-user:test-pass@example.test/testdb');
  });

  it('prefers CHATBOT_STAGING_DATABASE_URL over DATABASE_URL when the test URL is absent', () => {
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_STAGING_DATABASE_URL: 'postgresql://stage-user:stage-pass@example.test/stagedb',
      DATABASE_URL: 'postgres://database-user:database-pass@example.test/database',
      RAILWAY_ENVIRONMENT_NAME: 'staging'
    });

    expect(result.ok).toBeTrue();
    expect(result.envName).toBe('CHATBOT_STAGING_DATABASE_URL');
    expect(result.sourceName).toBe('CHATBOT_STAGING_DATABASE_URL');
    expect(result.value).toBe('postgresql://stage-user:stage-pass@example.test/stagedb');
  });

  it('rejects invalid staging override without falling back to DATABASE_URL', () => {
    const databaseUrl = 'postgres://database-user:database-pass@example.test/database';
    const invalidStagingUrl = 'railway-reference-that-is-not-a-url';
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_STAGING_DATABASE_URL: invalidStagingUrl,
      DATABASE_URL: databaseUrl,
      RAILWAY_ENVIRONMENT: 'staging'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeFalse();
    expect(result.reason).toBe('invalid_explicit_database_url');
    expect(result.envName).toBe('CHATBOT_STAGING_DATABASE_URL');
    expect(result.message.includes(databaseUrl)).toBeFalse();
    expect(result.message.includes(invalidStagingUrl)).toBeFalse();
  });

  it('rejects an explicit URL that equals DATABASE_URL without printing the URL', () => {
    const url = 'postgres://prod:secret@example.test/prod';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      CHATBOT_TEST_DATABASE_URL: url
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeFalse();
    expect(result.reason).toBe('explicit_url_matches_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('rejects non-PostgreSQL explicit URLs without printing the URL', () => {
    const url = 'mysql://user:secret@example.test/db';
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_TEST_DATABASE_URL: url
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('invalid_explicit_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('recognizes postgres URL schemes only', () => {
    expect(isPostgresUrl('postgres://user:pass@example.test/db')).toBeTrue();
    expect(isPostgresUrl('postgresql://user:pass@example.test/db')).toBeTrue();
    expect(isPostgresUrl('mysql://user:pass@example.test/db')).toBeFalse();
    expect(isPostgresUrl('not a url')).toBeFalse();
  });

  it('uses a temporary multi-shop verification schema name', () => {
    const schemaName = createVerificationSchemaName();

    expect(schemaName).toMatch(/^multi_shop_verify_\d+_\d+_[a-f0-9]{8}$/);
  });

  it('redacts configured database URL values from error messages', () => {
    const url = 'postgres://user:secret@example.test/db';
    const message = sanitizeMessage(`failed to connect to ${url}`, {
      CHATBOT_TEST_DATABASE_URL: url
    });

    expect(message).toBe('failed to connect to [redacted]');
    expect(message.includes('secret')).toBeFalse();
  });
});

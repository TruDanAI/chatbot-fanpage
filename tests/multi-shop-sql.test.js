const fs = require('fs');
const path = require('path');
const { describe, it, expect } = require('./harness');
const {
  chooseVerificationDatabaseUrl,
  createVerificationSchemaName,
  isPostgresUrl,
  RAILWAY_DATABASE_URL_SOURCE,
  sanitizeMessage
} = require('../scripts/verify-multi-shop-sql');

const SQL_PATH = path.join(__dirname, '..', 'db', 'multi-shop-proposal.sql');

function readSql() {
  return fs.readFileSync(SQL_PATH, 'utf8');
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

  it('creates the six multi-shop tables including page credentials', () => {
    const normalized = normalizeSql(readSql());

    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shops\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_pages\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_settings\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_products\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_assets\b/i);
    expect(normalized).toMatch(/\bCREATE TABLE IF NOT EXISTS shop_page_credentials\b/i);
    expect((normalized.match(/\bCREATE TABLE IF NOT EXISTS\b/gi) || []).length).toBe(6);
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
  });
});

describe('multi-shop SQL verifier safety', () => {
  it('rejects DATABASE_URL outside a known Railway staging environment', () => {
    const url = 'postgres://prod:secret@example.test/prod';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeFalse();
    expect(result.reason).toBe('database_url_requires_railway_staging');
    expect(result.message.includes(url)).toBeFalse();
    expect(result.message).toContain('RAILWAY_ENVIRONMENT');
    expect(result.message).toContain('staging');
  });

  it('rejects DATABASE_URL in Railway production without printing the URL', () => {
    const url = 'postgres://prod:secret@example.test/prod';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      RAILWAY_ENVIRONMENT: 'production'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeFalse();
    expect(result.reason).toBe('database_url_railway_production');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('allows DATABASE_URL only in Railway staging', () => {
    const url = 'postgres://stage-user:stage-pass@example.test/stagedb';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      RAILWAY_ENVIRONMENT_NAME: 'staging'
    });

    expect(result.ok).toBeTrue();
    expect(result.envName).toBe('DATABASE_URL');
    expect(result.sourceName).toBe(RAILWAY_DATABASE_URL_SOURCE);
    expect(result.value).toBe(url);
  });

  it('rejects invalid Railway staging DATABASE_URL without printing the URL', () => {
    const url = 'not-a-postgres-url-with-secret';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      RAILWAY_ENVIRONMENT: 'staging'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeFalse();
    expect(result.reason).toBe('invalid_railway_staging_database_url');
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

  it('falls back to Railway staging DATABASE_URL when the staging override is unusable', () => {
    const databaseUrl = 'postgres://database-user:database-pass@example.test/database';
    const invalidStagingUrl = 'railway-reference-that-is-not-a-url';
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_STAGING_DATABASE_URL: invalidStagingUrl,
      DATABASE_URL: databaseUrl,
      RAILWAY_ENVIRONMENT: 'staging'
    });

    expect(result.ok).toBeTrue();
    expect(result.envName).toBe('DATABASE_URL');
    expect(result.sourceName).toBe(RAILWAY_DATABASE_URL_SOURCE);
    expect(result.value).toBe(databaseUrl);
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

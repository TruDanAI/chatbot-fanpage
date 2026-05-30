const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPLICIT_DATABASE_URL_ENVS = Object.freeze([
  'CHATBOT_TEST_DATABASE_URL',
  'CHATBOT_STAGING_DATABASE_URL'
]);

const PROPOSAL_SQL_PATH = path.join(__dirname, '..', 'db', 'multi-shop-proposal.sql');

const EXPECTED_TABLES = Object.freeze({
  shops: {
    columns: {
      id: { dataType: 'text', nullable: false },
      slug: { dataType: 'text', nullable: false },
      name: { dataType: 'text', nullable: false },
      status: { dataType: 'text', nullable: false },
      package: { dataType: 'text', nullable: false },
      lifecycle: { dataType: 'text', nullable: false },
      live_enabled: { dataType: 'boolean', nullable: false },
      dry_run: { dataType: 'boolean', nullable: false },
      last_readiness_status: { dataType: 'text', nullable: false },
      last_readiness_checked_at: { dataType: 'timestamp with time zone', nullable: true },
      last_manual_test_status: { dataType: 'text', nullable: false },
      last_manual_test_at: { dataType: 'timestamp with time zone', nullable: true },
      last_ready_by: { dataType: 'text', nullable: false },
      default_locale: { dataType: 'text', nullable: false },
      timezone: { dataType: 'text', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false }
    }
  },
  shop_pages: {
    columns: {
      id: { dataType: 'text', nullable: false },
      shop_id: { dataType: 'text', nullable: false },
      page_id: { dataType: 'text', nullable: false },
      page_name: { dataType: 'text', nullable: false },
      status: { dataType: 'text', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false }
    }
  },
  shop_settings: {
    columns: {
      shop_id: { dataType: 'text', nullable: false },
      bot_mode: { dataType: 'text', nullable: false },
      handoff_enabled: { dataType: 'boolean', nullable: false },
      handoff_message: { dataType: 'text', nullable: false },
      menu_intro_text: { dataType: 'text', nullable: false },
      fallback_text: { dataType: 'text', nullable: false },
      settings_json: { dataType: 'jsonb', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false }
    }
  },
  shop_products: {
    columns: {
      id: { dataType: 'text', nullable: false },
      shop_id: { dataType: 'text', nullable: false },
      code: { dataType: 'text', nullable: false },
      name: { dataType: 'text', nullable: false },
      description: { dataType: 'text', nullable: false },
      price: { dataType: 'numeric', nullable: true },
      currency: { dataType: 'text', nullable: false },
      status: { dataType: 'text', nullable: false },
      sort_order: { dataType: 'integer', nullable: false },
      metadata_json: { dataType: 'jsonb', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false }
    }
  },
  shop_assets: {
    columns: {
      id: { dataType: 'text', nullable: false },
      shop_id: { dataType: 'text', nullable: false },
      product_id: { dataType: 'text', nullable: true },
      asset_type: { dataType: 'text', nullable: false },
      storage_provider: { dataType: 'text', nullable: false },
      storage_key: { dataType: 'text', nullable: false },
      public_url: { dataType: 'text', nullable: false },
      content_type: { dataType: 'text', nullable: false },
      size_bytes: { dataType: 'bigint', nullable: true },
      status: { dataType: 'text', nullable: false },
      sort_order: { dataType: 'integer', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false }
    }
  },
  shop_page_credentials: {
    columns: {
      id: { dataType: 'text', nullable: false },
      shop_id: { dataType: 'text', nullable: false },
      page_mapping_id: { dataType: 'text', nullable: false },
      credential_type: { dataType: 'text', nullable: false },
      encrypted_value: { dataType: 'text', nullable: false },
      encryption_key_id: { dataType: 'text', nullable: false },
      key_version: { dataType: 'integer', nullable: false },
      status: { dataType: 'text', nullable: false },
      metadata_json: { dataType: 'jsonb', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false }
    }
  },
  webhook_queue: {
    columns: {
      id: { dataType: 'bigint', nullable: false },
      tenant_id: { dataType: 'text', nullable: false },
      page_id: { dataType: 'text', nullable: false },
      status: { dataType: 'text', nullable: false },
      payload_json: { dataType: 'jsonb', nullable: false },
      event_json: { dataType: 'jsonb', nullable: false },
      attempt_count: { dataType: 'integer', nullable: false },
      max_attempts: { dataType: 'integer', nullable: false },
      available_at: { dataType: 'timestamp with time zone', nullable: false },
      locked_at: { dataType: 'timestamp with time zone', nullable: true },
      locked_by: { dataType: 'text', nullable: false },
      last_error: { dataType: 'text', nullable: false },
      created_at: { dataType: 'timestamp with time zone', nullable: false },
      updated_at: { dataType: 'timestamp with time zone', nullable: false },
      processed_at: { dataType: 'timestamp with time zone', nullable: true }
    }
  }
});

const EXPECTED_INDEXES = Object.freeze({
  shops_active_slug_uidx: {
    table: 'shops',
    parts: ['unique index', 'slug', 'where', 'status', 'active']
  },
  shop_pages_active_page_id_uidx: {
    table: 'shop_pages',
    parts: ['unique index', 'page_id', 'where', 'status', 'active']
  },
  shop_pages_shop_status_idx: {
    table: 'shop_pages',
    parts: ['shop_id', 'status']
  },
  shop_settings_bot_mode_idx: {
    table: 'shop_settings',
    parts: ['bot_mode']
  },
  shop_products_active_code_uidx: {
    table: 'shop_products',
    parts: ['unique index', 'shop_id', 'lower(code)', 'where', 'status', 'active']
  },
  shop_products_shop_status_sort_idx: {
    table: 'shop_products',
    parts: ['shop_id', 'status', 'sort_order', 'code']
  },
  shop_assets_shop_type_status_idx: {
    table: 'shop_assets',
    parts: ['shop_id', 'asset_type', 'status', 'sort_order', 'id']
  },
  shop_assets_product_status_idx: {
    table: 'shop_assets',
    parts: ['product_id', 'status', 'sort_order', 'id', 'where', 'product_id is not null']
  },
  shop_page_credentials_active_type_uidx: {
    table: 'shop_page_credentials',
    parts: ['unique index', 'shop_id', 'page_mapping_id', 'credential_type', 'where', 'status', 'active']
  },
  shop_page_credentials_lookup_idx: {
    table: 'shop_page_credentials',
    parts: ['page_mapping_id', 'credential_type', 'status']
  },
  webhook_queue_queued_available_idx: {
    table: 'webhook_queue',
    parts: ['tenant_id', 'available_at', 'id', 'where', 'status', 'queued']
  },
  webhook_queue_status_updated_idx: {
    table: 'webhook_queue',
    parts: ['tenant_id', 'status', 'updated_at', 'id']
  },
  webhook_queue_page_status_idx: {
    table: 'webhook_queue',
    parts: ['tenant_id', 'page_id', 'status', 'created_at']
  }
});

function normalizeEnvValue(value) {
  return String(value || '').trim();
}

function isPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  } catch (_) {
    return false;
  }
}

function chooseVerificationDatabaseUrl(env = process.env) {
  const databaseUrl = normalizeEnvValue(env.DATABASE_URL);
  const explicit = EXPLICIT_DATABASE_URL_ENVS
    .map(name => ({ name, value: normalizeEnvValue(env[name]) }))
    .find(item => item.value);

  if (!explicit) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_explicit_database_url',
      message: 'Skipped multi-shop SQL verification: set CHATBOT_TEST_DATABASE_URL or CHATBOT_STAGING_DATABASE_URL to an explicit non-production PostgreSQL database. DATABASE_URL is intentionally ignored.'
    };
  }

  if (databaseUrl && explicit.value === databaseUrl) {
    return {
      ok: false,
      skipped: false,
      reason: 'explicit_url_matches_database_url',
      envName: explicit.name,
      sourceName: explicit.name,
      message: `${explicit.name} must not equal DATABASE_URL. Refusing to verify against a potentially production database.`
    };
  }

  if (!isPostgresUrl(explicit.value)) {
    return {
      ok: false,
      skipped: false,
      reason: 'invalid_explicit_database_url',
      envName: explicit.name,
      sourceName: explicit.name,
      message: `${explicit.name} must be a valid postgres:// or postgresql:// URL. The URL value was not printed.`
    };
  }

  return {
    ok: true,
    skipped: false,
    envName: explicit.name,
    sourceName: explicit.name,
    value: explicit.value
  };
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error('Multi-shop verifier generated an unsafe schema identifier.');
  }
  return `"${identifier}"`;
}

function createVerificationSchemaName() {
  return `multi_shop_verify_${Date.now()}_${process.pid}_${crypto.randomBytes(4).toString('hex')}`.toLowerCase();
}

async function runSqlInSchema(client, schemaName, sql) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schemaName)}`);
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  }
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyTables(client, schemaName) {
  const expectedNames = Object.keys(EXPECTED_TABLES);
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_name = ANY($2)
      AND table_type = 'BASE TABLE'
  `, [schemaName, expectedNames]);
  const actual = new Set(result.rows.map(row => row.table_name));

  for (const tableName of expectedNames) {
    assertCondition(actual.has(tableName), `Missing expected table: ${tableName}.`);
  }
}

async function verifyColumns(client, schemaName) {
  const result = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = ANY($2)
  `, [schemaName, Object.keys(EXPECTED_TABLES)]);

  const tableColumns = new Map();
  for (const row of result.rows) {
    if (!tableColumns.has(row.table_name)) tableColumns.set(row.table_name, new Map());
    tableColumns.get(row.table_name).set(row.column_name, row);
  }

  for (const [tableName, expectedTable] of Object.entries(EXPECTED_TABLES)) {
    const columns = tableColumns.get(tableName) || new Map();
    for (const [name, expected] of Object.entries(expectedTable.columns)) {
      const actual = columns.get(name);
      assertCondition(Boolean(actual), `Missing expected ${tableName} column: ${name}.`);
      assertCondition(actual.data_type === expected.dataType, `${tableName}.${name} has unexpected type ${actual.data_type}.`);
      assertCondition((actual.is_nullable === 'YES') === expected.nullable, `${tableName}.${name} has unexpected nullability.`);
    }
  }
}

function normalizeIndexDefinition(value) {
  return String(value || '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function verifyIndexes(client, schemaName) {
  const result = await client.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = ANY($2)
  `, [schemaName, Object.keys(EXPECTED_TABLES)]);
  const indexes = new Map(result.rows.map(row => [row.indexname, {
    table: row.tablename,
    definition: normalizeIndexDefinition(row.indexdef)
  }]));

  for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
    const actual = indexes.get(name);
    assertCondition(Boolean(actual), `Missing expected index: ${name}.`);
    assertCondition(actual.table === expected.table, `Index ${name} is on unexpected table ${actual.table}.`);
    for (const part of expected.parts) {
      assertCondition(actual.definition.includes(part), `Index ${name} is missing expected part: ${part}.`);
    }
  }
}

function normalizeConstraintDefinition(value) {
  return String(value || '')
    .replace(/"/g, '')
    .replace(/::[a-z_ ]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function verifyConstraints(client, schemaName) {
  const result = await client.query(`
    SELECT t.relname AS table_name, c.contype, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1
      AND t.relname = ANY($2)
  `, [schemaName, Object.keys(EXPECTED_TABLES)]);

  const byTable = new Map();
  for (const row of result.rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
    byTable.get(row.table_name).push({
      type: row.contype,
      name: row.conname,
      definition: normalizeConstraintDefinition(row.definition)
    });
  }

  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    const constraints = byTable.get(tableName) || [];
    assertCondition(constraints.some(item => item.type === 'p'), `Missing ${tableName} primary key constraint.`);
  }

  const shopsChecks = (byTable.get('shops') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(shopsChecks.some(def => def.includes('id') && def.includes('<>')), 'Missing shops id non-empty CHECK constraint.');
  assertCondition(shopsChecks.some(def => def.includes('slug') && def.includes('<>')), 'Missing shops slug non-empty CHECK constraint.');
  assertCondition(shopsChecks.some(def => def.includes('status') && def.includes('active') && def.includes('paused') && def.includes('archived')), 'Missing shops status CHECK constraint.');
  assertCondition(shopsChecks.some(def => def.includes('package') && def.includes('basic') && def.includes('sales_flow') && def.includes('self_closing_addons')), 'Missing shops package CHECK constraint.');
  assertCondition(shopsChecks.some(def => def.includes('lifecycle') && def.includes('draft') && def.includes('configuring') && def.includes('ready') && def.includes('live') && def.includes('paused') && def.includes('archived')), 'Missing shops lifecycle CHECK constraint.');
  assertCondition(shopsChecks.some(def => def.includes('last_readiness_status') && def.includes('unknown') && def.includes('passed') && def.includes('failed') && def.includes('warnings')), 'Missing shops readiness status CHECK constraint.');
  assertCondition(shopsChecks.some(def => def.includes('last_manual_test_status') && def.includes('unknown') && def.includes('passed') && def.includes('failed')), 'Missing shops manual test status CHECK constraint.');

  const pageChecks = (byTable.get('shop_pages') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(pageChecks.some(def => def.includes('id') && def.includes('<>')), 'Missing shop_pages id non-empty CHECK constraint.');
  assertCondition(pageChecks.some(def => def.includes('page_id') && def.includes('<>')), 'Missing shop_pages page_id non-empty CHECK constraint.');
  assertCondition(pageChecks.some(def => def.includes('status') && def.includes('active') && def.includes('paused') && def.includes('archived')), 'Missing shop_pages status CHECK constraint.');

  const settingsChecks = (byTable.get('shop_settings') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(settingsChecks.some(def => def.includes('shop_id') && def.includes('<>')), 'Missing shop_settings shop_id non-empty CHECK constraint.');
  assertCondition(settingsChecks.some(def => def.includes('bot_mode') && def.includes('menu_code_handoff') && def.includes('disabled')), 'Missing shop_settings bot_mode CHECK constraint.');

  const productChecks = (byTable.get('shop_products') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(productChecks.some(def => def.includes('id') && def.includes('<>')), 'Missing shop_products id non-empty CHECK constraint.');
  assertCondition(productChecks.some(def => def.includes('code') && def.includes('<>')), 'Missing shop_products code non-empty CHECK constraint.');
  assertCondition(productChecks.some(def => def.includes('status') && def.includes('active') && def.includes('hidden') && def.includes('archived')), 'Missing shop_products status CHECK constraint.');

  const assetChecks = (byTable.get('shop_assets') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(assetChecks.some(def => def.includes('id') && def.includes('<>')), 'Missing shop_assets id non-empty CHECK constraint.');
  assertCondition(assetChecks.some(def => def.includes('asset_type') && def.includes('product_image') && def.includes('menu_image')), 'Missing shop_assets asset_type CHECK constraint.');
  assertCondition(assetChecks.some(def => def.includes('storage_provider') && def.includes('public_url') && def.includes('object_storage')), 'Missing shop_assets storage_provider CHECK constraint.');
  assertCondition(assetChecks.some(def => def.includes('status') && def.includes('active') && def.includes('hidden') && def.includes('archived')), 'Missing shop_assets status CHECK constraint.');

  const credentialChecks = (byTable.get('shop_page_credentials') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(credentialChecks.some(def => def.includes('id') && def.includes('<>')), 'Missing shop_page_credentials id non-empty CHECK constraint.');
  assertCondition(credentialChecks.some(def => def.includes('credential_type') && def.includes('fb_page_token')), 'Missing shop_page_credentials credential_type CHECK constraint.');
  assertCondition(credentialChecks.some(def => def.includes('encrypted_value') && def.includes('<>')), 'Missing shop_page_credentials encrypted_value non-empty CHECK constraint.');
  assertCondition(credentialChecks.some(def => def.includes('key_version') && def.includes('>') && def.includes('0')), 'Missing shop_page_credentials key_version CHECK constraint.');
  assertCondition(credentialChecks.some(def => def.includes('status') && def.includes('active') && def.includes('paused') && def.includes('archived')), 'Missing shop_page_credentials status CHECK constraint.');

  const queueChecks = (byTable.get('webhook_queue') || []).filter(item => item.type === 'c').map(item => item.definition);
  assertCondition(queueChecks.some(def => def.includes('tenant_id') && def.includes('<>')), 'Missing webhook_queue tenant_id non-empty CHECK constraint.');
  assertCondition(queueChecks.some(def => def.includes('page_id') && def.includes('<>')), 'Missing webhook_queue page_id non-empty CHECK constraint.');
  assertCondition(queueChecks.some(def => def.includes('status') && def.includes('queued') && def.includes('processing') && def.includes('done') && def.includes('failed')), 'Missing webhook_queue status CHECK constraint.');
  assertCondition(queueChecks.some(def => def.includes('attempt_count') && def.includes('>=') && def.includes('0')), 'Missing webhook_queue attempt_count CHECK constraint.');
  assertCondition(queueChecks.some(def => def.includes('max_attempts') && def.includes('>') && def.includes('0')), 'Missing webhook_queue max_attempts CHECK constraint.');

  const allForeignKeys = result.rows.filter(row => row.contype === 'f');
  assertCondition(allForeignKeys.length >= 7, `Expected at least 7 foreign key constraints, found ${allForeignKeys.length}.`);
}

async function verifyMultiShopProposal({ databaseUrl, schemaName = createVerificationSchemaName(), Client } = {}) {
  assertCondition(databaseUrl, 'Explicit non-production database URL is required.');
  const PgClient = Client || require('pg').Client;
  const sql = fs.readFileSync(PROPOSAL_SQL_PATH, 'utf8');
  const client = new PgClient({ connectionString: databaseUrl });
  let connected = false;
  let cleanupError = null;

  await client.connect();
  connected = true;
  try {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await runSqlInSchema(client, schemaName, sql);
    await runSqlInSchema(client, schemaName, sql);
    await verifyTables(client, schemaName);
    await verifyColumns(client, schemaName);
    await verifyIndexes(client, schemaName);
    await verifyConstraints(client, schemaName);
    return { schemaName };
  } finally {
    if (connected) {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      } catch (err) {
        cleanupError = err;
      }
      await client.end();
    }
    if (cleanupError) {
      throw cleanupError;
    }
  }
}

function sanitizeMessage(message, env = process.env) {
  let sanitized = String(message || '');
  for (const name of ['DATABASE_URL', ...EXPLICIT_DATABASE_URL_ENVS]) {
    const value = normalizeEnvValue(env[name]);
    if (value) {
      sanitized = sanitized.split(value).join('[redacted]');
    }
  }
  return sanitized;
}

async function main({ env = process.env, stdout = console.log, stderr = console.error } = {}) {
  const selected = chooseVerificationDatabaseUrl(env);
  if (!selected.ok) {
    const output = selected.skipped ? stdout : stderr;
    output(selected.message);
    return selected.skipped ? 0 : 1;
  }

  stdout(`using_database_url_source=${selected.sourceName}`);
  stdout('The database URL will not be printed.');
  stdout('Applying db/multi-shop-proposal.sql twice inside a temporary isolated schema.');
  try {
    const result = await verifyMultiShopProposal({ databaseUrl: selected.value });
    stdout(`Verified multi-shop tables, columns, indexes, CHECK constraints, foreign keys, and idempotency in temporary schema ${result.schemaName}.`);
    stdout('Temporary schema was dropped after verification.');
    return 0;
  } catch (err) {
    stderr(`Multi-shop SQL verification failed: ${sanitizeMessage(err.message, env)}`);
    stderr('Temporary schema cleanup was attempted. The database URL was not printed.');
    return 1;
  }
}

if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = {
  EXPLICIT_DATABASE_URL_ENVS,
  chooseVerificationDatabaseUrl,
  createVerificationSchemaName,
  isPostgresUrl,
  main,
  quoteIdentifier,
  sanitizeMessage,
  verifyMultiShopProposal
};

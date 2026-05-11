const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPLICIT_DATABASE_URL_ENVS = Object.freeze([
  'CHATBOT_TEST_DATABASE_URL',
  'CHATBOT_STAGING_DATABASE_URL'
]);

const PROPOSAL_SQL_PATH = path.join(__dirname, '..', 'db', 'internal-notes-proposal.sql');

const EXPECTED_COLUMNS = Object.freeze({
  id: { dataType: 'bigint', nullable: false, identity: true },
  tenant_id: { dataType: 'text', nullable: false },
  page_id: { dataType: 'text', nullable: false },
  target_type: { dataType: 'text', nullable: false },
  target_id: { dataType: 'text', nullable: false },
  body: { dataType: 'text', nullable: false },
  status: { dataType: 'text', nullable: false },
  created_by: { dataType: 'text', nullable: false },
  created_at: { dataType: 'timestamp with time zone', nullable: false },
  hidden_by: { dataType: 'text', nullable: false },
  hidden_at: { dataType: 'timestamp with time zone', nullable: true },
  hide_reason: { dataType: 'text', nullable: false }
});

const EXPECTED_INDEXES = Object.freeze({
  internal_notes_target_time_idx: ['tenant_id', 'page_id', 'target_type', 'target_id', 'created_at DESC', 'id DESC'],
  internal_notes_status_time_idx: ['tenant_id', 'page_id', 'status', 'created_at DESC', 'id DESC']
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
      message: 'Skipped internal notes SQL verification: set CHATBOT_TEST_DATABASE_URL or CHATBOT_STAGING_DATABASE_URL to an explicit non-production PostgreSQL database. DATABASE_URL is intentionally ignored.'
    };
  }

  if (databaseUrl && explicit.value === databaseUrl) {
    return {
      ok: false,
      skipped: false,
      reason: 'explicit_url_matches_database_url',
      envName: explicit.name,
      message: `${explicit.name} must not equal DATABASE_URL. Refusing to verify against a potentially production database.`
    };
  }

  if (!isPostgresUrl(explicit.value)) {
    return {
      ok: false,
      skipped: false,
      reason: 'invalid_explicit_database_url',
      envName: explicit.name,
      message: `${explicit.name} must be a valid postgres:// or postgresql:// URL. The URL value was not printed.`
    };
  }

  return {
    ok: true,
    skipped: false,
    envName: explicit.name,
    value: explicit.value
  };
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error('Internal verifier generated an unsafe schema identifier.');
  }
  return `"${identifier}"`;
}

function createVerificationSchemaName() {
  return `internal_notes_verify_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`.toLowerCase();
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

async function verifyTable(client, schemaName) {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_name = 'internal_notes'
      AND table_type = 'BASE TABLE'
  `, [schemaName]);
  assertCondition(result.rows.length === 1, 'internal_notes table was not created in the isolated schema.');
}

async function verifyColumns(client, schemaName) {
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable, is_identity
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = 'internal_notes'
  `, [schemaName]);
  const columns = new Map(result.rows.map(row => [row.column_name, row]));

  for (const [name, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = columns.get(name);
    assertCondition(Boolean(actual), `Missing expected internal_notes column: ${name}.`);
    assertCondition(actual.data_type === expected.dataType, `Column ${name} has unexpected type ${actual.data_type}.`);
    assertCondition((actual.is_nullable === 'YES') === expected.nullable, `Column ${name} has unexpected nullability.`);
    if (expected.identity) {
      assertCondition(actual.is_identity === 'YES', `Column ${name} is not an identity column.`);
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
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = 'internal_notes'
  `, [schemaName]);
  const indexes = new Map(result.rows.map(row => [row.indexname, normalizeIndexDefinition(row.indexdef)]));

  for (const [name, expectedParts] of Object.entries(EXPECTED_INDEXES)) {
    const definition = indexes.get(name);
    assertCondition(Boolean(definition), `Missing expected index: ${name}.`);
    for (const part of expectedParts) {
      assertCondition(definition.includes(part.toLowerCase()), `Index ${name} is missing expected part: ${part}.`);
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

async function verifyCheckConstraints(client, schemaName) {
  const result = await client.query(`
    SELECT c.contype, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1
      AND t.relname = 'internal_notes'
  `, [schemaName]);

  const constraints = result.rows.map(row => ({
    type: row.contype,
    name: row.conname,
    definition: normalizeConstraintDefinition(row.definition)
  }));
  const checks = constraints.filter(item => item.type === 'c').map(item => item.definition);

  assertCondition(constraints.some(item => item.type === 'p'), 'Missing internal_notes primary key constraint.');
  assertCondition(checks.length >= 7, `Expected at least 7 CHECK constraints, found ${checks.length}.`);
  assertCondition(checks.some(def => def.includes('tenant_id') && def.includes('<>')), 'Missing tenant_id non-empty CHECK constraint.');
  assertCondition(checks.some(def => def.includes('page_id') && def.includes('<>')), 'Missing page_id non-empty CHECK constraint.');
  assertCondition(checks.some(def => def.includes('target_type') && def.includes('order') && def.includes('conversation') && def.includes('customer')), 'Missing target_type CHECK constraint.');
  assertCondition(checks.some(def => def.includes('target_id') && def.includes('<>')), 'Missing target_id non-empty CHECK constraint.');
  assertCondition(checks.some(def => def.includes('body') && def.includes('<>')), 'Missing body non-empty CHECK constraint.');
  assertCondition(checks.some(def => def.includes('char_length(body)') && def.includes('<= 2000')), 'Missing body length CHECK constraint.');
  assertCondition(checks.some(def => def.includes('status') && def.includes('visible') && def.includes('hidden')), 'Missing status CHECK constraint.');
}

async function verifyInternalNotesProposal({ databaseUrl, schemaName = createVerificationSchemaName(), Client } = {}) {
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
    await verifyTable(client, schemaName);
    await verifyColumns(client, schemaName);
    await verifyIndexes(client, schemaName);
    await verifyCheckConstraints(client, schemaName);
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

  stdout(`Using ${selected.envName} for internal notes SQL verification. DATABASE_URL is ignored and the URL will not be printed.`);
  stdout('Applying db/internal-notes-proposal.sql twice inside a temporary isolated schema.');
  try {
    const result = await verifyInternalNotesProposal({ databaseUrl: selected.value });
    stdout(`Verified internal_notes table, columns, indexes, CHECK constraints, and idempotency in temporary schema ${result.schemaName}.`);
    stdout('Temporary schema was dropped after verification.');
    return 0;
  } catch (err) {
    stderr(`Internal notes SQL verification failed: ${sanitizeMessage(err.message, env)}`);
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
  verifyInternalNotesProposal
};

const crypto = require('crypto');
const { encryptCredential } = require('../core/credentials/page-credentials');

const DEFAULT_CREDENTIAL_TYPE = 'fb_page_token';
const DEFAULT_SHOP_ID = 'adult-shop';
const EXPLICIT_DATABASE_URL_ENVS = Object.freeze([
  'CHATBOT_TEST_DATABASE_URL',
  'CHATBOT_STAGING_DATABASE_URL'
]);
const PRODUCTION_CONFIRMATION = 'seed adult-shop page credential';

function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function boolFlag(value) {
  return /^(1|true|yes|on)$/i.test(trimText(value));
}

function isPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  } catch (_) {
    return false;
  }
}

function sanitizeMessage(message, env = process.env) {
  let sanitized = text(message);
  for (const name of ['DATABASE_URL', ...EXPLICIT_DATABASE_URL_ENVS]) {
    const value = trimText(env[name]);
    if (value) sanitized = sanitized.split(value).join('[redacted]');
  }
  return sanitized;
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    dryRun: true,
    production: false,
    shopId: DEFAULT_SHOP_ID,
    pageId: '',
    credentialType: DEFAULT_CREDENTIAL_TYPE,
    encryptionKeyId: 'default',
    keyVersion: 1
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      return argv[index] || '';
    };

    if (arg === '--apply') {
      options.apply = true;
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.apply = false;
    } else if (arg === '--production') {
      options.production = true;
    } else if (arg === '--shop-id') {
      options.shopId = nextValue();
    } else if (arg === '--page-id') {
      options.pageId = nextValue();
    } else if (arg === '--credential-type') {
      options.credentialType = nextValue();
    } else if (arg === '--encryption-key-id') {
      options.encryptionKeyId = nextValue();
    } else if (arg === '--key-version') {
      options.keyVersion = Number(nextValue());
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return options;
}

function chooseDatabaseUrl({ env = process.env, options = {} } = {}) {
  const databaseUrl = trimText(env.DATABASE_URL);

  if (options.production) {
    if (!options.apply) {
      return {
        ok: false,
        reason: 'production_requires_apply',
        message: 'Production mode is only available for the final approved write: pass --apply plus CONFIRM_PRODUCTION_WRITE. No production dry-run is supported by this script.'
      };
    }
    if (trimText(env.CONFIRM_PRODUCTION_WRITE) !== PRODUCTION_CONFIRMATION) {
      return {
        ok: false,
        reason: 'missing_production_confirmation',
        message: `Refusing production write: set CONFIRM_PRODUCTION_WRITE="${PRODUCTION_CONFIRMATION}" only after fresh backup and explicit approval.`
      };
    }
    if (!isPostgresUrl(databaseUrl)) {
      return {
        ok: false,
        reason: 'invalid_database_url',
        message: 'DATABASE_URL must be a valid postgres:// or postgresql:// URL for an approved production write. The URL value was not printed.'
      };
    }
    return {
      ok: true,
      envName: 'DATABASE_URL',
      value: databaseUrl,
      production: true
    };
  }

  const explicit = EXPLICIT_DATABASE_URL_ENVS
    .map(name => ({ name, value: trimText(env[name]) }))
    .find(item => item.value);

  if (!explicit) {
    return {
      ok: false,
      reason: 'missing_explicit_database_url',
      message: 'Set CHATBOT_TEST_DATABASE_URL or CHATBOT_STAGING_DATABASE_URL to an explicit non-production PostgreSQL database. DATABASE_URL is intentionally ignored outside approved production apply mode.'
    };
  }
  if (databaseUrl && explicit.value === databaseUrl) {
    return {
      ok: false,
      reason: 'explicit_url_matches_database_url',
      message: `${explicit.name} must not equal DATABASE_URL. Refusing to use a potentially production database.`
    };
  }
  if (!isPostgresUrl(explicit.value)) {
    return {
      ok: false,
      reason: 'invalid_explicit_database_url',
      message: `${explicit.name} must be a valid postgres:// or postgresql:// URL. The URL value was not printed.`
    };
  }

  return {
    ok: true,
    envName: explicit.name,
    value: explicit.value,
    production: false
  };
}

function getSeedInput({ env = process.env, options = {} } = {}) {
  return {
    shopId: trimText(options.shopId || env.PAGE_CREDENTIAL_SHOP_ID || DEFAULT_SHOP_ID),
    pageId: trimText(options.pageId || env.PAGE_CREDENTIAL_PAGE_ID || env.PAGE_ID),
    credentialType: trimText(options.credentialType || DEFAULT_CREDENTIAL_TYPE) || DEFAULT_CREDENTIAL_TYPE,
    encryptionKeyId: trimText(options.encryptionKeyId || env.CREDENTIAL_KEY_ID || 'default') || 'default',
    keyVersion: Number(options.keyVersion || env.CREDENTIAL_KEY_VERSION || 1),
    masterKey: trimText(env.CREDENTIAL_MASTER_KEY),
    token: text(env.PAGE_CREDENTIAL_TOKEN || env.FB_PAGE_TOKEN)
  };
}

function validateSeedInput(input = {}) {
  if (!trimText(input.shopId)) throw new Error('shop_id_missing');
  if (!trimText(input.pageId)) throw new Error('page_id_missing');
  if (trimText(input.credentialType) !== DEFAULT_CREDENTIAL_TYPE) {
    throw new Error('unsupported_credential_type');
  }
  if (!trimText(input.encryptionKeyId)) throw new Error('encryption_key_id_missing');
  if (!Number.isInteger(input.keyVersion) || input.keyVersion <= 0) {
    throw new Error('key_version_invalid');
  }
  if (!trimText(input.masterKey)) throw new Error('credential_master_key_missing');
  if (!text(input.token)) throw new Error('credential_token_missing');
}

async function findActiveShopPage(client, input) {
  const result = await client.query(
    `
      SELECT
        s.id AS shop_id,
        sp.id AS page_mapping_id
      FROM shops s
      JOIN shop_pages sp ON sp.shop_id = s.id
      WHERE s.id = $1
        AND s.status = 'active'
        AND sp.page_id = $2
        AND sp.status = 'active'
      ORDER BY sp.updated_at DESC, sp.id
      LIMIT 2
    `,
    [input.shopId, input.pageId]
  );

  if (!result.rows.length) return { found: false, reason: 'shop_page_not_found' };
  if (result.rows.length > 1) return { found: false, reason: 'shop_page_ambiguous' };
  return {
    found: true,
    shopId: trimText(result.rows[0].shop_id),
    pageMappingId: trimText(result.rows[0].page_mapping_id)
  };
}

async function activeCredentialCount(client, input, mapping) {
  const result = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
    `,
    [input.shopId, mapping.pageMappingId, input.credentialType]
  );
  return Number(result.rows[0]?.count || 0);
}

function createCredentialId() {
  if (typeof crypto.randomUUID === 'function') {
    return `credential_${crypto.randomUUID()}`;
  }
  return `credential_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

async function insertCredential(client, input, mapping, encryptedValue) {
  const id = createCredentialId();
  await client.query(
    `
      INSERT INTO shop_page_credentials (
        id,
        shop_id,
        page_mapping_id,
        credential_type,
        encrypted_value,
        encryption_key_id,
        key_version,
        status,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb, now(), now())
    `,
    [
      id,
      input.shopId,
      mapping.pageMappingId,
      input.credentialType,
      encryptedValue,
      input.encryptionKeyId,
      input.keyVersion,
      JSON.stringify({
        seeded_by: 'prepare-page-credential-seed',
        secret_source: 'env',
        rotation_mode: 'initial'
      })
    ]
  );
  return id;
}

async function preparePageCredentialSeed({
  client,
  env = process.env,
  options = {},
  stdout = () => {}
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('client_required');
  }

  const input = getSeedInput({ env, options });
  validateSeedInput(input);

  stdout(`mode=${options.apply ? 'apply' : 'dry-run'}`);
  stdout(`production=${options.production ? 'true' : 'false'}`);

  const mapping = await findActiveShopPage(client, input);
  if (!mapping.found) {
    stdout('shop_found=false');
    stdout('page_found=false');
    throw new Error(mapping.reason);
  }

  stdout('shop_found=true');
  stdout('page_found=true');

  const existing = await activeCredentialCount(client, input, mapping);
  stdout(`active_credential_exists=${existing > 0 ? 'true' : 'false'}`);
  if (existing > 0) {
    throw new Error('active_credential_exists');
  }

  const encryptedValue = encryptCredential(input.token, input.masterKey);
  if (!options.apply) {
    stdout('credential_inserted=false');
    stdout('dry_run_no_write=true');
    return {
      ok: true,
      dryRun: true,
      inserted: false,
      shopFound: true,
      pageFound: true,
      activeCredentialExists: false
    };
  }

  await client.query('BEGIN');
  try {
    await insertCredential(client, input, mapping, encryptedValue);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  }

  stdout('credential_inserted=true');
  return {
    ok: true,
    dryRun: false,
    inserted: true,
    shopFound: true,
    pageFound: true,
    activeCredentialExists: false
  };
}

async function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = console.log,
  stderr = console.error,
  Client
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    stderr(`Invalid arguments: ${err.message}`);
    return 1;
  }

  const selected = chooseDatabaseUrl({ env, options });
  if (!selected.ok) {
    stderr(selected.message);
    return 1;
  }

  const PgClient = Client || require('pg').Client;
  const client = new PgClient({ connectionString: selected.value });
  stdout(`database_url_source=${selected.envName}`);
  stdout('database_url_printed=false');
  stdout('token_printed=false');
  stdout('encrypted_value_printed=false');

  try {
    await client.connect();
    await preparePageCredentialSeed({ client, env, options, stdout });
    return 0;
  } catch (err) {
    stderr(`credential_seed_failed=${sanitizeMessage(err.message, env)}`);
    stderr('No token, encrypted credential, or database URL was printed.');
    return 1;
  } finally {
    try {
      await client.end();
    } catch (_) {}
  }
}

if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = {
  DEFAULT_CREDENTIAL_TYPE,
  EXPLICIT_DATABASE_URL_ENVS,
  PRODUCTION_CONFIRMATION,
  activeCredentialCount,
  boolFlag,
  chooseDatabaseUrl,
  findActiveShopPage,
  getSeedInput,
  isPostgresUrl,
  main,
  parseArgs,
  preparePageCredentialSeed,
  sanitizeMessage,
  validateSeedInput
};

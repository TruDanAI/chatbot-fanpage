const crypto = require('crypto');
const { encryptCredential } = require('../core/credentials/page-credentials');
const { pageRef } = require('../core/utils/log-refs');

const SHOP_ID = 'test-shop';
const SHOP_SLUG = 'test-shop';
const SHOP_NAME = 'Test Shop Canary';
const DEFAULT_PAGE_NAME = 'Test Shop Canary Fanpage';
const CREDENTIAL_TYPE = 'fb_page_token';
const PRODUCTION_CONFIRMATION = 'seed test-shop canary';

const EXPLICIT_DATABASE_URL_ENVS = Object.freeze([
  'CHATBOT_TEST_DATABASE_URL',
  'CHATBOT_STAGING_DATABASE_URL'
]);
const PRODUCTION_DATABASE_URL_ENVS = Object.freeze([
  'DATABASE_PUBLIC_URL',
  'DATABASE_URL'
]);
const SENSITIVE_ENV_NAMES = Object.freeze([
  'DATABASE_URL',
  'DATABASE_PUBLIC_URL',
  'CHATBOT_TEST_DATABASE_URL',
  'CHATBOT_STAGING_DATABASE_URL',
  'CREDENTIAL_MASTER_KEY',
  'TEST_SHOP_PAGE_ID',
  'TEST_SHOP_PAGE_TOKEN',
  'TEST_SHOP_FB_APP_SECRET',
  'FB_APP_SECRET'
]);

const COUNT_TABLES = Object.freeze([
  'shops',
  'shop_pages',
  'shop_settings',
  'shop_products',
  'shop_assets',
  'shop_page_credentials'
]);

const TEST_PRODUCTS = Object.freeze([
  {
    id: 'product_test_shop_test01',
    code: 'TEST01',
    name: '[TEST] Canary Sample 1',
    description: 'TEST PRODUCT - not for sale.',
    price: 1000,
    currency: 'VND',
    sortOrder: 10,
    metadata: {
      testOnly: true,
      priceLabel: '1k test',
      description: 'TEST PRODUCT - not for sale.'
    }
  },
  {
    id: 'product_test_shop_test02',
    code: 'TEST02',
    name: '[TEST] Canary Sample 2',
    description: 'TEST PRODUCT - not for sale.',
    price: 2000,
    currency: 'VND',
    sortOrder: 20,
    metadata: {
      testOnly: true,
      priceLabel: '2k test',
      description: 'TEST PRODUCT - not for sale.'
    }
  }
]);

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
  for (const name of SENSITIVE_ENV_NAMES) {
    const value = trimText(env[name]);
    if (value) sanitized = sanitized.split(value).join('[redacted]');
  }
  return sanitized;
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    dryRun: true,
    checkOnly: false,
    production: false,
    pageName: '',
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
      options.checkOnly = false;
    } else if (arg === '--dry-run') {
      options.apply = false;
      options.dryRun = true;
      options.checkOnly = false;
    } else if (arg === '--check' || arg === '--check-only') {
      options.apply = false;
      options.dryRun = false;
      options.checkOnly = true;
    } else if (arg === '--production') {
      options.production = true;
    } else if (arg === '--page-name') {
      options.pageName = nextValue();
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
  if (options.production) {
    if (options.apply && trimText(env.CONFIRM_PRODUCTION_WRITE) !== PRODUCTION_CONFIRMATION) {
      return {
        ok: false,
        reason: 'missing_production_confirmation',
        message: `Refusing production write: set CONFIRM_PRODUCTION_WRITE="${PRODUCTION_CONFIRMATION}" only after explicit approval.`
      };
    }

    const selected = PRODUCTION_DATABASE_URL_ENVS
      .map(name => ({ name, value: trimText(env[name]) }))
      .find(item => item.value);

    if (!selected) {
      return {
        ok: false,
        reason: 'missing_database_url',
        message: 'No production PostgreSQL URL env was available. The URL value was not printed.'
      };
    }
    if (!isPostgresUrl(selected.value)) {
      return {
        ok: false,
        reason: 'invalid_database_url',
        envName: selected.name,
        message: `${selected.name} must be a valid postgres:// or postgresql:// URL. The URL value was not printed.`
      };
    }
    return {
      ok: true,
      envName: selected.name,
      value: selected.value,
      production: true
    };
  }

  const databaseUrl = trimText(env.DATABASE_URL);
  const databasePublicUrl = trimText(env.DATABASE_PUBLIC_URL);
  const explicit = EXPLICIT_DATABASE_URL_ENVS
    .map(name => ({ name, value: trimText(env[name]) }))
    .find(item => item.value);

  if (!explicit) {
    return {
      ok: false,
      reason: 'missing_explicit_database_url',
      message: 'Set CHATBOT_TEST_DATABASE_URL or CHATBOT_STAGING_DATABASE_URL to an explicit non-production PostgreSQL database. Production DATABASE_URL values are intentionally ignored outside --production mode.'
    };
  }
  if ((databaseUrl && explicit.value === databaseUrl) || (databasePublicUrl && explicit.value === databasePublicUrl)) {
    return {
      ok: false,
      reason: 'explicit_url_matches_database_url',
      envName: explicit.name,
      message: `${explicit.name} must not equal a production database URL env. Refusing to use a potentially production database.`
    };
  }
  if (!isPostgresUrl(explicit.value)) {
    return {
      ok: false,
      reason: 'invalid_explicit_database_url',
      envName: explicit.name,
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
    shopId: SHOP_ID,
    shopSlug: SHOP_SLUG,
    shopName: SHOP_NAME,
    pageId: trimText(env.TEST_SHOP_PAGE_ID),
    pageName: trimText(options.pageName || env.TEST_SHOP_PAGE_NAME || DEFAULT_PAGE_NAME) || DEFAULT_PAGE_NAME,
    credentialType: CREDENTIAL_TYPE,
    encryptionKeyId: trimText(options.encryptionKeyId || env.CREDENTIAL_KEY_ID || 'default') || 'default',
    keyVersion: Number(options.keyVersion || env.CREDENTIAL_KEY_VERSION || 1),
    masterKey: trimText(env.CREDENTIAL_MASTER_KEY),
    token: text(env.TEST_SHOP_PAGE_TOKEN)
  };
}

function validateSeedInput(input = {}, { requireCredential = true } = {}) {
  if (input.shopId !== SHOP_ID || input.shopSlug !== SHOP_SLUG) throw new Error('shop_scope_invalid');
  if (!trimText(input.pageId)) throw new Error('test_page_id_missing');
  if (!trimText(input.pageName)) throw new Error('test_page_name_missing');
  if (!trimText(input.encryptionKeyId)) throw new Error('encryption_key_id_missing');
  if (!Number.isInteger(input.keyVersion) || input.keyVersion <= 0) {
    throw new Error('key_version_invalid');
  }
  if (requireCredential) {
    if (!trimText(input.masterKey)) throw new Error('credential_master_key_missing');
    if (!text(input.token)) throw new Error('test_page_token_missing');
  }
}

function createPageMappingId(pageId) {
  return `page_test_shop_${crypto.createHash('sha256').update(trimText(pageId)).digest('hex').slice(0, 12)}`;
}

function createCredentialId() {
  if (typeof crypto.randomUUID === 'function') return `credential_${crypto.randomUUID()}`;
  return `credential_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function createSettingsJson() {
  return {
    shopName: SHOP_NAME,
    minAge: 18,
    botMode: {
      name: 'menu_code_handoff',
      handoffEnabled: true,
      aiFallbackEnabled: false,
      orderFlowEnabled: false,
      leadCaptureEnabled: false,
      followUpEnabled: false,
      recommendationEnabled: false,
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      fallbackEnabled: true,
      handoffMessage: 'Test shop canary handoff is enabled.',
      menuIntroText: 'Test shop canary menu. Use test codes only.'
    },
    ruleToggles: {
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      fallbackEnabled: true,
      leadCaptureEnabled: false
    },
    policies: {
      freeShipping: false,
      privacy: '',
      payment: '',
      preorderDays: '',
      orderInfoFields: 'test only'
    },
    hotCarouselProductCodes: ['TEST01', 'TEST02'],
    intents: {},
    templates: {},
    testOnly: true
  };
}

async function getTableCounts(client) {
  const counts = {};
  for (const table of COUNT_TABLES) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = Number(result.rows[0]?.count || 0);
  }
  return counts;
}

async function getAdultShopCounts(client) {
  const result = await client.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM shops WHERE id = 'adult-shop') AS shops,
        (SELECT COUNT(*)::int FROM shop_pages WHERE shop_id = 'adult-shop') AS shop_pages,
        (SELECT COUNT(*)::int FROM shop_settings WHERE shop_id = 'adult-shop') AS shop_settings,
        (SELECT COUNT(*)::int FROM shop_products WHERE shop_id = 'adult-shop') AS shop_products,
        (SELECT COUNT(*)::int FROM shop_assets WHERE shop_id = 'adult-shop') AS shop_assets,
        (SELECT COUNT(*)::int FROM shop_page_credentials WHERE shop_id = 'adult-shop' AND credential_type = 'fb_page_token' AND status = 'active') AS active_credentials
    `
  );
  return result.rows[0] || {};
}

function sameCounts(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (Number(left[key] || 0) !== Number(right[key] || 0)) return false;
  }
  return true;
}

async function findPageMappings(client, pageId) {
  const result = await client.query(
    `
      SELECT sp.id, sp.shop_id, sp.status, s.status AS shop_status
      FROM shop_pages sp
      LEFT JOIN shops s ON s.id = sp.shop_id
      WHERE sp.page_id = $1
      ORDER BY sp.updated_at DESC, sp.id
    `,
    [pageId]
  );
  return result.rows || [];
}

function evaluatePageMappings(rows = []) {
  const otherShopRows = rows.filter(row => trimText(row.shop_id) !== SHOP_ID);
  if (otherShopRows.length) throw new Error('test_page_belongs_to_other_shop');

  const testRows = rows.filter(row => trimText(row.shop_id) === SHOP_ID);
  if (testRows.length > 1) throw new Error('test_shop_page_mapping_ambiguous');

  const activeRows = testRows.filter(row => trimText(row.status) === 'active');
  if (activeRows.length > 1) throw new Error('duplicate_active_test_page_mapping');

  const existing = activeRows[0] || testRows[0] || null;
  return {
    exists: Boolean(existing),
    active: trimText(existing?.status) === 'active',
    pageMappingId: trimText(existing?.id)
  };
}

async function assertNoShopSlugConflict(client) {
  const result = await client.query(
    `
      SELECT id
      FROM shops
      WHERE slug = $1
        AND id <> $2
        AND status = 'active'
      LIMIT 1
    `,
    [SHOP_SLUG, SHOP_ID]
  );
  if (result.rows.length) throw new Error('shop_slug_conflict');
}

async function assertNoProductOwnershipConflicts(client) {
  const ids = TEST_PRODUCTS.map(product => product.id);
  const result = await client.query(
    `
      SELECT id, shop_id
      FROM shop_products
      WHERE id = ANY($1)
    `,
    [ids]
  );
  if (result.rows.some(row => trimText(row.shop_id) !== SHOP_ID)) {
    throw new Error('test_product_id_conflict');
  }
}

async function assertNoProductCodeConflicts(client) {
  const idsByCode = new Map(TEST_PRODUCTS.map(product => [product.code.toLowerCase(), product.id]));
  const codes = [...idsByCode.keys()];
  const result = await client.query(
    `
      SELECT id, lower(code) AS code
      FROM shop_products
      WHERE shop_id = $1
        AND lower(code) = ANY($2)
        AND status = 'active'
    `,
    [SHOP_ID, codes]
  );
  for (const row of result.rows) {
    if (trimText(row.id) !== idsByCode.get(trimText(row.code))) {
      throw new Error('test_product_code_conflict');
    }
  }
}

async function activeCredentialSummary(client, pageMappingId) {
  const result = await client.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE shop_id = $1 AND credential_type = $2 AND status = 'active')::int AS shop_active_count,
        COUNT(*) FILTER (
          WHERE shop_id = $1
            AND page_mapping_id = $3
            AND credential_type = $2
            AND status = 'active'
        )::int AS mapping_active_count
      FROM shop_page_credentials
    `,
    [SHOP_ID, CREDENTIAL_TYPE, pageMappingId]
  );
  return {
    shopActiveCount: Number(result.rows[0]?.shop_active_count || 0),
    mappingActiveCount: Number(result.rows[0]?.mapping_active_count || 0)
  };
}

async function collectSafeState(client, input) {
  const counts = await getTableCounts(client);
  const adultCounts = await getAdultShopCounts(client);
  const mappings = await findPageMappings(client, input.pageId);
  const pageState = evaluatePageMappings(mappings);
  const pageMappingId = pageState.pageMappingId || createPageMappingId(input.pageId);
  const credentials = await activeCredentialSummary(client, pageMappingId);

  return {
    counts,
    adultCounts,
    pageState,
    pageMappingId,
    credentials
  };
}

async function validateSeedPlan(client, input) {
  await assertNoShopSlugConflict(client);
  const mappings = await findPageMappings(client, input.pageId);
  const pageState = evaluatePageMappings(mappings);
  const pageMappingId = pageState.pageMappingId || createPageMappingId(input.pageId);
  await assertNoProductOwnershipConflicts(client);
  await assertNoProductCodeConflicts(client);

  const credentials = await activeCredentialSummary(client, pageMappingId);
  if (credentials.shopActiveCount > 1) throw new Error('test_shop_credential_ambiguous');
  if (credentials.shopActiveCount === 1 && credentials.mappingActiveCount !== 1) {
    throw new Error('active_test_shop_credential_exists_for_different_mapping');
  }

  return {
    pageState,
    pageMappingId,
    credentials,
    wouldInsertCredential: credentials.mappingActiveCount === 0
  };
}

async function upsertShop(client) {
  await client.query(
    `
      INSERT INTO shops (id, slug, name, status, default_locale, timezone, created_at, updated_at)
      VALUES ($1, $2, $3, 'active', 'vi-VN', 'Asia/Bangkok', now(), now())
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        status = 'active',
        default_locale = EXCLUDED.default_locale,
        timezone = EXCLUDED.timezone,
        updated_at = now()
    `,
    [SHOP_ID, SHOP_SLUG, SHOP_NAME]
  );
}

async function upsertPageMapping(client, input, pageState) {
  const pageMappingId = pageState.pageMappingId || createPageMappingId(input.pageId);
  if (pageState.exists) {
    await client.query(
      `
        UPDATE shop_pages
        SET shop_id = $2,
            page_name = $3,
            status = 'active',
            updated_at = now()
        WHERE id = $1
          AND shop_id = $2
      `,
      [pageMappingId, SHOP_ID, input.pageName]
    );
    return pageMappingId;
  }

  await client.query(
    `
      INSERT INTO shop_pages (id, shop_id, page_id, page_name, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'active', now(), now())
    `,
    [pageMappingId, SHOP_ID, input.pageId, input.pageName]
  );
  return pageMappingId;
}

async function upsertSettings(client) {
  await client.query(
    `
      INSERT INTO shop_settings (
        shop_id,
        bot_mode,
        handoff_enabled,
        handoff_message,
        menu_intro_text,
        fallback_text,
        settings_json,
        created_at,
        updated_at
      )
      VALUES ($1, 'menu_code_handoff', true, $2, $3, $4, $5::jsonb, now(), now())
      ON CONFLICT (shop_id) DO UPDATE SET
        bot_mode = 'menu_code_handoff',
        handoff_enabled = true,
        handoff_message = EXCLUDED.handoff_message,
        menu_intro_text = EXCLUDED.menu_intro_text,
        fallback_text = EXCLUDED.fallback_text,
        settings_json = EXCLUDED.settings_json,
        updated_at = now()
    `,
    [
      SHOP_ID,
      'Test shop canary handoff is enabled.',
      'Test shop canary menu. Use test codes only.',
      'Test shop canary fallback. Staff will follow up.',
      JSON.stringify(createSettingsJson())
    ]
  );
}

async function upsertProducts(client) {
  for (const product of TEST_PRODUCTS) {
    await client.query(
      `
        INSERT INTO shop_products (
          id,
          shop_id,
          code,
          name,
          description,
          price,
          currency,
          status,
          sort_order,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9::jsonb, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          code = EXCLUDED.code,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          status = 'active',
          sort_order = EXCLUDED.sort_order,
          metadata_json = EXCLUDED.metadata_json,
          updated_at = now()
      `,
      [
        product.id,
        SHOP_ID,
        product.code,
        product.name,
        product.description,
        product.price,
        product.currency,
        product.sortOrder,
        JSON.stringify(product.metadata)
      ]
    );
  }
}

async function insertCredential(client, input, pageMappingId) {
  const encryptedValue = encryptCredential(input.token, input.masterKey);
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
      createCredentialId(),
      SHOP_ID,
      pageMappingId,
      CREDENTIAL_TYPE,
      encryptedValue,
      input.encryptionKeyId,
      input.keyVersion,
      JSON.stringify({
        seeded_by: 'seed-test-shop-canary',
        secret_source: 'env',
        rotation_mode: 'initial',
        page_ref: pageRef(input.pageId)
      })
    ]
  );
}

async function verifySeed(client, input) {
  const result = await client.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM shops WHERE id = $1 AND slug = $2 AND status = 'active') AS shop_exists,
        (SELECT COUNT(*)::int FROM shop_pages WHERE shop_id = $1 AND page_id = $3 AND status = 'active') AS page_mapping_exists,
        (SELECT COUNT(*)::int FROM shop_settings WHERE shop_id = $1 AND bot_mode = 'menu_code_handoff') AS settings_exists,
        (SELECT COUNT(*)::int FROM shop_products WHERE shop_id = $1 AND status = 'active') AS active_products,
        (SELECT COUNT(*)::int FROM shop_assets WHERE shop_id = $1 AND status = 'active') AS active_assets,
        (SELECT COUNT(*)::int FROM shop_page_credentials WHERE shop_id = $1 AND credential_type = $4 AND status = 'active') AS active_credentials
    `,
    [SHOP_ID, SHOP_SLUG, input.pageId, CREDENTIAL_TYPE]
  );
  return {
    shopExists: Number(result.rows[0]?.shop_exists || 0) === 1,
    pageMappingExists: Number(result.rows[0]?.page_mapping_exists || 0) === 1,
    settingsExists: Number(result.rows[0]?.settings_exists || 0) === 1,
    activeProducts: Number(result.rows[0]?.active_products || 0),
    activeAssets: Number(result.rows[0]?.active_assets || 0),
    activeCredentials: Number(result.rows[0]?.active_credentials || 0)
  };
}

function printCounts(prefix, counts, stdout) {
  for (const table of COUNT_TABLES) {
    stdout(`${prefix}_${table}=${Number(counts?.[table] || 0)}`);
  }
}

function printSafeState({ state, input, stdout, prefix = 'preflight' }) {
  printCounts(prefix, state.counts, stdout);
  stdout(`${prefix}_page_ref=${pageRef(input.pageId)}`);
  stdout(`${prefix}_test_page_mapping_exists=${state.pageState.exists ? 'true' : 'false'}`);
  stdout(`${prefix}_test_page_mapping_active=${state.pageState.active ? 'true' : 'false'}`);
  stdout(`${prefix}_test_shop_active_credential_count=${state.credentials.shopActiveCount}`);
}

async function seedTestShopCanary({
  client,
  env = process.env,
  options = {},
  stdout = () => {}
} = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client_required');
  if (options.apply && options.production && trimText(env.CONFIRM_PRODUCTION_WRITE) !== PRODUCTION_CONFIRMATION) {
    throw new Error('missing_production_confirmation');
  }

  const input = getSeedInput({ env, options });
  validateSeedInput(input, { requireCredential: !options.checkOnly });

  stdout(`mode=${options.apply ? 'apply' : options.checkOnly ? 'check-only' : 'dry-run'}`);
  stdout(`production=${options.production ? 'true' : 'false'}`);
  stdout(`shop_id=${SHOP_ID}`);
  stdout(`page_ref=${pageRef(input.pageId)}`);

  const before = await collectSafeState(client, input);
  printSafeState({ state: before, input, stdout, prefix: 'before' });

  if (options.checkOnly) {
    stdout('write_attempted=false');
    return {
      ok: true,
      mode: 'check-only',
      before,
      insertedCredential: false
    };
  }

  if (!options.apply) {
    const plan = await validateSeedPlan(client, input);
    stdout('write_attempted=false');
    stdout('dry_run_no_write=true');
    stdout('dry_run_plan_valid=true');
    stdout(`dry_run_would_insert_credential=${plan.wouldInsertCredential ? 'true' : 'false'}`);
    return {
      ok: true,
      mode: 'dry-run',
      before,
      plan,
      insertedCredential: false
    };
  }

  let insertedCredential = false;

  await client.query('BEGIN');
  try {
    const plan = await validateSeedPlan(client, input);

    await upsertShop(client);
    const savedPageMappingId = await upsertPageMapping(client, input, plan.pageState);
    await upsertSettings(client);
    await upsertProducts(client);

    if (plan.credentials.mappingActiveCount === 0) {
      await insertCredential(client, input, savedPageMappingId);
      insertedCredential = true;
    }

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  }

  const after = await collectSafeState(client, input);
  const verification = await verifySeed(client, input);
  const adultAfter = await getAdultShopCounts(client);
  stdout('write_attempted=true');
  stdout('shop_upserted=true');
  stdout('page_mapping_upserted=true');
  stdout('settings_upserted=true');
  stdout(`products_upserted=${TEST_PRODUCTS.length}`);
  stdout('assets_inserted=0');
  printCounts('after', after.counts, stdout);
  stdout(`test_shop_exists=${verification.shopExists ? 'true' : 'false'}`);
  stdout(`test_page_mapping_exists=${verification.pageMappingExists ? 'true' : 'false'}`);
  stdout(`test_settings_exists=${verification.settingsExists ? 'true' : 'false'}`);
  stdout(`test_products_count=${verification.activeProducts}`);
  stdout(`test_assets_count=${verification.activeAssets}`);
  stdout(`test_shop_active_fb_page_token_credentials=${verification.activeCredentials}`);
  stdout(`credential_inserted=${insertedCredential ? 'true' : 'false'}`);
  stdout(`adult_shop_unchanged=${sameCounts(before.adultCounts, adultAfter) ? 'true' : 'false'}`);

  if (!verification.shopExists) throw new Error('verify_test_shop_missing');
  if (!verification.pageMappingExists) throw new Error('verify_test_page_mapping_missing');
  if (!verification.settingsExists) throw new Error('verify_test_settings_missing');
  if (verification.activeProducts < TEST_PRODUCTS.length) throw new Error('verify_test_products_missing');
  if (verification.activeCredentials !== 1) throw new Error('verify_test_credential_count_invalid');
  if (!sameCounts(before.adultCounts, adultAfter)) throw new Error('verify_adult_shop_changed');

  return {
    ok: true,
    mode: 'apply',
    before,
    after,
    verification,
    insertedCredential
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
  const client = new PgClient({
    connectionString: selected.value,
    ssl: selected.envName === 'DATABASE_PUBLIC_URL' ? { rejectUnauthorized: false } : undefined
  });

  stdout(`database_url_source=${selected.envName}`);
  stdout('database_url_printed=false');
  stdout('page_id_printed=false');
  stdout('token_printed=false');
  stdout('app_secret_printed=false');
  stdout('encrypted_value_printed=false');

  try {
    await client.connect();
    await seedTestShopCanary({ client, env, options, stdout });
    return 0;
  } catch (err) {
    stderr(`seed_test_shop_canary_failed=${sanitizeMessage(err.message, env)}`);
    stderr('No token, encrypted credential, raw page id, app secret, or database URL was printed.');
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
  CREDENTIAL_TYPE,
  PRODUCTION_CONFIRMATION,
  SHOP_ID,
  TEST_PRODUCTS,
  chooseDatabaseUrl,
  createPageMappingId,
  getSeedInput,
  isPostgresUrl,
  main,
  parseArgs,
  sanitizeMessage,
  seedTestShopCanary,
  validateSeedInput
};

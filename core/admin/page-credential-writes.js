const crypto = require('crypto');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { DEFAULT_CREDENTIAL_TYPE, encryptCredential } = require('../credentials/page-credentials');
const { envFlagEnabled, isProductionRuntime } = require('../storage-config');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { assertPageSetupDirectWriteAllowed } = require('./page-setup-preview');
const { pageRef } = require('../utils/log-refs');

const DEMO_SHOP_CREDENTIAL_WRITE_UNLOCK_ENV = 'DEMO_SHOP_CREDENTIAL_WRITE_ENABLED';
const DEMO_SHOP_ID = 'demo-shop';
const DEMO_SHOP_CREDENTIAL_WRITE_LIFECYCLES = Object.freeze(new Set(['configuring', 'ready']));
const PAGE_CREDENTIAL_WRITE_ACTIONS = Object.freeze({
  CREATE: 'admin.shop_page_credential.create',
  ROTATE: 'admin.shop_page_credential.rotate'
});
const MIN_PAGE_TOKEN_LENGTH = 20;
const MAX_PAGE_TOKEN_LENGTH = 5000;

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL page credential admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function text(value = '') {
  return value == null ? '' : String(value);
}

function boolFlag(value) {
  return /^(1|true|yes|on|rotate)$/i.test(normalizeText(value, 20));
}

function normalizeEnvName(value = '') {
  return normalizeText(value, 80).toLowerCase();
}

function isStagingRuntime(env = process.env) {
  if (isProductionRuntime(env)) return false;
  return [
    env.NODE_ENV,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_ENVIRONMENT_NAME
  ].some(value => normalizeEnvName(value) === 'staging');
}

function isDemoShop(shop = {}) {
  return [shop.id, shop.slug]
    .map(value => normalizeText(value, 160).toLowerCase())
    .includes(DEMO_SHOP_ID);
}

function isDemoShopCredentialWriteProtected(shop = {}) {
  return isDemoShop(shop)
    && DEMO_SHOP_CREDENTIAL_WRITE_LIFECYCLES.has(normalizeText(shop.lifecycle, 80).toLowerCase())
    && shop.live_enabled === false;
}

function isActiveMappedPageForShop(shop = {}, mapping = {}) {
  return Boolean(mapping.id)
    && mapping.shop_id === shop.id
    && Boolean(normalizeText(mapping.page_id, 120))
    && normalizeText(mapping.status, 40).toLowerCase() === 'active';
}

function isDemoShopCredentialWriteUnlockAllowed(shop = {}, mapping = {}, env = process.env) {
  return envFlagEnabled(env[DEMO_SHOP_CREDENTIAL_WRITE_UNLOCK_ENV])
    && isStagingRuntime(env)
    && isDemoShopCredentialWriteProtected(shop)
    && envFlagEnabled(env.MESSENGER_DRY_RUN)
    && isActiveMappedPageForShop(shop, mapping);
}

function assertPageCredentialDirectWriteAllowed(shop = {}, mapping = {}, env = process.env) {
  if (!isDemoShopCredentialWriteProtected(shop)) {
    assertPageSetupDirectWriteAllowed(shop);
    return;
  }
  if (isDemoShopCredentialWriteUnlockAllowed(shop, mapping, env)) return;
  throw createPageCredentialWriteError(
    'page_setup_preview_only',
    'Demo-shop page setup is preview-only while configuring/non-live.',
    409
  );
}

function createPageCredentialWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function createCredentialId() {
  if (typeof crypto.randomUUID === 'function') {
    return `credential_${crypto.randomUUID()}`;
  }
  return `credential_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizePageCredentialInput(body = {}) {
  return {
    credentialType: normalizeText(body.credential_type ?? body.credentialType ?? DEFAULT_CREDENTIAL_TYPE, 80).toLowerCase() || DEFAULT_CREDENTIAL_TYPE,
    token: text(body.token ?? body.page_token ?? body.pageToken),
    rotate: Object.prototype.hasOwnProperty.call(body, 'rotate')
      ? boolFlag(body.rotate)
      : boolFlag(body.mode)
  };
}

function validatePageCredentialInput(input = {}, { masterKey = '' } = {}) {
  if (input.credentialType !== DEFAULT_CREDENTIAL_TYPE) {
    throw createPageCredentialWriteError('unsupported_credential_type', 'Credential type is not supported.', 400);
  }
  const token = text(input.token).trim();
  if (!token) {
    throw createPageCredentialWriteError('credential_token_missing', 'Credential token is required.', 400);
  }
  if (token.length < MIN_PAGE_TOKEN_LENGTH || token.length > MAX_PAGE_TOKEN_LENGTH) {
    throw createPageCredentialWriteError('credential_token_invalid', 'Credential token length is invalid.', 400);
  }
  if (!normalizeText(masterKey, 5000)) {
    throw createPageCredentialWriteError('credential_master_key_missing', 'Credential master key is required.', 503);
  }
}

function presentPageCredential(row = {}) {
  return {
    id: row.id || '',
    credential_type: row.credential_type || DEFAULT_CREDENTIAL_TYPE,
    status: row.status || ''
  };
}

function createPageCredentialWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createPageCredentialWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, lifecycle, live_enabled
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createPageCredentialWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function resolvePageMapping(client, { shopId, pageMappingId } = {}) {
    const normalized = normalizeText(pageMappingId, 160);
    if (!normalized) throw createPageCredentialWriteError('page_mapping_not_found', 'Page mapping was not found.', 404);
    const result = await client.query(`
      SELECT id, shop_id, page_id, page_name, status
      FROM shop_pages
      WHERE id = $1
        AND shop_id = $2
      LIMIT 1
    `, [normalized, shopId]);
    const mapping = result.rows[0] || null;
    if (!mapping?.id) {
      throw createPageCredentialWriteError('page_mapping_not_found', 'Page mapping was not found.', 404);
    }
    return mapping;
  }

  async function listActiveCredentialsForUpdate(client, { shopId, pageMappingId, credentialType } = {}) {
    const result = await client.query(`
      SELECT id, status, credential_type
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
      ORDER BY updated_at DESC, id
      FOR UPDATE
    `, [shopId, pageMappingId, credentialType]);
    return result.rows || [];
  }

  async function archiveActiveCredentials(client, { shopId, pageMappingId, credentialType } = {}) {
    const result = await client.query(`
      UPDATE shop_page_credentials
      SET status = 'archived',
          updated_at = now()
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
    `, [shopId, pageMappingId, credentialType]);
    return Number(result.rowCount || 0);
  }

  async function insertCredential(client, {
    shopId,
    pageMappingId,
    credentialId,
    input,
    encryptedValue
  } = {}) {
    const result = await client.query(`
      INSERT INTO shop_page_credentials (
        id, shop_id, page_mapping_id, credential_type, encrypted_value,
        encryption_key_id, key_version, status, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, 'default', 1, 'active', $6::jsonb)
      RETURNING id, shop_id, page_mapping_id, credential_type, status, created_at, updated_at
    `, [
      credentialId,
      shopId,
      pageMappingId,
      input.credentialType,
      encryptedValue,
      JSON.stringify({
        source: 'admin',
        rotated: Boolean(input.rotate)
      })
    ]);
    return result.rows[0] || null;
  }

  async function countActiveCredentials(client, { shopId, pageMappingId, credentialType } = {}) {
    const result = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
    `, [shopId, pageMappingId, credentialType]);
    return Number(result.rows[0]?.count || 0);
  }

  async function markShopReadinessStale(client, shopId) {
    const result = await client.query(`
      UPDATE shops
      SET last_readiness_status = 'unknown',
          last_readiness_checked_at = NULL,
          last_ready_by = '',
          updated_at = now()
      WHERE id = $1
      RETURNING id, last_readiness_status, last_readiness_checked_at, last_ready_by
    `, [shopId]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    action,
    resourceId = '',
    metadata = {},
    requestContext = {},
    includeAuthMethod = true
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action,
      resourceType: 'shop_page_credential',
      resourceId,
      outcome: 'success',
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata,
      includeAuthMethod
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    archiveActiveCredentials,
    countActiveCredentials,
    insertAudit,
    insertCredential,
    listActiveCredentialsForUpdate,
    markShopReadinessStale,
    resolvePageMapping,
    resolveShop
  };
}

function createPostgresPageCredentialWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createPageCredentialWriteRepository(),
  getCredentialMasterKey = () => process.env.CREDENTIAL_MASTER_KEY,
  env = process.env
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createPageCredentialWriteError('database_url_required', 'DATABASE_URL is required for page credential writes.', 503);
    }
    let transactionOpen = false;
    const client = new (Client || loadPgClient())({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const result = await fn(client);
      let commitResult;
      try {
        commitResult = await client.query('COMMIT');
        transactionOpen = false;
      } catch (_) {
        throw createPageCredentialWriteError('page_credential_commit_failed', 'Page credential write could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createPageCredentialWriteError('page_credential_commit_failed', 'Page credential write could not be committed.', 500);
      }
      return result;
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      if (String(err?.code || '') === '23505') {
        throw createPageCredentialWriteError('active_credential_exists', 'An active credential already exists for this page mapping.', 409);
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createPageCredentialWriteError('permission_denied', 'Page credential write permission is required.', 403);
    }
  }

  async function createPageCredential({
    principal,
    shopId,
    pageMappingId,
    body = {},
    requestContext = {}
  } = {}) {
    assertWritePermission(principal);
    const input = normalizePageCredentialInput(body);
    const masterKey = getCredentialMasterKey();
    validatePageCredentialInput(input, { masterKey });
    const token = text(input.token).trim();

    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      if (isDemoShopCredentialWriteProtected(shop) && !envFlagEnabled(env[DEMO_SHOP_CREDENTIAL_WRITE_UNLOCK_ENV])) {
        assertPageCredentialDirectWriteAllowed(shop, {}, env);
      } else if (!isDemoShopCredentialWriteProtected(shop)) {
        assertPageSetupDirectWriteAllowed(shop);
      }
      const mapping = await repository.resolvePageMapping(client, {
        shopId: shop.id,
        pageMappingId
      });
      assertPageCredentialDirectWriteAllowed(shop, mapping, env);
      const activeCredentials = await repository.listActiveCredentialsForUpdate(client, {
        shopId: shop.id,
        pageMappingId: mapping.id,
        credentialType: input.credentialType
      });
      const previousActiveCount = activeCredentials.length;
      if (activeCredentials.length && !input.rotate) {
        throw createPageCredentialWriteError('active_credential_exists', 'An active credential already exists for this page mapping.', 409);
      }
      const archivedCount = input.rotate
        ? await repository.archiveActiveCredentials(client, {
          shopId: shop.id,
          pageMappingId: mapping.id,
          credentialType: input.credentialType
        })
        : 0;
      const encryptedValue = encryptCredential(token, masterKey);
      const credentialId = createCredentialId();
      const row = await repository.insertCredential(client, {
        shopId: shop.id,
        pageMappingId: mapping.id,
        credentialId,
        input,
        encryptedValue
      });
      if (!row?.id) {
        throw createPageCredentialWriteError('page_credential_persist_failed', 'Page credential could not be persisted.', 500);
      }
      const activeCredentialCount = await repository.countActiveCredentials(client, {
        shopId: shop.id,
        pageMappingId: mapping.id,
        credentialType: input.credentialType
      });
      await repository.markShopReadinessStale(client, shop.id);
      await repository.insertAudit(client, {
        principal,
        action: input.rotate ? PAGE_CREDENTIAL_WRITE_ACTIONS.ROTATE : PAGE_CREDENTIAL_WRITE_ACTIONS.CREATE,
        resourceId: row.id,
        metadata: {
          page_ref: pageRef(mapping.page_id),
          credential_type: input.credentialType,
          rotated: Boolean(input.rotate),
          previous_active_count: previousActiveCount,
          archived_count: archivedCount,
          active_count: activeCredentialCount
        },
        requestContext,
        includeAuthMethod: false
      });
      return {
        shopId: shop.id,
        pageMappingId: mapping.id,
        page_ref: pageRef(mapping.page_id),
        credential: presentPageCredential(row),
        active_credential_count: activeCredentialCount,
        archived_count: archivedCount,
        rotated: Boolean(input.rotate)
      };
    });
  }

  return {
    createPageCredential
  };
}

module.exports = {
  DEFAULT_CREDENTIAL_TYPE,
  MAX_PAGE_TOKEN_LENGTH,
  MIN_PAGE_TOKEN_LENGTH,
  DEMO_SHOP_CREDENTIAL_WRITE_UNLOCK_ENV,
  PAGE_CREDENTIAL_WRITE_ACTIONS,
  createPageCredentialWriteError,
  createPageCredentialWriteRepository,
  createPostgresPageCredentialWriteService,
  isDemoShopCredentialWriteUnlockAllowed,
  isMissingPageCredentialWriteSchemaError: isMissingMultiShopSchemaError,
  normalizePageCredentialInput,
  presentPageCredential,
  validatePageCredentialInput
};

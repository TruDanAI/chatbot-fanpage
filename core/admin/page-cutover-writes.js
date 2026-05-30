const crypto = require('crypto');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { DEFAULT_CREDENTIAL_TYPE, encryptCredential } = require('../credentials/page-credentials');
const { isProductionRuntime } = require('../storage-config');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { pageRef, shopRef } = require('../utils/log-refs');

const PAGE_CUTOVER_ACTION = 'admin.shop_page.cutover';
const PAGE_CUTOVER_CONFIRMATION = 'CUTOVER PAGE';
const PAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}$/;
const MIN_PAGE_TOKEN_LENGTH = 20;
const MAX_PAGE_TOKEN_LENGTH = 5000;
const PROTECTED_SHOP_SLUGS = Object.freeze(new Set(['adult-shop', 'demo-shop', 'nem-bui-xa']));

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL page cutover admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function text(value = '') {
  return value == null ? '' : String(value);
}

function normalizePageId(value = '') {
  return String(value ?? '').trim().slice(0, 120);
}

function normalizeConfirmation(value = '') {
  return normalizeText(value, 200);
}

function createPageCutoverWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function createRef(prefix = 'r', value = '') {
  const normalized = normalizeText(value, 240);
  if (!normalized) return 'unknown';
  return `${prefix}:${crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 10)}`;
}

function credentialRef(credentialId = '') {
  return createRef('c', credentialId);
}

function createPageMappingId() {
  if (typeof crypto.randomUUID === 'function') return `page_${crypto.randomUUID()}`;
  return `page_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function createCredentialId() {
  if (typeof crypto.randomUUID === 'function') return `credential_${crypto.randomUUID()}`;
  return `credential_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function isProtectedShop(shop = {}) {
  const values = [shop.id, shop.slug]
    .map(value => normalizeText(value, 160).toLowerCase())
    .filter(Boolean);
  return values.some(value => (
    PROTECTED_SHOP_SLUGS.has(value)
    || value.includes('prod')
    || value.includes('production')
  ));
}

function assertPageCutoverRuntime(env = process.env) {
  if (isProductionRuntime(env)) {
    throw createPageCutoverWriteError(
      'page_cutover_not_allowed_in_production',
      'Page cutover is not allowed in production.',
      403
    );
  }
}

function normalizePageCutoverInput(body = {}) {
  return {
    newPageId: normalizePageId(body.new_page_id ?? body.newPageId ?? body.page_id ?? body.pageId),
    newPageName: normalizeText(body.new_page_name ?? body.newPageName ?? body.page_name ?? body.pageName ?? '', 180),
    newPageToken: text(body.new_page_token ?? body.newPageToken ?? body.page_token ?? body.pageToken ?? body.token),
    confirmationText: normalizeConfirmation(body.confirmation_text ?? body.confirmationText ?? body.confirmation ?? ''),
    shopSlugConfirmation: normalizeText(
      body.shop_slug_confirmation ?? body.shopSlugConfirmation ?? body.shop_slug ?? body.shopSlug ?? '',
      160
    ),
    expectedCurrentPageMappingId: normalizeText(
      body.expected_current_page_mapping_id
        ?? body.expectedCurrentPageMappingId
        ?? body.expected_current_mapping_id
        ?? body.expectedCurrentMappingId
        ?? body.current_page_mapping_id
        ?? body.currentPageMappingId
        ?? body.current_mapping_id
        ?? body.currentMappingId
        ?? '',
      160
    ),
    expectedCurrentPageRef: normalizeText(
      body.expected_current_page_ref
        ?? body.expectedCurrentPageRef
        ?? body.current_page_ref
        ?? body.currentPageRef
        ?? '',
      80
    )
  };
}

function validatePageCutoverInput(input = {}, { masterKey = '' } = {}) {
  if (input.confirmationText !== PAGE_CUTOVER_CONFIRMATION) {
    throw createPageCutoverWriteError(
      'page_cutover_confirmation_required',
      `Page cutover requires typing "${PAGE_CUTOVER_CONFIRMATION}".`,
      400
    );
  }
  if (!input.shopSlugConfirmation) {
    throw createPageCutoverWriteError(
      'shop_slug_confirmation_required',
      'Shop slug confirmation is required.',
      400
    );
  }
  if (!input.newPageId || !PAGE_ID_PATTERN.test(input.newPageId)) {
    throw createPageCutoverWriteError('invalid_page_id', 'Page id is invalid.', 400);
  }
  const token = text(input.newPageToken).trim();
  if (!token) {
    throw createPageCutoverWriteError('credential_token_missing', 'Credential token is required.', 400);
  }
  if (token.length < MIN_PAGE_TOKEN_LENGTH || token.length > MAX_PAGE_TOKEN_LENGTH) {
    throw createPageCutoverWriteError('credential_token_invalid', 'Credential token length is invalid.', 400);
  }
  if (!normalizeText(masterKey, 5000)) {
    throw createPageCutoverWriteError('credential_master_key_missing', 'Credential master key is required.', 503);
  }
}

function assertShopCutoverAllowed(shop = {}) {
  if (isProtectedShop(shop)) {
    throw createPageCutoverWriteError(
      'protected_shop_cutover_blocked',
      'This shop is protected from page cutover.',
      403
    );
  }
  const status = normalizeText(shop.status, 40).toLowerCase();
  const lifecycle = normalizeText(shop.lifecycle, 80).toLowerCase();
  if (status === 'archived' || lifecycle === 'archived' || lifecycle === 'live' || shop.live_enabled === true) {
    throw createPageCutoverWriteError(
      'shop_not_staging_test_safe',
      'Page cutover is allowed only for non-live staging test shops.',
      409
    );
  }
}

function assertCurrentExpectation(input = {}, mapping = {}) {
  if (input.expectedCurrentPageMappingId && input.expectedCurrentPageMappingId !== mapping.id) {
    throw createPageCutoverWriteError(
      'stale_page_mapping',
      'Current page mapping changed before cutover.',
      409
    );
  }
  if (input.expectedCurrentPageRef && input.expectedCurrentPageRef !== pageRef(mapping.page_id)) {
    throw createPageCutoverWriteError(
      'stale_page_ref',
      'Current page reference changed before cutover.',
      409
    );
  }
}

function presentCutoverResult({
  shop = {},
  oldMapping = {},
  newMapping = {},
  oldCredential = {},
  newCredential = {},
  activeMappingCount = 0,
  activeCredentialCount = 0
} = {}) {
  return {
    shopId: shop.id || '',
    shop_ref: shopRef(shop.id),
    old_page_mapping_id: oldMapping.id || '',
    new_page_mapping_id: newMapping.id || '',
    old_page_ref: pageRef(oldMapping.page_id),
    new_page_ref: pageRef(newMapping.page_id),
    old_credential_ref: credentialRef(oldCredential.id),
    new_credential_ref: credentialRef(newCredential.id),
    old_mapping_status: 'archived',
    new_mapping_status: 'active',
    old_credential_status: 'archived',
    new_credential_status: 'active',
    active_mapping_count: Number(activeMappingCount || 0),
    active_credential_count: Number(activeCredentialCount || 0),
    readiness_stale: true
  };
}

function createPageCutoverWriteRepository() {
  async function resolveShopForUpdate(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createPageCutoverWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, status, package, lifecycle, dry_run, live_enabled
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
      FOR UPDATE
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createPageCutoverWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function listActiveMappingsForShop(client, shopId) {
    const result = await client.query(`
      SELECT id, shop_id, page_id, page_name, status, created_at, updated_at
      FROM shop_pages
      WHERE shop_id = $1
        AND status = 'active'
      ORDER BY updated_at DESC, id ASC
      FOR UPDATE
    `, [shopId]);
    return result.rows || [];
  }

  async function listActiveCredentialsForMapping(client, { shopId, pageMappingId } = {}) {
    const result = await client.query(`
      SELECT id, shop_id, page_mapping_id, credential_type, status, created_at, updated_at
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
      ORDER BY updated_at DESC, id ASC
      FOR UPDATE
    `, [shopId, pageMappingId, DEFAULT_CREDENTIAL_TYPE]);
    return result.rows || [];
  }

  async function findActiveMappingByPageIdForUpdate(client, pageId) {
    const result = await client.query(`
      SELECT id, shop_id, page_id, status
      FROM shop_pages
      WHERE page_id = $1
        AND status = 'active'
      ORDER BY updated_at DESC, id ASC
      LIMIT 1
      FOR UPDATE
    `, [pageId]);
    return result.rows[0] || null;
  }

  async function insertPageMapping(client, { shopId, pageMappingId, input } = {}) {
    const result = await client.query(`
      INSERT INTO shop_pages (
        id, shop_id, page_id, page_name, status
      )
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING id, shop_id, page_id, page_name, status, created_at, updated_at
    `, [
      pageMappingId,
      shopId,
      input.newPageId,
      input.newPageName
    ]);
    return result.rows[0] || null;
  }

  async function insertCredential(client, {
    shopId,
    pageMappingId,
    credentialId,
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
      DEFAULT_CREDENTIAL_TYPE,
      encryptedValue,
      JSON.stringify({
        source: 'admin_page_cutover',
        health_check: false,
        messenger_send: false
      })
    ]);
    return result.rows[0] || null;
  }

  async function archiveCredential(client, { shopId, credentialId } = {}) {
    const result = await client.query(`
      UPDATE shop_page_credentials
      SET status = 'archived',
          updated_at = now()
      WHERE shop_id = $1
        AND id = $2
        AND status = 'active'
      RETURNING id, shop_id, page_mapping_id, credential_type, status, created_at, updated_at
    `, [shopId, credentialId]);
    return result.rows[0] || null;
  }

  async function archivePageMapping(client, { shopId, pageMappingId } = {}) {
    const result = await client.query(`
      UPDATE shop_pages
      SET status = 'archived',
          updated_at = now()
      WHERE shop_id = $1
        AND id = $2
        AND status = 'active'
      RETURNING id, shop_id, page_id, page_name, status, created_at, updated_at
    `, [shopId, pageMappingId]);
    return result.rows[0] || null;
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

  async function countActiveMappingsForShop(client, shopId) {
    const result = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM shop_pages
      WHERE shop_id = $1
        AND status = 'active'
    `, [shopId]);
    return Number(result.rows[0]?.count || 0);
  }

  async function countActiveCredentialsForMapping(client, { shopId, pageMappingId } = {}) {
    const result = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
    `, [shopId, pageMappingId, DEFAULT_CREDENTIAL_TYPE]);
    return Number(result.rows[0]?.count || 0);
  }

  async function resolveMappingStatus(client, { shopId, pageMappingId } = {}) {
    const result = await client.query(`
      SELECT id, status
      FROM shop_pages
      WHERE shop_id = $1
        AND id = $2
      LIMIT 1
    `, [shopId, pageMappingId]);
    return result.rows[0] || null;
  }

  async function resolveCredentialStatus(client, { shopId, credentialId } = {}) {
    const result = await client.query(`
      SELECT id, status
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND id = $2
      LIMIT 1
    `, [shopId, credentialId]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    resourceId = '',
    metadata = {},
    requestContext = {}
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action: PAGE_CUTOVER_ACTION,
      resourceType: 'shop_page_cutover',
      resourceId,
      outcome: 'success',
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata,
      includeAuthMethod: false
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    archiveCredential,
    archivePageMapping,
    countActiveCredentialsForMapping,
    countActiveMappingsForShop,
    findActiveMappingByPageIdForUpdate,
    insertAudit,
    insertCredential,
    insertPageMapping,
    listActiveCredentialsForMapping,
    listActiveMappingsForShop,
    markShopReadinessStale,
    resolveCredentialStatus,
    resolveMappingStatus,
    resolveShopForUpdate
  };
}

function createPostgresPageCutoverWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createPageCutoverWriteRepository(),
  getCredentialMasterKey = () => process.env.CREDENTIAL_MASTER_KEY,
  encryptCredentialValue = encryptCredential,
  env = process.env
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createPageCutoverWriteError('database_url_required', 'DATABASE_URL is required for page cutover writes.', 503);
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
        throw createPageCutoverWriteError('page_cutover_commit_failed', 'Page cutover could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createPageCutoverWriteError('page_cutover_commit_failed', 'Page cutover could not be committed.', 500);
      }
      return result;
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      if (String(err?.code || '') === '23505') {
        throw createPageCutoverWriteError('duplicate_active_page_id', 'Page id already has an active mapping.', 409);
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createPageCutoverWriteError('permission_denied', 'Page cutover write permission is required.', 403);
    }
  }

  async function cutoverPage({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    assertPageCutoverRuntime(env);
    const input = normalizePageCutoverInput(body);
    const masterKey = getCredentialMasterKey();
    validatePageCutoverInput(input, { masterKey });
    const token = text(input.newPageToken).trim();

    return withTransaction(async client => {
      const shop = await repository.resolveShopForUpdate(client, shopId);
      const expectedSlug = normalizeText(shop.slug || shop.id, 160);
      if (input.shopSlugConfirmation !== expectedSlug) {
        throw createPageCutoverWriteError(
          'shop_slug_confirmation_mismatch',
          'Shop slug confirmation does not match.',
          400
        );
      }
      assertShopCutoverAllowed(shop);

      const activeMappings = await repository.listActiveMappingsForShop(client, shop.id);
      if (activeMappings.length === 0) {
        throw createPageCutoverWriteError('active_page_mapping_required', 'Exactly one active page mapping is required.', 409);
      }
      if (activeMappings.length > 1) {
        throw createPageCutoverWriteError('active_page_mapping_ambiguous', 'Exactly one active page mapping is required.', 409);
      }
      const oldMapping = activeMappings[0];
      assertCurrentExpectation(input, oldMapping);
      if (input.newPageId === oldMapping.page_id) {
        throw createPageCutoverWriteError('same_page_id', 'New page id must differ from the current active page id.', 409);
      }

      const activeCredentials = await repository.listActiveCredentialsForMapping(client, {
        shopId: shop.id,
        pageMappingId: oldMapping.id
      });
      if (activeCredentials.length === 0) {
        throw createPageCutoverWriteError('active_page_credential_required', 'Exactly one active page credential is required.', 409);
      }
      if (activeCredentials.length > 1) {
        throw createPageCutoverWriteError('active_page_credential_ambiguous', 'Exactly one active page credential is required.', 409);
      }
      const oldCredential = activeCredentials[0];

      const duplicate = await repository.findActiveMappingByPageIdForUpdate(client, input.newPageId);
      if (duplicate?.id) {
        throw createPageCutoverWriteError('duplicate_active_page_id', 'Page id already has an active mapping.', 409);
      }

      const newMappingId = createPageMappingId();
      const newMapping = await repository.insertPageMapping(client, {
        shopId: shop.id,
        pageMappingId: newMappingId,
        input
      });
      if (!newMapping?.id) {
        throw createPageCutoverWriteError('page_cutover_mapping_persist_failed', 'New page mapping could not be persisted.', 500);
      }

      let encryptedValue;
      try {
        encryptedValue = encryptCredentialValue(token, masterKey);
      } catch (_) {
        throw createPageCutoverWriteError('page_cutover_encryption_failed', 'Page credential could not be encrypted.', 500);
      }

      const newCredentialId = createCredentialId();
      const newCredential = await repository.insertCredential(client, {
        shopId: shop.id,
        pageMappingId: newMapping.id,
        credentialId: newCredentialId,
        encryptedValue
      });
      if (!newCredential?.id) {
        throw createPageCutoverWriteError('page_cutover_credential_persist_failed', 'New page credential could not be persisted.', 500);
      }

      const archivedCredential = await repository.archiveCredential(client, {
        shopId: shop.id,
        credentialId: oldCredential.id
      });
      if (archivedCredential?.status !== 'archived') {
        throw createPageCutoverWriteError('page_cutover_old_credential_archive_failed', 'Old page credential could not be archived.', 500);
      }

      const archivedMapping = await repository.archivePageMapping(client, {
        shopId: shop.id,
        pageMappingId: oldMapping.id
      });
      if (archivedMapping?.status !== 'archived') {
        throw createPageCutoverWriteError('page_cutover_old_mapping_archive_failed', 'Old page mapping could not be archived.', 500);
      }

      await repository.markShopReadinessStale(client, shop.id);

      const activeMappingCount = await repository.countActiveMappingsForShop(client, shop.id);
      const activeCredentialCount = await repository.countActiveCredentialsForMapping(client, {
        shopId: shop.id,
        pageMappingId: newMapping.id
      });
      const oldMappingStatus = await repository.resolveMappingStatus(client, {
        shopId: shop.id,
        pageMappingId: oldMapping.id
      });
      const oldCredentialStatus = await repository.resolveCredentialStatus(client, {
        shopId: shop.id,
        credentialId: oldCredential.id
      });
      if (
        activeMappingCount !== 1
        || activeCredentialCount !== 1
        || oldMappingStatus?.status !== 'archived'
        || oldCredentialStatus?.status !== 'archived'
      ) {
        throw createPageCutoverWriteError('page_cutover_postcondition_failed', 'Page cutover post-condition failed.', 500);
      }

      await repository.insertAudit(client, {
        principal,
        resourceId: pageRef(newMapping.page_id),
        metadata: {
          shop_ref: shopRef(shop.id),
          old_page_ref: pageRef(oldMapping.page_id),
          new_page_ref: pageRef(newMapping.page_id),
          old_credential_ref: credentialRef(oldCredential.id),
          new_credential_ref: credentialRef(newCredential.id),
          active_mapping_count: activeMappingCount,
          active_credential_count: activeCredentialCount,
          readiness_stale: true,
          health_check: false,
          messenger_send: false,
          source: 'admin_api'
        },
        requestContext
      });

      return presentCutoverResult({
        shop,
        oldMapping,
        newMapping,
        oldCredential,
        newCredential,
        activeMappingCount,
        activeCredentialCount
      });
    });
  }

  return {
    cutoverPage
  };
}

module.exports = {
  MAX_PAGE_TOKEN_LENGTH,
  MIN_PAGE_TOKEN_LENGTH,
  PAGE_CUTOVER_ACTION,
  PAGE_CUTOVER_CONFIRMATION,
  PAGE_ID_PATTERN,
  PROTECTED_SHOP_SLUGS,
  createPageCutoverWriteError,
  createPageCutoverWriteRepository,
  createPostgresPageCutoverWriteService,
  credentialRef,
  isMissingPageCutoverWriteSchemaError: isMissingMultiShopSchemaError,
  isProtectedShop,
  normalizePageCutoverInput,
  presentCutoverResult,
  validatePageCutoverInput
};

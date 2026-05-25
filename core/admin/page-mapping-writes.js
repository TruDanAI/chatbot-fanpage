const crypto = require('crypto');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { isProductionRuntime } = require('../storage-config');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { assertPageSetupDirectWriteAllowed } = require('./page-setup-preview');
const { pageRef, shopRef } = require('../utils/log-refs');

const PAGE_MAPPING_WRITE_ACTIONS = Object.freeze({
  CREATE: 'admin.shop_page.create',
  ARCHIVE: 'admin.shop_page.archive'
});

const PAGE_MAPPING_STATUSES = Object.freeze(new Set(['active', 'paused']));
const PAGE_MAPPING_ARCHIVE_CONFIRMATION = 'ARCHIVE MAPPING';
const ADULT_SHOP_ID = 'adult-shop';
const PAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}$/;

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL page mapping admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizePageId(value = '') {
  return String(value ?? '').trim().slice(0, 120);
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

function isAdultShop(shop = {}) {
  return [shop.id, shop.slug]
    .map(value => normalizeText(value, 160).toLowerCase())
    .includes(ADULT_SHOP_ID);
}

function createPageMappingWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function normalizeCreatePageMappingInput(body = {}) {
  const status = normalizeText(body.status || 'active', 40).toLowerCase();
  return {
    pageId: normalizePageId(body.page_id ?? body.pageId),
    pageName: normalizeText(body.page_name ?? body.pageName, 180),
    status
  };
}

function hasOwnField(object = {}, fields = []) {
  return fields.some(field => Object.prototype.hasOwnProperty.call(object || {}, field));
}

function normalizeArchivePageMappingInput(body = {}) {
  return {
    confirmationText: normalizeText(
      body.confirmation_text ?? body.confirmationText ?? body.confirmation ?? '',
      200
    ),
    hasRawPageIdField: hasOwnField(body, ['page_id', 'pageId'])
  };
}

function validateCreatePageMappingInput(input = {}) {
  if (!input.pageId || !PAGE_ID_PATTERN.test(input.pageId)) {
    throw createPageMappingWriteError('invalid_page_id', 'Page id is invalid.', 400);
  }
  if (!PAGE_MAPPING_STATUSES.has(input.status)) {
    throw createPageMappingWriteError('invalid_page_mapping_status', 'Page mapping status is invalid.', 400);
  }
}

function validateArchivePageMappingInput(input = {}) {
  if (input.hasRawPageIdField) {
    throw createPageMappingWriteError('page_id_not_accepted', 'Page id is not accepted for archive.', 400);
  }
  if (!input.confirmationText.toUpperCase().includes(PAGE_MAPPING_ARCHIVE_CONFIRMATION)) {
    throw createPageMappingWriteError('archive_confirmation_required', 'Archive confirmation is required.', 400);
  }
}

function assertPageMappingArchiveRuntime(env = process.env) {
  if (!isStagingRuntime(env)) {
    throw createPageMappingWriteError('staging_only', 'Page mapping archive is available only in staging.', 403);
  }
}

function assertAdultShopArchiveAllowed(shop = {}) {
  if (isAdultShop(shop)) {
    throw createPageMappingWriteError('adult_shop_protected', 'This shop is protected from page mapping archive.', 403);
  }
}

function presentPageMapping(row = {}) {
  const rawPageId = row.page_id || '';
  return {
    id: row.id || '',
    shop_id: row.shop_id || '',
    page_id: rawPageId,
    page_ref: rawPageId ? pageRef(rawPageId) : '',
    page_name: row.page_name || '',
    status: row.status || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function presentArchivedPageMapping(row = {}) {
  const rawPageId = row.page_id || '';
  return {
    id: row.id || '',
    shop_id: row.shop_id || '',
    page_ref: rawPageId ? pageRef(rawPageId) : '',
    page_name: row.page_name || '',
    status: row.status || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function createPageMappingWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createPageMappingWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, lifecycle, live_enabled
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createPageMappingWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function resolveShopForUpdate(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createPageMappingWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, lifecycle, live_enabled
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
      FOR UPDATE
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createPageMappingWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function resolvePageMappingForUpdate(client, { shopId, pageMappingId } = {}) {
    const normalized = normalizeText(pageMappingId, 160);
    if (!normalized) throw createPageMappingWriteError('page_mapping_not_found', 'Page mapping was not found.', 404);
    const result = await client.query(`
      SELECT id, shop_id, page_id, page_name, status, created_at, updated_at
      FROM shop_pages
      WHERE id = $1
        AND shop_id = $2
      LIMIT 1
      FOR UPDATE
    `, [normalized, shopId]);
    const mapping = result.rows[0] || null;
    if (!mapping?.id) {
      throw createPageMappingWriteError('page_mapping_not_found', 'Page mapping was not found.', 404);
    }
    return mapping;
  }

  async function assertNoActivePageMapping(client, pageId) {
    const result = await client.query(`
      SELECT id, shop_id
      FROM shop_pages
      WHERE page_id = $1
        AND status = 'active'
      LIMIT 1
    `, [pageId]);
    if (result.rows[0]?.id) {
      throw createPageMappingWriteError('duplicate_active_page_id', 'Page id already has an active mapping.', 409);
    }
  }

  async function insertPageMapping(client, { shopId, pageMappingId, input } = {}) {
    const result = await client.query(`
      INSERT INTO shop_pages (
        id, shop_id, page_id, page_name, status
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, shop_id, page_id, page_name, status, created_at, updated_at
    `, [
      pageMappingId,
      shopId,
      input.pageId,
      input.pageName,
      input.status
    ]);
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

  async function archiveActiveCredentialsForMapping(client, { shopId, pageMappingId } = {}) {
    const result = await client.query(`
      UPDATE shop_page_credentials
      SET status = 'archived',
          updated_at = now()
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND status = 'active'
    `, [shopId, pageMappingId]);
    return Number(result.rowCount || 0);
  }

  async function countActiveCredentialsForMapping(client, { shopId, pageMappingId } = {}) {
    const result = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND status = 'active'
    `, [shopId, pageMappingId]);
    return Number(result.rows[0]?.count || 0);
  }

  async function insertAudit(client, {
    principal,
    action = PAGE_MAPPING_WRITE_ACTIONS.CREATE,
    resourceId = '',
    metadata = {},
    requestContext = {},
    includeAuthMethod = true
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action,
      resourceType: 'shop_page',
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
    archiveActiveCredentialsForMapping,
    archivePageMapping,
    assertNoActivePageMapping,
    countActiveCredentialsForMapping,
    insertAudit,
    insertPageMapping,
    resolvePageMappingForUpdate,
    resolveShop,
    resolveShopForUpdate
  };
}

function createPostgresPageMappingWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createPageMappingWriteRepository(),
  env = process.env
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createPageMappingWriteError('database_url_required', 'DATABASE_URL is required for page mapping writes.', 503);
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
        throw createPageMappingWriteError('page_mapping_commit_failed', 'Page mapping write could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createPageMappingWriteError('page_mapping_commit_failed', 'Page mapping write could not be committed.', 500);
      }
      return result;
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      if (String(err?.code || '') === '23505') {
        throw createPageMappingWriteError('duplicate_active_page_id', 'Page id already has an active mapping.', 409);
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createPageMappingWriteError('permission_denied', 'Page mapping write permission is required.', 403);
    }
  }

  async function createPageMapping({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const input = normalizeCreatePageMappingInput(body);
    validateCreatePageMappingInput(input);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      assertPageSetupDirectWriteAllowed(shop);
      if (input.status === 'active') {
        await repository.assertNoActivePageMapping(client, input.pageId);
      }
      const pageMappingId = `page_${crypto.randomUUID()}`;
      const row = await repository.insertPageMapping(client, {
        shopId: shop.id,
        pageMappingId,
        input
      });
      if (!row?.id) {
        throw createPageMappingWriteError('page_mapping_persist_failed', 'Page mapping could not be persisted.', 500);
      }
      await repository.insertAudit(client, {
        principal,
        resourceId: row.id,
        metadata: {
          shop_id: shop.id,
          page_mapping_id: row.id,
          page_ref: pageRef(input.pageId),
          page_name_length: input.pageName.length,
          status: input.status
        },
        requestContext
      });
      return {
        shopId: shop.id,
        page: presentPageMapping(row)
      };
    });
  }

  async function archivePageMapping({
    principal,
    shopId,
    pageMappingId,
    body = {},
    requestContext = {}
  } = {}) {
    assertWritePermission(principal);
    const input = normalizeArchivePageMappingInput(body);

    return withTransaction(async client => {
      const shop = await repository.resolveShopForUpdate(client, shopId);
      const mapping = await repository.resolvePageMappingForUpdate(client, {
        shopId: shop.id,
        pageMappingId
      });
      assertPageMappingArchiveRuntime(env);
      validateArchivePageMappingInput(input);
      assertAdultShopArchiveAllowed(shop);

      const oldStatus = normalizeText(mapping.status, 40).toLowerCase();
      if (oldStatus !== 'active' && oldStatus !== 'archived') {
        throw createPageMappingWriteError('page_mapping_not_active', 'Page mapping is not active.', 409);
      }

      const alreadyArchived = oldStatus === 'archived';
      const archivedMapping = alreadyArchived
        ? { ...mapping, status: 'archived' }
        : await repository.archivePageMapping(client, {
          shopId: shop.id,
          pageMappingId: mapping.id
        });
      if (!archivedMapping?.id) {
        throw createPageMappingWriteError('page_mapping_archive_failed', 'Page mapping could not be archived.', 500);
      }

      const archivedCredentialCount = await repository.archiveActiveCredentialsForMapping(client, {
        shopId: shop.id,
        pageMappingId: mapping.id
      });
      const activeCredentialCountAfter = await repository.countActiveCredentialsForMapping(client, {
        shopId: shop.id,
        pageMappingId: mapping.id
      });
      const changedFields = [];
      if (!alreadyArchived) changedFields.push('shop_pages.status');
      if (archivedCredentialCount > 0) changedFields.push('shop_page_credentials.status');

      await repository.insertAudit(client, {
        principal,
        action: PAGE_MAPPING_WRITE_ACTIONS.ARCHIVE,
        resourceId: mapping.id,
        metadata: {
          changedFields,
          oldStatus,
          newStatus: 'archived',
          page_ref: pageRef(mapping.page_id),
          shop_ref: shopRef(shop.id),
          archivedCredentialCount,
          activeCredentialCountAfter,
          adultShopOverride: false,
          source: 'admin_ui'
        },
        requestContext,
        includeAuthMethod: false
      });

      return {
        shopId: shop.id,
        pageMappingId: mapping.id,
        page_ref: pageRef(mapping.page_id),
        page: presentArchivedPageMapping(archivedMapping),
        oldStatus,
        newStatus: 'archived',
        archivedCredentialCount,
        activeCredentialCountAfter,
        already_archived: alreadyArchived
      };
    });
  }

  return {
    archivePageMapping,
    createPageMapping
  };
}

module.exports = {
  ADULT_SHOP_ID,
  PAGE_ID_PATTERN,
  PAGE_MAPPING_ARCHIVE_CONFIRMATION,
  PAGE_MAPPING_STATUSES,
  PAGE_MAPPING_WRITE_ACTIONS,
  createPageMappingWriteError,
  createPageMappingWriteRepository,
  createPostgresPageMappingWriteService,
  isAdultShop,
  isMissingPageMappingWriteSchemaError: isMissingMultiShopSchemaError,
  isStagingRuntime,
  normalizeArchivePageMappingInput,
  normalizeCreatePageMappingInput,
  presentArchivedPageMapping,
  presentPageMapping,
  validateArchivePageMappingInput,
  validateCreatePageMappingInput
};

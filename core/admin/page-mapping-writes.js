const crypto = require('crypto');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { pageRef } = require('../utils/log-refs');

const PAGE_MAPPING_WRITE_ACTIONS = Object.freeze({
  CREATE: 'admin.shop_page.create'
});

const PAGE_MAPPING_STATUSES = Object.freeze(new Set(['active', 'paused']));
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

function validateCreatePageMappingInput(input = {}) {
  if (!input.pageId || !PAGE_ID_PATTERN.test(input.pageId)) {
    throw createPageMappingWriteError('invalid_page_id', 'Page id is invalid.', 400);
  }
  if (!PAGE_MAPPING_STATUSES.has(input.status)) {
    throw createPageMappingWriteError('invalid_page_mapping_status', 'Page mapping status is invalid.', 400);
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

function createPageMappingWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createPageMappingWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createPageMappingWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
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

  async function insertAudit(client, {
    principal,
    resourceId = '',
    metadata = {},
    requestContext = {}
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action: PAGE_MAPPING_WRITE_ACTIONS.CREATE,
      resourceType: 'shop_page',
      resourceId,
      outcome: 'success',
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    assertNoActivePageMapping,
    insertAudit,
    insertPageMapping,
    resolveShop
  };
}

function createPostgresPageMappingWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createPageMappingWriteRepository()
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

  return {
    createPageMapping
  };
}

module.exports = {
  PAGE_ID_PATTERN,
  PAGE_MAPPING_STATUSES,
  PAGE_MAPPING_WRITE_ACTIONS,
  createPageMappingWriteError,
  createPageMappingWriteRepository,
  createPostgresPageMappingWriteService,
  isMissingPageMappingWriteSchemaError: isMissingMultiShopSchemaError,
  normalizeCreatePageMappingInput,
  presentPageMapping,
  validateCreatePageMappingInput
};

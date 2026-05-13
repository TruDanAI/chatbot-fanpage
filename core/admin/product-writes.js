const crypto = require('crypto');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');

const PRODUCT_WRITE_ACTIONS = Object.freeze({
  CREATE: 'admin.product.create',
  UPDATE: 'admin.product.update',
  STATUS: 'admin.product.status',
  ARCHIVE: 'admin.product.archive'
});

const PRODUCT_STATUSES = Object.freeze(new Set(['active', 'hidden', 'archived']));

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL product admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeLongText(value = '', max = 2000) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function normalizeProductId(value = '') {
  return normalizeText(value, 160);
}

function normalizeCode(value = '') {
  return normalizeText(value, 80);
}

function normalizeName(value = '') {
  return normalizeText(value, 180);
}

function toBoundedInteger(value, fallback = 0, { min = -100000, max = 100000 } = {}) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
}

function normalizeTags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  return [...new Set(raw
    .map(item => normalizeText(item, 40))
    .filter(Boolean)
    .slice(0, 20))];
}

function jsonObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function createProductWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function productStatusFromBody(body = {}, fallback = 'hidden') {
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    return normalizeBoolean(body.enabled, fallback === 'active') ? 'active' : 'hidden';
  }
  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    return normalizeBoolean(body.active, fallback === 'active') ? 'active' : 'hidden';
  }
  const status = normalizeText(body.status, 40).toLowerCase();
  if (status === 'enabled') return 'active';
  if (status === 'disabled') return 'hidden';
  if (PRODUCT_STATUSES.has(status)) return status;
  return fallback;
}

function buildMetadata(existing = {}, input = {}) {
  const next = { ...jsonObject(existing) };
  if (Object.prototype.hasOwnProperty.call(input, 'price_text')) {
    const priceText = normalizeText(input.price_text, 120);
    if (priceText) next.priceText = priceText;
    else delete next.priceText;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'priceText')) {
    const priceText = normalizeText(input.priceText, 120);
    if (priceText) next.priceText = priceText;
    else delete next.priceText;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'tags')) {
    const tags = normalizeTags(input.tags);
    if (tags.length) next.tags = tags;
    else delete next.tags;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'category')) {
    const category = normalizeText(input.category, 80);
    if (category) next.category = category;
    else delete next.category;
  }
  return next;
}

function getPriceTextFromMetadata(metadata = {}) {
  const object = jsonObject(metadata);
  return normalizeText(object.priceText || object.priceLabel || object.price, 120);
}

function presentProduct(row = {}) {
  const metadata = jsonObject(row.metadata_json);
  return {
    id: row.id || '',
    shop_id: row.shop_id || '',
    code: row.code || '',
    name: row.name || '',
    description: row.description || '',
    price: row.price == null ? null : String(row.price),
    currency: row.currency || '',
    price_text: getPriceTextFromMetadata(metadata),
    status: row.status || '',
    enabled: String(row.status || '').toLowerCase() === 'active',
    sort_order: Number(row.sort_order || 0),
    tags: Array.isArray(metadata.tags) ? metadata.tags.map(item => normalizeText(item, 40)).filter(Boolean) : [],
    category: normalizeText(metadata.category, 80),
    metadata_json: metadata,
    updated_at: row.updated_at || ''
  };
}

function normalizeCreateInput(body = {}) {
  const name = normalizeName(body.name ?? body.title);
  const code = normalizeCode(body.code);
  return {
    code,
    name,
    description: normalizeLongText(body.description, 2000),
    status: productStatusFromBody(body, 'active'),
    sortOrder: toBoundedInteger(body.sort_order ?? body.sortOrder, 0),
    metadata: buildMetadata({}, body)
  };
}

function normalizePatchInput(existing = {}, body = {}) {
  const hasCode = Object.prototype.hasOwnProperty.call(body, 'code');
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name') || Object.prototype.hasOwnProperty.call(body, 'title');
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  const hasStatus = ['enabled', 'active', 'status'].some(key => Object.prototype.hasOwnProperty.call(body, key));
  const hasSortOrder = Object.prototype.hasOwnProperty.call(body, 'sort_order') || Object.prototype.hasOwnProperty.call(body, 'sortOrder');
  const next = {
    code: hasCode ? normalizeCode(body.code) : normalizeCode(existing.code),
    name: hasName ? normalizeName(body.name ?? body.title) : normalizeName(existing.name),
    description: hasDescription ? normalizeLongText(body.description, 2000) : normalizeLongText(existing.description, 2000),
    status: hasStatus ? productStatusFromBody(body, existing.status || 'hidden') : normalizeText(existing.status || 'hidden', 40).toLowerCase(),
    sortOrder: hasSortOrder ? toBoundedInteger(body.sort_order ?? body.sortOrder, Number(existing.sort_order || 0)) : Number(existing.sort_order || 0),
    metadata: buildMetadata(existing.metadata_json || {}, body)
  };
  return next;
}

function validateNormalizedProduct(input = {}, { partial = false } = {}) {
  if (!input.code) {
    throw createProductWriteError('invalid_product_code', 'Product code is required.', 400);
  }
  if (!input.name) {
    throw createProductWriteError('invalid_product_name', 'Product name is required.', 400);
  }
  if (!PRODUCT_STATUSES.has(input.status)) {
    throw createProductWriteError('invalid_product_status', 'Product status is invalid.', 400);
  }
  if (partial && input.status === 'archived') {
    throw createProductWriteError('invalid_product_status', 'Use the archive endpoint to archive products.', 400);
  }
}

function createProductWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createProductWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createProductWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function getProductForShop(client, shopId, productId) {
    const result = await client.query(`
      SELECT id, shop_id, code, name, description, price, currency, status,
             sort_order, metadata_json, updated_at
      FROM shop_products
      WHERE shop_id = $1 AND id = $2
      LIMIT 1
    `, [shopId, productId]);
    return result.rows[0] || null;
  }

  async function assertUniqueCode(client, { shopId, code, excludeProductId = '' } = {}) {
    const result = await client.query(`
      SELECT id
      FROM shop_products
      WHERE shop_id = $1
        AND lower(code) = lower($2)
        AND ($3 = '' OR id <> $3)
        AND status <> 'archived'
      LIMIT 1
    `, [shopId, code, excludeProductId]);
    if (result.rows[0]?.id) {
      throw createProductWriteError('duplicate_product_code', 'Product code already exists in this shop.', 409);
    }
  }

  async function insertProduct(client, { shopId, productId, input } = {}) {
    const result = await client.query(`
      INSERT INTO shop_products (
        id, shop_id, code, name, description, price, currency, status,
        sort_order, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, NULL, '', $6, $7, $8::jsonb)
      RETURNING id, shop_id, code, name, description, price, currency, status,
                sort_order, metadata_json, updated_at
    `, [
      productId,
      shopId,
      input.code,
      input.name,
      input.description,
      input.status,
      input.sortOrder,
      JSON.stringify(input.metadata || {})
    ]);
    return result.rows[0] || null;
  }

  async function updateProduct(client, { shopId, productId, input } = {}) {
    const result = await client.query(`
      UPDATE shop_products
      SET code = $3,
          name = $4,
          description = $5,
          status = $6,
          sort_order = $7,
          metadata_json = $8::jsonb,
          updated_at = now()
      WHERE shop_id = $1 AND id = $2
      RETURNING id, shop_id, code, name, description, price, currency, status,
                sort_order, metadata_json, updated_at
    `, [
      shopId,
      productId,
      input.code,
      input.name,
      input.description,
      input.status,
      input.sortOrder,
      JSON.stringify(input.metadata || {})
    ]);
    return result.rows[0] || null;
  }

  async function archiveProduct(client, { shopId, productId } = {}) {
    const result = await client.query(`
      UPDATE shop_products
      SET status = 'archived',
          updated_at = now()
      WHERE shop_id = $1 AND id = $2
      RETURNING id, shop_id, code, name, description, price, currency, status,
                sort_order, metadata_json, updated_at
    `, [shopId, productId]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    action,
    resourceId = '',
    outcome = 'success',
    metadata = {},
    requestContext = {}
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action,
      resourceType: 'shop_product',
      resourceId,
      outcome,
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata
    });
    try {
      await insertAuditLogEntry(client, entry);
      return entry;
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return { ...entry, skipped: true, reason: 'audit_schema_not_ready' };
    }
  }

  return {
    archiveProduct,
    assertUniqueCode,
    getProductForShop,
    insertAudit,
    insertProduct,
    resolveShop,
    updateProduct
  };
}

function createPostgresProductWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createProductWriteRepository()
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createProductWriteError('database_url_required', 'DATABASE_URL is required for product writes.', 503);
    }
    const PgClient = Client || loadPgClient();
    const client = new PgClient({ connectionString: databaseUrl });
    let committed = false;
    await client.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      committed = true;
      return result;
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createProductWriteError('permission_denied', 'Product write permission is required.', 403);
    }
  }

  async function createProduct({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const input = normalizeCreateInput(body);
    validateNormalizedProduct(input);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      await repository.assertUniqueCode(client, { shopId: shop.id, code: input.code });
      const productId = `product_${crypto.randomUUID()}`;
      const row = await repository.insertProduct(client, { shopId: shop.id, productId, input });
      if (!row?.id) {
        throw createProductWriteError('product_persist_failed', 'Product could not be persisted.', 500);
      }
      const persisted = await repository.getProductForShop(client, shop.id, productId);
      if (!persisted?.id) {
        throw createProductWriteError('product_persist_failed', 'Product could not be persisted.', 500);
      }
      await repository.insertAudit(client, {
        principal,
        action: PRODUCT_WRITE_ACTIONS.CREATE,
        resourceId: productId,
        metadata: {
          shop_id: shop.id,
          product_id: productId,
          code: input.code,
          status: input.status
        },
        requestContext
      });
      return { shopId: shop.id, product: presentProduct(row) };
    });
  }

  async function updateProductWithAction({ principal, shopId, productId, body = {}, requestContext = {}, action = PRODUCT_WRITE_ACTIONS.UPDATE } = {}) {
    assertWritePermission(principal);
    const normalizedProductId = normalizeProductId(productId);
    if (!normalizedProductId) throw createProductWriteError('product_not_found', 'Product was not found.', 404);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const existing = await repository.getProductForShop(client, shop.id, normalizedProductId);
      if (!existing) throw createProductWriteError('product_not_found', 'Product was not found.', 404);
      const input = normalizePatchInput(existing, body);
      validateNormalizedProduct(input, { partial: true });
      await repository.assertUniqueCode(client, {
        shopId: shop.id,
        code: input.code,
        excludeProductId: normalizedProductId
      });
      const row = await repository.updateProduct(client, { shopId: shop.id, productId: normalizedProductId, input });
      if (!row) throw createProductWriteError('product_not_found', 'Product was not found.', 404);
      await repository.insertAudit(client, {
        principal,
        action,
        resourceId: normalizedProductId,
        metadata: {
          shop_id: shop.id,
          product_id: normalizedProductId,
          code: input.code,
          status: input.status
        },
        requestContext
      });
      return { shopId: shop.id, product: presentProduct(row) };
    });
  }

  async function updateProduct(input = {}) {
    return updateProductWithAction({
      ...input,
      action: PRODUCT_WRITE_ACTIONS.UPDATE
    });
  }

  async function setProductEnabled({ principal, shopId, productId, enabled = true, requestContext = {} } = {}) {
    const status = enabled ? 'active' : 'hidden';
    return updateProductWithAction({
      principal,
      shopId,
      productId,
      body: { status },
      requestContext,
      action: PRODUCT_WRITE_ACTIONS.STATUS
    });
  }

  async function archiveProduct({ principal, shopId, productId, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const normalizedProductId = normalizeProductId(productId);
    if (!normalizedProductId) throw createProductWriteError('product_not_found', 'Product was not found.', 404);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const existing = await repository.getProductForShop(client, shop.id, normalizedProductId);
      if (!existing) throw createProductWriteError('product_not_found', 'Product was not found.', 404);
      const row = await repository.archiveProduct(client, { shopId: shop.id, productId: normalizedProductId });
      if (!row) throw createProductWriteError('product_not_found', 'Product was not found.', 404);
      await repository.insertAudit(client, {
        principal,
        action: PRODUCT_WRITE_ACTIONS.ARCHIVE,
        resourceId: normalizedProductId,
        metadata: {
          shop_id: shop.id,
          product_id: normalizedProductId,
          code: existing.code,
          status: 'archived'
        },
        requestContext
      });
      return { shopId: shop.id, product: presentProduct(row) };
    });
  }

  return {
    archiveProduct,
    createProduct,
    setProductEnabled,
    updateProduct
  };
}

module.exports = {
  PRODUCT_WRITE_ACTIONS,
  createPostgresProductWriteService,
  createProductWriteError,
  createProductWriteRepository,
  isMissingProductWriteSchemaError: isMissingMultiShopSchemaError,
  normalizeCreateInput,
  normalizePatchInput,
  presentProduct
};

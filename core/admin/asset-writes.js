const crypto = require('crypto');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');

const ASSET_WRITE_ACTIONS = Object.freeze({
  CREATE: 'admin.shop_asset.create',
  UPDATE: 'admin.shop_asset.update',
  STATUS: 'admin.shop_asset.status',
  ARCHIVE: 'admin.shop_asset.archive'
});

const ASSET_TYPES = Object.freeze(new Set(['menu_image', 'product_image']));
const ASSET_STATUSES = Object.freeze(new Set(['active', 'hidden', 'archived']));
const MAX_PUBLIC_URL_LENGTH = 2048;

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL asset admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeAssetId(value = '') {
  return normalizeText(value, 160);
}

function normalizeAssetType(value = '') {
  return normalizeText(value, 60).toLowerCase();
}

function normalizeStatus(value = '', fallback = 'active') {
  const status = normalizeText(value, 40).toLowerCase();
  if (status === 'enabled') return 'active';
  if (status === 'disabled') return 'hidden';
  return status || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
}

function toBoundedInteger(value, fallback = 0, { min = -100000, max = 100000 } = {}) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function createAssetWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function normalizeHostnameForPolicy(hostname = '') {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/g, '');
}

function parseIpv4Address(hostname = '') {
  const parts = String(hostname || '').split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255 ? number : null;
  });
  return octets.every(octet => octet != null) ? octets : null;
}

function isBlockedIpv4Address(octets = []) {
  const [a, b] = octets;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 255;
}

function parseIpv4MappedIpv6(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  if (!host.startsWith('::ffff:')) return null;
  const suffix = host.slice('::ffff:'.length);
  const dotted = parseIpv4Address(suffix);
  if (dotted) return dotted;

  const parts = suffix.split(':');
  if (parts.length !== 2 || parts.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const high = parseInt(parts[0], 16);
  const low = parseInt(parts[1], 16);
  return [high >> 8, high & 255, low >> 8, low & 255];
}

function isLocalOrPrivateHostname(hostname = '') {
  const host = normalizeHostnameForPolicy(hostname);
  const ipv4 = parseIpv4Address(host);
  const mappedIpv4 = parseIpv4MappedIpv6(host);
  return host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '::' ||
    host === '0:0:0:0:0:0:0:0' ||
    host === '0:0:0:0:0:0:0:1' ||
    Boolean(ipv4 && isBlockedIpv4Address(ipv4)) ||
    Boolean(mappedIpv4 && isBlockedIpv4Address(mappedIpv4)) ||
    (() => {
      if (!host.includes(':')) return false;
      const first = host.split(':')[0];
      if (!/^[0-9a-f]{1,4}$/i.test(first)) return false;
      const value = parseInt(first, 16);
      return value === 0 ||
        (value & 0xfe00) === 0xfc00 ||
        (value & 0xffc0) === 0xfe80;
    })();
}

function isNonPublicHostname(hostname = '') {
  const host = normalizeHostnameForPolicy(hostname);
  if (!host) return true;
  if (host.includes(':') || parseIpv4Address(host)) return false;
  return !host.includes('.') || host.endsWith('.internal');
}

function normalizePublicUrl(value = '') {
  const raw = String(value ?? '').trim();
  if (!raw) throw createAssetWriteError('public_url_required', 'Public URL is required.', 400);
  if (raw.length > MAX_PUBLIC_URL_LENGTH) {
    throw createAssetWriteError('public_url_too_long', 'Public URL is too long.', 400);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw createAssetWriteError('invalid_public_url', 'Public URL must be a valid URL.', 400);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createAssetWriteError('invalid_public_url', 'Public URL must use http or https.', 400);
  }
  if (parsed.username ||
    parsed.password ||
    isLocalOrPrivateHostname(parsed.hostname) ||
    isNonPublicHostname(parsed.hostname)) {
    throw createAssetWriteError('invalid_public_url', 'Public URL is not allowed.', 400);
  }

  return parsed.href;
}

function summarizePublicUrl(publicUrl = '') {
  try {
    const parsed = new URL(publicUrl);
    return {
      url_protocol: parsed.protocol.replace(/:$/, ''),
      url_host: normalizeText(parsed.hostname, 160),
      url_path_length: parsed.pathname.length,
      url_has_query: Boolean(parsed.search)
    };
  } catch (_) {
    return {};
  }
}

function normalizeCreateInput(body = {}) {
  const assetType = normalizeAssetType(body.asset_type ?? body.assetType);
  return {
    assetType,
    productId: normalizeText(body.product_id ?? body.productId, 160),
    publicUrl: normalizePublicUrl(body.public_url ?? body.publicUrl),
    contentType: normalizeText(body.content_type ?? body.contentType, 120),
    sortOrder: toBoundedInteger(body.sort_order ?? body.sortOrder, 0),
    status: normalizeStatus(body.status, 'active')
  };
}

function normalizePatchInput(existing = {}, body = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  const hasProductId = has('product_id') || has('productId');
  return {
    assetType: has('asset_type') || has('assetType')
      ? normalizeAssetType(body.asset_type ?? body.assetType)
      : normalizeAssetType(existing.asset_type),
    productId: hasProductId
      ? normalizeText(body.product_id ?? body.productId, 160)
      : normalizeText(existing.product_id, 160),
    publicUrl: has('public_url') || has('publicUrl')
      ? normalizePublicUrl(body.public_url ?? body.publicUrl)
      : normalizePublicUrl(existing.public_url),
    contentType: has('content_type') || has('contentType')
      ? normalizeText(body.content_type ?? body.contentType, 120)
      : normalizeText(existing.content_type, 120),
    sortOrder: has('sort_order') || has('sortOrder')
      ? toBoundedInteger(body.sort_order ?? body.sortOrder, Number(existing.sort_order || 0))
      : Number(existing.sort_order || 0),
    status: ['enabled', 'active', 'status'].some(key => has(key))
      ? normalizeStatus(body.status, normalizeBoolean(body.enabled ?? body.active, existing.status === 'active') ? 'active' : 'hidden')
      : normalizeStatus(existing.status, 'hidden')
  };
}

function validateAssetInput(input = {}) {
  if (!ASSET_TYPES.has(input.assetType)) {
    throw createAssetWriteError('invalid_asset_type', 'Asset type is invalid.', 400);
  }
  if (!ASSET_STATUSES.has(input.status)) {
    throw createAssetWriteError('invalid_asset_status', 'Asset status is invalid.', 400);
  }
  if (input.assetType === 'product_image' && !input.productId) {
    throw createAssetWriteError('product_id_required', 'Product image requires product_id.', 400);
  }
}

function presentAsset(row = {}) {
  return {
    id: row.id || '',
    shop_id: row.shop_id || '',
    product_id: row.product_id || '',
    product_code: row.product_code || '',
    asset_type: row.asset_type || '',
    storage_provider: row.storage_provider || '',
    public_url: row.public_url || '',
    content_type: row.content_type || '',
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    status: row.status || '',
    sort_order: Number(row.sort_order || 0),
    updated_at: row.updated_at || ''
  };
}

function createAssetWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createAssetWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createAssetWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function getProductForShop(client, shopId, productId) {
    const normalized = normalizeText(productId, 160);
    if (!normalized) return null;
    const result = await client.query(`
      SELECT id, shop_id, code
      FROM shop_products
      WHERE shop_id = $1 AND id = $2
      LIMIT 1
    `, [shopId, normalized]);
    return result.rows[0] || null;
  }

  async function getAssetForShop(client, shopId, assetId) {
    const result = await client.query(`
      SELECT a.id, a.shop_id, a.product_id, p.code AS product_code, a.asset_type,
             a.storage_provider, a.public_url, a.content_type, a.size_bytes,
             a.status, a.sort_order, a.updated_at
      FROM shop_assets a
      LEFT JOIN shop_products p ON p.id = a.product_id AND p.shop_id = a.shop_id
      WHERE a.shop_id = $1 AND a.id = $2
        AND a.asset_type IN ('menu_image', 'product_image')
      LIMIT 1
    `, [shopId, assetId]);
    return result.rows[0] || null;
  }

  async function insertAsset(client, { shopId, assetId, input } = {}) {
    const result = await client.query(`
      INSERT INTO shop_assets (
        id, shop_id, product_id, asset_type, storage_provider, storage_key,
        public_url, content_type, size_bytes, status, sort_order
      )
      VALUES ($1, $2, NULLIF($3, ''), $4, 'public_url', '', $5, $6, NULL, $7, $8)
      RETURNING id, shop_id, product_id, asset_type, storage_provider,
                public_url, content_type, size_bytes, status, sort_order, updated_at
    `, [
      assetId,
      shopId,
      input.productId || '',
      input.assetType,
      input.publicUrl,
      input.contentType,
      input.status,
      input.sortOrder
    ]);
    return result.rows[0] || null;
  }

  async function updateAsset(client, { shopId, assetId, input } = {}) {
    const result = await client.query(`
      UPDATE shop_assets
      SET product_id = NULLIF($3, ''),
          asset_type = $4,
          storage_provider = 'public_url',
          storage_key = '',
          public_url = $5,
          content_type = $6,
          status = $7,
          sort_order = $8,
          updated_at = now()
      WHERE shop_id = $1 AND id = $2
        AND asset_type IN ('menu_image', 'product_image')
      RETURNING id, shop_id, product_id, asset_type, storage_provider,
                public_url, content_type, size_bytes, status, sort_order, updated_at
    `, [
      shopId,
      assetId,
      input.productId || '',
      input.assetType,
      input.publicUrl,
      input.contentType,
      input.status,
      input.sortOrder
    ]);
    return result.rows[0] || null;
  }

  async function archiveAsset(client, { shopId, assetId } = {}) {
    const result = await client.query(`
      UPDATE shop_assets
      SET status = 'archived',
          storage_provider = 'public_url',
          storage_key = '',
          updated_at = now()
      WHERE shop_id = $1 AND id = $2
        AND asset_type IN ('menu_image', 'product_image')
      RETURNING id, shop_id, product_id, asset_type, storage_provider,
                public_url, content_type, size_bytes, status, sort_order, updated_at
    `, [shopId, assetId]);
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
      resourceType: 'shop_asset',
      resourceId,
      outcome,
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    archiveAsset,
    getAssetForShop,
    getProductForShop,
    insertAsset,
    insertAudit,
    resolveShop,
    updateAsset
  };
}

function createPostgresAssetWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createAssetWriteRepository()
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createAssetWriteError('database_url_required', 'DATABASE_URL is required for asset writes.', 503);
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
        throw createAssetWriteError('asset_commit_failed', 'Asset write could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createAssetWriteError('asset_commit_failed', 'Asset write could not be committed.', 500);
      }
      return result;
    } catch (err) {
      if (transactionOpen) {
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
      throw createAssetWriteError('permission_denied', 'Asset write permission is required.', 403);
    }
  }

  async function validateProductScope(client, shopId, input) {
    if (!input.productId) return null;
    const product = await repository.getProductForShop(client, shopId, input.productId);
    if (!product?.id) {
      throw createAssetWriteError('product_not_found', 'Product was not found for this shop.', 404);
    }
    return product;
  }

  function buildAuditMetadata(shopId, assetId, input = {}) {
    return {
      shop_id: shopId,
      asset_id: assetId,
      asset_type: input.assetType,
      product_id: input.productId || '',
      status: input.status,
      sort_order: input.sortOrder,
      content_type: input.contentType || '',
      ...summarizePublicUrl(input.publicUrl)
    };
  }

  async function createAsset({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const input = normalizeCreateInput(body);
    validateAssetInput(input);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      await validateProductScope(client, shop.id, input);
      const assetId = `asset_${crypto.randomUUID()}`;
      const row = await repository.insertAsset(client, { shopId: shop.id, assetId, input });
      if (!row?.id) throw createAssetWriteError('asset_persist_failed', 'Asset could not be persisted.', 500);
      await repository.insertAudit(client, {
        principal,
        action: ASSET_WRITE_ACTIONS.CREATE,
        resourceId: assetId,
        metadata: buildAuditMetadata(shop.id, assetId, input),
        requestContext
      });
      return { shopId: shop.id, asset: presentAsset(row) };
    });
  }

  async function updateAssetWithAction({ principal, shopId, assetId, body = {}, requestContext = {}, action = ASSET_WRITE_ACTIONS.UPDATE } = {}) {
    assertWritePermission(principal);
    const normalizedAssetId = normalizeAssetId(assetId);
    if (!normalizedAssetId) throw createAssetWriteError('asset_not_found', 'Asset was not found.', 404);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const existing = await repository.getAssetForShop(client, shop.id, normalizedAssetId);
      if (!existing) throw createAssetWriteError('asset_not_found', 'Asset was not found.', 404);
      const input = normalizePatchInput(existing, body);
      validateAssetInput(input);
      await validateProductScope(client, shop.id, input);
      const row = await repository.updateAsset(client, { shopId: shop.id, assetId: normalizedAssetId, input });
      if (!row?.id) throw createAssetWriteError('asset_not_found', 'Asset was not found.', 404);
      await repository.insertAudit(client, {
        principal,
        action,
        resourceId: normalizedAssetId,
        metadata: buildAuditMetadata(shop.id, normalizedAssetId, input),
        requestContext
      });
      return { shopId: shop.id, asset: presentAsset(row) };
    });
  }

  async function updateAsset(input = {}) {
    return updateAssetWithAction({
      ...input,
      action: ASSET_WRITE_ACTIONS.UPDATE
    });
  }

  async function setAssetEnabled({ principal, shopId, assetId, enabled = true, requestContext = {} } = {}) {
    return updateAssetWithAction({
      principal,
      shopId,
      assetId,
      body: { status: enabled ? 'active' : 'hidden' },
      requestContext,
      action: ASSET_WRITE_ACTIONS.STATUS
    });
  }

  async function archiveAsset({ principal, shopId, assetId, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const normalizedAssetId = normalizeAssetId(assetId);
    if (!normalizedAssetId) throw createAssetWriteError('asset_not_found', 'Asset was not found.', 404);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const existing = await repository.getAssetForShop(client, shop.id, normalizedAssetId);
      if (!existing) throw createAssetWriteError('asset_not_found', 'Asset was not found.', 404);
      const row = await repository.archiveAsset(client, { shopId: shop.id, assetId: normalizedAssetId });
      if (!row?.id) throw createAssetWriteError('asset_not_found', 'Asset was not found.', 404);
      const input = normalizePatchInput(existing, { status: 'archived' });
      await repository.insertAudit(client, {
        principal,
        action: ASSET_WRITE_ACTIONS.ARCHIVE,
        resourceId: normalizedAssetId,
        metadata: buildAuditMetadata(shop.id, normalizedAssetId, input),
        requestContext
      });
      return { shopId: shop.id, asset: presentAsset(row) };
    });
  }

  return {
    archiveAsset,
    createAsset,
    setAssetEnabled,
    updateAsset
  };
}

module.exports = {
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_WRITE_ACTIONS,
  MAX_PUBLIC_URL_LENGTH,
  createAssetWriteError,
  createAssetWriteRepository,
  createPostgresAssetWriteService,
  isMissingAssetWriteSchemaError: isMissingMultiShopSchemaError,
  normalizeCreateInput,
  normalizePatchInput,
  presentAsset,
  summarizePublicUrl
};

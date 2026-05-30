const crypto = require('crypto');
const path = require('path');
const { Writable } = require('stream');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { shopRef } = require('../utils/log-refs');
const { insertAuditLogEntry } = require('./audit');
const {
  ASSET_STATUSES,
  ASSET_TYPES,
  createAssetWriteError,
  createAssetWriteRepository,
  presentAsset
} = require('./asset-writes');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');

const ASSET_UPLOAD_ACTIONS = Object.freeze({
  CREATE: 'admin.shop_asset.upload'
});

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_ALLOWED_EXT = Object.freeze(['.jpg', '.jpeg', '.png', '.webp']);
const SAFE_MIME_TYPES = Object.freeze(new Set(DEFAULT_ALLOWED_MIME));
const SAFE_EXTENSIONS = Object.freeze(new Set(DEFAULT_ALLOWED_EXT));
const SVG_EXTENSIONS = Object.freeze(new Set(['.svg', '.svgz']));
const MIME_BY_EXTENSION = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
});
const EXTENSIONS_BY_MIME = Object.freeze({
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp'])
});

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL asset upload admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
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

function toBoundedInteger(value, fallback = 0, { min = -100000, max = 100000 } = {}) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function createAssetUploadError(code, message, statusCode = 400) {
  const err = createAssetWriteError(code, message, statusCode);
  return err;
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function parseAllowedList(value, fallback = []) {
  const list = String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : [...fallback];
}

function normalizeExtension(value = '') {
  const ext = path.extname(String(value || '')).trim().toLowerCase();
  return ext.startsWith('.') ? ext : (ext ? `.${ext}` : '');
}

function normalizeAllowedExtensions(value) {
  return parseAllowedList(value, DEFAULT_ALLOWED_EXT)
    .map(item => item.startsWith('.') ? item : `.${item}`)
    .filter(item => SAFE_EXTENSIONS.has(item));
}

function normalizeAllowedMimeTypes(value) {
  return parseAllowedList(value, DEFAULT_ALLOWED_MIME)
    .filter(item => SAFE_MIME_TYPES.has(item));
}

function resolveImageUploadPolicy(env = process.env) {
  const maxBytes = parsePositiveInteger(env.IMAGE_UPLOAD_MAX_BYTES, DEFAULT_MAX_BYTES);
  const allowedMime = normalizeAllowedMimeTypes(env.IMAGE_UPLOAD_ALLOWED_MIME);
  const allowedExt = normalizeAllowedExtensions(env.IMAGE_UPLOAD_ALLOWED_EXT);
  return {
    maxBytes,
    allowedMime: allowedMime.length ? allowedMime : [...DEFAULT_ALLOWED_MIME],
    allowedExt: allowedExt.length ? allowedExt : [...DEFAULT_ALLOWED_EXT]
  };
}

function isAdminImageUploadEnabled(value = process.env.ADMIN_IMAGE_UPLOAD_ENABLED) {
  return normalizeBoolean(value, false);
}

function validateCloudinaryConfig(env = process.env) {
  const rawUrl = String(env.CLOUDINARY_URL || '').trim();
  const rawFolder = String(env.CLOUDINARY_FOLDER || '').trim();
  if (!rawUrl || !rawFolder) {
    return { ok: false, reason: 'missing_cloudinary_config' };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'cloudinary:' || !parsed.hostname || !parsed.username || !parsed.password) {
      return { ok: false, reason: 'invalid_cloudinary_url' };
    }
  } catch (_) {
    return { ok: false, reason: 'invalid_cloudinary_url' };
  }

  const folder = rawFolder
    .split('/')
    .map(segment => normalizeCloudinaryPathSegment(segment, 100))
    .filter(Boolean)
    .join('/');
  if (!folder) return { ok: false, reason: 'invalid_cloudinary_folder' };
  return { ok: true, folder };
}

function normalizeCloudinaryPathSegment(value = '', max = 120) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
}

function buildCloudinaryFolder(baseFolder = '', shopId = '', assetType = '') {
  const shopSegment = normalizeCloudinaryPathSegment(shopId) || 'shop';
  const typeSegment = normalizeCloudinaryPathSegment(assetType) || 'asset';
  return [baseFolder, shopSegment, typeSegment].filter(Boolean).join('/');
}

function contentLooksLikeSvg(buffer = Buffer.alloc(0)) {
  const head = buffer.slice(0, Math.min(buffer.length, 2048)).toString('utf8').replace(/\0/g, ' ').trimStart();
  return /<svg(?:\s|>|:)/i.test(head) || /<!doctype\s+svg/i.test(head);
}

function sniffRejectedBinaryType(buffer = Buffer.alloc(0)) {
  if (buffer.length >= 6) {
    const ascii6 = buffer.slice(0, 6).toString('ascii');
    if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') return 'image/gif';
  }
  if (buffer.length >= 4 && buffer.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'application/zip';
  if (buffer.length >= 7 && buffer.slice(0, 7).toString('ascii') === 'Rar!\x1a\x07') return 'application/x-rar-compressed';
  if (buffer.length >= 6 && buffer[0] === 0x37 && buffer[1] === 0x7a && buffer[2] === 0xbc && buffer[3] === 0xaf && buffer[4] === 0x27 && buffer[5] === 0x1c) {
    return 'application/x-7z-compressed';
  }
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 16).toString('ascii').toLowerCase();
    if (/^(heic|heix|hevc|hevx|mif1|msf1)/.test(brand)) return 'image/heic';
    return 'video/mp4';
  }
  return '';
}

function sniffAllowedImageType(buffer = Buffer.alloc(0)) {
  if (contentLooksLikeSvg(buffer)) return 'image/svg+xml';
  const rejected = sniffRejectedBinaryType(buffer);
  if (rejected) return rejected;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png';
  }
  if (buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

function validateUploadedFile(file = {}, policy = resolveImageUploadPolicy()) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw createAssetUploadError('missing_file', 'Image file is required.', 400);
  }

  const size = Number(file.size == null ? file.buffer.length : file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw createAssetUploadError('missing_file', 'Image file is required.', 400);
  }
  if (size > Number(policy.maxBytes || DEFAULT_MAX_BYTES)) {
    throw createAssetUploadError('file_too_large', 'Image file is too large.', 413);
  }

  const extension = normalizeExtension(file.originalname || '');
  const declaredMime = normalizeText(file.mimetype || '', 120).toLowerCase();
  if (SVG_EXTENSIONS.has(extension) || declaredMime === 'image/svg+xml') {
    throw createAssetUploadError('svg_not_allowed', 'SVG uploads are not allowed.', 400);
  }
  if (!(policy.allowedExt || []).includes(extension)) {
    throw createAssetUploadError('invalid_file_extension', 'Image extension is not allowed.', 400);
  }
  if (!(policy.allowedMime || []).includes(declaredMime)) {
    throw createAssetUploadError('invalid_file_type', 'Image MIME type is not allowed.', 400);
  }

  const detectedMime = sniffAllowedImageType(file.buffer);
  if (detectedMime === 'image/svg+xml') {
    throw createAssetUploadError('svg_not_allowed', 'SVG uploads are not allowed.', 400);
  }
  if (!detectedMime || !SAFE_MIME_TYPES.has(detectedMime)) {
    throw createAssetUploadError('invalid_file_signature', 'Image file signature is not allowed.', 400);
  }
  if (detectedMime !== declaredMime || MIME_BY_EXTENSION[extension] !== detectedMime) {
    throw createAssetUploadError('file_type_mismatch', 'Image file type does not match its extension or MIME type.', 400);
  }
  if (!EXTENSIONS_BY_MIME[detectedMime]?.has(extension)) {
    throw createAssetUploadError('file_type_mismatch', 'Image file type does not match its extension or MIME type.', 400);
  }

  return {
    extension,
    contentType: detectedMime,
    sizeBytes: size
  };
}

function normalizeUploadInput(body = {}, file = {}, policy = resolveImageUploadPolicy()) {
  if (normalizeText(body.product_code ?? body.productCode, 160)) {
    throw createAssetUploadError('product_code_not_supported', 'Product code is not accepted for image upload.', 400);
  }

  const assetType = normalizeAssetType(body.asset_type ?? body.assetType);
  if (!ASSET_TYPES.has(assetType)) {
    throw createAssetUploadError('invalid_asset_type', 'Asset type is invalid.', 400);
  }
  const status = normalizeStatus(body.status, 'active');
  if (!ASSET_STATUSES.has(status)) {
    throw createAssetUploadError('invalid_asset_status', 'Asset status is invalid.', 400);
  }

  const productId = assetType === 'product_image'
    ? normalizeText(body.product_id ?? body.productId, 160)
    : '';
  if (assetType === 'product_image' && !productId) {
    throw createAssetUploadError('product_id_required', 'Product image requires product_id.', 400);
  }

  const fileInfo = validateUploadedFile(file, policy);
  return {
    assetType,
    productId,
    status,
    sortOrder: toBoundedInteger(body.sort_order ?? body.sortOrder, 0),
    contentType: fileInfo.contentType,
    sizeBytes: fileInfo.sizeBytes,
    extension: fileInfo.extension
  };
}

function safeEntityRef(prefix = 'r', value = '') {
  const normalized = normalizeText(value, 240);
  if (!normalized) return 'unknown';
  return `${prefix}:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 10)}`;
}

function summarizeUrlHost(publicUrl = '') {
  try {
    const parsed = new URL(publicUrl);
    return normalizeText(parsed.hostname, 160);
  } catch (_) {
    return '';
  }
}

function normalizeSecureUrl(value = '') {
  const raw = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw createAssetUploadError('insecure_upload_url', 'Uploaded image URL is invalid.', 502);
  }
  if (parsed.protocol !== 'https:') {
    throw createAssetUploadError('insecure_upload_url', 'Uploaded image URL must use https.', 502);
  }
  return parsed.href;
}

function createCloudinaryUploader({ cloudinary } = {}) {
  function loadCloudinary() {
    if (cloudinary) return cloudinary;
    try {
      return require('cloudinary').v2;
    } catch (_) {
      throw createAssetUploadError('feature_not_configured', 'Image upload storage is not configured.', 503);
    }
  }

  return {
    async uploadBuffer(buffer, options = {}) {
      const client = loadCloudinary();
      if (typeof client.config === 'function') client.config({ secure: true });
      if (!client.uploader || typeof client.uploader.upload_stream !== 'function') {
        throw createAssetUploadError('feature_not_configured', 'Image upload storage is not configured.', 503);
      }
      return new Promise((resolve, reject) => {
        const stream = client.uploader.upload_stream(options, (err, result) => {
          if (err) {
            reject(createAssetUploadError('cloudinary_upload_failed', 'Image upload could not be completed.', 502));
            return;
          }
          resolve(result || {});
        });
        const writer = stream instanceof Writable || typeof stream.end === 'function' ? stream : null;
        if (!writer) {
          reject(createAssetUploadError('cloudinary_upload_failed', 'Image upload could not be completed.', 502));
          return;
        }
        writer.end(buffer);
      });
    },
    async destroy(publicId, options = {}) {
      const client = loadCloudinary();
      if (typeof client.config === 'function') client.config({ secure: true });
      if (!client.uploader || typeof client.uploader.destroy !== 'function') return null;
      return client.uploader.destroy(publicId, options);
    }
  };
}

function createAssetUploadRepository(baseRepository = createAssetWriteRepository()) {
  async function getActiveProductForShop(client, shopId, productId) {
    const normalized = normalizeText(productId, 160);
    if (!normalized) return null;
    const result = await client.query(`
      SELECT id, shop_id, code, status
      FROM shop_products
      WHERE shop_id = $1
        AND id = $2
        AND status = 'active'
      LIMIT 1
    `, [shopId, normalized]);
    return result.rows[0] || null;
  }

  async function insertUploadedAsset(client, { shopId, assetId, input, storageKey, publicUrl } = {}) {
    const result = await client.query(`
      INSERT INTO shop_assets (
        id, shop_id, product_id, asset_type, storage_provider, storage_key,
        public_url, content_type, size_bytes, status, sort_order
      )
      VALUES ($1, $2, NULLIF($3, ''), $4, 'object_storage', $5, $6, $7, $8, $9, $10)
      RETURNING id, shop_id, product_id, asset_type, storage_provider,
                public_url, content_type, size_bytes, status, sort_order, updated_at
    `, [
      assetId,
      shopId,
      input.productId || '',
      input.assetType,
      storageKey,
      publicUrl,
      input.contentType,
      input.sizeBytes,
      input.status,
      input.sortOrder
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
      action: ASSET_UPLOAD_ACTIONS.CREATE,
      resourceType: 'shop_asset',
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
    getActiveProductForShop,
    insertAudit,
    insertUploadedAsset,
    resolveShop: baseRepository.resolveShop
  };
}

function safeCleanupLog(logger, { shop_ref = '', asset_ref = '' } = {}) {
  const message = [
    '[admin-image-upload] cleanup_failed',
    `shop_ref=${normalizeText(shop_ref, 32) || 'unknown'}`,
    `asset_ref=${normalizeText(asset_ref, 32) || 'unknown'}`,
    'provider=cloudinary'
  ].join(' ');
  if (logger && typeof logger.warn === 'function') logger.warn(message);
}

function createPostgresAssetUploadService({
  enabled = isAdminImageUploadEnabled(),
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createAssetUploadRepository(),
  cloudinaryUploader,
  cloudinary,
  env = process.env,
  logger = console
} = {}) {
  const uploadEnabled = normalizeBoolean(enabled, false);
  const uploader = cloudinaryUploader || createCloudinaryUploader({ cloudinary });

  function isEnabled() {
    return uploadEnabled;
  }

  function getPolicy() {
    return resolveImageUploadPolicy(env);
  }

  function getCloudinaryConfig() {
    return validateCloudinaryConfig(env);
  }

  function assertFeatureReady() {
    if (!uploadEnabled) {
      throw createAssetUploadError('feature_disabled', 'Image upload is disabled.', 404);
    }
    const config = getCloudinaryConfig();
    if (!config.ok) {
      throw createAssetUploadError('feature_not_configured', 'Image upload storage is not configured.', 503);
    }
    return config;
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createAssetUploadError('permission_denied', 'Asset write permission is required.', 403);
    }
  }

  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createAssetUploadError('database_url_required', 'DATABASE_URL is required for asset uploads.', 503);
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
        throw createAssetUploadError('asset_upload_commit_failed', 'Asset upload could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createAssetUploadError('asset_upload_commit_failed', 'Asset upload could not be committed.', 500);
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

  async function validateProductScope(client, shopId, input) {
    if (!input.productId) return null;
    const product = await repository.getActiveProductForShop(client, shopId, input.productId);
    if (!product?.id) {
      throw createAssetUploadError('product_not_found', 'Product was not found for this shop.', 404);
    }
    return product;
  }

  async function cleanupCloudinaryUpload(uploaded = {}, refs = {}) {
    const publicId = normalizeText(uploaded?.publicId || uploaded?.public_id || '', 500);
    if (!publicId) return;
    try {
      await uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true
      });
    } catch (_) {
      safeCleanupLog(logger, refs);
    }
  }

  async function uploadToCloudinary({ file, input, config, shopId, publicId, onUploadedPublicId } = {}) {
    let result;
    try {
      result = await uploader.uploadBuffer(file.buffer, {
        resource_type: 'image',
        secure: true,
        folder: buildCloudinaryFolder(config.folder, shopId, input.assetType),
        public_id: publicId,
        overwrite: false,
        use_filename: false,
        unique_filename: false
      });
    } catch (err) {
      if (err?.code === 'feature_not_configured' || err?.code === 'cloudinary_upload_failed') throw err;
      throw createAssetUploadError('cloudinary_upload_failed', 'Image upload could not be completed.', 502);
    }

    const storageKey = normalizeText(result?.public_id || '', 500);
    if (storageKey && typeof onUploadedPublicId === 'function') onUploadedPublicId(storageKey);
    const secureUrl = normalizeSecureUrl(result?.secure_url || '');
    if (!storageKey) {
      throw createAssetUploadError('cloudinary_upload_failed', 'Image upload could not be completed.', 502);
    }
    return {
      publicId: storageKey,
      secureUrl
    };
  }

  function buildAuditMetadata({ shopId, assetId, input, product, publicUrl } = {}) {
    return {
      shop_ref: shopRef(shopId),
      asset_ref: safeEntityRef('a', assetId),
      asset_type: input.assetType,
      ...(product?.id ? { product_ref: safeEntityRef('pr', product.id) } : {}),
      ...(product?.code ? { product_code: normalizeText(product.code, 80) } : {}),
      provider: 'cloudinary',
      mime: input.contentType,
      size_bytes: input.sizeBytes,
      url_host: summarizeUrlHost(publicUrl)
    };
  }

  async function createUploadedAsset({ principal, shopId, body = {}, file = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const config = assertFeatureReady();
    const input = normalizeUploadInput(body, file, getPolicy());
    const assetId = `asset_${crypto.randomUUID()}`;
    const publicId = `asset_${crypto.randomUUID()}`;
    let uploaded = null;
    const refs = {
      shop_ref: '',
      asset_ref: safeEntityRef('a', assetId)
    };

    try {
      return await withTransaction(async client => {
        const shop = await repository.resolveShop(client, shopId);
        refs.shop_ref = shopRef(shop.id);
        const product = await validateProductScope(client, shop.id, input);
        uploaded = await uploadToCloudinary({
          file,
          input,
          config,
          shopId: shop.id,
          publicId,
          onUploadedPublicId(storageKey) {
            uploaded = { publicId: storageKey };
          }
        });
        const row = await repository.insertUploadedAsset(client, {
          shopId: shop.id,
          assetId,
          input,
          storageKey: uploaded.publicId,
          publicUrl: uploaded.secureUrl
        });
        if (!row?.id) {
          throw createAssetUploadError('asset_persist_failed', 'Asset could not be persisted.', 500);
        }
        await repository.insertAudit(client, {
          principal,
          resourceId: refs.asset_ref,
          metadata: buildAuditMetadata({
            shopId: shop.id,
            assetId,
            input,
            product,
            publicUrl: uploaded.secureUrl
          }),
          requestContext
        });
        return { shopId: shop.id, asset: presentAsset(row) };
      });
    } catch (err) {
      await cleanupCloudinaryUpload(uploaded, refs);
      throw err;
    }
  }

  return {
    createUploadedAsset,
    getCloudinaryConfig,
    getPolicy,
    isEnabled
  };
}

module.exports = {
  ASSET_UPLOAD_ACTIONS,
  DEFAULT_ALLOWED_EXT,
  DEFAULT_ALLOWED_MIME,
  DEFAULT_MAX_BYTES,
  buildCloudinaryFolder,
  createAssetUploadError,
  createAssetUploadRepository,
  createCloudinaryUploader,
  createPostgresAssetUploadService,
  isAdminImageUploadEnabled,
  isMissingAssetUploadSchemaError: isMissingMultiShopSchemaError,
  normalizeUploadInput,
  resolveImageUploadPolicy,
  safeEntityRef,
  sniffAllowedImageType,
  validateCloudinaryConfig,
  validateUploadedFile
};

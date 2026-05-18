const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { normalizeCreateInput: normalizeAssetCreateInput } = require('./asset-writes');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');

const PRODUCT_IMPORT_ACTION = 'admin.product.import';
const PRODUCT_IMPORT_MAX_ROWS = 100;
const PRODUCT_IMPORT_METADATA_JSON_SUPPORTED = true;

const PRODUCT_STATUSES = Object.freeze(new Set(['active', 'hidden', 'archived']));
const KNOWN_COLUMNS = Object.freeze(new Set([
  'code',
  'name',
  'price_text',
  'description',
  'image_url',
  'status',
  'sort_order',
  'category',
  'tags',
  'metadata_json'
]));
const HEADERLESS_MINIMUM_COLUMNS = Object.freeze([
  'code',
  'name',
  'price_text',
  'description',
  'image_url',
  'status',
  'sort_order'
]);
const HEADERLESS_FLEXIBLE_COLUMNS = Object.freeze([
  'code',
  'name',
  'price_text',
  'description',
  'image_url',
  'category',
  'tags',
  'metadata_json',
  'status',
  'sort_order'
]);
const SAFE_CODE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,79}$/u;
const SAFE_VALUE_FIELDS = Object.freeze(new Set([
  'code',
  'status'
]));
const SAFE_PRODUCT_CODE_ECHO_PATTERN = /^(?=.{2,16}$)(?=.*[a-z])(?=.*\d)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i;
const SAFE_STATUS_ECHO_PATTERN = /^[a-z]{1,16}$/i;
const SENSITIVE_VALUE_PATTERN = /(?:token|secret|password|bearer|authorization|metadata_json|phone|tel|sdt|sđt|address|dia chi|địa chỉ|pageid|pageref|customerid|senderid|userid|psid|fbid)/i;
const URL_LIKE_VALUE_PATTERN = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;
const JSON_LIKE_VALUE_PATTERN = /(?:^\s*[\[{]|[\]}]\s*$|":|'\s*:)/;

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL product import admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeLongText(value = '', max = 2000) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function jsonObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function normalizeHeader(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .slice(0, 80);
}

function hasOwn(object = {}, key = '') {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function createProductImportError(code, message, statusCode = 400, extra = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

function createValidationError({
  rowsReceived = 0,
  ignoredColumns = [],
  errors = []
} = {}) {
  return createProductImportError(
    'product_import_validation_failed',
    'Product import validation failed.',
    400,
    {
      rows_received: rowsReceived,
      ignored_columns: ignoredColumns,
      errors
    }
  );
}

function normalizeStatus(value = '', fallback = 'active') {
  const status = normalizeText(value, 40).toLowerCase();
  if (!status) return fallback;
  if (status === 'enabled') return 'active';
  if (status === 'disabled') return 'hidden';
  return status;
}

function parseSortOrder(value = '') {
  const text = String(value ?? '').trim();
  if (!text) return { ok: true, value: 0 };
  if (!/^-?\d+$/.test(text)) return { ok: false, value: 0 };
  const number = Number(text);
  if (!Number.isSafeInteger(number)) return { ok: false, value: 0 };
  return {
    ok: true,
    value: Math.max(-100000, Math.min(100000, number))
  };
}

function normalizeTags(value = '') {
  return [...new Set(String(value ?? '')
    .split(',')
    .map(item => normalizeText(item, 40))
    .filter(Boolean)
    .slice(0, 20))];
}

function looksSensitiveSubmittedValue(value = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (text.length > 80) return true;
  if (SENSITIVE_VALUE_PATTERN.test(text)) return true;
  if (URL_LIKE_VALUE_PATTERN.test(text)) return true;
  if (JSON_LIKE_VALUE_PATTERN.test(text)) return true;
  if ((text.match(/\d/g) || []).length >= 7) return true;
  if (text.split(/\s+/).filter(Boolean).length >= 3) return true;

  const compact = text.toLowerCase().replace(/[\s._:-]+/g, '_');
  if (String(text).toLowerCase().startsWith('p:')) return true;
  return /(^|_)(page|customer|cust|sender|user|uid|psid|fbid)(_|$|\d)/i.test(compact);
}

function safeSubmittedValue(field = '', value = '') {
  const normalizedField = normalizeHeader(field);
  if (!SAFE_VALUE_FIELDS.has(normalizedField)) return undefined;
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (looksSensitiveSubmittedValue(text)) return undefined;
  if (normalizedField === 'code') {
    return SAFE_PRODUCT_CODE_ECHO_PATTERN.test(text) ? text : undefined;
  }
  if (normalizedField === 'status') {
    return SAFE_STATUS_ECHO_PATTERN.test(text) ? text : undefined;
  }
  return undefined;
}

function suggestedFixForImportError(code = '') {
  return {
    csv_required: 'Paste CSV text with a header row and at least one product.',
    invalid_csv: 'Check quotes, commas, and line breaks, then try again.',
    no_rows: 'Add at least one product row below the header.',
    too_many_rows: `Split the file into batches of ${PRODUCT_IMPORT_MAX_ROWS} rows or fewer.`,
    missing_required_column: 'Add the required column to the header row.',
    invalid_product_code: 'Use a short code starting with a letter or number; allowed punctuation is dot, underscore, colon, and hyphen.',
    duplicate_product_code_in_csv: 'Keep one row for each product code or merge the duplicated rows.',
    invalid_product_name: 'Add a product name.',
    invalid_product_status: 'Use active, hidden, archived, enabled, or disabled.',
    invalid_sort_order: 'Use a whole number between -100000 and 100000.',
    invalid_metadata_json: 'Use a valid JSON object such as {"size":"M"}.',
    metadata_json_not_supported: 'Remove metadata_json for this environment.',
    invalid_image_url: 'Use a public https image URL; private and internal hosts are rejected.'
  }[String(code || '')] || 'Edit this cell and validate again.';
}

function safeRowError(row, field, code, message, value, extra = {}) {
  const error = {
    row,
    field,
    code,
    message,
    suggested_fix: suggestedFixForImportError(code)
  };
  const safeValue = safeSubmittedValue(field, value);
  if (safeValue !== undefined) error.value = safeValue;
  if (Array.isArray(extra.related_rows)) {
    error.related_rows = extra.related_rows
      .map(item => Number(item || 0))
      .filter(item => Number.isInteger(item) && item > 0)
      .slice(0, 10);
  }
  return error;
}

function parseCsvText(csvText = '') {
  const raw = String(csvText ?? '').trim();
  if (!raw) {
    throw createValidationError({
      rowsReceived: 0,
      errors: [safeRowError(0, 'csv', 'csv_required', 'CSV text is required.')]
    });
  }

  let records;
  try {
    records = parse(raw, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (_) {
    throw createValidationError({
      rowsReceived: 0,
      errors: [safeRowError(0, 'csv', 'invalid_csv', 'CSV could not be parsed.')]
    });
  }

  if (!records.length) {
    throw createValidationError({
      rowsReceived: 0,
      errors: [safeRowError(0, 'csv', 'csv_required', 'CSV text is required.')]
    });
  }

  const firstHeaders = records[0].map(normalizeHeader);
  const hasHeader = firstHeaders.includes('code') || firstHeaders.includes('name');
  const ignoredColumns = new Set();
  const rows = [];
  const headerErrors = [];

  if (hasHeader) {
    if (!firstHeaders.includes('code')) {
      headerErrors.push(safeRowError(1, 'code', 'missing_required_column', 'Column code is required.'));
    }
    if (!firstHeaders.includes('name')) {
      headerErrors.push(safeRowError(1, 'name', 'missing_required_column', 'Column name is required.'));
    }
    firstHeaders.forEach(header => {
      if (header && !KNOWN_COLUMNS.has(header)) ignoredColumns.add(header);
    });

    for (let index = 1; index < records.length; index += 1) {
      const record = records[index] || [];
      const row = {};
      firstHeaders.forEach((header, columnIndex) => {
        if (!header || !KNOWN_COLUMNS.has(header) || hasOwn(row, header)) return;
        row[header] = record[columnIndex] ?? '';
      });
      rows.push({ rowNumber: index + 1, values: row });
    }
  } else {
    const columns = records.some(record => (record || []).length > HEADERLESS_MINIMUM_COLUMNS.length)
      ? HEADERLESS_FLEXIBLE_COLUMNS
      : HEADERLESS_MINIMUM_COLUMNS;
    records.forEach((record, index) => {
      const row = {};
      for (let columnIndex = 0; columnIndex < record.length; columnIndex += 1) {
        const key = columns[columnIndex];
        if (!key) {
          ignoredColumns.add(`column_${columnIndex + 1}`);
          continue;
        }
        row[key] = record[columnIndex] ?? '';
      }
      rows.push({ rowNumber: index + 1, values: row });
    });
  }

  if (headerErrors.length) {
    throw createValidationError({
      rowsReceived: rows.length,
      ignoredColumns: [...ignoredColumns],
      errors: headerErrors
    });
  }

  if (!rows.length) {
    throw createValidationError({
      rowsReceived: 0,
      ignoredColumns: [...ignoredColumns],
      errors: [safeRowError(1, 'csv', 'no_rows', 'At least one product row is required.')]
    });
  }

  return {
    rows,
    ignoredColumns: [...ignoredColumns]
  };
}

function normalizeImportRow({ rowNumber, values }) {
  const errors = [];
  const code = normalizeText(values.code, 80);
  const name = normalizeText(values.name, 180);
  const status = normalizeStatus(values.status, 'active');
  const sortOrder = parseSortOrder(values.sort_order);
  const metadataPatch = {};
  let imageUrl = '';

  if (!code) {
    errors.push(safeRowError(rowNumber, 'code', 'invalid_product_code', 'Product code is required.', values.code));
  } else if (!SAFE_CODE_PATTERN.test(code)) {
    errors.push(safeRowError(rowNumber, 'code', 'invalid_product_code', 'Product code format is invalid.', values.code));
  }
  if (!name) {
    errors.push(safeRowError(rowNumber, 'name', 'invalid_product_name', 'Product name is required.', values.name));
  }
  if (!PRODUCT_STATUSES.has(status)) {
    errors.push(safeRowError(rowNumber, 'status', 'invalid_product_status', 'Product status is invalid.', values.status));
  }
  if (!sortOrder.ok) {
    errors.push(safeRowError(rowNumber, 'sort_order', 'invalid_sort_order', 'Sort order must be an integer.', values.sort_order));
  }

  if (hasOwn(values, 'metadata_json') && String(values.metadata_json ?? '').trim()) {
    if (!PRODUCT_IMPORT_METADATA_JSON_SUPPORTED) {
      errors.push(safeRowError(rowNumber, 'metadata_json', 'metadata_json_not_supported', 'metadata_json is not supported by the current schema.'));
    } else {
      try {
        const parsed = JSON.parse(String(values.metadata_json));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.push(safeRowError(rowNumber, 'metadata_json', 'invalid_metadata_json', 'metadata_json must be a JSON object.'));
        } else {
          Object.assign(metadataPatch, parsed);
        }
      } catch (_) {
        errors.push(safeRowError(rowNumber, 'metadata_json', 'invalid_metadata_json', 'metadata_json must be valid JSON.'));
      }
    }
  }

  const priceText = normalizeText(values.price_text, 120);
  if (priceText) metadataPatch.priceText = priceText;
  const category = normalizeText(values.category, 80);
  if (category) metadataPatch.category = category;
  const tags = normalizeTags(values.tags);
  if (tags.length) metadataPatch.tags = tags;

  const rawImageUrl = String(values.image_url ?? '').trim();
  if (rawImageUrl) {
    try {
      imageUrl = normalizeAssetCreateInput({
        asset_type: 'product_image',
        product_id: 'product_import_placeholder',
        public_url: rawImageUrl,
        status: 'active'
      }).publicUrl;
    } catch (_) {
      errors.push(safeRowError(rowNumber, 'image_url', 'invalid_image_url', 'Image URL is invalid.'));
    }
  }

  return {
    errors,
    row: {
      rowNumber,
      code,
      name,
      description: normalizeLongText(values.description, 2000),
      status,
      sortOrder: sortOrder.value,
      metadataPatch,
      imageUrl
    }
  };
}

function parseImportInput(body = {}) {
  const parsed = parseCsvText(body.csv ?? body.csv_text ?? body.csvText ?? '');
  const errors = [];
  const rows = [];

  if (parsed.rows.length > PRODUCT_IMPORT_MAX_ROWS) {
    errors.push(safeRowError(0, 'csv', 'too_many_rows', `CSV import supports at most ${PRODUCT_IMPORT_MAX_ROWS} rows.`));
  }

  const seenCodes = new Map();
  for (const rawRow of parsed.rows) {
    const normalized = normalizeImportRow(rawRow);
    errors.push(...normalized.errors);
    const codeKey = normalized.row.code.toLowerCase();
    if (codeKey) {
      if (seenCodes.has(codeKey)) {
        errors.push(safeRowError(
          normalized.row.rowNumber,
          'code',
          'duplicate_product_code_in_csv',
          `Product code is duplicated in this CSV with row ${seenCodes.get(codeKey)}.`,
          normalized.row.code,
          { related_rows: [seenCodes.get(codeKey), normalized.row.rowNumber] }
        ));
      } else {
        seenCodes.set(codeKey, normalized.row.rowNumber);
      }
    }
    rows.push(normalized.row);
  }

  if (errors.length) {
    throw createValidationError({
      rowsReceived: parsed.rows.length,
      ignoredColumns: parsed.ignoredColumns,
      errors
    });
  }

  return {
    rows,
    rowsReceived: parsed.rows.length,
    ignoredColumns: parsed.ignoredColumns
  };
}

function isValidateOnly(body = {}) {
  return /^(1|true|yes|on|validate_only)$/i.test(String(body?.validate_only ?? body?.validateOnly ?? '').trim());
}

function presentImportPreview(rows = []) {
  return rows.slice(0, 10).map(row => ({
    row: Number(row.rowNumber || 0),
    code: safeSubmittedValue('code', row.code) || '',
    name: safeSubmittedValue('name', row.name) || '',
    status: safeSubmittedValue('status', row.status) || '',
    sort_order: Number(row.sortOrder || 0),
    has_image_url: Boolean(row.imageUrl),
    metadata_keys: Object.keys(jsonObject(row.metadataPatch)).sort().slice(0, 20)
  }));
}

function presentImportPreviewRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice(0, 10).map(row => ({
    row: Number(row?.row || row?.rowNumber || 0),
    code: safeSubmittedValue('code', row?.code) || '',
    name: safeSubmittedValue('name', row?.name) || '',
    status: safeSubmittedValue('status', row?.status) || '',
    sort_order: Number(row?.sort_order ?? row?.sortOrder ?? 0),
    has_image_url: Boolean(row?.has_image_url ?? row?.imageUrl),
    metadata_keys: Array.isArray(row?.metadata_keys)
      ? row.metadata_keys.map(key => normalizeText(key, 80)).filter(Boolean).slice(0, 20)
      : []
  }));
}

function presentImportSummary(summary = {}) {
  return {
    shop_id: summary.shop_id || summary.shopId || '',
    rows_received: Number(summary.rows_received || 0),
    products_created: Number(summary.products_created || 0),
    products_updated: Number(summary.products_updated || 0),
    product_images_created: Number(summary.product_images_created || 0),
    product_images_updated: Number(summary.product_images_updated || 0),
    product_images_skipped: Number(summary.product_images_skipped || 0),
    image_assets_touched: Number(summary.image_assets_touched || 0),
    ignored_columns: Array.isArray(summary.ignored_columns)
      ? summary.ignored_columns.map(column => normalizeText(column, 80)).filter(Boolean)
      : [],
    errors: Array.isArray(summary.errors) ? summary.errors : [],
    validate_only: Boolean(summary.validate_only),
    preview_rows: presentImportPreviewRows(summary.preview_rows),
    metadata_json_supported: PRODUCT_IMPORT_METADATA_JSON_SUPPORTED
  };
}

function createProductImportRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createProductImportError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createProductImportError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function getProductsByCodes(client, shopId, codeKeys = []) {
    if (!codeKeys.length) return [];
    const result = await client.query(`
      SELECT id, shop_id, code, name, description, price, currency, status,
             sort_order, metadata_json, updated_at
      FROM shop_products
      WHERE shop_id = $1
        AND lower(code) = ANY($2::text[])
      ORDER BY CASE
                 WHEN status = 'active' THEN 0
                 WHEN status = 'hidden' THEN 1
                 ELSE 2
               END,
               updated_at DESC NULLS LAST,
               id ASC
    `, [shopId, codeKeys]);
    return result.rows || [];
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

  async function getProductImageAssetsByProductIds(client, shopId, productIds = []) {
    if (!productIds.length) return [];
    const result = await client.query(`
      SELECT id, shop_id, product_id, asset_type, storage_provider, public_url,
             content_type, size_bytes, status, sort_order, updated_at
      FROM shop_assets
      WHERE shop_id = $1
        AND product_id = ANY($2::text[])
        AND asset_type = 'product_image'
        AND status <> 'archived'
      ORDER BY product_id ASC, sort_order ASC, id ASC
    `, [shopId, productIds]);
    return result.rows || [];
  }

  async function insertProductImageAsset(client, { shopId, assetId, input } = {}) {
    const result = await client.query(`
      INSERT INTO shop_assets (
        id, shop_id, product_id, asset_type, storage_provider, storage_key,
        public_url, content_type, size_bytes, status, sort_order
      )
      VALUES ($1, $2, $3, 'product_image', 'public_url', '', $4, '', NULL, $5, $6)
      RETURNING id, shop_id, product_id, asset_type, storage_provider,
                public_url, content_type, size_bytes, status, sort_order, updated_at
    `, [
      assetId,
      shopId,
      input.productId,
      input.publicUrl,
      input.status,
      input.sortOrder
    ]);
    return result.rows[0] || null;
  }

  async function updateProductImageAsset(client, { shopId, assetId, input } = {}) {
    const result = await client.query(`
      UPDATE shop_assets
      SET product_id = $3,
          asset_type = 'product_image',
          storage_provider = 'public_url',
          storage_key = '',
          public_url = $4,
          content_type = '',
          status = $5,
          sort_order = $6,
          updated_at = now()
      WHERE shop_id = $1 AND id = $2
        AND asset_type = 'product_image'
      RETURNING id, shop_id, product_id, asset_type, storage_provider,
                public_url, content_type, size_bytes, status, sort_order, updated_at
    `, [
      shopId,
      assetId,
      input.productId,
      input.publicUrl,
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
      action: PRODUCT_IMPORT_ACTION,
      resourceType: 'shop_product',
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
    getProductImageAssetsByProductIds,
    getProductsByCodes,
    insertAudit,
    insertProduct,
    insertProductImageAsset,
    resolveShop,
    updateProduct,
    updateProductImageAsset
  };
}

function assetStatusForProductStatus(status = '') {
  const normalized = normalizeStatus(status, 'active');
  if (normalized === 'hidden' || normalized === 'archived') return normalized;
  return 'active';
}

function createPostgresProductImportService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createProductImportRepository()
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createProductImportError('database_url_required', 'DATABASE_URL is required for product imports.', 503);
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
        throw createProductImportError('product_import_commit_failed', 'Product import could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createProductImportError('product_import_commit_failed', 'Product import could not be committed.', 500);
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
      throw createProductImportError('permission_denied', 'Product write permission is required.', 403);
    }
  }

  async function importProducts({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const input = parseImportInput(body);
    if (isValidateOnly(body)) {
      return presentImportSummary({
        shop_id: normalizeText(shopId, 160),
        rows_received: input.rowsReceived,
        products_created: 0,
        products_updated: 0,
        product_images_created: 0,
        product_images_updated: 0,
        product_images_skipped: input.rowsReceived - input.rows.filter(row => row.imageUrl).length,
        image_assets_touched: 0,
        ignored_columns: input.ignoredColumns,
        errors: [],
        validate_only: true,
        preview_rows: presentImportPreview(input.rows)
      });
    }
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const codeKeys = [...new Set(input.rows.map(row => row.code.toLowerCase()))];
      const existingRows = await repository.getProductsByCodes(client, shop.id, codeKeys);
      const existingByCode = new Map();
      for (const row of existingRows) {
        const key = String(row.code || '').toLowerCase();
        if (!existingByCode.has(key)) existingByCode.set(key, row);
      }

      const persistedByRow = [];
      let productsCreated = 0;
      let productsUpdated = 0;

      for (const row of input.rows) {
        const existing = existingByCode.get(row.code.toLowerCase()) || null;
        const metadata = {
          ...jsonObject(existing?.metadata_json),
          ...jsonObject(row.metadataPatch)
        };
        const productInput = {
          code: row.code,
          name: row.name,
          description: row.description,
          status: row.status,
          sortOrder: row.sortOrder,
          metadata
        };
        let persisted;
        if (existing?.id) {
          persisted = await repository.updateProduct(client, {
            shopId: shop.id,
            productId: existing.id,
            input: productInput
          });
          productsUpdated += 1;
        } else {
          const productId = `product_${crypto.randomUUID()}`;
          persisted = await repository.insertProduct(client, {
            shopId: shop.id,
            productId,
            input: productInput
          });
          productsCreated += 1;
        }
        if (!persisted?.id) {
          throw createProductImportError('product_import_persist_failed', 'Product import could not be persisted.', 500);
        }
        persistedByRow.push({ row, product: persisted });
      }

      const rowsWithImages = persistedByRow.filter(item => item.row.imageUrl);
      const existingAssets = await repository.getProductImageAssetsByProductIds(
        client,
        shop.id,
        rowsWithImages.map(item => item.product.id)
      );
      const assetByProductId = new Map();
      for (const asset of existingAssets) {
        if (asset.product_id && !assetByProductId.has(asset.product_id)) {
          assetByProductId.set(asset.product_id, asset);
        }
      }

      let productImagesCreated = 0;
      let productImagesUpdated = 0;
      for (const item of rowsWithImages) {
        const productId = item.product.id;
        const assetInput = {
          productId,
          publicUrl: item.row.imageUrl,
          status: assetStatusForProductStatus(item.row.status),
          sortOrder: item.row.sortOrder
        };
        const existingAsset = assetByProductId.get(productId);
        if (existingAsset?.id) {
          const updated = await repository.updateProductImageAsset(client, {
            shopId: shop.id,
            assetId: existingAsset.id,
            input: assetInput
          });
          if (!updated?.id) {
            throw createProductImportError('product_import_asset_persist_failed', 'Product image asset could not be persisted.', 500);
          }
          productImagesUpdated += 1;
        } else {
          const assetId = `asset_${crypto.randomUUID()}`;
          const inserted = await repository.insertProductImageAsset(client, {
            shopId: shop.id,
            assetId,
            input: assetInput
          });
          if (!inserted?.id) {
            throw createProductImportError('product_import_asset_persist_failed', 'Product image asset could not be persisted.', 500);
          }
          productImagesCreated += 1;
        }
      }

      const summary = presentImportSummary({
        shop_id: shop.id,
        rows_received: input.rowsReceived,
        products_created: productsCreated,
        products_updated: productsUpdated,
        product_images_created: productImagesCreated,
        product_images_updated: productImagesUpdated,
        product_images_skipped: input.rowsReceived - rowsWithImages.length,
        image_assets_touched: productImagesCreated + productImagesUpdated,
        ignored_columns: input.ignoredColumns,
        errors: []
      });

      await repository.insertAudit(client, {
        principal,
        resourceId: shop.id,
        metadata: {
          rows_received: summary.rows_received,
          products_created: summary.products_created,
          products_updated: summary.products_updated,
          image_assets_touched: summary.image_assets_touched,
          error_count: 0,
          ignored_columns_count: summary.ignored_columns.length
        },
        requestContext
      });

      return summary;
    });
  }

  return {
    importProducts
  };
}

module.exports = {
  PRODUCT_IMPORT_ACTION,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_METADATA_JSON_SUPPORTED,
  createPostgresProductImportService,
  createProductImportError,
  createProductImportRepository,
  isMissingProductImportSchemaError: isMissingMultiShopSchemaError,
  parseImportInput,
  presentImportSummary,
  safeSubmittedValue
};

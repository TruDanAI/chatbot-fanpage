const {
  PERMISSIONS,
  hasPermission
} = require('../admin-auth');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { pageRef, shopRef } = require('../utils/log-refs');

const PAGE_SETUP_PREVIEW_ACTIONS = Object.freeze({
  PAGE_MAPPING: 'admin.shop_page.preview',
  PAGE_CREDENTIAL: 'admin.shop_page_credential.preview'
});
const PREVIEW_CREDENTIAL_TYPE = 'fb_page_token';
const PAGE_ID_MAX_LENGTH = 64;
const PAGE_NAME_MAX_LENGTH = 180;
const META_NUMERIC_PAGE_ID_PATTERN = /^\d{5,32}$/;
const READINESS_BLOCKERS_REMAINING = Object.freeze([
  'page_mapping_ready',
  'credential_ready'
]);
const TOKEN_FIELD_NAMES = Object.freeze([
  'token',
  'page_token',
  'pageToken',
  'page_access_token',
  'pageAccessToken',
  'fb_page_token',
  'fbPageToken',
  'facebook_page_token',
  'facebookPageToken',
  'access_token',
  'accessToken',
  'credential',
  'credential_value',
  'credentialValue',
  'encrypted_value',
  'encryptedValue'
]);
const SAFE_CREDENTIAL_PREVIEW_FIELD_KEYS = Object.freeze(new Set([
  'credential_type',
  'credentialtype',
  'page_id',
  'pageid',
  'validate_only',
  'validateonly'
]));
const CREDENTIAL_TOKEN_FIELD_PATTERN = /(?:token|access[_-]?token|credential[_-]?(?:value|token)|encrypted[_-]?value|secret|password|authorization)/i;

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL page setup preview.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizePageId(value = '') {
  return String(value ?? '').trim().slice(0, PAGE_ID_MAX_LENGTH);
}

function createPageSetupPreviewError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function isDemoShop(shop = {}) {
  return [shop.id, shop.slug]
    .map(value => String(value || '').trim().toLowerCase())
    .includes('demo-shop');
}

function isConfiguringNonLive(shop = {}) {
  return String(shop.lifecycle || '').trim().toLowerCase() === 'configuring'
    && shop.live_enabled === false;
}

function isPageSetupPreviewAllowed(shop = {}) {
  return isDemoShop(shop) || isConfiguringNonLive(shop);
}

function isDemoShopSetupPreviewOnly(shop = {}) {
  return isDemoShop(shop) && isConfiguringNonLive(shop);
}

function assertPageSetupPreviewAllowed(shop = {}) {
  if (!isPageSetupPreviewAllowed(shop)) {
    throw createPageSetupPreviewError(
      'setup_preview_not_allowed',
      'Page setup preview is only available for demo-shop or configuring/non-live shops.',
      403
    );
  }
}

function assertPageSetupDirectWriteAllowed(shop = {}) {
  if (isDemoShopSetupPreviewOnly(shop)) {
    throw createPageSetupPreviewError(
      'page_setup_preview_only',
      'Demo-shop page setup is preview-only while configuring/non-live.',
      409
    );
  }
}

function assertPreviewPermission(principal) {
  if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
    throw createPageSetupPreviewError('permission_denied', 'Page setup preview permission is required.', 403);
  }
}

function normalizePageMappingPreviewInput(body = {}) {
  const rawPageName = String(body.page_name ?? body.pageName ?? '');
  const trimmedPageName = rawPageName.replace(/\s+/g, ' ').trim();
  return {
    pageId: normalizePageId(body.page_id ?? body.pageId),
    pageNameLength: Math.min(trimmedPageName.length, PAGE_NAME_MAX_LENGTH),
    pageNameProvided: Boolean(trimmedPageName),
    pageNameStatus: !trimmedPageName
      ? 'not_provided'
      : (trimmedPageName.length > PAGE_NAME_MAX_LENGTH ? 'too_long' : 'ok')
  };
}

function isCredentialTokenFieldName(name = '') {
  const key = String(name || '').trim();
  const normalized = key.replace(/[\s.-]+/g, '_').toLowerCase();
  if (SAFE_CREDENTIAL_PREVIEW_FIELD_KEYS.has(normalized)) return false;
  return TOKEN_FIELD_NAMES.includes(key) || CREDENTIAL_TOKEN_FIELD_PATTERN.test(normalized);
}

function hasSubmittedCredentialToken(body = {}, depth = 0) {
  if (!body || typeof body !== 'object' || depth > 5) return false;
  return Object.entries(body).some(([key, value]) => (
    isCredentialTokenFieldName(key) || hasSubmittedCredentialToken(value, depth + 1)
  ));
}

function normalizeCredentialPreviewInput(body = {}) {
  return {
    credentialType: normalizeText(
      body.credential_type ?? body.credentialType ?? PREVIEW_CREDENTIAL_TYPE,
      80
    ).toLowerCase() || PREVIEW_CREDENTIAL_TYPE,
    pageId: normalizePageId(body.page_id ?? body.pageId)
  };
}

function createReadinessImpact(shop = {}) {
  return {
    validate_only: true,
    changes_readiness: false,
    blockers_remaining: [...READINESS_BLOCKERS_REMAINING],
    live_enabled_after_preview: Boolean(shop.live_enabled)
  };
}

function presentPageNamePreview(input = {}) {
  return {
    provided: Boolean(input.pageNameProvided),
    length: Number(input.pageNameLength || 0),
    max_length: PAGE_NAME_MAX_LENGTH,
    status: input.pageNameStatus || 'not_provided'
  };
}

function createPageSetupPreviewRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createPageSetupPreviewError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, lifecycle, live_enabled
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createPageSetupPreviewError('shop_not_found', 'Shop was not found.', 404);
    return {
      id: shop.id || '',
      slug: shop.slug || '',
      lifecycle: shop.lifecycle || '',
      live_enabled: Boolean(shop.live_enabled)
    };
  }

  async function hasActivePageMapping(client, pageId) {
    const result = await client.query(`
      SELECT id
      FROM shop_pages
      WHERE page_id = $1
        AND status = 'active'
      LIMIT 1
    `, [pageId]);
    return Boolean(result.rows[0]?.id);
  }

  return {
    hasActivePageMapping,
    resolveShop
  };
}

function createPostgresPageSetupPreviewService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createPageSetupPreviewRepository(),
  getCredentialMasterKey = () => process.env.CREDENTIAL_MASTER_KEY
} = {}) {
  async function withClient(fn) {
    if (!databaseUrl) {
      throw createPageSetupPreviewError('database_url_required', 'DATABASE_URL is required for page setup preview.', 503);
    }
    const client = new (Client || loadPgClient())({ connectionString: databaseUrl });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  async function previewPageMapping({ principal, shopId, body = {} } = {}) {
    assertPreviewPermission(principal);
    const input = normalizePageMappingPreviewInput(body);
    if (!input.pageId) {
      throw createPageSetupPreviewError('page_id_required', 'Page id is required for preview.', 400);
    }
    const pageIdFormatValid = META_NUMERIC_PAGE_ID_PATTERN.test(input.pageId);

    return withClient(async client => {
      const shop = await repository.resolveShop(client, shopId);
      assertPageSetupPreviewAllowed(shop);
      const duplicate = pageIdFormatValid
        ? await repository.hasActivePageMapping(client, input.pageId)
        : false;
      return {
        schemaReady: true,
        validate_only: true,
        shop_ref: shopRef(shop.id),
        page_ref: pageRef(input.pageId),
        duplicate_active_mapping: duplicate,
        conflict: duplicate,
        page_format_valid: pageIdFormatValid,
        page_name: presentPageNamePreview(input),
        readiness_impact: createReadinessImpact(shop)
      };
    });
  }

  async function previewCredentialPrerequisites({ principal, shopId, body = {} } = {}) {
    assertPreviewPermission(principal);
    if (hasSubmittedCredentialToken(body)) {
      throw createPageSetupPreviewError(
        'credential_token_not_accepted_in_preview',
        'Credential token is not accepted in preview.',
        400
      );
    }
    const input = normalizeCredentialPreviewInput(body);
    const credentialTypeAllowed = input.credentialType === PREVIEW_CREDENTIAL_TYPE;
    const masterKeyConfigured = Boolean(normalizeText(getCredentialMasterKey(), 5000));

    return withClient(async client => {
      const shop = await repository.resolveShop(client, shopId);
      assertPageSetupPreviewAllowed(shop);
      return {
        schemaReady: true,
        validate_only: true,
        shop_ref: shopRef(shop.id),
        page_ref: input.pageId ? pageRef(input.pageId) : '',
        credential_type: input.credentialType,
        credential_type_allowed: credentialTypeAllowed,
        credential_master_key_configured: masterKeyConfigured,
        token_accepted: false,
        health_check: false,
        messenger_send: false,
        readiness_impact: createReadinessImpact(shop)
      };
    });
  }

  return {
    previewCredentialPrerequisites,
    previewPageMapping
  };
}

module.exports = {
  META_NUMERIC_PAGE_ID_PATTERN,
  PAGE_NAME_MAX_LENGTH,
  PAGE_SETUP_PREVIEW_ACTIONS,
  PREVIEW_CREDENTIAL_TYPE,
  READINESS_BLOCKERS_REMAINING,
  TOKEN_FIELD_NAMES,
  assertPageSetupDirectWriteAllowed,
  createPageSetupPreviewError,
  createPageSetupPreviewRepository,
  createPostgresPageSetupPreviewService,
  isCredentialTokenFieldName,
  isDemoShopSetupPreviewOnly,
  isMissingPageSetupPreviewSchemaError: isMissingMultiShopSchemaError,
  isPageSetupPreviewAllowed,
  normalizeCredentialPreviewInput,
  normalizePageMappingPreviewInput
};

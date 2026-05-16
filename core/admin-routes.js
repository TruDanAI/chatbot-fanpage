const {
  PERMISSIONS,
  getAdminBearerToken,
  getAdminRequestToken
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
const {
  presentAssetWriteApi,
  presentPageCredentialWriteApi,
  presentPageMappingWriteApi,
  presentProductWriteApi,
  presentShopSettingsWriteApi,
  presentShopWriteApi
} = require('./admin/api-presenter');
const {
  INTERNAL_NOTE_ACTION,
  INTERNAL_NOTE_RESOURCE_TYPE,
  createPostgresInternalNoteService
} = require('./admin/internal-notes');
const {
  createPostgresAssetWriteService,
  isMissingAssetWriteSchemaError
} = require('./admin/asset-writes');
const {
  createPostgresProductWriteService,
  isMissingProductWriteSchemaError
} = require('./admin/product-writes');
const {
  createPostgresPageCredentialWriteService,
  isMissingPageCredentialWriteSchemaError
} = require('./admin/page-credential-writes');
const {
  createPostgresPageMappingWriteService,
  isMissingPageMappingWriteSchemaError
} = require('./admin/page-mapping-writes');
const {
  createPostgresShopSettingsWriteService,
  isMissingShopSettingsWriteSchemaError
} = require('./admin/shop-settings-writes');
const {
  createPostgresShopWriteService,
  isMissingShopWriteSchemaError
} = require('./admin/shop-writes');
const { createAdminLegacyHandlers } = require('./admin/legacy-routes');
const {
  assertReadOnlySql,
  createPostgresDashboardReader
} = require('./admin/reader');
const { createAdminReadHandlers } = require('./admin/read-routes');
const {
  createAdminRouteAuthorizer,
  parseAdminRoles
} = require('./admin/route-auth');
const {
  createAdminLoginRateLimiter,
  createAdminSessionHandlers,
  createAdminSessionManager
} = require('./admin/session');
const {
  maskAddress,
  maskPhone,
  renderShopCreateHtml
} = require('./admin/views');

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function isRotateCredentialRequest(body = {}) {
  return /^(1|true|yes|on|rotate)$/i.test(String(body?.rotate || body?.mode || '').trim());
}

function setResponseHeader(res, name, value) {
  if (typeof res?.set === 'function') return res.set(name, value);
  if (typeof res?.setHeader === 'function') return res.setHeader(name, value);
  if (res?.headers) res.headers[String(name).toLowerCase()] = value;
  return undefined;
}

function setAdminNoStoreHeaders(_req, res, next) {
  setResponseHeader(res, 'Cache-Control', 'no-store');
  setResponseHeader(res, 'Pragma', 'no-cache');
  setResponseHeader(res, 'Expires', '0');
  setResponseHeader(res, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(res, 'Referrer-Policy', 'no-referrer');
  if (typeof next === 'function') return next();
  return undefined;
}

function getRequestHeader(req, name) {
  return String(req?.get?.(name) || '');
}

function getRequestIp(req, getClientIp) {
  if (typeof getClientIp === 'function') return getClientIp(req);
  return String(req?.ip || req?.socket?.remoteAddress || '');
}

function buildInternalNoteRequestContext(req, getClientIp) {
  return {
    requestId: getRequestHeader(req, 'x-request-id') || getRequestHeader(req, 'x-correlation-id'),
    ip: getRequestIp(req, getClientIp),
    userAgent: getRequestHeader(req, 'user-agent')
  };
}

function isMissingInternalNotesSchemaError(err) {
  return err?.code === '42P01' || err?.code === '42703';
}

function presentInternalNoteCreateApi(note = {}) {
  const bodyLength = Number(note.bodyLength || 0);
  return {
    ok: true,
    schemaReady: true,
    note: {
      id: note.id != null ? String(note.id) : '',
      target_type: note.targetType || '',
      target_id: note.targetId || '',
      status: note.status || '',
      created_by: note.createdBy || '',
      created_at: note.createdAt ? String(note.createdAt) : '',
      body_length: Number.isFinite(bodyLength) ? bodyLength : 0
    }
  };
}

function presentInternalNoteCreateError(err) {
  if (isMissingInternalNotesSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'internal_notes_schema_not_ready',
        message: 'Internal notes schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  if (code === 'invalid_target_type' || code === 'target_id_required') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'invalid_internal_note_target',
        message: 'Internal note target is invalid.'
      }
    };
  }
  if (code === 'body_required') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'invalid_internal_note_body',
        message: 'Internal note body is required.'
      }
    };
  }
  if (code === 'body_too_long') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'invalid_internal_note_body',
        message: 'Internal note body is too long.'
      }
    };
  }
  if (code === 'created_by_required') {
    return {
      statusCode: 500,
      body: {
        ok: false,
        schemaReady: true,
        error: 'internal_note_actor_unresolved',
        message: 'Internal note actor could not be resolved.'
      }
    };
  }
  if (code === 'permission_denied') {
    return {
      statusCode: 403,
      body: {
        ok: false,
        schemaReady: true,
        error: 'permission_denied',
        message: 'Internal note write permission is required.'
      }
    };
  }
  if (code === 'database_url_required') {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: true,
        error: 'internal_notes_unavailable',
        message: 'Internal notes are unavailable.'
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'internal_note_create_failed',
      message: 'Internal note could not be created.'
    }
  };
}

function presentInternalNoteCreateTextError(err) {
  const response = presentInternalNoteCreateError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Internal note could not be created.'
  };
}

function presentProductWriteError(err) {
  if (isMissingProductWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_product_code: ['invalid_product_input', 'Product code is required.', 400],
    invalid_product_name: ['invalid_product_input', 'Product name is required.', 400],
    invalid_product_status: ['invalid_product_input', 'Product status is invalid.', 400],
    duplicate_product_code: ['duplicate_product_code', 'Product code already exists in this shop.', 409],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    product_not_found: ['product_not_found', 'Product was not found.', 404],
    permission_denied: ['permission_denied', 'Product write permission is required.', 403],
    database_url_required: ['product_write_unavailable', 'Product writes are unavailable.', 503],
    product_commit_failed: ['product_commit_failed', 'Product write could not be committed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'product_write_failed',
      message: 'Product write could not be completed.'
    }
  };
}

function presentProductWriteTextError(err) {
  const response = presentProductWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Product write could not be completed.'
  };
}

function presentShopSettingsWriteError(err) {
  if (isMissingShopSettingsWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_bot_mode: ['invalid_bot_mode', 'Bot mode is invalid.', 400],
    setting_text_too_long: ['invalid_shop_settings_input', 'Shop settings text is too long.', 400],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    permission_denied: ['permission_denied', 'Shop settings write permission is required.', 403],
    database_url_required: ['shop_settings_write_unavailable', 'Shop settings writes are unavailable.', 503],
    settings_commit_failed: ['settings_commit_failed', 'Shop settings write could not be committed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'shop_settings_write_failed',
      message: 'Shop settings write could not be completed.'
    }
  };
}

function presentShopSettingsWriteTextError(err) {
  const response = presentShopSettingsWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Shop settings write could not be completed.'
  };
}

function presentShopWriteError(err) {
  if (isMissingShopWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_shop_id: ['invalid_shop_input', 'Shop id/slug is invalid.', 400],
    invalid_shop_name: ['invalid_shop_input', 'Display name is required.', 400],
    invalid_shop_status: ['invalid_shop_status', 'Shop status is invalid.', 400],
    invalid_shop_locale: ['invalid_shop_input', 'Shop locale is invalid.', 400],
    invalid_shop_timezone: ['invalid_shop_input', 'Shop timezone is invalid.', 400],
    invalid_bot_mode: ['invalid_bot_mode', 'Bot mode is invalid.', 400],
    duplicate_shop: ['duplicate_shop', 'Shop id/slug already exists.', 409],
    permission_denied: ['permission_denied', 'Shop write permission is required.', 403],
    database_url_required: ['shop_write_unavailable', 'Shop writes are unavailable.', 503],
    shop_create_commit_failed: ['shop_create_commit_failed', 'Shop create could not be committed.', 500],
    shop_persist_failed: ['shop_create_failed', 'Shop could not be created.', 500],
    shop_settings_persist_failed: ['shop_create_failed', 'Default shop settings could not be created.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'shop_write_failed',
      message: 'Shop write could not be completed.'
    }
  };
}

function presentShopWriteTextError(err) {
  const response = presentShopWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Shop write could not be completed.'
  };
}

function presentPageMappingWriteError(err) {
  if (isMissingPageMappingWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_page_id: ['invalid_page_id', 'Page id is invalid.', 400],
    invalid_page_mapping_status: ['invalid_page_mapping_status', 'Page mapping status is invalid.', 400],
    duplicate_active_page_id: ['duplicate_active_page_id', 'Page id already has an active mapping.', 409],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    permission_denied: ['permission_denied', 'Page mapping write permission is required.', 403],
    database_url_required: ['page_mapping_write_unavailable', 'Page mapping writes are unavailable.', 503],
    page_mapping_commit_failed: ['page_mapping_commit_failed', 'Page mapping write could not be committed.', 500],
    page_mapping_persist_failed: ['page_mapping_create_failed', 'Page mapping could not be created.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'page_mapping_write_failed',
      message: 'Page mapping write could not be completed.'
    }
  };
}

function presentPageMappingWriteTextError(err) {
  const response = presentPageMappingWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Page mapping write could not be completed.'
  };
}

function presentPageCredentialWriteError(err) {
  if (isMissingPageCredentialWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    unsupported_credential_type: ['unsupported_credential_type', 'Credential type is not supported.', 400],
    credential_token_missing: ['credential_token_missing', 'Credential token is required.', 400],
    credential_token_invalid: ['credential_token_invalid', 'Credential token is invalid.', 400],
    credential_master_key_missing: ['credential_write_unavailable', 'Credential writes are unavailable.', 503],
    active_credential_exists: ['active_credential_exists', 'An active credential already exists. Use rotate mode to replace it.', 409],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    page_mapping_not_found: ['page_mapping_not_found', 'Page mapping was not found for this shop.', 404],
    permission_denied: ['permission_denied', 'Page credential write permission is required.', 403],
    database_url_required: ['credential_write_unavailable', 'Credential writes are unavailable.', 503],
    page_credential_commit_failed: ['page_credential_commit_failed', 'Page credential write could not be committed.', 500],
    page_credential_persist_failed: ['page_credential_write_failed', 'Page credential could not be saved.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'page_credential_write_failed',
      message: 'Page credential write could not be completed.'
    }
  };
}

function presentPageCredentialWriteTextError(err) {
  const response = presentPageCredentialWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Page credential write could not be completed.'
  };
}

function presentAssetWriteError(err) {
  if (isMissingAssetWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_asset_type: ['invalid_asset_input', 'Asset type is invalid.', 400],
    invalid_asset_status: ['invalid_asset_input', 'Asset status is invalid.', 400],
    public_url_required: ['invalid_public_url', 'Public URL is required.', 400],
    public_url_too_long: ['invalid_public_url', 'Public URL is too long.', 400],
    invalid_public_url: ['invalid_public_url', 'Public URL is invalid.', 400],
    product_id_required: ['product_id_required', 'Product image requires product_id.', 400],
    product_not_found: ['product_not_found', 'Product was not found for this shop.', 404],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    asset_not_found: ['asset_not_found', 'Asset was not found.', 404],
    permission_denied: ['permission_denied', 'Asset write permission is required.', 403],
    database_url_required: ['asset_write_unavailable', 'Asset writes are unavailable.', 503],
    asset_commit_failed: ['asset_commit_failed', 'Asset write could not be committed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'asset_write_failed',
      message: 'Asset write could not be completed.'
    }
  };
}

function presentAssetWriteTextError(err) {
  const response = presentAssetWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Asset write could not be completed.'
  };
}

function registerAdminRoutes(app, {
  storage,
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp,
  dashboardReader,
  internalNoteService,
  assetWriteService,
  pageCredentialWriteService,
  pageMappingWriteService,
  productWriteService,
  shopSettingsWriteService,
  shopWriteService,
  dashboardDatabaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.TENANT_ID || 'default',
  pageId = process.env.PAGE_ID || '',
  adminPrincipalId = process.env.ADMIN_PRINCIPAL_ID || 'legacy-admin',
  adminPrincipalDisplayName = process.env.ADMIN_PRINCIPAL_DISPLAY_NAME || '',
  adminPrincipalRoles = parseAdminRoles(process.env.ADMIN_ROLES || 'owner'),
  adminPrincipalPermissions = [],
  adminSessionManager,
  adminSessionSecret = process.env.SESSION_SECRET || '',
  adminSessionCookieName = process.env.ADMIN_SESSION_COOKIE_NAME || 'chatbot_admin_session',
  adminPublicBaseUrl = process.env.ADMIN_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '',
  adminSessionTtlMs = parsePositiveInteger(process.env.ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000),
  adminLoginRateLimiter,
  adminLoginRateLimitWindowMs = parsePositiveInteger(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
  adminLoginRateLimitMax = parsePositiveInteger(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX, 10),
  auditLogger,
  adminAuditLogEnabled = process.env.ADMIN_AUDIT_LOG_ENABLED === 'true',
  adminAuditFailClosed = false
}) {
  const reader = dashboardReader || createPostgresDashboardReader({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });
  const audit = auditLogger || createPostgresAuditLogger({
    enabled: adminAuditLogEnabled,
    databaseUrl: dashboardDatabaseUrl
  });
  const notes = internalNoteService || createPostgresInternalNoteService({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });
  const assetWrites = assetWriteService || createPostgresAssetWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const pageCredentialWrites = pageCredentialWriteService || createPostgresPageCredentialWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const pageMappingWrites = pageMappingWriteService || createPostgresPageMappingWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const productWrites = productWriteService || createPostgresProductWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopSettingsWrites = shopSettingsWriteService || createPostgresShopSettingsWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopWrites = shopWriteService || createPostgresShopWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const sessionManager = adminSessionManager || createAdminSessionManager({
    sessionSecret: adminSessionSecret,
    cookieName: adminSessionCookieName,
    publicBaseUrl: adminPublicBaseUrl,
    nodeEnv: process.env.NODE_ENV || '',
    ttlMs: adminSessionTtlMs
  });
  const loginRateLimiter = adminLoginRateLimiter || createAdminLoginRateLimiter({
    windowMs: adminLoginRateLimitWindowMs,
    max: adminLoginRateLimitMax,
    getClientIp
  });
  const {
    authorizeAdminRequest,
    recordAdminAudit,
    requireAdminBearerToken,
    requireAdminToken
  } = createAdminRouteAuthorizer({
    adminExportToken,
    adminIpAllowlist,
    getClientIp,
    tenantId,
    pageId,
    adminPrincipalId,
    adminPrincipalDisplayName,
    adminPrincipalRoles,
    adminPrincipalPermissions,
    sessionManager,
    auditLogger: audit,
    adminAuditFailClosed
  });
  const {
    sendLoginForm,
    submitLogin,
    submitLogout
  } = createAdminSessionHandlers({
    sessionManager,
    adminExportToken,
    tenantId,
    pageId,
    adminPrincipalId,
    adminPrincipalDisplayName,
    adminPrincipalRoles,
    adminPrincipalPermissions,
    loginRateLimiter,
    recordAdminAudit
  });
  const {
    sendAuditLog,
    sendAuditLogApi,
    sendDashboard,
    sendDashboardApi,
    sendInternalNotesApi,
    sendShopDetail,
    sendShopDetailApi,
    sendShopHealthApi,
    sendShopSettingsApi,
    sendShops,
    sendShopsApi,
    sendUserDetail,
    sendUserDetailApi
  } = createAdminReadHandlers({
    reader,
    internalNoteService: notes,
    tenantId,
    pageId,
    authorizeAdminRequest,
    recordAdminAudit
  });
  const {
    sendCustomersCsv,
    sendEventsJsonl,
    sendLegacyState
  } = createAdminLegacyHandlers({
    storage,
    authorizeAdminRequest,
    recordAdminAudit
  });

  async function createInternalNoteApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.INTERNAL_NOTE_WRITE,
      bearerOnly: true,
      action: INTERNAL_NOTE_ACTION,
      resourceType: INTERNAL_NOTE_RESOURCE_TYPE
    });
    if (!principal) return;

    const body = req.body || {};
    try {
      const note = await notes.createNote({
        principal,
        targetType: body.target_type,
        targetId: body.target_id,
        body: body.body,
        requestContext: buildInternalNoteRequestContext(req, getClientIp)
      });
      return res.status(201).json(presentInternalNoteCreateApi(note));
    } catch (err) {
      const response = presentInternalNoteCreateError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createInternalNoteHtml(req, res) {
    const senderId = String(req.params.senderId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.INTERNAL_NOTE_WRITE,
      bearerOnly: true,
      action: INTERNAL_NOTE_ACTION,
      resourceType: INTERNAL_NOTE_RESOURCE_TYPE,
      resourceId: senderId
    });
    if (!principal) return;

    const body = req.body || {};
    try {
      await notes.createNote({
        principal,
        targetType: body.target_type,
        targetId: senderId,
        body: body.body,
        allowedTargetTypes: ['customer', 'conversation'],
        requestContext: buildInternalNoteRequestContext(req, getClientIp)
      });
      return res.redirect(303, `/admin/dashboard/users/${encodeURIComponent(senderId)}`);
    } catch (err) {
      const response = presentInternalNoteCreateTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  function buildProductWriteRequestContext(req) {
    return buildInternalNoteRequestContext(req, getClientIp);
  }

  async function sendNewShopForm(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.create.form',
      resourceType: 'shop'
    });
    if (!principal) return;
    return res.type('html').send(renderShopCreateHtml());
  }

  async function createShopApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.create',
      resourceType: 'shop'
    });
    if (!principal) return;
    try {
      const result = await shopWrites.createShop({
        principal,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentShopWriteApi(result));
    } catch (err) {
      const response = presentShopWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createShopHtml(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.create',
      resourceType: 'shop'
    });
    if (!principal) return;
    try {
      const result = await shopWrites.createShop({
        principal,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, `/admin/shops/${encodeURIComponent(result.shopId)}`);
    } catch (err) {
      const response = presentShopWriteTextError(err);
      return res.status(response.statusCode).type('html').send(renderShopCreateHtml({
        values: req.body || {},
        error: response.text
      }));
    }
  }

  function shopProductRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?productMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  function shopPageMappingRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?pageMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  function shopPageCredentialRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?credentialMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  async function createPageMappingApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_page.create',
      resourceType: 'shop_page',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await pageMappingWrites.createPageMapping({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentPageMappingWriteApi(result));
    } catch (err) {
      const response = presentPageMappingWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createPageMappingHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_page.create',
      resourceType: 'shop_page',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await pageMappingWrites.createPageMapping({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopPageMappingRedirect(shopId, 'created'));
    } catch (err) {
      const response = presentPageMappingWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function createPageCredentialApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const pageMappingId = String(req.params.pageMappingId || '').trim().slice(0, 160);
    const action = isRotateCredentialRequest(req.body || {})
      ? 'admin.shop_page_credential.rotate'
      : 'admin.shop_page_credential.create';
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action,
      resourceType: 'shop_page_credential',
      resourceId: pageMappingId
    });
    if (!principal) return;
    try {
      const result = await pageCredentialWrites.createPageCredential({
        principal,
        shopId,
        pageMappingId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentPageCredentialWriteApi(result));
    } catch (err) {
      const response = presentPageCredentialWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createPageCredentialHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const pageMappingId = String(req.params.pageMappingId || '').trim().slice(0, 160);
    const action = isRotateCredentialRequest(req.body || {})
      ? 'admin.shop_page_credential.rotate'
      : 'admin.shop_page_credential.create';
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action,
      resourceType: 'shop_page_credential',
      resourceId: pageMappingId
    });
    if (!principal) return;
    try {
      const result = await pageCredentialWrites.createPageCredential({
        principal,
        shopId,
        pageMappingId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopPageCredentialRedirect(shopId, result.rotated ? 'rotated' : 'created'));
    } catch (err) {
      const response = presentPageCredentialWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function createProductApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.create',
      resourceType: 'shop_product',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await productWrites.createProduct({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateProductApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.update',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const result = await productWrites.updateProduct({
        principal,
        shopId,
        productId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function setProductStatusApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.status',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const body = req.body || {};
      const enabled = Object.prototype.hasOwnProperty.call(body, 'enabled')
        ? /^(1|true|yes|on|active|enabled)$/i.test(String(body.enabled || '').trim())
        : /^(active|enable|enabled)$/i.test(String(body.status || '').trim());
      const result = await productWrites.setProductEnabled({
        principal,
        shopId,
        productId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function archiveProductApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.archive',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const result = await productWrites.archiveProduct({
        principal,
        shopId,
        productId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateShopSettingsApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_settings.update',
      resourceType: 'shop_settings',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopSettingsWrites.updateSettings({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopSettingsWriteApi(result));
    } catch (err) {
      const response = presentShopSettingsWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createAssetApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.create',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.createAsset({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateAssetApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.update',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.updateAsset({
        principal,
        shopId,
        assetId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function setAssetStatusApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.status',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const body = req.body || {};
      const enabled = Object.prototype.hasOwnProperty.call(body, 'enabled')
        ? /^(1|true|yes|on|active|enabled)$/i.test(String(body.enabled || '').trim())
        : /^(active|enable|enabled)$/i.test(String(body.status || '').trim());
      const result = await assetWrites.setAssetEnabled({
        principal,
        shopId,
        assetId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function archiveAssetApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.archive',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.archiveAsset({
        principal,
        shopId,
        assetId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createProductHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.create',
      resourceType: 'shop_product',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await productWrites.createProduct({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'created'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function updateProductHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.update',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      await productWrites.updateProduct({
        principal,
        shopId,
        productId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'updated'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function setProductStatusHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.status',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const enabled = /^(1|true|yes|on|active|enabled)$/i.test(String(req.body?.enabled || '').trim());
      await productWrites.setProductEnabled({
        principal,
        shopId,
        productId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, enabled ? 'enabled' : 'disabled'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function archiveProductHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.archive',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      await productWrites.archiveProduct({
        principal,
        shopId,
        productId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'archived'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  function shopAssetRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?assetMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  async function createAssetHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.create',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await assetWrites.createAsset({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'created'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function updateAssetHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.update',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      await assetWrites.updateAsset({
        principal,
        shopId,
        assetId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'updated'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function setAssetStatusHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.status',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const enabled = /^(1|true|yes|on|active|enabled)$/i.test(String(req.body?.enabled || '').trim());
      await assetWrites.setAssetEnabled({
        principal,
        shopId,
        assetId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, enabled ? 'enabled' : 'disabled'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function archiveAssetHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.archive',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      await assetWrites.archiveAsset({
        principal,
        shopId,
        assetId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'archived'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function updateShopSettingsHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_settings.update',
      resourceType: 'shop_settings',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopSettingsWrites.updateSettings({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'settings-updated'));
    } catch (err) {
      const response = presentShopSettingsWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  if (typeof app.use === 'function') {
    app.use('/admin', setAdminNoStoreHeaders);
  }

  app.get('/admin/login', sendLoginForm);
  app.post('/admin/login', submitLogin);
  app.post('/admin/logout', submitLogout);
  app.get('/admin/api/dashboard', sendDashboardApi);
  app.get('/admin/api/dashboard/users/:senderId', sendUserDetailApi);
  app.get('/admin/api/shops', sendShopsApi);
  app.post('/admin/api/shops', createShopApi);
  app.get('/admin/api/shops/:shopId', sendShopDetailApi);
  app.get('/admin/api/shops/:shopId/health', sendShopHealthApi);
  app.get('/admin/api/shops/:shopId/settings', sendShopSettingsApi);
  app.post('/admin/api/shops/:shopId/pages', createPageMappingApi);
  app.post('/admin/api/shops/:shopId/pages/:pageMappingId/credentials', createPageCredentialApi);
  app.post('/admin/api/shops/:shopId/products', createProductApi);
  app.post('/admin/api/shops/:shopId/assets', createAssetApi);
  app.post('/admin/api/shops/:shopId/settings', updateShopSettingsApi);
  if (typeof app.patch === 'function') {
    app.patch('/admin/api/shops/:shopId/settings', updateShopSettingsApi);
    app.patch('/admin/api/shops/:shopId/products/:productId', updateProductApi);
    app.patch('/admin/api/shops/:shopId/products/:productId/status', setProductStatusApi);
    app.patch('/admin/api/shops/:shopId/assets/:assetId', updateAssetApi);
    app.patch('/admin/api/shops/:shopId/assets/:assetId/status', setAssetStatusApi);
  }
  app.post('/admin/api/shops/:shopId/products/:productId/status', setProductStatusApi);
  app.post('/admin/api/shops/:shopId/assets/:assetId/status', setAssetStatusApi);
  if (typeof app.delete === 'function') {
    app.delete('/admin/api/shops/:shopId/products/:productId', archiveProductApi);
    app.delete('/admin/api/shops/:shopId/assets/:assetId', archiveAssetApi);
  }
  app.get('/admin/api/audit', sendAuditLogApi);
  app.get('/admin/api/internal-notes', sendInternalNotesApi);
  app.post('/admin/api/internal-notes', createInternalNoteApi);
  app.get('/admin/dashboard', sendDashboard);
  app.get('/admin/db', sendDashboard);
  app.get('/admin/dashboard/users/:senderId', sendUserDetail);
  app.get('/admin/shops', sendShops);
  app.get('/admin/shops/new', sendNewShopForm);
  app.post('/admin/shops', createShopHtml);
  app.get('/admin/shops/:shopId', sendShopDetail);
  app.post('/admin/shops/:shopId/pages', createPageMappingHtml);
  app.post('/admin/shops/:shopId/pages/:pageMappingId/credentials', createPageCredentialHtml);
  app.post('/admin/shops/:shopId/settings', updateShopSettingsHtml);
  app.post('/admin/shops/:shopId/products', createProductHtml);
  app.post('/admin/shops/:shopId/products/:productId', updateProductHtml);
  app.post('/admin/shops/:shopId/products/:productId/status', setProductStatusHtml);
  app.post('/admin/shops/:shopId/products/:productId/archive', archiveProductHtml);
  app.post('/admin/shops/:shopId/assets', createAssetHtml);
  app.post('/admin/shops/:shopId/assets/:assetId', updateAssetHtml);
  app.post('/admin/shops/:shopId/assets/:assetId/status', setAssetStatusHtml);
  app.post('/admin/shops/:shopId/assets/:assetId/archive', archiveAssetHtml);
  app.post('/admin/dashboard/users/:senderId/notes', createInternalNoteHtml);
  app.get('/admin/db/users/:senderId', sendUserDetail);
  app.get('/admin/audit', sendAuditLog);
  app.get('/admin/customers.csv', sendCustomersCsv);
  app.get('/admin/events.jsonl', sendEventsJsonl);
  app.get('/admin/state/:userId', sendLegacyState);

  return {
    authorizeAdminRequest,
    sessionManager,
    requireAdminToken,
    requireAdminBearerToken
  };
}

module.exports = {
  assertReadOnlySql,
  createAdminLegacyHandlers,
  createAdminLoginRateLimiter,
  createAdminReadHandlers,
  createPostgresAuditLogger,
  createPostgresAssetWriteService,
  createPostgresDashboardReader,
  createPostgresPageCredentialWriteService,
  createPostgresPageMappingWriteService,
  createPostgresProductWriteService,
  createPostgresShopSettingsWriteService,
  createPostgresShopWriteService,
  createAdminRouteAuthorizer,
  createAdminSessionHandlers,
  createAdminSessionManager,
  getAdminBearerToken,
  getAdminRequestToken,
  maskAddress,
  maskPhone,
  parseAdminRoles,
  registerAdminRoutes,
  setAdminNoStoreHeaders
};

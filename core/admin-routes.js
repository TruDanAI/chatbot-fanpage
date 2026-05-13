const {
  PERMISSIONS,
  getAdminBearerToken,
  getAdminRequestToken
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
const {
  presentProductWriteApi
} = require('./admin/api-presenter');
const {
  INTERNAL_NOTE_ACTION,
  INTERNAL_NOTE_RESOURCE_TYPE,
  createPostgresInternalNoteService
} = require('./admin/internal-notes');
const {
  createPostgresProductWriteService,
  isMissingProductWriteSchemaError
} = require('./admin/product-writes');
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
  maskPhone
} = require('./admin/views');

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
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

function registerAdminRoutes(app, {
  storage,
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp,
  dashboardReader,
  internalNoteService,
  productWriteService,
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
  const productWrites = productWriteService || createPostgresProductWriteService({
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
      return res.redirect(303, `/admin/shops/${encodeURIComponent(shopId)}`);
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
      return res.redirect(303, `/admin/shops/${encodeURIComponent(shopId)}`);
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
      await productWrites.setProductEnabled({
        principal,
        shopId,
        productId,
        enabled: /^(1|true|yes|on|active|enabled)$/i.test(String(req.body?.enabled || '').trim()),
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, `/admin/shops/${encodeURIComponent(shopId)}`);
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
      return res.redirect(303, `/admin/shops/${encodeURIComponent(shopId)}`);
    } catch (err) {
      const response = presentProductWriteTextError(err);
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
  app.get('/admin/api/shops/:shopId', sendShopDetailApi);
  app.post('/admin/api/shops/:shopId/products', createProductApi);
  if (typeof app.patch === 'function') {
    app.patch('/admin/api/shops/:shopId/products/:productId', updateProductApi);
    app.patch('/admin/api/shops/:shopId/products/:productId/status', setProductStatusApi);
  }
  app.post('/admin/api/shops/:shopId/products/:productId/status', setProductStatusApi);
  if (typeof app.delete === 'function') {
    app.delete('/admin/api/shops/:shopId/products/:productId', archiveProductApi);
  }
  app.get('/admin/api/audit', sendAuditLogApi);
  app.get('/admin/api/internal-notes', sendInternalNotesApi);
  app.post('/admin/api/internal-notes', createInternalNoteApi);
  app.get('/admin/dashboard', sendDashboard);
  app.get('/admin/db', sendDashboard);
  app.get('/admin/dashboard/users/:senderId', sendUserDetail);
  app.get('/admin/shops', sendShops);
  app.get('/admin/shops/:shopId', sendShopDetail);
  app.post('/admin/shops/:shopId/products', createProductHtml);
  app.post('/admin/shops/:shopId/products/:productId', updateProductHtml);
  app.post('/admin/shops/:shopId/products/:productId/status', setProductStatusHtml);
  app.post('/admin/shops/:shopId/products/:productId/archive', archiveProductHtml);
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
  createPostgresDashboardReader,
  createPostgresProductWriteService,
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

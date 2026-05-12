const {
  PERMISSIONS,
  getAdminBearerToken,
  getAdminRequestToken
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
const {
  INTERNAL_NOTE_ACTION,
  INTERNAL_NOTE_RESOURCE_TYPE,
  createPostgresInternalNoteService
} = require('./admin/internal-notes');
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

function registerAdminRoutes(app, {
  storage,
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp,
  dashboardReader,
  internalNoteService,
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

  if (typeof app.use === 'function') {
    app.use('/admin', setAdminNoStoreHeaders);
  }

  app.get('/admin/login', sendLoginForm);
  app.post('/admin/login', submitLogin);
  app.post('/admin/logout', submitLogout);
  app.get('/admin/api/dashboard', sendDashboardApi);
  app.get('/admin/api/dashboard/users/:senderId', sendUserDetailApi);
  app.get('/admin/api/audit', sendAuditLogApi);
  app.get('/admin/api/internal-notes', sendInternalNotesApi);
  app.post('/admin/api/internal-notes', createInternalNoteApi);
  app.get('/admin/dashboard', sendDashboard);
  app.get('/admin/db', sendDashboard);
  app.get('/admin/dashboard/users/:senderId', sendUserDetail);
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

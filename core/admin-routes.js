const {
  getAdminBearerToken,
  getAdminRequestToken
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
const { createPostgresInternalNoteService } = require('./admin/internal-notes');
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

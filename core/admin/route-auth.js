const {
  PERMISSIONS,
  authenticateStaticBearer,
  authenticateStaticRequestToken,
  buildAuditLogEntry,
  requirePermission
} = require('../admin-auth');

function normalizeFilterText(value = '', max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseAdminRoles(value = 'owner') {
  const list = Array.isArray(value)
    ? value
    : String(value || 'owner').split(',');
  const roles = list
    .map(role => normalizeFilterText(role, 60).toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean);
  return roles.length ? roles : ['owner'];
}

function createAdminRouteAuthorizer({
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp,
  tenantId = 'default',
  pageId = '',
  adminPrincipalId = 'legacy-admin',
  adminPrincipalDisplayName = '',
  adminPrincipalRoles = ['owner'],
  adminPrincipalPermissions = [],
  auditLogger,
  adminAuditFailClosed = false
} = {}) {
  function getRequestHeader(req, name) {
    return String(req?.get?.(name) || '');
  }

  function getRequestId(req) {
    return getRequestHeader(req, 'x-request-id') || getRequestHeader(req, 'x-correlation-id');
  }

  function getRequestIp(req) {
    if (typeof getClientIp === 'function') return getClientIp(req);
    return String(req?.ip || req?.socket?.remoteAddress || '');
  }

  function isAdminIpAllowed(req) {
    if (!adminIpAllowlist.length) return true;
    return adminIpAllowlist.includes(getRequestIp(req));
  }

  function authOptions() {
    return {
      token: adminExportToken,
      principalId: adminPrincipalId,
      displayName: adminPrincipalDisplayName,
      roles: adminPrincipalRoles,
      permissions: adminPrincipalPermissions,
      tenantId,
      pageId
    };
  }

  async function recordAdminAudit(req, {
    principal,
    action,
    resourceType,
    resourceId = '',
    outcome,
    metadata = {}
  }) {
    if (!auditLogger || typeof auditLogger.record !== 'function') return null;
    const entry = buildAuditLogEntry({
      principal,
      action,
      resourceType,
      resourceId,
      outcome,
      requestId: getRequestId(req),
      ip: getRequestIp(req),
      userAgent: getRequestHeader(req, 'user-agent'),
      metadata
    });
    try {
      await auditLogger.record(entry);
    } catch (err) {
      if (adminAuditFailClosed) throw err;
    }
    return entry;
  }

  async function authorizeAdminRequest(req, res, {
    permission,
    bearerOnly = false,
    action = permission,
    resourceType = 'admin',
    resourceId = ''
  } = {}) {
    if (!isAdminIpAllowed(req)) {
      await recordAdminAudit(req, {
        principal: null,
        action,
        resourceType,
        resourceId,
        outcome: 'denied',
        metadata: { reason: 'ip_not_allowed' }
      });
      res.sendStatus(403);
      return null;
    }

    const auth = bearerOnly
      ? authenticateStaticBearer(req, authOptions())
      : authenticateStaticRequestToken(req, authOptions());
    if (!auth.ok) {
      await recordAdminAudit(req, {
        principal: null,
        action,
        resourceType,
        resourceId,
        outcome: 'denied',
        metadata: { reason: auth.reason, bearerOnly }
      });
      if (auth.statusCode === 503) {
        res.status(503).send('ADMIN_EXPORT_TOKEN chưa được cấu hình.');
      } else {
        res.sendStatus(auth.statusCode || 401);
      }
      return null;
    }

    const decision = requirePermission(auth.principal, permission);
    if (!decision.ok) {
      await recordAdminAudit(req, {
        principal: auth.principal,
        action,
        resourceType,
        resourceId,
        outcome: 'denied',
        metadata: { reason: decision.reason, permission: decision.permission }
      });
      res.sendStatus(decision.statusCode || 403);
      return null;
    }

    return auth.principal;
  }

  async function requireAdminToken(req, res) {
    return Boolean(await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.EXPORT_READ,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'legacy_admin'
    }));
  }

  async function requireAdminBearerToken(req, res) {
    return Boolean(await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: PERMISSIONS.DASHBOARD_READ,
      resourceType: 'dashboard'
    }));
  }

  return {
    authorizeAdminRequest,
    recordAdminAudit,
    requireAdminBearerToken,
    requireAdminToken
  };
}

module.exports = {
  createAdminRouteAuthorizer,
  parseAdminRoles
};

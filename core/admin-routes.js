const fs = require('fs');
const {
  PERMISSIONS,
  authenticateStaticBearer,
  authenticateStaticRequestToken,
  buildAuditLogEntry,
  getAdminBearerToken,
  getAdminRequestToken,
  requirePermission
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
const {
  assertReadOnlySql,
  createPostgresDashboardReader,
  normalizeDashboardFilters
} = require('./admin/reader');
const {
  maskAddress,
  maskPhone,
  renderAuditHtml,
  renderDashboardHtml,
  renderUserDetailHtml
} = require('./admin/views');

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

function registerAdminRoutes(app, {
  storage,
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp,
  dashboardReader,
  dashboardDatabaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.TENANT_ID || 'default',
  pageId = process.env.PAGE_ID || '',
  adminPrincipalId = process.env.ADMIN_PRINCIPAL_ID || 'legacy-admin',
  adminPrincipalDisplayName = process.env.ADMIN_PRINCIPAL_DISPLAY_NAME || '',
  adminPrincipalRoles = parseAdminRoles(process.env.ADMIN_ROLES || 'owner'),
  adminPrincipalPermissions = [],
  auditLogger,
  adminAuditLogEnabled = process.env.ADMIN_AUDIT_LOG_ENABLED === 'true',
  adminAuditFailClosed = false
}) {
  function isAdminIpAllowed(req) {
    if (!adminIpAllowlist.length) return true;
    return adminIpAllowlist.includes(getRequestIp(req));
  }

  const reader = dashboardReader || createPostgresDashboardReader({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });
  const audit = auditLogger || createPostgresAuditLogger({
    enabled: adminAuditLogEnabled,
    databaseUrl: dashboardDatabaseUrl
  });

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
    if (!audit || typeof audit.record !== 'function') return null;
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
      await audit.record(entry);
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

  async function sendDashboard(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: PERMISSIONS.DASHBOARD_READ,
      resourceType: 'dashboard'
    });
    if (!principal) return;
    try {
      const model = await reader.getOverview(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      res.type('html').send(renderDashboardHtml(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      res.status(err.statusCode || 500).send('Không đọc được dashboard.');
    }
  }

  async function sendUserDetail(req, res) {
    const senderId = String(req.params.senderId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.USER_DETAIL_READ,
      bearerOnly: true,
      action: PERMISSIONS.USER_DETAIL_READ,
      resourceType: 'sender',
      resourceId: senderId
    });
    if (!principal) return;
    try {
      const model = await reader.getUserDetail(senderId);
      model.filters = normalizeDashboardFilters(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender',
        resourceId: senderId,
        outcome: 'success'
      });
      res.type('html').send(renderUserDetailHtml(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender',
        resourceId: senderId,
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      res.status(err.statusCode || 500).send('Không đọc được dashboard detail.');
    }
  }

  async function sendAuditLog(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.AUDIT_READ,
      bearerOnly: true,
      action: PERMISSIONS.AUDIT_READ,
      resourceType: 'audit_log'
    });
    if (!principal) return;
    try {
      const model = await reader.getAuditLog(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      res.type('html').send(renderAuditHtml(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      res.status(err.statusCode || 500).send('Không đọc được audit log.');
    }
  }

  app.get('/admin/dashboard', sendDashboard);
  app.get('/admin/db', sendDashboard);
  app.get('/admin/dashboard/users/:senderId', sendUserDetail);
  app.get('/admin/db/users/:senderId', sendUserDetail);
  app.get('/admin/audit', sendAuditLog);

  app.get('/admin/customers.csv', async (req, res) => {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.EXPORT_READ,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'customers.csv'
    });
    if (!principal) return;

    const file = storage.getCustomersFile();
    if (!fs.existsSync(file)) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.EXPORT_READ,
        resourceType: 'file_export',
        resourceId: 'customers.csv',
        outcome: 'error',
        metadata: { statusCode: 404 }
      });
      return res.status(404).send('Chưa có file customers.csv.');
    }

    await recordAdminAudit(req, {
      principal,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'customers.csv',
      outcome: 'success'
    });
    res.download(file, 'customers.csv');
  });

  app.get('/admin/events.jsonl', async (req, res) => {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.EXPORT_READ,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'events.jsonl'
    });
    if (!principal) return;

    const file = storage.getEventsFile();
    if (!fs.existsSync(file)) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.EXPORT_READ,
        resourceType: 'file_export',
        resourceId: 'events.jsonl',
        outcome: 'error',
        metadata: { statusCode: 404 }
      });
      res.status(404).send('Chưa có events.jsonl');
      return;
    }
    await recordAdminAudit(req, {
      principal,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'events.jsonl',
      outcome: 'success'
    });
    res.download(file, 'events.jsonl');
  });

  app.get('/admin/state/:userId', async (req, res) => {
    const userId = req.params.userId;
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.LEGACY_STATE_READ,
      action: PERMISSIONS.LEGACY_STATE_READ,
      resourceType: 'state',
      resourceId: userId
    });
    if (!principal) return;
    const orderDraft = storage.getOrderDraft(userId);
    await recordAdminAudit(req, {
      principal,
      action: PERMISSIONS.LEGACY_STATE_READ,
      resourceType: 'state',
      resourceId: userId,
      outcome: 'success'
    });
    res.json({
      userId,
      inHandoff: storage.inHandoff(userId),
      lastUserAt: storage.getLastUserAt(userId),
      lastProductCode: storage.getLastProductCode(userId),
      orderDraft,
      abandonedCartReminderSentAt: orderDraft.abandonedCartReminderSentAt || '',
      abandonedCartReminderFailedAt: orderDraft.abandonedCartReminderFailedAt || '',
      sessionState: storage.getSessionState(userId),
      historyLength: storage.getHistory(userId).length
    });
  });

  return {
    authorizeAdminRequest,
    requireAdminToken,
    requireAdminBearerToken
  };
}

module.exports = {
  assertReadOnlySql,
  createPostgresAuditLogger,
  createPostgresDashboardReader,
  getAdminBearerToken,
  getAdminRequestToken,
  maskAddress,
  maskPhone,
  registerAdminRoutes
};

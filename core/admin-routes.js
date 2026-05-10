const fs = require('fs');
const {
  PERMISSIONS,
  getAdminBearerToken,
  getAdminRequestToken
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
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
  maskAddress,
  maskPhone
} = require('./admin/views');

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
  const reader = dashboardReader || createPostgresDashboardReader({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });
  const audit = auditLogger || createPostgresAuditLogger({
    enabled: adminAuditLogEnabled,
    databaseUrl: dashboardDatabaseUrl
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
    auditLogger: audit,
    adminAuditFailClosed
  });
  const {
    sendAuditLog,
    sendDashboard,
    sendUserDetail
  } = createAdminReadHandlers({
    reader,
    authorizeAdminRequest,
    recordAdminAudit
  });

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
  createAdminReadHandlers,
  createPostgresAuditLogger,
  createPostgresDashboardReader,
  createAdminRouteAuthorizer,
  getAdminBearerToken,
  getAdminRequestToken,
  maskAddress,
  maskPhone,
  parseAdminRoles,
  registerAdminRoutes
};

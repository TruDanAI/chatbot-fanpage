const { PERMISSIONS } = require('../admin-auth');
const {
  presentAuditApi,
  presentDashboardApi,
  presentUserDetailApi
} = require('./api-presenter');
const { normalizeDashboardFilters } = require('./reader');
const {
  renderAuditHtml,
  renderDashboardHtml,
  renderUserDetailHtml
} = require('./views');

function createAdminReadHandlers({
  reader,
  authorizeAdminRequest,
  recordAdminAudit
} = {}) {
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

  async function sendDashboardApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: PERMISSIONS.DASHBOARD_READ,
      resourceType: 'dashboard_api'
    });
    if (!principal) return;
    try {
      const model = await reader.getOverview(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard_api',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      return res.json(presentDashboardApi(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard_api',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      return res.status(err.statusCode || 500).json({ error: 'dashboard_read_failed' });
    }
  }

  async function sendUserDetailApi(req, res) {
    const senderId = String(req.params.senderId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.USER_DETAIL_READ,
      bearerOnly: true,
      action: PERMISSIONS.USER_DETAIL_READ,
      resourceType: 'sender_api',
      resourceId: senderId
    });
    if (!principal) return;
    try {
      const model = await reader.getUserDetail(senderId);
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender_api',
        resourceId: senderId,
        outcome: 'success'
      });
      return res.json(presentUserDetailApi(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender_api',
        resourceId: senderId,
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      return res.status(err.statusCode || 500).json({ error: 'user_detail_read_failed' });
    }
  }

  async function sendAuditLogApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.AUDIT_READ,
      bearerOnly: true,
      action: PERMISSIONS.AUDIT_READ,
      resourceType: 'audit_log_api'
    });
    if (!principal) return;
    try {
      const model = await reader.getAuditLog(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log_api',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      return res.json(presentAuditApi(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log_api',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      return res.status(err.statusCode || 500).json({ error: 'audit_log_read_failed' });
    }
  }

  return {
    sendAuditLog,
    sendAuditLogApi,
    sendDashboard,
    sendDashboardApi,
    sendUserDetail,
    sendUserDetailApi
  };
}

module.exports = {
  createAdminReadHandlers
};

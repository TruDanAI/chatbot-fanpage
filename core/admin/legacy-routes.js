const fs = require('fs');
const { PERMISSIONS } = require('../admin-auth');

function createAdminLegacyHandlers({
  storage,
  authorizeAdminRequest,
  recordAdminAudit,
  fileExists = fs.existsSync
} = {}) {
  async function sendCustomersCsv(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.EXPORT_READ,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'customers.csv'
    });
    if (!principal) return;

    const file = storage.getCustomersFile();
    if (!fileExists(file)) {
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
    return res.download(file, 'customers.csv');
  }

  async function sendEventsJsonl(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.EXPORT_READ,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'events.jsonl'
    });
    if (!principal) return;

    const file = storage.getEventsFile();
    if (!fileExists(file)) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.EXPORT_READ,
        resourceType: 'file_export',
        resourceId: 'events.jsonl',
        outcome: 'error',
        metadata: { statusCode: 404 }
      });
      return res.status(404).send('Chưa có events.jsonl');
    }

    await recordAdminAudit(req, {
      principal,
      action: PERMISSIONS.EXPORT_READ,
      resourceType: 'file_export',
      resourceId: 'events.jsonl',
      outcome: 'success'
    });
    return res.download(file, 'events.jsonl');
  }

  async function sendLegacyState(req, res) {
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
    return res.json({
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
  }

  return {
    sendCustomersCsv,
    sendEventsJsonl,
    sendLegacyState
  };
}

module.exports = {
  createAdminLegacyHandlers
};

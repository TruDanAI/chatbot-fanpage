const fs = require('fs');

function getBearerToken(header = '') {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getAdminRequestToken(req) {
  return String(req?.get?.('x-admin-token') || getBearerToken(req?.get?.('authorization')) || '').trim();
}

function registerAdminRoutes(app, {
  storage,
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp
}) {
  function isAdminIpAllowed(req) {
    if (!adminIpAllowlist.length) return true;
    return adminIpAllowlist.includes(getClientIp(req));
  }

  function requireAdminToken(req, res) {
    if (!adminExportToken) {
      res.status(503).send('ADMIN_EXPORT_TOKEN chưa được cấu hình.');
      return false;
    }
    if (!isAdminIpAllowed(req)) {
      res.sendStatus(403);
      return false;
    }
    const token = getAdminRequestToken(req);
    if (token !== adminExportToken) {
      res.sendStatus(401);
      return false;
    }
    return true;
  }

  app.get('/admin/customers.csv', (req, res) => {
    if (!requireAdminToken(req, res)) return;

    const file = storage.getCustomersFile();
    if (!fs.existsSync(file)) {
      return res.status(404).send('Chưa có file customers.csv.');
    }

    res.download(file, 'customers.csv');
  });

  app.get('/admin/events.jsonl', (req, res) => {
    if (!requireAdminToken(req, res)) return;

    const file = storage.getEventsFile();
    if (!fs.existsSync(file)) {
      res.status(404).send('Chưa có events.jsonl');
      return;
    }
    res.download(file, 'events.jsonl');
  });

  app.get('/admin/state/:userId', (req, res) => {
    if (!requireAdminToken(req, res)) return;
    const userId = req.params.userId;
    const orderDraft = storage.getOrderDraft(userId);
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
    requireAdminToken
  };
}

module.exports = {
  getAdminRequestToken,
  registerAdminRoutes
};

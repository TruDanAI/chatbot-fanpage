const { createDashboardRepository } = require('./dashboard-repository');

function normalizeFilterText(value = '', max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const ORDER_STATUS_FILTERS = new Set(['draft', 'ready_to_confirm', 'confirmed', 'cancelled', 'abandoned']);
const AUDIT_OUTCOME_FILTERS = new Set(['success', 'denied', 'error', 'noop']);

function toInteger(value, fallback, { min = 1, max = 100 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function toPagination({ limit, page }) {
  const safePage = toInteger(page, 1, { min: 1, max: 1000 });
  return {
    page: safePage,
    offset: (safePage - 1) * limit
  };
}

const DEFAULT_DASHBOARD_LIMITS = {
  overviewRows: 25,
  attentionRows: 8,
  topProductRows: 8,
  detailOrders: 10,
  detailItems: 50,
  detailMessages: 30,
  detailEvents: 30,
  auditRows: 50
};

function normalizeDashboardFilters(query = {}, limits = DEFAULT_DASHBOARD_LIMITS) {
  const limit = toInteger(query.limit, limits.overviewRows, { min: 1, max: 100 });
  const fallbackPage = query.page;
  const orders = toPagination({ limit, page: query.ordersPage || fallbackPage });
  const conversations = toPagination({ limit, page: query.conversationsPage || fallbackPage });
  const events = toPagination({ limit, page: query.eventsPage || fallbackPage });
  const status = normalizeFilterText(query.status, 40).toLowerCase();
  const filters = {
    senderId: normalizeFilterText(query.senderId, 100),
    status: ORDER_STATUS_FILTERS.has(status) ? status : '',
    productCode: normalizeFilterText(query.productCode, 40),
    eventType: normalizeFilterText(query.eventType, 40),
    limit,
    ordersPage: orders.page,
    ordersOffset: orders.offset,
    conversationsPage: conversations.page,
    conversationsOffset: conversations.offset,
    eventsPage: events.page,
    eventsOffset: events.offset
  };
  filters.activeCount = ['senderId', 'status', 'productCode', 'eventType']
    .filter(key => Boolean(filters[key]))
    .length;
  return filters;
}

function normalizeAuditFilters(query = {}, limits = DEFAULT_DASHBOARD_LIMITS) {
  const limit = toInteger(query.limit, limits.auditRows, { min: 1, max: 100 });
  const pagination = toPagination({ limit, page: query.page });
  const outcome = normalizeFilterText(query.outcome, 40).toLowerCase();
  const filters = {
    actorId: normalizeFilterText(query.actorId, 100),
    action: normalizeFilterText(query.action, 120),
    outcome: AUDIT_OUTCOME_FILTERS.has(outcome) ? outcome : '',
    limit,
    page: pagination.page,
    offset: pagination.offset
  };
  filters.activeCount = ['actorId', 'action', 'outcome']
    .filter(key => Boolean(filters[key]))
    .length;
  return filters;
}

function assertReadOnlySql(sql) {
  const normalized = String(sql || '').trim().replace(/\s+/g, ' ');
  if (!/^SELECT\b/i.test(normalized)) {
    throw new Error('Dashboard database access only allows SELECT statements.');
  }
  if (/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|MERGE|COPY|GRANT|REVOKE|CALL|DO|VACUUM|ANALYZE)\b/i.test(normalized)) {
    throw new Error('Dashboard database access refused a non-read-only statement.');
  }
  return normalized;
}

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL admin dashboard.');
  }
}

function createDashboardLimitConfig(limits = {}) {
  return {
    overviewRows: toInteger(limits.overviewRows, DEFAULT_DASHBOARD_LIMITS.overviewRows, { min: 1, max: 100 }),
    attentionRows: toInteger(limits.attentionRows, DEFAULT_DASHBOARD_LIMITS.attentionRows, { min: 1, max: 25 }),
    topProductRows: toInteger(limits.topProductRows, DEFAULT_DASHBOARD_LIMITS.topProductRows, { min: 1, max: 25 }),
    detailOrders: toInteger(limits.detailOrders, DEFAULT_DASHBOARD_LIMITS.detailOrders, { min: 1, max: 30 }),
    detailItems: toInteger(limits.detailItems, DEFAULT_DASHBOARD_LIMITS.detailItems, { min: 1, max: 100 }),
    detailMessages: toInteger(limits.detailMessages, DEFAULT_DASHBOARD_LIMITS.detailMessages, { min: 1, max: 100 }),
    detailEvents: toInteger(limits.detailEvents, DEFAULT_DASHBOARD_LIMITS.detailEvents, { min: 1, max: 100 }),
    auditRows: toInteger(limits.auditRows, DEFAULT_DASHBOARD_LIMITS.auditRows, { min: 1, max: 100 })
  };
}

function createPostgresDashboardReader({
  databaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.TENANT_ID || 'default',
  pageId = process.env.PAGE_ID || '',
  Client = loadPgClient(),
  limits = {}
} = {}) {
  const config = createDashboardLimitConfig(limits);
  const repository = createDashboardRepository({
    tenantId,
    pageId,
    limits: config
  });

  async function withClient(fn) {
    if (!databaseUrl) {
      const err = new Error('DATABASE_URL is required for PostgreSQL admin dashboard.');
      err.statusCode = 503;
      throw err;
    }
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const readOnlyClient = {
      query(sql, params = []) {
        assertReadOnlySql(sql);
        return client.query(sql, params);
      }
    };
    try {
      return await fn(readOnlyClient);
    } finally {
      await client.end();
    }
  }

  async function getOverview(rawFilters = {}) {
    const filters = normalizeDashboardFilters(rawFilters, config);
    return withClient(client => repository.getOverview(client, filters));
  }

  async function getUserDetail(senderId) {
    const normalizedSenderId = String(senderId || '').trim().slice(0, 160);
    return withClient(client => repository.getUserDetail(client, normalizedSenderId));
  }

  async function getAuditLog(rawFilters = {}) {
    const filters = normalizeAuditFilters(rawFilters, config);
    return withClient(client => repository.getAuditLog(client, filters));
  }

  async function getShops() {
    return withClient(client => repository.getShops(client));
  }

  async function getShopDetail(shopId) {
    const normalizedShopId = String(shopId || '').trim().slice(0, 160);
    return withClient(client => repository.getShopDetail(client, normalizedShopId));
  }

  return {
    getOverview,
    getShopDetail,
    getShops,
    getUserDetail,
    getAuditLog
  };
}

module.exports = {
  DEFAULT_DASHBOARD_LIMITS,
  assertReadOnlySql,
  createDashboardLimitConfig,
  createPostgresDashboardReader,
  normalizeAuditFilters,
  normalizeDashboardFilters
};

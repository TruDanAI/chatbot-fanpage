function normalizeFilterText(value = '', max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeSqlLike(value = '') {
  return String(value || '').replace(/[\\%_]/g, char => `\\${char}`);
}

function likeParam(value = '') {
  return `%${escapeSqlLike(value)}%`;
}

const ORDER_STATUS_FILTERS = new Set(['draft', 'ready_to_confirm', 'confirmed', 'cancelled', 'abandoned']);
const AUDIT_OUTCOME_FILTERS = new Set(['success', 'denied', 'error', 'noop']);

function toInteger(value, fallback, { min = 1, max = 100 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

const DEFAULT_DASHBOARD_LIMITS = {
  overviewRows: 25,
  detailOrders: 10,
  detailItems: 50,
  detailMessages: 30,
  detailEvents: 30,
  auditRows: 50
};

function normalizeDashboardFilters(query = {}, limits = DEFAULT_DASHBOARD_LIMITS) {
  const status = normalizeFilterText(query.status, 40).toLowerCase();
  const filters = {
    senderId: normalizeFilterText(query.senderId, 100),
    status: ORDER_STATUS_FILTERS.has(status) ? status : '',
    productCode: normalizeFilterText(query.productCode, 40),
    eventType: normalizeFilterText(query.eventType, 40),
    limit: toInteger(query.limit, limits.overviewRows, { min: 1, max: 100 })
  };
  filters.activeCount = ['senderId', 'status', 'productCode', 'eventType']
    .filter(key => Boolean(filters[key]))
    .length;
  return filters;
}

function normalizeAuditFilters(query = {}, limits = DEFAULT_DASHBOARD_LIMITS) {
  const outcome = normalizeFilterText(query.outcome, 40).toLowerCase();
  const filters = {
    actorId: normalizeFilterText(query.actorId, 100),
    action: normalizeFilterText(query.action, 120),
    outcome: AUDIT_OUTCOME_FILTERS.has(outcome) ? outcome : '',
    limit: toInteger(query.limit, limits.auditRows, { min: 1, max: 100 })
  };
  filters.activeCount = ['actorId', 'action', 'outcome']
    .filter(key => Boolean(filters[key]))
    .length;
  return filters;
}

function addSqlCondition(conditions, params, sql, value, paramOffset = 2) {
  params.push(value);
  conditions.push(sql.replace('?', `$${paramOffset + params.length}`));
}

function buildOverviewQueryScope(filters, { tableAlias, productColumn, statusColumn, eventTypeColumn } = {}) {
  const conditions = [`${tableAlias}.tenant_id = $1`, `${tableAlias}.page_id = $2`];
  const params = [];
  if (filters.senderId) {
    addSqlCondition(conditions, params, `${tableAlias}.sender_id ILIKE ? ESCAPE '\\'`, likeParam(filters.senderId));
  }
  if (filters.productCode && productColumn) {
    addSqlCondition(conditions, params, `${productColumn} ILIKE ? ESCAPE '\\'`, likeParam(filters.productCode));
  }
  if (filters.status && statusColumn) {
    addSqlCondition(conditions, params, `${statusColumn} = ?`, filters.status);
  }
  if (filters.eventType && eventTypeColumn) {
    addSqlCondition(conditions, params, `${eventTypeColumn} ILIKE ? ESCAPE '\\'`, likeParam(filters.eventType));
  }
  return {
    whereSql: conditions.join(' AND '),
    filterParams: params
  };
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

function isMissingAuditSchemaError(err) {
  return err && ['42P01', '42703'].includes(String(err.code || ''));
}

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL admin dashboard.');
  }
}

function createPostgresDashboardReader({
  databaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.TENANT_ID || 'default',
  pageId = process.env.PAGE_ID || '',
  Client = loadPgClient(),
  limits = {}
} = {}) {
  const config = {
    overviewRows: toInteger(limits.overviewRows, DEFAULT_DASHBOARD_LIMITS.overviewRows, { min: 1, max: 100 }),
    detailOrders: toInteger(limits.detailOrders, DEFAULT_DASHBOARD_LIMITS.detailOrders, { min: 1, max: 30 }),
    detailItems: toInteger(limits.detailItems, DEFAULT_DASHBOARD_LIMITS.detailItems, { min: 1, max: 100 }),
    detailMessages: toInteger(limits.detailMessages, DEFAULT_DASHBOARD_LIMITS.detailMessages, { min: 1, max: 100 }),
    detailEvents: toInteger(limits.detailEvents, DEFAULT_DASHBOARD_LIMITS.detailEvents, { min: 1, max: 100 }),
    auditRows: toInteger(limits.auditRows, DEFAULT_DASHBOARD_LIMITS.auditRows, { min: 1, max: 100 })
  };

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
    return withClient(async client => {
      const params = [tenantId, pageId];
      const conversationsScope = buildOverviewQueryScope(filters, {
        tableAlias: 'c',
        productColumn: 'c.last_product_code'
      });
      const ordersScope = buildOverviewQueryScope(filters, {
        tableAlias: 'o',
        productColumn: 'o.product_code',
        statusColumn: 'o.status'
      });
      const eventsScope = buildOverviewQueryScope(filters, {
        tableAlias: 'e',
        productColumn: 'e.product_code',
        eventTypeColumn: 'e.type'
      });
      const conversationsLimitParam = 3 + conversationsScope.filterParams.length;
      const ordersLimitParam = 3 + ordersScope.filterParams.length;
      const eventsLimitParam = 3 + eventsScope.filterParams.length;
      const counts = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM profiles WHERE tenant_id = $1 AND page_id = $2) AS profiles,
          (SELECT COUNT(*)::int FROM conversations WHERE tenant_id = $1 AND page_id = $2) AS conversations,
          (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND page_id = $2) AS messages,
          (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND page_id = $2) AS orders,
          (SELECT COUNT(*)::int FROM order_items WHERE tenant_id = $1 AND page_id = $2) AS order_items,
          (SELECT COUNT(*)::int FROM events WHERE tenant_id = $1 AND page_id = $2) AS events,
          (SELECT COUNT(*)::int FROM processed_mids WHERE tenant_id = $1 AND page_id = $2) AS processed_mids
      `, params);
      const conversations = await client.query(`
        SELECT sender_id, session_state, last_product_code, last_user_at, updated_at
        FROM conversations c
        WHERE ${conversationsScope.whereSql}
        ORDER BY updated_at DESC, sender_id ASC
        LIMIT $${conversationsLimitParam}
      `, [...params, ...conversationsScope.filterParams, filters.limit]);
      const orders = await client.query(`
        SELECT o.id, o.sender_id, o.status, o.product_code, o.customer_name,
               o.phone, o.address, o.updated_at, COUNT(oi.id)::int AS item_count
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE ${ordersScope.whereSql}
        GROUP BY o.id, o.sender_id, o.status, o.product_code, o.customer_name,
                 o.phone, o.address, o.updated_at
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT $${ordersLimitParam}
      `, [...params, ...ordersScope.filterParams, filters.limit]);
      const events = await client.query(`
        SELECT id, sender_id, type, source, session_state, product_code, event_at, text
        FROM events e
        WHERE ${eventsScope.whereSql}
        ORDER BY event_at DESC, id DESC
        LIMIT $${eventsLimitParam}
      `, [...params, ...eventsScope.filterParams, filters.limit]);

      return {
        tenantId,
        pageId,
        counts: counts.rows[0] || {},
        conversations: conversations.rows,
        orders: orders.rows,
        events: events.rows,
        filters,
        limits: { ...config, overviewRows: filters.limit }
      };
    });
  }

  async function getUserDetail(senderId) {
    const normalizedSenderId = String(senderId || '').trim().slice(0, 160);
    return withClient(async client => {
      const params = [tenantId, pageId, normalizedSenderId];
      const profile = await client.query(`
        SELECT sender_id, first_name, last_name, name, created_at, updated_at
        FROM profiles
        WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
        LIMIT 1
      `, params);
      const conversation = await client.query(`
        SELECT sender_id, session_state, last_product_code, last_user_at,
               handoff_until, timed_out_at, updated_at
        FROM conversations
        WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
        LIMIT 1
      `, params);
      const orders = await client.query(`
        SELECT id, sender_id, status, product_code, customer_name, phone, address,
               draft_updated_at, staff_notified_at, abandoned_cart_reminder_sent_at,
               abandoned_cart_reminder_failed_at, abandoned_at, confirmed_at, updated_at
        FROM orders
        WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
        ORDER BY updated_at DESC, id DESC
        LIMIT $4
      `, [...params, config.detailOrders]);
      const orderIds = orders.rows.map(order => order.id).filter(Boolean);
      const items = orderIds.length
        ? await client.query(`
            SELECT order_id, item_index, code, name, qty, variant, display, created_at
            FROM order_items
            WHERE tenant_id = $1 AND page_id = $2 AND order_id = ANY($3::bigint[])
            ORDER BY order_id DESC, item_index ASC, id ASC
            LIMIT $4
          `, [tenantId, pageId, orderIds, config.detailItems])
        : { rows: [] };
      const messages = await client.query(`
        SELECT id, role, text, source, created_at
        FROM messages
        WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `, [...params, config.detailMessages]);
      const events = await client.query(`
        SELECT id, type, source, session_state, product_code, text, event_at
        FROM events
        WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
        ORDER BY event_at DESC, id DESC
        LIMIT $4
      `, [...params, config.detailEvents]);

      return {
        tenantId,
        pageId,
        senderId: normalizedSenderId,
        profile: profile.rows[0] || null,
        conversation: conversation.rows[0] || null,
        orders: orders.rows,
        orderItems: items.rows,
        messages: messages.rows,
        events: events.rows,
        limits: config
      };
    });
  }

  async function getAuditLog(rawFilters = {}) {
    const filters = normalizeAuditFilters(rawFilters, config);
    return withClient(async client => {
      const conditions = ['tenant_id = $1', 'page_id = $2'];
      const filterParams = [];
      if (filters.actorId) {
        addSqlCondition(conditions, filterParams, "actor_id ILIKE ? ESCAPE '\\'", likeParam(filters.actorId));
      }
      if (filters.action) {
        addSqlCondition(conditions, filterParams, "action ILIKE ? ESCAPE '\\'", likeParam(filters.action));
      }
      if (filters.outcome) {
        addSqlCondition(conditions, filterParams, 'outcome = ?', filters.outcome);
      }
      const limitParam = 3 + filterParams.length;
      let audit;
      let schemaReady = true;
      try {
        audit = await client.query(`
          SELECT occurred_at, actor_id, actor_roles, action, resource_type,
                 resource_id, outcome, request_id, user_agent
          FROM admin_audit_log
          WHERE ${conditions.join(' AND ')}
          ORDER BY occurred_at DESC, id DESC
          LIMIT $${limitParam}
        `, [tenantId, pageId, ...filterParams, filters.limit]);
      } catch (err) {
        if (!isMissingAuditSchemaError(err)) throw err;
        schemaReady = false;
        audit = { rows: [] };
      }

      return {
        tenantId,
        pageId,
        rows: audit.rows,
        schemaReady,
        filters,
        limits: { ...config, auditRows: filters.limit }
      };
    });
  }

  return {
    getOverview,
    getUserDetail,
    getAuditLog
  };
}

module.exports = {
  DEFAULT_DASHBOARD_LIMITS,
  assertReadOnlySql,
  createPostgresDashboardReader,
  normalizeAuditFilters,
  normalizeDashboardFilters
};

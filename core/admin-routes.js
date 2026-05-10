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

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function limitText(value = '', max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function maskPhone(value = '') {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 2) return '**';
  return `${'*'.repeat(Math.max(4, digits.length - 2))}${digits.slice(-2)}`;
}

function maskAddress(value = '') {
  return String(value || '').trim() ? '[masked-address]' : '';
}

function maskSensitiveText(value = '', max = 240) {
  return limitText(value, max)
    .replace(/\b(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/g, '[masked-phone]')
    .replace(/\b(?:sdt|sđt|phone|tel|dien thoai|điện thoại)\s*[:=-]?\s*\S+/gi, '$1 [masked-phone]')
    .replace(/\b(?:dia chi|địa chỉ|address)\s*[:=-]?\s*.+$/gi, '$1 [masked-address]');
}

function encodeRoutePart(value = '') {
  return encodeURIComponent(String(value || ''));
}

function formatDate(value = '') {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function formatLabel(value = '') {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function statusClass(value = '') {
  const status = String(value || '').toLowerCase();
  if (status === 'confirmed' || status === 'ready_to_confirm' || status === 'success') return 'status status-success';
  if (status === 'cancelled' || status === 'denied' || status.includes('failed') || status.includes('error')) return 'status status-danger';
  if (status === 'abandoned') return 'status status-warning';
  return 'status status-neutral';
}

function renderStatus(value = '') {
  const label = String(value || 'unknown');
  return `<span class="${statusClass(label)}">${escapeHtml(label)}</span>`;
}

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

function parseAdminRoles(value = 'owner') {
  const list = Array.isArray(value)
    ? value
    : String(value || 'owner').split(',');
  const roles = list
    .map(role => normalizeFilterText(role, 60).toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean);
  return roles.length ? roles : ['owner'];
}

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

function dashboardQueryString(filters = {}, overrides = {}) {
  const params = new URLSearchParams();
  const next = { ...filters, ...overrides };
  for (const key of ['senderId', 'status', 'productCode', 'eventType', 'limit']) {
    const value = String(next[key] || '').trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
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

function createPostgresAuditLogger({
  enabled = false,
  databaseUrl = process.env.DATABASE_URL,
  Client
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      async record() {
        return { skipped: true, reason: 'disabled' };
      }
    };
  }

  async function record(entry = {}) {
    if (!databaseUrl) {
      const err = new Error('DATABASE_URL is required for admin audit logging.');
      err.statusCode = 503;
      throw err;
    }
    const PgClient = Client || loadPgClient();
    const client = new PgClient({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`
        INSERT INTO admin_audit_log (
          occurred_at, tenant_id, page_id, actor_id, actor_roles, action,
          resource_type, resource_id, outcome, request_id, request_ip_hash,
          user_agent, metadata
        )
        VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      `, [
        entry.occurred_at,
        entry.tenant_id || '',
        entry.page_id || '',
        entry.actor_id || 'anonymous',
        Array.isArray(entry.actor_roles) ? entry.actor_roles : [],
        entry.action || '',
        entry.resource_type || '',
        entry.resource_id || '',
        entry.outcome || 'error',
        entry.request_id || '',
        entry.request_ip_hash || '',
        entry.user_agent || '',
        JSON.stringify(entry.metadata || {})
      ]);
      return { recorded: true };
    } finally {
      await client.end();
    }
  }

  return {
    enabled: true,
    record
  };
}

function renderLayout(title, body) {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, sans-serif;
      color: #17202a;
      background: #f7f8fb;
      --surface: #ffffff;
      --surface-muted: #f1f5f9;
      --border: #d8e0ea;
      --muted: #64748b;
      --primary: #0f766e;
      --primary-dark: #115e59;
      --link: #2563eb;
      --warning: #b45309;
      --success: #15803d;
      --danger: #b91c1c;
      --neutral: #475569;
    }
    body { margin: 0; background: #f7f8fb; }
    header { background: var(--primary-dark); color: white; padding: 18px 24px; }
    main { max-width: 1180px; margin: 0 auto; padding: 20px 16px 40px; }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; margin-top: 24px; }
    a { color: var(--link); font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--muted); font-size: 13px; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; align-items: end; margin: 18px 0 20px; }
    .filters label { display: grid; gap: 4px; color: #334155; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .filters input, .filters select { min-height: 34px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; color: #17202a; background: #ffffff; font: inherit; }
    .filters button, .filters a { min-height: 34px; border-radius: 6px; padding: 7px 10px; font-size: 14px; font-weight: 700; text-align: center; box-sizing: border-box; }
    .filters button { border: 1px solid var(--primary); color: #ffffff; background: var(--primary); cursor: pointer; }
    .filters a { border: 1px solid var(--border); color: #334155; background: #ffffff; text-decoration: none; }
    .counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .count { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .count span { color: var(--muted); font-size: 13px; }
    .count strong { display: block; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: var(--surface-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: #334155; }
    tr:last-child td { border-bottom: 0; }
    code { background: #eef2f7; padding: 1px 4px; border-radius: 4px; }
    .empty { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; color: var(--muted); }
    .status { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .status-success { color: var(--success); background: #dcfce7; }
    .status-warning { color: var(--warning); background: #fef3c7; }
    .status-danger { color: var(--danger); background: #fee2e2; }
    .status-neutral { color: var(--neutral); background: #e2e8f0; }
    .stack { display: grid; gap: 18px; }
  </style>
</head>
<body>
  <header><h1>${escapeHtml(title)}</h1></header>
  <main>${body}</main>
</body>
</html>`;
}

function renderCounts(counts = {}) {
  return `<section class="counts">${Object.keys(counts).map(key => `
    <div class="count"><span>${escapeHtml(formatLabel(key))}</span><strong>${escapeHtml(counts[key])}</strong></div>
  `).join('')}</section>`;
}

function renderTable(headers, rows, renderRow) {
  if (!rows.length) return '<div class="empty">Không có dữ liệu.</div>';
  return `<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table>`;
}

function renderFilterForm(filters = {}) {
  const statusOptions = ['', 'draft', 'ready_to_confirm', 'confirmed', 'cancelled', 'abandoned']
    .map(value => `<option value="${escapeHtml(value)}"${filters.status === value ? ' selected' : ''}>${escapeHtml(value || 'Any')}</option>`)
    .join('');
  return `<form class="filters" method="get" action="/admin/dashboard">
    <label>Sender
      <input name="senderId" value="${escapeHtml(filters.senderId)}" maxlength="100">
    </label>
    <label>Order Status
      <select name="status">${statusOptions}</select>
    </label>
    <label>Product
      <input name="productCode" value="${escapeHtml(filters.productCode)}" maxlength="40">
    </label>
    <label>Event Type
      <input name="eventType" value="${escapeHtml(filters.eventType)}" maxlength="40">
    </label>
    <label>Limit
      <input name="limit" type="number" min="1" max="100" value="${escapeHtml(filters.limit || 25)}">
    </label>
    <button type="submit">Filter</button>
    <a href="/admin/dashboard">Clear</a>
  </form>`;
}

function renderAuditFilterForm(filters = {}) {
  const outcomeOptions = ['', 'success', 'denied', 'error', 'noop']
    .map(value => `<option value="${escapeHtml(value)}"${filters.outcome === value ? ' selected' : ''}>${escapeHtml(value || 'Any')}</option>`)
    .join('');
  return `<form class="filters" method="get" action="/admin/audit">
    <label>Actor
      <input name="actorId" value="${escapeHtml(filters.actorId)}" maxlength="100">
    </label>
    <label>Action
      <input name="action" value="${escapeHtml(filters.action)}" maxlength="120">
    </label>
    <label>Outcome
      <select name="outcome">${outcomeOptions}</select>
    </label>
    <label>Limit
      <input name="limit" type="number" min="1" max="100" value="${escapeHtml(filters.limit || 50)}">
    </label>
    <button type="submit">Filter</button>
    <a href="/admin/audit">Clear</a>
  </form>`;
}

function renderDashboardHtml(model) {
  const body = `
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(model.pageId)}</code> | list limit ${escapeHtml(model.limits.overviewRows)} | active filters ${escapeHtml(model.filters?.activeCount || 0)}</p>
    ${renderFilterForm(model.filters || {})}
    ${renderCounts(model.counts)}

    <h2>Orders</h2>
    ${renderTable(['updated', 'sender', 'status', 'product', 'name', 'phone', 'address', 'items'], model.orders, order => `
      <tr>
        <td>${escapeHtml(formatDate(order.updated_at))}</td>
        <td><a href="/admin/dashboard/users/${encodeRoutePart(order.sender_id)}${dashboardQueryString(model.filters)}">${escapeHtml(order.sender_id)}</a></td>
        <td>${renderStatus(order.status)}</td>
        <td>${escapeHtml(order.product_code)}</td>
        <td>${escapeHtml(limitText(order.customer_name, 80))}</td>
        <td>${escapeHtml(maskPhone(order.phone))}</td>
        <td>${escapeHtml(maskAddress(order.address))}</td>
        <td>${escapeHtml(order.item_count ?? '')}</td>
      </tr>
    `)}

    <h2>Conversations</h2>
    ${renderTable(['updated', 'sender', 'state', 'last product', 'last user at'], model.conversations, item => `
      <tr>
        <td>${escapeHtml(formatDate(item.updated_at))}</td>
        <td><a href="/admin/dashboard/users/${encodeRoutePart(item.sender_id)}${dashboardQueryString(model.filters)}">${escapeHtml(item.sender_id)}</a></td>
        <td>${escapeHtml(item.session_state)}</td>
        <td>${escapeHtml(item.last_product_code)}</td>
        <td>${escapeHtml(formatDate(item.last_user_at))}</td>
      </tr>
    `)}

    <h2>Recent Events</h2>
    ${renderTable(['time', 'sender', 'type', 'source', 'product', 'text'], model.events, event => `
      <tr>
        <td>${escapeHtml(formatDate(event.event_at))}</td>
        <td><a href="/admin/dashboard/users/${encodeRoutePart(event.sender_id)}${dashboardQueryString(model.filters)}">${escapeHtml(event.sender_id)}</a></td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.source)}</td>
        <td>${escapeHtml(event.product_code)}</td>
        <td>${escapeHtml(maskSensitiveText(event.text, 120))}</td>
      </tr>
    `)}
  `;
  return renderLayout('Admin Dashboard', body);
}

function renderAuditHtml(model) {
  const body = `
    <p><a href="/admin/dashboard">Back to dashboard</a></p>
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(model.pageId)}</code> | audit limit ${escapeHtml(model.limits.auditRows)} | active filters ${escapeHtml(model.filters?.activeCount || 0)}</p>
    ${model.schemaReady === false ? '<div class="empty">Audit schema chưa được apply. Hãy chạy migration theo runbook trước khi bật audit log.</div>' : ''}
    ${renderAuditFilterForm(model.filters || {})}
    ${renderTable(['time', 'actor', 'roles', 'action', 'resource', 'outcome', 'request', 'user agent'], model.rows, row => `
      <tr>
        <td>${escapeHtml(formatDate(row.occurred_at))}</td>
        <td>${escapeHtml(row.actor_id)}</td>
        <td>${escapeHtml(Array.isArray(row.actor_roles) ? row.actor_roles.join(', ') : '')}</td>
        <td>${escapeHtml(row.action)}</td>
        <td>${escapeHtml([row.resource_type, row.resource_id].filter(Boolean).join(':'))}</td>
        <td>${renderStatus(row.outcome)}</td>
        <td>${escapeHtml(row.request_id)}</td>
        <td>${escapeHtml(limitText(row.user_agent, 90))}</td>
      </tr>
    `)}
  `;
  return renderLayout('Admin Audit Log', body);
}

function renderUserDetailHtml(model) {
  const itemsByOrder = new Map();
  for (const item of model.orderItems) {
    const key = String(item.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(item);
  }
  const profile = model.profile || {};
  const conversation = model.conversation || {};
  const body = `
    <p><a href="/admin/dashboard${dashboardQueryString(model.filters || {})}">Back to dashboard</a></p>
    <p class="meta">Sender <code>${escapeHtml(model.senderId)}</code> | detail limits: ${escapeHtml(model.limits.detailOrders)} orders, ${escapeHtml(model.limits.detailMessages)} messages, ${escapeHtml(model.limits.detailEvents)} events.</p>

    <h2>Profile</h2>
    <table><tbody>
      <tr><th>Name</th><td>${escapeHtml(profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(' '))}</td></tr>
      <tr><th>Created</th><td>${escapeHtml(formatDate(profile.created_at))}</td></tr>
      <tr><th>Updated</th><td>${escapeHtml(formatDate(profile.updated_at))}</td></tr>
      <tr><th>Session</th><td>${escapeHtml(conversation.session_state || '')}</td></tr>
      <tr><th>Last Product</th><td>${escapeHtml(conversation.last_product_code || '')}</td></tr>
      <tr><th>Last User At</th><td>${escapeHtml(formatDate(conversation.last_user_at))}</td></tr>
    </tbody></table>

    <h2>Orders</h2>
    ${renderTable(['updated', 'status', 'product', 'name', 'phone', 'address', 'items'], model.orders, order => {
      const items = (itemsByOrder.get(String(order.id)) || [])
        .map(item => `${item.qty} x ${item.display || item.code || item.name}`.trim())
        .join(', ');
      return `
        <tr>
          <td>${escapeHtml(formatDate(order.updated_at))}</td>
          <td>${renderStatus(order.status)}</td>
          <td>${escapeHtml(order.product_code)}</td>
          <td>${escapeHtml(limitText(order.customer_name, 80))}</td>
          <td>${escapeHtml(maskPhone(order.phone))}</td>
          <td>${escapeHtml(maskAddress(order.address))}</td>
          <td>${escapeHtml(limitText(items, 160))}</td>
        </tr>
      `;
    })}

    <h2>Messages</h2>
    ${renderTable(['time', 'role', 'source', 'text'], model.messages, message => `
      <tr>
        <td>${escapeHtml(formatDate(message.created_at))}</td>
        <td>${escapeHtml(message.role)}</td>
        <td>${escapeHtml(message.source)}</td>
        <td>${escapeHtml(maskSensitiveText(message.text, 220))}</td>
      </tr>
    `)}

    <h2>Events</h2>
    ${renderTable(['time', 'type', 'source', 'state', 'product', 'text'], model.events, event => `
      <tr>
        <td>${escapeHtml(formatDate(event.event_at))}</td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.source)}</td>
        <td>${escapeHtml(event.session_state)}</td>
        <td>${escapeHtml(event.product_code)}</td>
        <td>${escapeHtml(maskSensitiveText(event.text, 180))}</td>
      </tr>
    `)}
  `;
  return renderLayout('Admin User Detail', body);
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

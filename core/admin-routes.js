const fs = require('fs');

function getBearerToken(header = '') {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getAdminRequestToken(req) {
  return String(req?.get?.('x-admin-token') || getBearerToken(req?.get?.('authorization')) || '').trim();
}

function getAdminBearerToken(req) {
  return getBearerToken(req?.get?.('authorization'));
}

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
  if (status === 'confirmed' || status === 'ready_to_confirm') return 'status status-success';
  if (status === 'cancelled' || status.includes('failed') || status.includes('error')) return 'status status-danger';
  if (status === 'abandoned') return 'status status-warning';
  return 'status status-neutral';
}

function renderStatus(value = '') {
  const label = String(value || 'unknown');
  return `<span class="${statusClass(label)}">${escapeHtml(label)}</span>`;
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
  detailEvents: 30
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
    detailEvents: toInteger(limits.detailEvents, DEFAULT_DASHBOARD_LIMITS.detailEvents, { min: 1, max: 100 })
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

  async function getOverview() {
    return withClient(async client => {
      const params = [tenantId, pageId];
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
        FROM conversations
        WHERE tenant_id = $1 AND page_id = $2
        ORDER BY updated_at DESC, sender_id ASC
        LIMIT $3
      `, [...params, config.overviewRows]);
      const orders = await client.query(`
        SELECT o.id, o.sender_id, o.status, o.product_code, o.customer_name,
               o.phone, o.address, o.updated_at, COUNT(oi.id)::int AS item_count
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.tenant_id = $1 AND o.page_id = $2
        GROUP BY o.id, o.sender_id, o.status, o.product_code, o.customer_name,
                 o.phone, o.address, o.updated_at
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT $3
      `, [...params, config.overviewRows]);
      const events = await client.query(`
        SELECT id, sender_id, type, source, session_state, product_code, event_at, text
        FROM events
        WHERE tenant_id = $1 AND page_id = $2
        ORDER BY event_at DESC, id DESC
        LIMIT $3
      `, [...params, config.overviewRows]);

      return {
        tenantId,
        pageId,
        counts: counts.rows[0] || {},
        conversations: conversations.rows,
        orders: orders.rows,
        events: events.rows,
        limits: config
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

  return {
    getOverview,
    getUserDetail
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

function renderDashboardHtml(model) {
  const body = `
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(model.pageId)}</code> | list limit ${escapeHtml(model.limits.overviewRows)}</p>
    ${renderCounts(model.counts)}

    <h2>Orders</h2>
    ${renderTable(['updated', 'sender', 'status', 'product', 'name', 'phone', 'address', 'items'], model.orders, order => `
      <tr>
        <td>${escapeHtml(formatDate(order.updated_at))}</td>
        <td><a href="/admin/dashboard/users/${encodeRoutePart(order.sender_id)}">${escapeHtml(order.sender_id)}</a></td>
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
        <td><a href="/admin/dashboard/users/${encodeRoutePart(item.sender_id)}">${escapeHtml(item.sender_id)}</a></td>
        <td>${escapeHtml(item.session_state)}</td>
        <td>${escapeHtml(item.last_product_code)}</td>
        <td>${escapeHtml(formatDate(item.last_user_at))}</td>
      </tr>
    `)}

    <h2>Recent Events</h2>
    ${renderTable(['time', 'sender', 'type', 'source', 'product', 'text'], model.events, event => `
      <tr>
        <td>${escapeHtml(formatDate(event.event_at))}</td>
        <td><a href="/admin/dashboard/users/${encodeRoutePart(event.sender_id)}">${escapeHtml(event.sender_id)}</a></td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.source)}</td>
        <td>${escapeHtml(event.product_code)}</td>
        <td>${escapeHtml(maskSensitiveText(event.text, 120))}</td>
      </tr>
    `)}
  `;
  return renderLayout('Admin Dashboard', body);
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
    <p><a href="/admin/dashboard">Back to dashboard</a></p>
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
  pageId = process.env.PAGE_ID || ''
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

  function requireAdminBearerToken(req, res) {
    if (!adminExportToken) {
      res.status(503).send('ADMIN_EXPORT_TOKEN chưa được cấu hình.');
      return false;
    }
    if (!isAdminIpAllowed(req)) {
      res.sendStatus(403);
      return false;
    }
    const token = getAdminBearerToken(req);
    if (token !== adminExportToken) {
      res.sendStatus(401);
      return false;
    }
    return true;
  }

  const reader = dashboardReader || createPostgresDashboardReader({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });

  async function sendDashboard(req, res) {
    if (!requireAdminBearerToken(req, res)) return;
    try {
      const model = await reader.getOverview();
      res.type('html').send(renderDashboardHtml(model));
    } catch (err) {
      res.status(err.statusCode || 500).send('Không đọc được dashboard.');
    }
  }

  async function sendUserDetail(req, res) {
    if (!requireAdminBearerToken(req, res)) return;
    try {
      const model = await reader.getUserDetail(req.params.senderId);
      res.type('html').send(renderUserDetailHtml(model));
    } catch (err) {
      res.status(err.statusCode || 500).send('Không đọc được dashboard detail.');
    }
  }

  app.get('/admin/dashboard', sendDashboard);
  app.get('/admin/db', sendDashboard);
  app.get('/admin/dashboard/users/:senderId', sendUserDetail);
  app.get('/admin/db/users/:senderId', sendUserDetail);

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
    requireAdminToken,
    requireAdminBearerToken
  };
}

module.exports = {
  assertReadOnlySql,
  createPostgresDashboardReader,
  getAdminBearerToken,
  getAdminRequestToken,
  maskAddress,
  maskPhone,
  registerAdminRoutes
};

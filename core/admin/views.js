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
  if (status === 'confirmed' || status === 'ready_to_confirm' || status === 'success' || status === 'active') return 'status status-success';
  if (status === 'cancelled' || status === 'denied' || status.includes('failed') || status.includes('error')) return 'status status-danger';
  if (status === 'abandoned' || status === 'hidden') return 'status status-warning';
  if (status === 'archived') return 'status status-danger';
  return 'status status-neutral';
}

function renderStatus(value = '') {
  const label = String(value || 'unknown');
  return `<span class="${statusClass(label)}">${escapeHtml(label)}</span>`;
}

function dashboardQueryString(filters = {}, overrides = {}) {
  const params = new URLSearchParams();
  const next = { ...filters, ...overrides };
  for (const key of ['senderId', 'status', 'productCode', 'eventType', 'limit', 'ordersPage', 'conversationsPage', 'eventsPage']) {
    const value = String(next[key] || '').trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function auditQueryString(filters = {}, overrides = {}) {
  const params = new URLSearchParams();
  const next = { ...filters, ...overrides };
  for (const key of ['actorId', 'action', 'outcome', 'limit', 'page']) {
    const value = String(next[key] || '').trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function renderLayout(title, body, { showLogout = true } = {}) {
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
    .header-inner { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .logout-form { margin: 0; }
    .logout-form button { border: 1px solid rgba(255,255,255,.55); border-radius: 6px; background: transparent; color: #ffffff; padding: 7px 10px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .logout-form button:hover { background: rgba(255,255,255,.1); }
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
    .pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; color: var(--muted); font-size: 13px; }
    .pagination a, .pagination span { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; background: #ffffff; }
    .pagination span { color: var(--muted); background: #f8fafc; }
    .counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .count { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .count span { color: var(--muted); font-size: 13px; }
    .count strong { display: block; font-size: 22px; }
    .ops-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-top: 14px; }
    .subsection h3 { font-size: 15px; margin: 0 0 8px; }
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
    .login-panel { max-width: 420px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 18px; }
    .login-panel form { display: grid; gap: 12px; }
    .login-panel label { display: grid; gap: 5px; font-size: 13px; font-weight: 700; color: #334155; }
    .login-panel input { min-height: 38px; border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px; font: inherit; }
    .login-panel button { min-height: 38px; border: 1px solid var(--primary); border-radius: 6px; background: var(--primary); color: #ffffff; font: inherit; font-weight: 700; cursor: pointer; }
    .error { color: var(--danger); background: #fee2e2; border: 1px solid #fecaca; border-radius: 6px; padding: 9px 10px; font-size: 14px; }
    .banner { border-radius: 6px; padding: 9px 10px; font-size: 14px; margin: 10px 0 14px; }
    .banner-success { color: var(--success); background: #dcfce7; border: 1px solid #bbf7d0; }
    .banner-error { color: var(--danger); background: #fee2e2; border: 1px solid #fecaca; }
    .note-body { white-space: pre-wrap; overflow-wrap: anywhere; }
    .note-form { display: grid; gap: 10px; margin: 12px 0 16px; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
    .note-form fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 12px; }
    .note-form legend, .note-form label { color: #334155; font-size: 13px; font-weight: 700; }
    .note-form label { display: grid; gap: 5px; }
    .note-form fieldset label { display: inline-flex; align-items: center; gap: 5px; }
    .note-form textarea { min-height: 92px; border: 1px solid var(--border); border-radius: 6px; padding: 8px 9px; color: #17202a; background: #ffffff; font: inherit; resize: vertical; }
    .note-form button { width: fit-content; min-height: 36px; border: 1px solid var(--primary); border-radius: 6px; background: var(--primary); color: #ffffff; font: inherit; font-weight: 700; padding: 7px 11px; cursor: pointer; }
    .product-section { display: grid; gap: 14px; }
    .product-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .product-toolbar h2 { margin: 0; }
    .product-filters { margin: 0; }
    .product-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 0 0 6px; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
    .product-form.compact { padding: 0; margin: 0; border: 0; background: transparent; grid-template-columns: repeat(2, minmax(96px, 1fr)); }
    .product-form h3 { grid-column: 1 / -1; margin: 0 0 2px; font-size: 15px; }
    .product-form label { display: grid; gap: 4px; color: #334155; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .product-form input, .product-form textarea, .product-form select { min-height: 32px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; color: #17202a; background: #ffffff; font: inherit; font-size: 13px; box-sizing: border-box; width: 100%; }
    .product-form textarea { min-height: 54px; resize: vertical; grid-column: 1 / -1; }
    .product-form button, .inline-action button { min-height: 32px; border: 1px solid var(--primary); border-radius: 6px; background: var(--primary); color: #ffffff; font: inherit; font-size: 13px; font-weight: 700; padding: 6px 9px; cursor: pointer; }
    .product-form .form-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
    .product-form .required { color: var(--danger); }
    .product-name { min-width: 190px; }
    .product-actions { display: grid; gap: 6px; min-width: 86px; }
    .product-actions .meta { max-width: 180px; }
    .inline-action { margin: 0 0 6px; }
    .inline-action:last-child { margin-bottom: 0; }
    .inline-action.warning button { border-color: var(--warning); background: var(--warning); }
    .inline-action.danger button { border-color: var(--danger); background: var(--danger); }
  </style>
</head>
<body>
  <header><div class="header-inner"><h1>${escapeHtml(title)}</h1>${showLogout ? '<form class="logout-form" method="post" action="/admin/logout"><button type="submit">Logout</button></form>' : ''}</div></header>
  <main>${body}</main>
</body>
</html>`;
}

function renderLoginHtml({ error = '' } = {}) {
  const body = `
    <section class="login-panel">
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/admin/login">
        <label>Admin Token
          <input name="adminToken" type="password" autocomplete="current-password" maxlength="300" autofocus>
        </label>
        <button type="submit">Login</button>
      </form>
    </section>
  `;
  return renderLayout('Admin Login', body, { showLogout: false });
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

function limitNoteBody(value = '', max = 800) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function resolveInternalNotesViewModel(model = {}) {
  const nested = model.internalNotes || {};
  return {
    canCreate: model.canCreateNote != null ? Boolean(model.canCreateNote) : Boolean(nested.canCreate),
    error: model.notesError || nested.error || '',
    hasNext: model.notesHasNext != null
      ? Boolean(model.notesHasNext)
      : Boolean(nested.hasNext || nested.pagination?.hasNext),
    message: model.notesMessage || nested.message || '',
    notes: Array.isArray(model.notes) ? model.notes : (nested.notes || []),
    schemaReady: model.notesSchemaReady != null ? model.notesSchemaReady !== false : nested.schemaReady !== false,
    targetId: model.senderId || nested.targetId || ''
  };
}

function renderInternalNotesSection(model = {}) {
  const notesModel = resolveInternalNotesViewModel(model);
  const senderId = notesModel.targetId || '';
  const form = notesModel.canCreate && notesModel.schemaReady !== false && !notesModel.error
    ? `
      <form class="note-form" method="post" action="/admin/dashboard/users/${encodeRoutePart(senderId)}/notes">
        <p class="meta">Sender <code>${escapeHtml(senderId)}</code></p>
        <fieldset>
          <legend>Đối tượng</legend>
          <label><input type="radio" name="target_type" value="customer" checked> Customer</label>
          <label><input type="radio" name="target_type" value="conversation"> Conversation</label>
        </fieldset>
        <label>Nội dung
          <textarea name="body" required maxlength="2000"></textarea>
        </label>
        <button type="submit">Lưu ghi chú</button>
      </form>
    `
    : '';
  const notes = notesModel.notes || [];
  const content = notesModel.schemaReady === false
    ? `<div class="empty">${escapeHtml(notesModel.message || 'Ghi chú nội bộ chưa sẵn sàng.')}</div>`
    : notesModel.error
      ? `<div class="empty">${escapeHtml(notesModel.message || 'Không đọc được ghi chú nội bộ.')}</div>`
      : !notes.length
        ? '<div class="empty">Chưa có ghi chú nào.</div>'
        : `${renderTable(['time', 'created_by', 'target_type', 'body'], notes, note => `
        <tr>
          <td>${escapeHtml(formatDate(note.created_at))}</td>
          <td>${escapeHtml(note.created_by)}</td>
          <td><span class="status status-neutral">${escapeHtml(note.target_type)}</span></td>
          <td class="note-body">${escapeHtml(limitNoteBody(note.body, 800))}</td>
        </tr>
      `)}${notesModel.hasNext ? '<p class="meta">Đang hiển thị các ghi chú mới nhất.</p>' : ''}`;

  return `
    <h2>Ghi Chú Nội Bộ</h2>
    ${form}
    ${content}
  `;
}

function renderPagination(page = {}, filters = {}, queryString = dashboardQueryString, pageParam = 'page') {
  const total = Number(page.total || 0);
  const limit = Math.max(1, Number(page.limit || filters.limit || 1));
  const currentPage = Math.max(1, Number(page.page || filters.page || 1));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const previous = page.hasPrevious
    ? `<a href="${queryString(filters, { [pageParam]: page.previousPage })}">Previous</a>`
    : '<span>Previous</span>';
  const next = page.hasNext
    ? `<a href="${queryString(filters, { [pageParam]: page.nextPage })}">Next</a>`
    : '<span>Next</span>';
  return `<nav class="pagination" aria-label="Pagination">${previous}<span>Page ${escapeHtml(currentPage)} of ${escapeHtml(totalPages)}</span><span>${escapeHtml(total)} rows</span>${next}</nav>`;
}

function renderOperations(operations = {}, filters = {}) {
  const activity = operations.activity || {};
  const needsAttention = operations.needsAttention || {};
  const attentionRows = [
    ...(needsAttention.orders || []).map(order => ({
      reason: order.reason || 'needs_review',
      updated_at: order.updated_at,
      sender_id: order.sender_id,
      status: order.status,
      product_code: order.product_code,
      detail: order.item_count != null ? `${order.item_count} items` : ''
    })),
    ...(needsAttention.handoffs || []).map(item => ({
      reason: 'active_handoff',
      updated_at: item.handoff_until || item.updated_at,
      sender_id: item.sender_id,
      status: item.session_state,
      product_code: item.last_product_code,
      detail: item.handoff_until ? `until ${formatDate(item.handoff_until)}` : ''
    }))
  ];
  const snapshot = {
    orders_24h: activity.orders_24h || 0,
    confirmed_24h: activity.confirmed_24h || 0,
    ready_orders: activity.ready_orders || 0,
    abandoned_24h: activity.abandoned_24h || 0,
    active_handoffs: activity.active_handoffs || 0,
    events_24h: activity.events_24h || 0
  };
  return `
    <h2>Ops Snapshot</h2>
    <p class="meta">Rolling ${escapeHtml(operations.windowHours || 24)}h activity | product signal window ${escapeHtml(operations.productWindowDays || 30)}d | last user message ${escapeHtml(formatDate(activity.last_user_message_at))} | last event ${escapeHtml(formatDate(activity.last_event_at))}</p>
    ${renderCounts(snapshot)}
    <section class="ops-grid">
      <div class="subsection">
        <h3>Needs Attention</h3>
        ${renderTable(['reason', 'updated', 'sender', 'state', 'product', 'detail'], attentionRows, row => `
          <tr>
            <td>${escapeHtml(formatLabel(row.reason))}</td>
            <td>${escapeHtml(formatDate(row.updated_at))}</td>
            <td><a href="/admin/dashboard/users/${encodeRoutePart(row.sender_id)}${dashboardQueryString(filters)}">${escapeHtml(row.sender_id)}</a></td>
            <td>${renderStatus(row.status)}</td>
            <td>${escapeHtml(row.product_code)}</td>
            <td>${escapeHtml(row.detail)}</td>
          </tr>
        `)}
      </div>
      <div class="subsection">
        <h3>Top Products</h3>
        ${renderTable(['product', 'orders 30d', 'confirmed'], operations.topProducts || [], row => `
          <tr>
            <td>${escapeHtml(row.product_code)}</td>
            <td>${escapeHtml(row.total_orders || 0)}</td>
            <td>${escapeHtml(row.confirmed_orders || 0)}</td>
          </tr>
        `)}
      </div>
      <div class="subsection">
        <h3>Order Status</h3>
        ${renderTable(['status', 'total'], operations.orderStatusBreakdown || [], row => `
          <tr>
            <td>${renderStatus(row.status)}</td>
            <td>${escapeHtml(row.total || 0)}</td>
          </tr>
        `)}
      </div>
    </section>
  `;
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
    <label>Page
      <input name="page" type="number" min="1" max="1000" value="${escapeHtml(filters.page || 1)}">
    </label>
    <button type="submit">Filter</button>
    <a href="/admin/audit">Clear</a>
  </form>`;
}

function renderDashboardHtml(model) {
  const pagination = model.pagination || {};
  const body = `
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(model.pageId)}</code> | list limit ${escapeHtml(model.limits.overviewRows)} | active filters ${escapeHtml(model.filters?.activeCount || 0)}</p>
    ${renderFilterForm(model.filters || {})}
    ${renderCounts(model.counts)}
    ${renderOperations(model.operations || {}, model.filters || {})}

    <h2>Orders</h2>
    ${renderPagination(pagination.orders, model.filters || {}, dashboardQueryString, 'ordersPage')}
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
    ${renderPagination(pagination.conversations, model.filters || {}, dashboardQueryString, 'conversationsPage')}
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
    ${renderPagination(pagination.events, model.filters || {}, dashboardQueryString, 'eventsPage')}
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
  const pagination = model.pagination || {};
  const body = `
    <p><a href="/admin/dashboard">Back to dashboard</a></p>
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(model.pageId)}</code> | audit limit ${escapeHtml(model.limits.auditRows)} | audit page ${escapeHtml(model.filters?.page || 1)} | active filters ${escapeHtml(model.filters?.activeCount || 0)}</p>
    ${model.schemaReady === false ? '<div class="empty">Audit schema chưa được apply. Hãy chạy migration theo runbook trước khi bật audit log.</div>' : ''}
    ${renderAuditFilterForm(model.filters || {})}
    ${renderPagination(pagination.audit, model.filters || {}, auditQueryString)}
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

function renderShopsHtml(model = {}) {
  const shops = model.shops || [];
  const body = `
    <p><a href="/admin/dashboard">Back to dashboard</a></p>
    ${model.schemaReady === false ? `<div class="empty">${escapeHtml(model.message || 'Multi-shop schema chưa sẵn sàng.')}</div>` : ''}
    <h2>Shops</h2>
    ${renderTable(['shop', 'status', 'pages', 'products', 'assets', 'bot mode', 'updated'], shops, shop => `
      <tr>
        <td><a href="/admin/shops/${encodeRoutePart(shop.id)}">${escapeHtml(shop.name || shop.slug || shop.id)}</a><br><span class="meta"><code>${escapeHtml(shop.id)}</code> ${escapeHtml(shop.slug)}</span></td>
        <td>${renderStatus(shop.status)}</td>
        <td>${escapeHtml(shop.active_page_count || 0)} / ${escapeHtml(shop.page_count || 0)}</td>
        <td>${escapeHtml(shop.product_count || 0)}</td>
        <td>${escapeHtml(shop.asset_count || 0)}</td>
        <td>${escapeHtml(shop.bot_mode || '')}</td>
        <td>${escapeHtml(formatDate(shop.updated_at))}</td>
      </tr>
    `)}
  `;
  return renderLayout('Admin Shops', body);
}

function renderJsonBlock(value = {}) {
  const json = JSON.stringify(value || {}, null, 2);
  if (!json || json === '{}') return '<div class="empty">Không có dữ liệu.</div>';
  return `<pre class="empty">${escapeHtml(json)}</pre>`;
}

function renderProductFlash(flash = {}) {
  const text = String(flash.text || '').trim();
  if (!text) return '';
  const type = flash.type === 'error' ? 'error' : 'success';
  return `<div class="banner banner-${escapeHtml(type)}" role="status">${escapeHtml(text)}</div>`;
}

function renderProductFilterForm(shopId = '', filters = {}, summary = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}`;
  const statusOptions = ['', 'active', 'hidden', 'archived']
    .map(value => `<option value="${escapeHtml(value)}"${filters.productStatus === value ? ' selected' : ''}>${escapeHtml(value || 'all')}</option>`)
    .join('');
  const total = Number(summary.total || 0);
  const shown = Number(summary.shown || total);
  return `<form class="filters product-filters" method="get" action="${escapeHtml(action)}">
    <label>Search code/name
      <input name="productSearch" value="${escapeHtml(filters.productSearch || '')}" maxlength="100" autocomplete="off">
    </label>
    <label>Status
      <select name="productStatus">${statusOptions}</select>
    </label>
    <button type="submit">Filter</button>
    <a href="${escapeHtml(action)}">Clear</a>
    <span class="meta">${escapeHtml(shown)} of ${escapeHtml(total)} products</span>
  </form>`;
}

function renderProductAddForm(shopId = '') {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/products`;
  return `<form class="product-form" method="post" action="${escapeHtml(action)}">
    <h3>Add product</h3>
    <label>Product code <span class="required">required</span><input name="code" maxlength="80" required aria-required="true" autocomplete="off"></label>
    <label>Name / title <span class="required">required</span><input name="name" maxlength="180" required aria-required="true"></label>
    <label>Price text<input name="price_text" maxlength="120" placeholder="150k"></label>
    <label>Sort order<input name="sort_order" type="number" value="0"></label>
    <label>Status<select name="status"><option value="active">active</option><option value="hidden">hidden</option></select></label>
    <label>Category<input name="category" maxlength="80"></label>
    <label>Tags<input name="tags" maxlength="240"></label>
    <label>Description<textarea name="description" maxlength="2000"></textarea></label>
    <div class="form-actions"><button type="submit">Add product</button><span class="meta">Required fields: code and name/title.</span></div>
  </form>`;
}

function renderProductEditForm(shopId = '', product = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/products/${encodeRoutePart(product.id)}`;
  return `<form class="product-form compact" method="post" action="${escapeHtml(action)}">
    <label>Code <span class="required">required</span><input name="code" value="${escapeHtml(product.code)}" maxlength="80" required aria-required="true"></label>
    <label>Name/title <span class="required">required</span><input name="name" value="${escapeHtml(product.name)}" maxlength="180" required aria-required="true"></label>
    <label>Price text<input name="price_text" value="${escapeHtml(product.price_text || product.price || '')}" maxlength="120"></label>
    <label>Sort order<input name="sort_order" type="number" value="${escapeHtml(product.sort_order || 0)}"></label>
    <label>Category<input name="category" value="${escapeHtml(product.category || '')}" maxlength="80"></label>
    <label>Tags<input name="tags" value="${escapeHtml(Array.isArray(product.tags) ? product.tags.join(', ') : '')}" maxlength="240"></label>
    <label>Description<textarea name="description" maxlength="2000">${escapeHtml(product.description || '')}</textarea></label>
    <div class="form-actions"><button type="submit">Save product</button></div>
  </form>`;
}

function renderProductStatusActions(shopId = '', product = {}) {
  const nextEnabled = String(product.status || '').toLowerCase() === 'active' ? 'false' : 'true';
  const label = nextEnabled === 'true' ? 'Enable' : 'Disable';
  const statusAction = `/admin/shops/${encodeRoutePart(shopId)}/products/${encodeRoutePart(product.id)}/status`;
  const archiveAction = `/admin/shops/${encodeRoutePart(shopId)}/products/${encodeRoutePart(product.id)}/archive`;
  return `
    <form class="inline-action" method="post" action="${escapeHtml(statusAction)}">
      <input type="hidden" name="enabled" value="${escapeHtml(nextEnabled)}">
      <button type="submit">${escapeHtml(label)}</button>
    </form>
    <form class="inline-action danger" method="post" action="${escapeHtml(archiveAction)}" data-confirm="Archive product">
      <button type="submit" onclick="return confirm('Archive this product? It will be hidden from active use, not deleted.');">Archive product</button>
    </form>
    <span class="meta">Archive is a soft archive, not a delete action.</span>
  `;
}

function renderShopDetailHtml(model = {}) {
  const shop = model.shop || {};
  const assets = model.assets || {};
  const summary = assets.summary || {};
  const body = `
    <p><a href="/admin/shops">Back to shops</a></p>
    ${model.schemaReady === false ? `<div class="empty">${escapeHtml(model.message || 'Multi-shop schema chưa sẵn sàng.')}</div>` : ''}
    ${!shop.id && model.schemaReady !== false ? '<div class="empty">Không tìm thấy shop.</div>' : ''}
    ${shop.id ? `
      <p class="meta">Shop <code>${escapeHtml(shop.id)}</code> | slug <code>${escapeHtml(shop.slug)}</code> | updated ${escapeHtml(formatDate(shop.updated_at))}</p>

      <h2>Metadata</h2>
      <table><tbody>
        <tr><th>Name</th><td>${escapeHtml(shop.name)}</td></tr>
        <tr><th>Status</th><td>${renderStatus(shop.status)}</td></tr>
        <tr><th>Locale</th><td>${escapeHtml(shop.default_locale)}</td></tr>
        <tr><th>Timezone</th><td>${escapeHtml(shop.timezone)}</td></tr>
        <tr><th>Created</th><td>${escapeHtml(formatDate(shop.created_at))}</td></tr>
      </tbody></table>

      <h2>Page Mappings</h2>
      ${renderTable(['page id', 'name', 'status', 'updated'], model.pages || [], page => `
        <tr>
          <td><code>${escapeHtml(page.page_id)}</code></td>
          <td>${escapeHtml(page.page_name)}</td>
          <td>${renderStatus(page.status)}</td>
          <td>${escapeHtml(formatDate(page.updated_at))}</td>
        </tr>
      `)}

      <h2>Settings</h2>
      <table><tbody>
        <tr><th>Bot Mode</th><td>${escapeHtml(model.settings?.bot_mode || '')}</td></tr>
        <tr><th>Handoff</th><td>${escapeHtml(model.settings?.handoff_enabled ? 'enabled' : 'disabled')}</td></tr>
        <tr><th>Handoff Message</th><td>${escapeHtml(model.settings?.handoff_message || '')}</td></tr>
        <tr><th>Menu Intro</th><td>${escapeHtml(model.settings?.menu_intro_text || '')}</td></tr>
        <tr><th>Fallback</th><td>${escapeHtml(model.settings?.fallback_text || '')}</td></tr>
        <tr><th>Updated</th><td>${escapeHtml(formatDate(model.settings?.updated_at))}</td></tr>
      </tbody></table>
      <h2>Settings JSON</h2>
      ${renderJsonBlock(model.settings?.settings_json || {})}

      <section class="product-section">
        ${renderProductFlash(model.productFlash || {})}
        <div class="product-toolbar">
          <h2>Products</h2>
          <p class="meta">Manage catalog rows only. Product archive is soft and keeps the row.</p>
        </div>
        ${renderProductFilterForm(shop.id, model.productFilters || {}, model.productFilterSummary || { total: (model.products || []).length, shown: (model.products || []).length })}
        ${renderProductAddForm(shop.id)}
        ${renderTable(['code', 'name/title', 'price_text', 'status', 'sort_order', 'updated', 'quick actions', 'edit'], model.products || [], product => `
        <tr>
          <td><code>${escapeHtml(product.code)}</code></td>
          <td class="product-name">${escapeHtml(product.name)}<br><span class="meta">${escapeHtml(limitText(product.description, 120))}</span></td>
          <td>${escapeHtml(product.price_text || [product.price, product.currency].filter(Boolean).join(' '))}</td>
          <td>${renderStatus(product.status)}</td>
          <td>${escapeHtml(product.sort_order || 0)}</td>
          <td>${escapeHtml(formatDate(product.updated_at))}</td>
          <td class="product-actions">${renderProductStatusActions(shop.id, product)}</td>
          <td>${renderProductEditForm(shop.id, product)}</td>
        </tr>
      `)}
      </section>

      <h2>Assets</h2>
      ${renderCounts(summary)}
      ${renderTable(['type', 'product', 'provider', 'url', 'status', 'size', 'updated'], assets.rows || [], asset => `
        <tr>
          <td>${escapeHtml(asset.asset_type)}</td>
          <td>${escapeHtml(asset.product_code || asset.product_id || '')}</td>
          <td>${escapeHtml(asset.storage_provider)}</td>
          <td>${asset.public_url ? `<a href="${escapeHtml(asset.public_url)}" rel="noreferrer">${escapeHtml(limitText(asset.public_url, 90))}</a>` : ''}</td>
          <td>${renderStatus(asset.status)}</td>
          <td>${escapeHtml(asset.size_bytes ?? '')}</td>
          <td>${escapeHtml(formatDate(asset.updated_at))}</td>
        </tr>
      `)}
    ` : ''}
  `;
  return renderLayout('Admin Shop Detail', body);
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

    ${renderInternalNotesSection(model)}

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

module.exports = {
  maskAddress,
  maskPhone,
  renderAuditHtml,
  renderDashboardHtml,
  renderLoginHtml,
  renderShopDetailHtml,
  renderShopsHtml,
  renderUserDetailHtml
};

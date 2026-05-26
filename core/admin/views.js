const { normalizeRuleToggles } = require('../rule-toggles');
const { pageRef } = require('../utils/log-refs');

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
  if (status === 'confirmed' || status === 'ready_to_confirm' || status === 'success' || status === 'active' || status === 'enabled' || status === 'pass' || status === 'passed' || status === 'ready' || status === 'true') return 'status status-success';
  if (status === 'cancelled' || status === 'denied' || status === 'fail' || status === 'incomplete' || status.includes('failed') || status.includes('error')) return 'status status-danger';
  if (status === 'abandoned' || status === 'hidden' || status === 'disabled' || status === 'false' || status === 'paused') return 'status status-warning';
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
    .button-link { display: inline-flex; align-items: center; min-height: 34px; border: 1px solid var(--primary); border-radius: 6px; padding: 7px 10px; color: #ffffff; background: var(--primary); font-size: 14px; font-weight: 700; text-decoration: none; box-sizing: border-box; }
    .button-link:hover { text-decoration: none; background: var(--primary-dark); }
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
    .banner-warning { color: #854d0e; background: #fef3c7; border: 1px solid #fde68a; }
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
    .product-form.bulk-import textarea { min-height: 150px; font-family: Consolas, monospace; }
    .product-form h3 { grid-column: 1 / -1; margin: 0 0 2px; font-size: 15px; }
    .product-form label { display: grid; gap: 4px; color: #334155; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .product-form .wide { grid-column: 1 / -1; }
    .product-form input, .product-form textarea, .product-form select { min-height: 32px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; color: #17202a; background: #ffffff; font: inherit; font-size: 13px; box-sizing: border-box; width: 100%; }
    .product-form textarea { min-height: 54px; resize: vertical; grid-column: 1 / -1; }
    .product-form button, .inline-action button { min-height: 32px; border: 1px solid var(--primary); border-radius: 6px; background: var(--primary); color: #ffffff; font: inherit; font-size: 13px; font-weight: 700; padding: 6px 9px; cursor: pointer; }
    .product-form .form-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
    .product-form .required { color: var(--danger); }
    .import-help { grid-column: 1 / -1; display: grid; gap: 8px; color: #334155; font-size: 13px; }
    .import-help p { margin: 0; }
    .import-example { white-space: pre-wrap; overflow-x: auto; background: #eef2f7; border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-size: 12px; }
    .import-preview { grid-column: 1 / -1; display: none; }
    .import-preview.visible { display: block; }
    .import-preview h4 { margin: 0 0 6px; font-size: 13px; color: #334155; }
    .import-preview-scroll { max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: #ffffff; }
    .import-preview-scroll table { border: 0; border-radius: 0; }
    .secondary-button { border-color: var(--border) !important; background: #ffffff !important; color: #334155 !important; }
    .settings-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 0 0 14px; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
    .settings-form label { display: grid; gap: 5px; color: #334155; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .settings-form input, .settings-form select, .settings-form textarea { min-height: 34px; border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px; color: #17202a; background: #ffffff; font: inherit; font-size: 13px; box-sizing: border-box; width: 100%; }
    .settings-form textarea { min-height: 82px; resize: vertical; }
    .settings-form .wide { grid-column: 1 / -1; }
    .settings-form fieldset { border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin: 0; }
    .settings-form legend { color: #334155; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .settings-checkbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px 12px; margin-top: 6px; }
    .settings-form .checkbox-label { display: inline-flex; align-items: center; gap: 8px; text-transform: none; font-size: 13px; }
    .settings-form .checkbox-label input { width: 16px; height: 16px; }
    .settings-form .help { color: var(--muted); font-size: 12px; font-weight: 400; text-transform: none; }
    .settings-form button { width: fit-content; min-height: 34px; border: 1px solid var(--primary); border-radius: 6px; background: var(--primary); color: #ffffff; font: inherit; font-size: 13px; font-weight: 700; padding: 7px 11px; cursor: pointer; }
    .settings-form .form-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
    .product-name { min-width: 190px; }
    .product-actions { display: grid; gap: 6px; min-width: 86px; }
    .product-actions .meta { max-width: 180px; }
    .inline-action { margin: 0 0 6px; }
    .inline-action:last-child { margin-bottom: 0; }
    .inline-action.warning button { border-color: var(--warning); background: var(--warning); }
    .inline-action.danger button { border-color: var(--danger); background: var(--danger); }
    .checklist-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 16px 0 4px; }
    .checklist-card h2 { margin-top: 0; }
    .checklist-table { margin-top: 8px; }
    .checklist-table td:first-child { width: 42%; }
    .checklist-table td:nth-child(2) { width: 90px; }
    .admin-nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .admin-nav a { color: rgba(255,255,255,.75); font-size: 14px; font-weight: 600; text-decoration: none; padding: 5px 10px; border-radius: 6px; }
    .admin-nav a:hover { color: #ffffff; background: rgba(255,255,255,.12); text-decoration: none; }
    .admin-nav a.nav-active { color: #ffffff; background: rgba(255,255,255,.18); }
    .admin-brand { font-size: 15px; font-weight: 800; letter-spacing: .3px; color: #ffffff; margin-right: 8px; }
    .login-branding { margin-bottom: 14px; }
    .login-branding h2 { font-size: 20px; margin: 0 0 4px; color: #17202a; }
    .login-branding p { margin: 0; color: var(--muted); font-size: 13px; }
    .asset-group { display: grid; gap: 10px; margin-top: 16px; }
    .asset-group h3 { margin: 0; font-size: 15px; }
    .asset-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .asset-card { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .asset-preview { width: 128px; }
    .asset-thumb { width: 128px; height: 128px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-muted); display: block; }
    .asset-thumb-broken { width: 128px; height: 128px; border-radius: 6px; border: 1px solid var(--border); background: #fee2e2; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: var(--danger); box-sizing: border-box; padding: 8px; }
    .asset-card-body { min-width: 0; display: grid; gap: 8px; }
    .asset-title-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .asset-url { overflow-wrap: anywhere; font-size: 13px; }
    .asset-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .asset-url-field { grid-column: 1 / -1; }
    .bulk-menu-import { margin-top: 12px; }
    .bulk-menu-import textarea { min-height: 116px; font-family: Consolas, monospace; }
    .bulk-errors { margin-top: 12px; }
    @media (max-width: 640px) {
      .asset-card { grid-template-columns: 1fr; }
      .asset-preview, .asset-thumb, .asset-thumb-broken { width: 100%; max-width: 160px; }
    }
    .toggle-desc { display: block; font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 2px; }
    .collapsible-section summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--muted); padding: 8px 0; }
    .collapsible-section summary:hover { color: #17202a; }
    .page-id-help { font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 2px; line-height: 1.4; }
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; overflow-x: auto; padding-bottom: 1px; }
    .tabs a { padding: 8px 16px; text-decoration: none; color: var(--muted); font-weight: 600; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
    .tabs a:hover { color: #17202a; }
    .tabs a.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tab-section { display: none; }
    .tab-section.active { display: block; }
    .health-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 16px 0; }
    .health-card h2 { margin-top: 0; font-size: 16px; }
    .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .health-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <header><div class="header-inner"><span class="admin-brand">ZenBot</span><nav class="admin-nav">${showLogout ? '<a href="/admin/dashboard">Dashboard</a><a href="/admin/shops">Shops</a><a href="/admin/audit">Audit</a>' : ''}</nav>${showLogout ? '<form class="logout-form" method="post" action="/admin/logout"><button type="submit">Logout</button></form>' : ''}</div></header>
  <main><h1>${escapeHtml(title)}</h1>${body}</main>
</body>
</html>`;
}

function renderLoginHtml({ error = '' } = {}) {
  const body = `
    <section class="login-panel">
      <div class="login-branding">
        <h2>ZenBot Admin</h2>
        <p>Messenger chatbot management console. Enter your admin token to continue.</p>
      </div>
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
  const createLink = model.canCreateShop
    ? '<p><a class="button-link" href="/admin/shops/new">Create shop</a></p>'
    : '';
  const body = `
    <p><a href="/admin/dashboard">Back to dashboard</a></p>
    ${model.schemaReady === false ? `<div class="empty">${escapeHtml(model.message || 'Multi-shop schema chưa sẵn sàng.')}</div>` : ''}
    <h2>Shops</h2>
    ${createLink}
    ${renderTable(['shop', 'status', 'package', 'lifecycle', 'live', 'readiness', 'pages', 'products', 'assets', 'bot mode', 'updated'], shops, shop => `
      <tr>
        <td><a href="/admin/shops/${encodeRoutePart(shop.id)}">${escapeHtml(shop.name || shop.slug || shop.id)}</a><br><span class="meta"><code>${escapeHtml(shop.id)}</code> ${escapeHtml(shop.slug)}</span></td>
        <td>${renderStatus(shop.status)}</td>
        <td>${escapeHtml(shop.package || 'basic')}</td>
        <td>${renderStatus(shop.lifecycle || 'unknown')}</td>
        <td>${renderStatus(shop.live_enabled ? 'enabled' : 'disabled')}</td>
        <td>${renderStatus(shop.last_readiness_status || 'unknown')}</td>
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

function renderShopCreateHtml({ values = {}, error = '' } = {}) {
  const status = String(values.status || 'active');
  const packageName = String(values.package || values.shop_package || 'basic');
  const lifecycle = String(values.lifecycle || 'draft');
  const botMode = String(values.bot_mode || 'menu_code_handoff');
  const statusOptions = ['active', 'paused', 'archived']
    .map(value => `<option value="${escapeHtml(value)}"${status === value ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
  const botModeOptions = [
    ['menu_code_handoff', 'Menu code handoff'],
    ['menu_only', 'Menu only'],
    ['handoff_only', 'Handoff only'],
    ['disabled', 'Disabled']
  ]
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${botMode === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
  const packageOptions = [
    ['basic', 'Gói Cơ Bản'],
    ['sales_flow', 'Gói Tự Động'],
    ['self_closing_addons', 'Gói Chốt Đơn / add-ons']
  ]
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${packageName === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
  const lifecycleOptions = ['draft', 'configuring', 'ready', 'live', 'paused', 'archived']
    .map(value => `<option value="${escapeHtml(value)}"${lifecycle === value ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
  const body = `
    <p><a href="/admin/shops">Back to shops</a></p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form class="settings-form" method="post" action="/admin/shops">
      <label>Shop id / slug <span class="required">required</span>
        <input name="shop_id" value="${escapeHtml(values.shop_id || values.slug || '')}" maxlength="80" required aria-required="true" autocomplete="off" pattern="[a-z0-9]+(-[a-z0-9]+)*">
      </label>
      <label>Display name <span class="required">required</span>
        <input name="display_name" value="${escapeHtml(values.display_name || values.name || '')}" maxlength="180" required aria-required="true">
      </label>
      <label>Status
        <select name="status">${statusOptions}</select>
      </label>
      <label>Package
        <select name="package">${packageOptions}</select>
      </label>
      <label>Lifecycle
        <select name="lifecycle">${lifecycleOptions}</select>
      </label>
      <label>Bot mode
        <select name="bot_mode">${botModeOptions}</select>
      </label>
      <label>Locale
        <input name="locale" value="${escapeHtml(values.locale || values.default_locale || 'vi-VN')}" maxlength="40" required aria-required="true">
      </label>
      <label>Timezone
        <input name="timezone" value="${escapeHtml(values.timezone || 'Asia/Ho_Chi_Minh')}" maxlength="80" required aria-required="true">
      </label>
      <div class="form-actions">
        <button type="submit">Create shop</button>
        <span class="meta">Creates only the shop shell and default settings. Page mapping and credentials are separate phases.</span>
      </div>
    </form>
  `;
  return renderLayout('Create Admin Shop', body);
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

function renderProductBulkImportForm(shopId = '') {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/products/import`;
  const sample = [
    'code,name,price_text,description,image_url,category,tags,metadata_json,status,sort_order',
    'M7,Demo Product M7,150k,Demo product,https://example.com/m7.png,demo,"hot,new","{""size"":""M""}",active,1'
  ].join('\n');
  return `<form class="product-form bulk-import" method="post" action="${escapeHtml(action)}">
    <h3>Bulk import products</h3>
    <div class="import-help">
      <p><strong>Required columns:</strong> <code>code</code>, <code>name</code></p>
      <p><strong>Optional columns:</strong> <code>price_text</code>, <code>description</code>, <code>image_url</code>, <code>category</code>, <code>tags</code>, <code>metadata_json</code>, <code>status</code>, <code>sort_order</code></p>
      <div class="import-example">${escapeHtml(sample)}</div>
    </div>
    <label>CSV products
      <textarea name="csv" maxlength="50000" placeholder="${escapeHtml(sample)}" spellcheck="false" data-product-import-csv></textarea>
    </label>
    <div class="import-preview" data-product-import-preview>
      <h4>Local CSV preview</h4>
      <p class="meta">Preview reads only the header and first rows in this browser. Server validation is final.</p>
      <div class="import-preview-scroll" data-product-import-preview-table></div>
    </div>
    <div class="form-actions">
      <button type="submit" name="validate_only" value="true" class="secondary-button">Validate only</button>
      <button type="submit">Import products</button>
      <span class="meta">Upserts by product code. Optional image_url creates or updates product_image assets.</span>
    </div>
  </form>`;
}

function renderProductImportErrorsTable(errors = []) {
  const rows = Array.isArray(errors) ? errors : [];
  if (!rows.length) return '<div class="empty">No row-level errors were returned.</div>';
  return renderTable(['row', 'column', 'value', 'code', 'message', 'suggested fix'], rows, error => {
    const relatedRows = Array.isArray(error.related_rows) && error.related_rows.length
      ? ` rows ${error.related_rows.join(', ')}`
      : '';
    return `<tr>
      <td>${escapeHtml(error.row || 0)}${escapeHtml(relatedRows)}</td>
      <td><code>${escapeHtml(error.field || '')}</code></td>
      <td>${error.value ? `<code>${escapeHtml(error.value)}</code>` : '<span class="meta">not shown</span>'}</td>
      <td><code>${escapeHtml(error.code || '')}</code></td>
      <td>${escapeHtml(error.message || '')}</td>
      <td>${escapeHtml(error.suggested_fix || '')}</td>
    </tr>`;
  });
}

function renderProductImportPreviewTable(rows = []) {
  const previewRows = Array.isArray(rows) ? rows : [];
  if (!previewRows.length) return '<div class="empty">No preview rows were returned.</div>';
  return renderTable(['row', 'code', 'name', 'status', 'sort_order', 'image', 'metadata keys'], previewRows, row => `
    <tr>
      <td>${escapeHtml(row.row || 0)}</td>
      <td><code>${escapeHtml(row.code || '')}</code></td>
      <td>${escapeHtml(row.name || '')}</td>
      <td>${renderStatus(row.status || '')}</td>
      <td>${escapeHtml(row.sort_order || 0)}</td>
      <td>${escapeHtml(row.has_image_url ? 'yes' : 'no')}</td>
      <td>${escapeHtml(Array.isArray(row.metadata_keys) ? row.metadata_keys.join(', ') : '')}</td>
    </tr>
  `);
}

function renderProductImportResultHtml({ shopId = '', result = null, error = null } = {}) {
  const backHref = `/admin/shops/${encodeRoutePart(shopId)}#products`;
  const body = error
    ? `
      <p><a href="${escapeHtml(backHref)}">Back to products</a></p>
      <div class="banner banner-error" role="alert">${escapeHtml(error.message || 'Product import validation failed.')}</div>
      <p class="meta">Rows received: ${escapeHtml(error.rows_received || 0)}${Array.isArray(error.ignored_columns) && error.ignored_columns.length ? ` | ignored columns: ${escapeHtml(error.ignored_columns.join(', '))}` : ''}</p>
      ${renderProductImportErrorsTable(error.errors || [])}
    `
    : `
      <p><a href="${escapeHtml(backHref)}">Back to products</a></p>
      <div class="banner banner-success" role="status">${escapeHtml(result?.validate_only ? 'Validation passed. No products were written.' : 'Product import completed.')}</div>
      <p class="meta">Rows received: ${escapeHtml(result?.rows_received || 0)} | products created: ${escapeHtml(result?.products_created || 0)} | products updated: ${escapeHtml(result?.products_updated || 0)} | image assets touched: ${escapeHtml(result?.image_assets_touched || 0)}</p>
      ${Array.isArray(result?.ignored_columns) && result.ignored_columns.length ? `<p class="meta">Ignored columns: ${escapeHtml(result.ignored_columns.join(', '))}</p>` : ''}
      <h2>Server Preview</h2>
      <p class="meta">Preview is sanitized and limited to the first 10 rows.</p>
      ${renderProductImportPreviewTable(result?.preview_rows || [])}
    `;
  return renderLayout('Product Import', body);
}

function renderBulkMenuImageErrorsTable(errors = []) {
  const rows = Array.isArray(errors) ? errors : [];
  if (!rows.length) return '<div class="empty">No row errors were returned.</div>';
  return renderTable(['row', 'field', 'code', 'message', 'suggested fix'], rows, error => `
    <tr>
      <td>${escapeHtml(error.row || 0)}</td>
      <td><code>${escapeHtml(error.field || '')}</code></td>
      <td><code>${escapeHtml(error.code || '')}</code></td>
      <td>${escapeHtml(error.message || '')}</td>
      <td>${escapeHtml(error.suggested_fix || '')}</td>
    </tr>
  `);
}

function renderBulkMenuImageImportResultHtml({ shopId = '', error = null } = {}) {
  const backHref = `/admin/shops/${encodeRoutePart(shopId)}#assets`;
  const body = `
    <p><a href="${escapeHtml(backHref)}">Back to image manager</a></p>
    <div class="banner banner-error" role="alert">${escapeHtml(error?.message || 'Bulk menu image import failed.')}</div>
    <p class="meta">Rows received: ${escapeHtml(error?.rows_received || 0)} | errors: ${escapeHtml(error?.errors_count || 0)}</p>
    <section class="bulk-errors">
      ${renderBulkMenuImageErrorsTable(error?.errors || [])}
    </section>
  `;
  return renderLayout('Bulk Menu Image Import', body);
}

function renderPageMappingAddForm(shopId = '') {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/pages`;
  return `<form class="product-form" method="post" action="${escapeHtml(action)}">
    <h3>Add page mapping</h3>
    <label>Page ID <span class="required">required</span><input name="page_id" maxlength="120" required aria-required="true" autocomplete="off" pattern="[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}"><span class="page-id-help">The numeric Facebook Page ID. Find it in <strong>Facebook Page Settings &rarr; About</strong> or in the page URL. Handle this value carefully &mdash; it connects the bot to a specific Facebook page.</span></label>
    <label>Page name<input name="page_name" maxlength="180"></label>
    <div class="form-actions"><button type="submit">Add mapping</button><span class="meta">Creates an active page mapping only. Credentials are added separately below.</span></div>
  </form>`;
}

function renderPageCredentialForm(shopId = '', page = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/pages/${encodeRoutePart(page.id)}/credentials`;
  return `<form class="product-form compact" method="post" action="${escapeHtml(action)}">
    <input type="hidden" name="credential_type" value="fb_page_token">
    <label>Credential <span class="required">required</span><input name="token" type="password" minlength="20" maxlength="5000" required aria-required="true" autocomplete="off"></label>
    <label class="checkbox-label">
      <input type="checkbox" name="rotate" value="true">
      Rotate existing active credential
    </label>
    <div class="form-actions"><button type="submit">Save credential</button></div>
  </form>`;
}

function isPageSetupPreviewMode(shop = {}) {
  const isDemoShop = [shop.id, shop.slug]
    .map(value => String(value || '').trim().toLowerCase())
    .includes('demo-shop');
  return isDemoShop
    && String(shop.lifecycle || '').trim().toLowerCase() === 'configuring'
    && shop.live_enabled === false;
}

function renderPageSetupPreviewSection(shopId = '') {
  const pageAction = `/admin/shops/${encodeRoutePart(shopId)}/pages/preview`;
  const credentialAction = `/admin/shops/${encodeRoutePart(shopId)}/page-credentials/preview`;
  return `<section class="checklist-card" id="page-setup-preview" aria-label="Page setup preview">
    <h2>Page Setup Preview</h2>
    <p class="meta">Validate demo-shop setup inputs without creating mappings, saving credentials, running token health checks, or sending Messenger messages.</p>
    <div class="ops-grid">
      <form class="product-form" method="post" action="${escapeHtml(pageAction)}">
        <h3>Page Mapping Preview</h3>
        <input type="hidden" name="validate_only" value="true">
        <label>Page ID <span class="required">required</span><input name="page_id" maxlength="64" required aria-required="true" autocomplete="off" inputmode="numeric" pattern="[0-9]{5,32}"></label>
        <label>Page name<input name="page_name" maxlength="180"></label>
        <div class="form-actions"><button type="submit">Preview mapping</button><span class="meta">Returns a hashed page reference and duplicate status only.</span></div>
      </form>
      <form class="product-form" method="post" action="${escapeHtml(credentialAction)}">
        <h3>Credential Prerequisites Preview</h3>
        <input type="hidden" name="validate_only" value="true">
        <label>Credential type
          <select name="credential_type"><option value="fb_page_token" selected>fb_page_token</option></select>
        </label>
        <div class="form-actions"><button type="submit">Preview credential</button><span class="meta">No token field is accepted in preview mode.</span></div>
      </form>
    </div>
  </section>`;
}

function renderPageCredentialPreviewDisabled() {
  return '<span class="meta">Credential writes are disabled in preview mode.</span>';
}

function isAdultShopView(shop = {}) {
  return [shop.id, shop.slug]
    .map(value => String(value || '').trim().toLowerCase())
    .includes('adult-shop');
}

function pageStatus(page = {}) {
  return String(page.status || '').trim().toLowerCase();
}

function renderPageCredentialCount(page = {}) {
  if (page.active_credential_count == null) return '<span class="meta">unknown</span>';
  return escapeHtml(Number(page.active_credential_count || 0));
}

function renderPageArchiveForm(shopId = '', page = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/pages/${encodeRoutePart(page.id)}/archive`;
  return `<form class="product-form compact inline-action danger" method="post" action="${escapeHtml(action)}" data-confirm="Archive mapping">
    <input type="hidden" name="source" value="admin_ui">
    <label>Confirm<input name="confirmation_text" maxlength="80" required aria-required="true" autocomplete="off" placeholder="ARCHIVE MAPPING"></label>
    <div class="form-actions"><button type="submit" onclick="return confirm('Archive this mapping? It will archive active credentials for this mapping, not delete anything.');">Archive mapping</button></div>
  </form>`;
}

function renderActivePageMappingsTable({
  shopId = '',
  pages = [],
  pageSetupPreviewMode = false,
  archiveEnabled = false
} = {}) {
  const headers = ['page ref', 'name', 'status', 'active credentials', 'updated', 'credential action'];
  if (archiveEnabled) headers.push('archive');
  return renderTable(headers, pages, page => `
    <tr>
      <td><code>${escapeHtml(page.page_ref || pageRef(page.page_id))}</code></td>
      <td>${escapeHtml(page.page_name)}</td>
      <td>${renderStatus(page.status)}</td>
      <td>${renderPageCredentialCount(page)}</td>
      <td>${escapeHtml(formatDate(page.updated_at))}</td>
      <td>${pageSetupPreviewMode ? renderPageCredentialPreviewDisabled() : renderPageCredentialForm(shopId, page)}</td>
      ${archiveEnabled ? `<td>${renderPageArchiveForm(shopId, page)}</td>` : ''}
    </tr>
  `);
}

function renderReadOnlyPageMappingsTable(pages = []) {
  return renderTable(['page ref', 'name', 'status', 'active credentials', 'updated'], pages, page => `
    <tr>
      <td><code>${escapeHtml(page.page_ref || pageRef(page.page_id))}</code></td>
      <td>${escapeHtml(page.page_name)}</td>
      <td>${renderStatus(page.status)}</td>
      <td>${renderPageCredentialCount(page)}</td>
      <td>${escapeHtml(formatDate(page.updated_at))}</td>
    </tr>
  `);
}

function renderPageMappingsSection({
  shop = {},
  pages = [],
  pageSetupPreviewMode = false,
  archiveEnabled = false
} = {}) {
  const activeMappings = (pages || []).filter(page => pageStatus(page) === 'active');
  const archivedMappings = (pages || []).filter(page => pageStatus(page) === 'archived');
  const otherMappings = (pages || []).filter(page => !['active', 'archived'].includes(pageStatus(page)));
  const canArchive = Boolean(archiveEnabled) && !isAdultShopView(shop);
  return `
    <section class="asset-group">
      <h3>Active Mappings</h3>
      ${renderActivePageMappingsTable({
        shopId: shop.id,
        pages: activeMappings,
        pageSetupPreviewMode,
        archiveEnabled: canArchive
      })}
    </section>
    ${otherMappings.length ? `
      <section class="asset-group">
        <h3>Other Mappings</h3>
        ${renderReadOnlyPageMappingsTable(otherMappings)}
      </section>
    ` : ''}
    <details class="collapsible-section">
      <summary>Archived Mappings (${escapeHtml(archivedMappings.length)})</summary>
      ${renderReadOnlyPageMappingsTable(archivedMappings)}
    </details>
  `;
}

function renderPageSetupPreviewResultHtml({ shopId = '', title = 'Page Setup Preview', result = null, error = null } = {}) {
  const backHref = `/admin/shops/${encodeRoutePart(shopId)}#page-setup-preview`;
  const body = `
    <p><a href="${escapeHtml(backHref)}">Back to page setup preview</a></p>
    ${error ? `<div class="banner banner-error" role="alert">${escapeHtml(error.message || 'Preview failed.')}</div>` : ''}
    ${result ? `
      <div class="banner banner-success" role="status">Preview completed. No setup data was written.</div>
      ${renderJsonBlock(result)}
    ` : ''}
  `;
  return renderLayout(title, body);
}

function renderOnboardingChecklist(onboarding = {}) {
  const rows = Array.isArray(onboarding.checklist) ? onboarding.checklist : [];
  if (!rows.length) return '';
  const readyLabel = onboarding.ready ? 'ready' : 'incomplete';
  return `<section class="checklist-card" aria-label="Onboarding readiness checklist">
    <h2>Onboarding Readiness</h2>
    <p class="meta">Status ${renderStatus(readyLabel)}</p>
    <table class="checklist-table"><thead><tr><th>item</th><th>status</th><th>next action</th></tr></thead><tbody>
      ${rows.map(row => {
        const href = String(row.action_href || '').trim();
        const action = href
          ? `<a href="${escapeHtml(href)}">${escapeHtml(row.next_action || '')}</a>`
          : escapeHtml(row.next_action || '');
        return `<tr>
          <td>${escapeHtml(row.label || row.key || '')}</td>
          <td>${renderStatus(row.passed ? 'pass' : 'fail')}</td>
          <td>${action}</td>
        </tr>`;
      }).join('')}
    </tbody></table>
  </section>`;
}

function renderControlPlaneOptions(values = [], selected = '') {
  const current = String(selected || '');
  return values
    .map(value => `<option value="${escapeHtml(value)}"${current === value ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
}

function renderReadinessIssues(title = '', rows = [], className = 'banner-error') {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  return `<div class="banner ${escapeHtml(className)}" role="status">
    <strong>${escapeHtml(title)}</strong>
    <ul>
      ${list.map(row => `<li><strong>${escapeHtml(row.label || row.key || '')}</strong>${row.detail ? ` - ${escapeHtml(row.detail)}` : ''}${row.next_action ? ` Next: ${escapeHtml(row.next_action)}` : ''}</li>`).join('')}
    </ul>
  </div>`;
}

function renderDryRunStatus(value) {
  if (value === true) return renderStatus('true');
  if (value === false) return renderStatus('false');
  return renderStatus('unknown');
}

function renderShopEmergencyControls(shop = {}) {
  const status = String(shop.status || '').trim().toLowerCase();
  const pauseAction = `/admin/shops/${encodeRoutePart(shop.id)}/pause`;
  const resumeAction = `/admin/shops/${encodeRoutePart(shop.id)}/resume`;
  const pauseForm = `
    <form class="settings-form compact" method="post" action="${escapeHtml(pauseAction)}">
      <label>Confirmation
        <input name="confirmation_text" placeholder="PAUSE SHOP" maxlength="40" required aria-required="true">
      </label>
      <div class="form-actions">
        <button type="submit">Pause shop</button>
        <span class="meta">Pause stops bot responses, forces dry_run, disables live, and preserves data.</span>
      </div>
    </form>`;
  const resumeForm = `
    <form class="settings-form compact" method="post" action="${escapeHtml(resumeAction)}">
      <label>Confirmation
        <input name="confirmation_text" placeholder="RESUME SHOP" maxlength="40" required aria-required="true">
      </label>
      <div class="form-actions">
        <button type="submit">Resume shop</button>
        <span class="meta">Resume reactivates the shop in dry-run with live disabled.</span>
      </div>
    </form>`;
  if (status === 'active') return pauseForm;
  if (status === 'paused') return resumeForm;
  return '<p class="meta">Emergency pause/resume is available for active or paused shops only.</p>';
}

function renderControlPlaneForm(shop = {}, onboarding = {}) {
  const action = `/admin/shops/${encodeRoutePart(shop.id)}/control-plane`;
  const readinessAction = `/admin/shops/${encodeRoutePart(shop.id)}/readiness-check`;
  const liveChecked = shop.live_enabled ? ' checked' : '';
  const blockers = (onboarding.checklist || []).filter(row => !row.passed);
  const hardBlockers = Array.isArray(onboarding.hard_blockers) ? onboarding.hard_blockers : [];
  const warnings = Array.isArray(onboarding.warnings) ? onboarding.warnings : [];
  return `<section class="checklist-card" id="control-plane" aria-label="Shop control plane">
    <h2>Control Plane</h2>
    <p class="meta">Internal operator controls. Runtime lifecycle/live gate remains disabled unless <code>SHOP_LIVE_GATE_ENABLED</code> is explicitly enabled.</p>
    <table><tbody>
      <tr><th>Existing status</th><td>${renderStatus(shop.status || 'unknown')}</td></tr>
      <tr><th>Package</th><td>${escapeHtml(shop.package || 'basic')}</td></tr>
      <tr><th>Lifecycle</th><td>${renderStatus(shop.lifecycle || 'unknown')}</td></tr>
      <tr><th>dry_run</th><td>${renderDryRunStatus(shop.dry_run)}</td></tr>
      <tr><th>Live enabled</th><td>${renderStatus(shop.live_enabled ? 'enabled' : 'disabled')}</td></tr>
      <tr><th>Readiness</th><td>${renderStatus(shop.last_readiness_status || 'unknown')}</td></tr>
      <tr><th>Readiness checked</th><td>${escapeHtml(formatDate(shop.last_readiness_checked_at))}</td></tr>
      <tr><th>Manual test</th><td>${renderStatus(shop.last_manual_test_status || 'unknown')}</td></tr>
      <tr><th>Manual test at</th><td>${escapeHtml(formatDate(shop.last_manual_test_at))}</td></tr>
      <tr><th>Last ready by</th><td>${escapeHtml(shop.last_ready_by || '')}</td></tr>
    </tbody></table>
    ${hardBlockers.length
      ? renderReadinessIssues('Readiness hard blockers', hardBlockers, 'banner-error')
      : (blockers.length ? `<div class="banner banner-error" role="status">Readiness blockers: ${escapeHtml(blockers.map(row => row.label || row.key).join(', '))}</div>` : '<div class="banner banner-success" role="status">No current readiness blockers.</div>')}
    ${warnings.length ? renderReadinessIssues('Readiness warnings', warnings, 'banner-warning') : ''}
    <form class="settings-form compact" method="post" action="${escapeHtml(readinessAction)}">
      <div class="form-actions">
        <button type="submit">Recheck readiness</button>
        <span class="meta">Updates readiness status and checked time only.</span>
      </div>
    </form>
    <h3>Emergency Brake</h3>
    ${renderShopEmergencyControls(shop)}
    <form class="settings-form" method="post" action="${escapeHtml(action)}">
      <label>Package
        <select name="package">${renderControlPlaneOptions(['basic', 'sales_flow', 'self_closing_addons'], shop.package || 'basic')}</select>
      </label>
      <label>Lifecycle
        <select name="lifecycle">${renderControlPlaneOptions(['draft', 'configuring', 'ready', 'live', 'paused', 'archived'], shop.lifecycle || 'draft')}</select>
      </label>
      <input type="hidden" name="live_enabled" value="false">
      <label class="checkbox-label">
        <input type="checkbox" name="live_enabled" value="true"${liveChecked}>
        live_enabled
      </label>
      <label>Manual test status
        <select name="manual_test_status">${renderControlPlaneOptions(['unknown', 'passed', 'failed'], shop.last_manual_test_status || 'unknown')}</select>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="confirm_live" value="true">
        Confirm live enable / live lifecycle change
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="override_readiness" value="true">
        Override readiness blockers for this internal save
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="confirm_pause_archive" value="true">
        Confirm pause/archive lifecycle change
      </label>
      <div class="form-actions">
        <button type="submit">Save control plane</button>
        <span class="meta">Dangerous changes are audited. This form does not enable unfinished features.</span>
      </div>
    </form>
  </section>`;
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

function renderProductOptions(products = [], selectedProductId = '', { includeEmpty = true } = {}) {
  const empty = includeEmpty ? '<option value="">none</option>' : '';
  return `${empty}${(products || []).map(product => {
    const id = String(product.id || '');
    const label = [product.code, product.name].filter(Boolean).join(' - ') || id;
    return `<option value="${escapeHtml(id)}"${id === String(selectedProductId || '') ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}`;
}

function renderAssetTypeOptions(selected = '') {
  const type = String(selected || 'menu_image');
  const baseTypes = ['menu_image', 'product_image'];
  const options = type && !baseTypes.includes(type) ? [type, ...baseTypes] : baseTypes;
  return options
    .map(value => `<option value="${escapeHtml(value)}"${type === value ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
}

function renderAssetStatusOptions(selected = '') {
  const status = String(selected || 'active');
  return ['active', 'hidden', 'archived']
    .map(value => `<option value="${escapeHtml(value)}"${status === value ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
}

function renderAssetAddForm(shopId = '', products = []) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/assets`;
  return `<form class="product-form" method="post" action="${escapeHtml(action)}">
    <h3>Add asset URL</h3>
    <label>Asset type <span class="required">required</span><select name="asset_type" required>${renderAssetTypeOptions('menu_image')}</select></label>
    <label>Product<select name="product_id">${renderProductOptions(products)}</select></label>
    <label>Content type<input name="content_type" maxlength="120" placeholder="image/jpeg"></label>
    <label>Sort order<input name="sort_order" type="number" value="0"></label>
    <label>Status<select name="status"><option value="active">active</option><option value="hidden">hidden</option></select></label>
    <label>Public image URL <span class="required">required</span><input name="public_url" type="url" maxlength="2048" required aria-required="true" autocomplete="off"></label>
    <div class="form-actions"><button type="submit">Add asset</button><span class="meta">Product is required for product_image. URLs are stored as public_url only.</span></div>
  </form>`;
}

function renderBulkMenuImageImportForm(shopId = '') {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/assets/menu-images/import`;
  return `<form class="product-form bulk-menu-import" method="post" action="${escapeHtml(action)}">
    <h3>Bulk menu image URL import</h3>
    <label class="wide">Menu image URLs
      <textarea name="menu_image_urls" maxlength="50000" placeholder="https://cdn.example.test/menu-1.jpg&#10;https://cdn.example.test/menu-2.jpg,2" required aria-required="true"></textarea>
    </label>
    <label>Content type<input name="content_type" maxlength="120" placeholder="image/jpeg"></label>
    <div class="form-actions">
      <button type="submit">Import menu images</button>
      <span class="meta">One public http/https URL per line. Optional format: URL,sort_order. Creates menu_image assets only.</span>
    </div>
  </form>`;
}

function activeProductsOnly(products = []) {
  return (products || []).filter(product => String(product.status || '').toLowerCase() === 'active');
}

function renderImageUploadStatusOptions() {
  return '<option value="active">active</option><option value="hidden">hidden</option>';
}

function renderAssetUploadForms(shopId = '', products = []) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/assets/uploads`;
  const uploadProducts = activeProductsOnly(products);
  return `
    <form class="product-form" method="post" action="${escapeHtml(action)}" enctype="multipart/form-data">
      <h3>Upload menu image</h3>
      <input type="hidden" name="asset_type" value="menu_image">
      <label>Image file <span class="required">required</span><input name="image" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required aria-required="true"></label>
      <label>Sort order<input name="sort_order" type="number" value="0"></label>
      <label>Status<select name="status">${renderImageUploadStatusOptions()}</select></label>
      <div class="form-actions"><button type="submit">Upload menu image</button><span class="meta">JPG, PNG, or WebP. Stored through the configured image provider.</span></div>
    </form>
    <form class="product-form" method="post" action="${escapeHtml(action)}" enctype="multipart/form-data">
      <h3>Upload product image</h3>
      <input type="hidden" name="asset_type" value="product_image">
      <label>Product <span class="required">required</span><select name="product_id" required aria-required="true">${renderProductOptions(uploadProducts, '', { includeEmpty: true })}</select></label>
      <label>Image file <span class="required">required</span><input name="image" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required aria-required="true"></label>
      <label>Sort order<input name="sort_order" type="number" value="0"></label>
      <label>Status<select name="status">${renderImageUploadStatusOptions()}</select></label>
      <div class="form-actions"><button type="submit">Upload product image</button><span class="meta">Product image uploads require an active product.</span></div>
    </form>
  `;
}

function renderAssetEditForm(shopId = '', asset = {}, products = []) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/assets/${encodeRoutePart(asset.id)}`;
  return `<form class="product-form compact" method="post" action="${escapeHtml(action)}">
    <label>Type <span class="required">required</span><select name="asset_type" required>${renderAssetTypeOptions(asset.asset_type)}</select></label>
    <label>Product<select name="product_id">${renderProductOptions(products, asset.product_id)}</select></label>
    <label>Content type<input name="content_type" value="${escapeHtml(asset.content_type || '')}" maxlength="120"></label>
    <label>Sort order<input name="sort_order" type="number" value="${escapeHtml(asset.sort_order || 0)}"></label>
    <label>Status<select name="status">${renderAssetStatusOptions(asset.status)}</select></label>
    <label class="asset-url-field">Replace image URL <span class="required">required</span><input name="public_url" type="url" value="${escapeHtml(asset.public_url || '')}" maxlength="2048" required aria-required="true"></label>
    <div class="form-actions"><button type="submit">Save asset</button></div>
  </form>`;
}

function renderAssetStatusActions(shopId = '', asset = {}) {
  const nextEnabled = String(asset.status || '').toLowerCase() === 'active' ? 'false' : 'true';
  const label = nextEnabled === 'true' ? 'Enable' : 'Disable';
  const statusAction = `/admin/shops/${encodeRoutePart(shopId)}/assets/${encodeRoutePart(asset.id)}/status`;
  const archiveAction = `/admin/shops/${encodeRoutePart(shopId)}/assets/${encodeRoutePart(asset.id)}/archive`;
  return `
    <form class="inline-action" method="post" action="${escapeHtml(statusAction)}">
      <input type="hidden" name="enabled" value="${escapeHtml(nextEnabled)}">
      <button type="submit">${escapeHtml(label)}</button>
    </form>
    <form class="inline-action danger" method="post" action="${escapeHtml(archiveAction)}" data-confirm="Archive asset">
      <button type="submit" onclick="return confirm('Archive this asset? It will be hidden from active use, not deleted.');">Archive asset</button>
    </form>
    <span class="meta">Archive is a soft archive, not a delete action.</span>
  `;
}

function renderChatBehaviorSettingsForm(shopId = '', settings = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/settings`;
  const botMode = String(settings?.bot_mode || 'disabled');
  const settingsJson = settings?.settings_json || {};
  const ruleToggles = normalizeRuleToggles({
    ...(settingsJson.botMode || {}),
    ...(settingsJson.ruleToggles || {})
  });
  const modeOptions = [
    ['menu_code_handoff', 'Menu code handoff', 'Shows product menu, replies to codes, then hands off to staff'],
    ['menu_only', 'Menu only', 'Shows menu and replies to codes, no handoff'],
    ['handoff_only', 'Handoff only', 'Immediately hands all messages to staff'],
    ['disabled', 'Disabled', 'Bot does not respond']
  ]
    .map(([value, label, desc]) => `<option value="${escapeHtml(value)}"${botMode === value ? ' selected' : ''}>${escapeHtml(label)} \u2014 ${escapeHtml(desc)}</option>`)
    .join('');
  const toggleRows = [
    ['productCodeLookupEnabled', 'Product Lookup', 'Bot responds when a customer types a product code (e.g. M7).'],
    ['menuSendingEnabled', 'Menu Images', 'Bot sends menu/catalog images when a customer asks to browse.'],
    ['postProductHandoffEnabled', 'Auto-Handoff', 'Bot hands the customer to staff after showing product details.'],
    ['fallbackEnabled', 'Fallback Message', 'Bot sends a fallback reply when it cannot understand the message.'],
    ['leadCaptureEnabled', 'Lead Capture', 'Bot collects customer name, phone, and address for order drafts.']
  ]
    .map(([name, label, desc]) => `
      <label class="checkbox-label">
        <input type="hidden" name="${escapeHtml(name)}" value="false">
        <input type="checkbox" name="${escapeHtml(name)}" value="true"${ruleToggles[name] ? ' checked' : ''}>
        <span>${escapeHtml(label)}<span class="toggle-desc">${escapeHtml(desc)}</span></span>
      </label>
    `)
    .join('');

  return `<form class="settings-form" method="post" action="${escapeHtml(action)}">
    <label>Bot mode
      <select name="bot_mode">${modeOptions}</select>
      <span class="help">Controls which runtime behavior mode this shop uses. Each mode changes how the bot responds to customer messages.</span>
    </label>
    <label class="checkbox-label">
      <input type="hidden" name="handoff_enabled" value="false">
      <input type="checkbox" name="handoff_enabled" value="true"${settings?.handoff_enabled ? ' checked' : ''}>
      <span>Enable handoff<span class="toggle-desc">Allow the bot to transfer conversations to human staff.</span></span>
    </label>
    <fieldset class="wide">
      <legend>Rule toggles</legend>
      <div class="settings-checkbox-grid">${toggleRows}</div>
      <span class="help">Per-shop switches that control specific bot features at runtime.</span>
    </fieldset>
    <label class="wide">Handoff message
      <textarea name="handoff_message" maxlength="1000">${escapeHtml(settings?.handoff_message || '')}</textarea>
      <span class="help">Sent when the bot hands a customer to staff.</span>
    </label>
    <label class="wide">Menu intro text
      <textarea name="menu_intro_text" maxlength="1000">${escapeHtml(settings?.menu_intro_text || '')}</textarea>
      <span class="help">Shown before menu or product-list content.</span>
    </label>
    <label class="wide">Fallback text
      <textarea name="fallback_text" maxlength="1000">${escapeHtml(settings?.fallback_text || '')}</textarea>
      <span class="help">Used when the bot cannot confidently answer.</span>
    </label>
    <div class="form-actions">
      <button type="submit">Save settings</button>
      <span class="meta">Text is trimmed on save. No image or rule-engine changes here.</span>
    </div>
  </form>`;
}

function healthCount(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function healthTimestamp(value = '') {
  return value ? formatDate(value) : 'unknown';
}

function renderHealthMetric(label = '', value = '', state = 'unknown') {
  const normalizedState = ['ok', 'warning', 'error', 'unknown'].includes(state) ? state : 'unknown';
  const status = normalizedState === 'ok'
    ? 'ready'
    : normalizedState === 'error'
      ? 'error'
      : normalizedState;
  return `<div class="health-item"><span class="${statusClass(status)}">${escapeHtml(normalizedState)}</span><span><strong>${escapeHtml(label)}</strong>: ${escapeHtml(value)}</span></div>`;
}

function renderHealthCard(health = {}) {
  if (!health || health.schemaReady === false || health.available === false) {
    return `
      <section class="health-card">
        <h2>Shop Health</h2>
        <p class="meta">Shop health is unavailable right now. Shop detail data is still shown.</p>
        <div class="health-grid">
          ${renderHealthMetric('Health status', 'unknown', 'unknown')}
        </div>
      </section>
    `;
  }

  const mappings = health.pageMappings || {};
  const credentials = health.credentials || {};
  const activity = health.activity || {};
  const queue = health.queue || {};
  const mappingUnavailable = mappings.available === false;
  const credentialUnavailable = credentials.available === false;
  const activityUnavailable = activity.available === false;
  const queueUnavailable = queue.available === false;
  const errorRate = Number(activity.send_error_rate_1h);
  const hasErrorRate = Number.isFinite(errorRate);

  return `
    <section class="health-card">
      <h2>Shop Health</h2>
      <div class="health-grid">
        ${renderHealthMetric('Page mappings', mappingUnavailable ? 'unknown' : `${healthCount(mappings.total)} total`, mappingUnavailable ? 'unknown' : (healthCount(mappings.total) > 0 ? 'ok' : 'error'))}
        ${renderHealthMetric('Active credentials', credentialUnavailable ? 'unknown' : healthCount(credentials.byStatus?.active), credentialUnavailable ? 'unknown' : (healthCount(credentials.byStatus?.active) > 0 ? 'ok' : 'error'))}
        ${renderHealthMetric('Last webhook', activityUnavailable ? 'unknown' : healthTimestamp(activity.last_webhook_received_at), activityUnavailable ? 'unknown' : (activity.last_webhook_received_at ? 'ok' : 'warning'))}
        ${renderHealthMetric('Last send', activityUnavailable ? 'unknown' : healthTimestamp(activity.last_successful_send_at), activityUnavailable ? 'unknown' : (activity.last_successful_send_at ? 'ok' : 'warning'))}
        ${renderHealthMetric('Send error rate 1h', activityUnavailable || !hasErrorRate ? 'unknown' : `${(errorRate * 100).toFixed(1)}%`, activityUnavailable || !hasErrorRate ? 'unknown' : (errorRate > 0.1 ? 'error' : (errorRate > 0 ? 'warning' : 'ok')))}
        ${renderHealthMetric('Active handoffs', activityUnavailable ? 'unknown' : healthCount(activity.active_handoff_count), activityUnavailable ? 'unknown' : (healthCount(activity.active_handoff_count) > 0 ? 'warning' : 'ok'))}
        ${renderHealthMetric('Queue', queueUnavailable ? 'unknown' : `${healthCount(queue.total)} total`, queueUnavailable ? 'unknown' : 'ok')}
      </div>
    </section>
  `;
}

function renderAssetPreview(asset = {}) {
  if (!asset.public_url) {
    return '<div class="asset-thumb-broken">No URL</div>';
  }
  return `
    <img src="${escapeHtml(asset.public_url)}" alt="${escapeHtml(asset.asset_type || 'image asset')}" class="asset-thumb" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true; this.nextElementSibling.hidden=false;">
    <div class="asset-thumb-broken" hidden>Broken image</div>
  `;
}

function renderAssetEnabledBadge(asset = {}) {
  const status = String(asset.status || '').toLowerCase();
  if (status === 'archived') return renderStatus('archived');
  if (status === 'active') return renderStatus('enabled');
  return renderStatus('disabled');
}

function renderAssetProductLinkBadge(asset = {}) {
  const linked = Boolean(asset.product_id || asset.product_code);
  return `<span class="${linked ? 'status status-success' : 'status status-neutral'}">${linked ? 'product linked' : 'product unlinked'}</span>`;
}

function renderAssetCards(assets = [], shopId = '', products = []) {
  if (!assets.length) return '<div class="empty">Không có dữ liệu.</div>';
  return `<div class="asset-card-grid">${assets.map(asset => `
    <article class="asset-card">
      <div class="asset-preview">${renderAssetPreview(asset)}</div>
      <div class="asset-card-body">
        <div class="asset-title-row">
          <strong>${escapeHtml(formatLabel(asset.asset_type || 'asset'))}</strong>
          ${renderAssetEnabledBadge(asset)}
          ${renderAssetProductLinkBadge(asset)}
          <span class="status status-neutral">sort_order ${escapeHtml(asset.sort_order || 0)}</span>
        </div>
        <div class="asset-badges">
          ${renderStatus(asset.status || 'unknown')}
          <span class="status status-neutral">${escapeHtml(asset.storage_provider || 'public_url')}</span>
          ${asset.product_code || asset.product_id ? `<span class="status status-neutral">${escapeHtml(asset.product_code || asset.product_id)}</span>` : ''}
        </div>
        <div class="asset-url">${asset.public_url ? `<a href="${escapeHtml(asset.public_url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(limitText(asset.public_url, 120))}</a>` : ''}</div>
        <p class="meta">Updated ${escapeHtml(formatDate(asset.updated_at))}</p>
        <div class="product-actions">${renderAssetStatusActions(shopId, asset)}</div>
        ${renderAssetEditForm(shopId, asset, products)}
      </div>
    </article>
  `).join('')}</div>`;
}

function groupShopAssets(assets = []) {
  const grouped = {
    menu_image: [],
    product_image: [],
    shop_image: [],
    other: []
  };
  for (const asset of assets) {
    const type = String(asset.asset_type || '').trim();
    if (type === 'menu_image') grouped.menu_image.push(asset);
    else if (type === 'product_image') grouped.product_image.push(asset);
    else if (type === 'shop_image') grouped.shop_image.push(asset);
    else grouped.other.push(asset);
  }
  return [
    { title: 'Menu Images', rows: grouped.menu_image },
    { title: 'Product Images', rows: grouped.product_image },
    { title: 'Shop Images', rows: grouped.shop_image },
    { title: 'Other / Unknown Assets', rows: grouped.other }
  ];
}

function renderAssetGroups(assets = [], shopId = '', products = []) {
  return groupShopAssets(assets)
    .map(group => `
      <section class="asset-group">
        <h3>${escapeHtml(group.title)}</h3>
        ${renderAssetCards(group.rows, shopId, products)}
      </section>
    `)
    .join('');
}

function renderShopDetailHtml(model = {}) {
  const shop = model.shop || {};
  const assets = model.assets || {};
  const summary = assets.summary || {};
  const assetRows = Array.isArray(assets.rows) ? assets.rows : [];
  const assetProducts = model.assetProducts || model.products || [];
  const pageSetupPreviewMode = isPageSetupPreviewMode(shop);
  const body = `
    <p><a href="/admin/shops">Back to shops</a></p>
    ${model.schemaReady === false ? `<div class="empty">${escapeHtml(model.message || 'Multi-shop schema chưa sẵn sàng.')}</div>` : ''}
    ${!shop.id && model.schemaReady !== false ? '<div class="empty">Không tìm thấy shop.</div>' : ''}
    ${shop.id ? `
      <p class="meta">Shop <code>${escapeHtml(shop.id)}</code> | slug <code>${escapeHtml(shop.slug)}</code> | updated ${escapeHtml(formatDate(shop.updated_at))}</p>

      <nav class="tabs">
        <a href="#overview" class="active">Overview</a>
        <a href="#pages">Pages &amp; Credentials</a>
        <a href="#settings">Chat Behavior</a>
        <a href="#products">Products</a>
        <a href="#assets">Images / Assets</a>
      </nav>

      <div id="overview" class="tab-section active">
        ${renderProductFlash(model.controlFlash || {})}
        ${renderControlPlaneForm(shop, model.onboarding || {})}
        ${renderOnboardingChecklist(model.onboarding || {})}
        ${renderHealthCard(model.health)}
        <h2 id="metadata">Metadata</h2>
        <table><tbody>
          <tr><th>Name</th><td>${escapeHtml(shop.name)}</td></tr>
          <tr><th>Status</th><td>${renderStatus(shop.status)}</td></tr>
          <tr><th>Locale</th><td>${escapeHtml(shop.default_locale)}</td></tr>
          <tr><th>Timezone</th><td>${escapeHtml(shop.timezone)}</td></tr>
          <tr><th>Created</th><td>${escapeHtml(formatDate(shop.created_at))}</td></tr>
        </tbody></table>
      </div>

      <div id="pages" class="tab-section">
        <h2 id="page-mappings">Page Mappings</h2>
        ${renderProductFlash(model.pageFlash || {})}
        ${renderProductFlash(model.credentialFlash || {})}
        ${pageSetupPreviewMode ? renderPageSetupPreviewSection(shop.id) : renderPageMappingAddForm(shop.id)}
        ${renderPageMappingsSection({
          shop,
          pages: model.pages || [],
          pageSetupPreviewMode,
          archiveEnabled: Boolean(model.pageArchiveEnabled)
        })}
      </div>

      <div id="settings" class="tab-section">
        ${renderProductFlash(model.productFlash || {})}
        <h2 id="settings-heading">Chat Behavior Settings</h2>
        ${renderChatBehaviorSettingsForm(shop.id, model.settings || {})}
        <details class="collapsible-section">
          <summary>Advanced: Current settings values &amp; raw JSON</summary>
          <table><tbody>
            <tr><th>Bot Mode</th><td>${escapeHtml(model.settings?.bot_mode || '')}</td></tr>
            <tr><th>Handoff</th><td>${escapeHtml(model.settings?.handoff_enabled ? 'enabled' : 'disabled')}</td></tr>
            <tr><th>Handoff Message</th><td>${escapeHtml(model.settings?.handoff_message || '')}</td></tr>
            <tr><th>Menu Intro</th><td>${escapeHtml(model.settings?.menu_intro_text || '')}</td></tr>
            <tr><th>Fallback</th><td>${escapeHtml(model.settings?.fallback_text || '')}</td></tr>
            <tr><th>Rule Toggles</th><td>${escapeHtml(JSON.stringify(normalizeRuleToggles({
              ...(model.settings?.settings_json?.botMode || {}),
              ...(model.settings?.settings_json?.ruleToggles || {})
            })))}</td></tr>
            <tr><th>Updated</th><td>${escapeHtml(formatDate(model.settings?.updated_at))}</td></tr>
          </tbody></table>
          ${renderJsonBlock(model.settings?.settings_json || {})}
        </details>
      </div>

      <div id="products" class="tab-section">
        <section class="product-section">
          <div class="product-toolbar">
            <h2 id="products-heading">Products</h2>
            <p class="meta">Manage catalog rows only. Product archive is soft and keeps the row.</p>
          </div>
          ${renderProductFilterForm(shop.id, model.productFilters || {}, model.productFilterSummary || { total: (model.products || []).length, shown: (model.products || []).length })}
          ${renderProductAddForm(shop.id)}
          ${renderProductBulkImportForm(shop.id)}
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
      </div>

      <div id="assets" class="tab-section">
        <h2 id="assets-heading">Assets</h2>
        ${renderProductFlash(model.assetFlash || {})}
        ${renderCounts(summary)}
        ${model.adminImageUploadEnabled ? renderAssetUploadForms(shop.id, assetProducts) : ''}
        ${renderAssetAddForm(shop.id, model.products || [])}
        ${renderBulkMenuImageImportForm(shop.id)}
        ${renderAssetGroups(assetRows, shop.id, model.products || [])}
      </div>

      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const tabs = document.querySelectorAll('.tabs a');
          const sections = document.querySelectorAll('.tab-section');
          const overviewSection = document.getElementById('overview');

          function sectionForHash(hash) {
            if (!hash || hash === '#') return overviewSection;
            const target = document.getElementById(hash.slice(1));
            if (!target) return overviewSection;
            if (target.classList.contains('tab-section')) return target;
            return target.closest('.tab-section') || overviewSection;
          }

          function activateTab(hash) {
            const activeSection = sectionForHash(hash);
            const activeHash = activeSection ? '#' + activeSection.id : '#overview';
            tabs.forEach(t => t.classList.toggle('active', t.getAttribute('href') === activeHash));
            sections.forEach(s => s.classList.toggle('active', s === activeSection));
          }
          window.addEventListener('hashchange', () => activateTab(window.location.hash));
          activateTab(window.location.hash);

          function parsePreviewCsv(text) {
            const rows = [];
            let row = [];
            let cell = '';
            let quoted = false;
            const input = String(text || '');
            for (let index = 0; index < input.length; index += 1) {
              const char = input[index];
              const next = input[index + 1];
              if (quoted && char === '"' && next === '"') {
                cell += '"';
                index += 1;
              } else if (char === '"') {
                quoted = !quoted;
              } else if (!quoted && char === ',') {
                row.push(cell.trim());
                cell = '';
              } else if (!quoted && (char === '\\n' || char === '\\r')) {
                if (char === '\\r' && next === '\\n') index += 1;
                row.push(cell.trim());
                if (row.some(value => value)) rows.push(row);
                row = [];
                cell = '';
                if (rows.length >= 11) break;
              } else {
                cell += char;
              }
            }
            if (rows.length < 11 && (cell || row.length)) {
              row.push(cell.trim());
              if (row.some(value => value)) rows.push(row);
            }
            return rows;
          }

          function safeImportPreviewCell(column, value) {
            const header = String(column || '').trim().toLowerCase().replace(/[\\s-]+/g, '_');
            const text = String(value || '').replace(/\\s+/g, ' ').trim();
            if (!text) return '';
            const sensitiveTerms = [
              'to' + 'ken',
              'sec' + 'ret',
              'pass' + 'word',
              'bearer',
              'authorization',
              'metadata_json',
              'phone',
              'tel',
              'sdt',
              'sđt',
              'address',
              'dia chi',
              'địa chỉ',
              'pageid',
              'pageref',
              'customerid',
              'senderid',
              'userid',
              'psid',
              'fbid'
            ];
            if (text.length > 80) return 'not shown';
            if (sensitiveTerms.some(term => text.toLowerCase().includes(term))) return 'not shown';
            if (/(?:[a-z][a-z0-9+.-]*:\\/\\/|www\\.)/i.test(text)) return 'not shown';
            if (/(?:^\\s*[\\[{]|[\\]}]\\s*$|":|'\\s*:)/.test(text)) return 'not shown';
            if ((text.match(/\\d/g) || []).length >= 7) return 'not shown';
            if (text.split(/\\s+/).filter(Boolean).length >= 3) return 'not shown';
            if (header === 'code' && /^(?=.{2,16}$)(?=.*[a-z])(?=.*\\d)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i.test(text)) {
              const compact = text.toLowerCase().replace(/[\\s._:-]+/g, '_');
              if (!/(^|_)(page|customer|cust|sender|user|uid|psid|fbid)(_|$|\\d)/i.test(compact)) return text;
            }
            if (header === 'status' && /^[a-z]{1,16}$/i.test(text)) return text;
            return 'not shown';
          }

          function renderImportPreview() {
            const textarea = document.querySelector('[data-product-import-csv]');
            const preview = document.querySelector('[data-product-import-preview]');
            const target = document.querySelector('[data-product-import-preview-table]');
            if (!textarea || !preview || !target) return;
            const rows = parsePreviewCsv(textarea.value);
            if (rows.length < 2) {
              preview.classList.remove('visible');
              target.textContent = '';
              return;
            }
            const header = rows[0].slice(0, 10);
            const bodyRows = rows.slice(1, 11);
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            header.forEach(column => {
              const th = document.createElement('th');
              th.textContent = column || '(blank)';
              headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            bodyRows.forEach(sourceRow => {
              const tr = document.createElement('tr');
              header.forEach((_, index) => {
                const td = document.createElement('td');
                td.textContent = safeImportPreviewCell(header[index], sourceRow[index]);
                tr.appendChild(td);
              });
              tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            target.replaceChildren(table);
            preview.classList.add('visible');
          }

          const importTextarea = document.querySelector('[data-product-import-csv]');
          if (importTextarea) {
            importTextarea.addEventListener('input', renderImportPreview);
            renderImportPreview();
          }
        });
      </script>
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
  renderBulkMenuImageImportResultHtml,
  renderDashboardHtml,
  renderLoginHtml,
  renderProductImportResultHtml,
  renderPageSetupPreviewResultHtml,
  renderShopCreateHtml,
  renderShopDetailHtml,
  renderShopsHtml,
  renderUserDetailHtml
};

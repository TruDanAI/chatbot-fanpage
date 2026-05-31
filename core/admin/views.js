const { normalizeRuleToggles } = require('../rule-toggles');
const { pageRef } = require('../utils/log-refs');
const { renderEmptyState, renderGuidanceCard } = require('./wizard-ui');

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlPattern(value = '') {
  return String(value ?? '').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function escapePreviewHtml(value = '') {
  return String(value ?? '')
    .replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsString(value = '') {
  return JSON.stringify(String(value ?? ''))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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

const PAGE_ID_SHAPED_PATTERN = /^\d{11,32}$/;

function displayPageIdRef(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return PAGE_ID_SHAPED_PATTERN.test(text) ? pageRef(text) : text;
}

function encodeRoutePart(value = '') {
  return encodeURIComponent(String(value || ''));
}

function productImportStorageKey(shopId = '') {
  return `product-import-csv:${String(shopId || '').trim().slice(0, 160)}`;
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

function renderProductStatus(value = '') {
  const status = String(value || '').toLowerCase();
  let label = value;
  let helper = '';
  if (status === 'active') {
    label = 'Hoạt động';
    helper = 'bot có thể tư vấn';
  } else if (status === 'hidden') {
    label = 'Tạm ẩn';
    helper = 'bot không tư vấn';
  } else if (status === 'archived') {
    label = 'Đã lưu trữ';
    helper = 'giữ lại lịch sử, không dùng trong bot';
  }
  return `<span class="${statusClass(value)}">${escapeHtml(label)}</span><br><span class="meta" style="font-size: 11px; display: block; margin-top: 4px; font-weight: normal; text-transform: none; line-height: 1.3;">${escapeHtml(helper)}</span>`;
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
    .import-summary-band { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; margin: 12px 0; }
    .import-summary-item { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); padding: 10px; }
    .import-summary-item span { display: block; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .import-summary-item strong { display: block; margin-top: 2px; font-size: 20px; }
    .import-confirm-form { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 14px 0; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
    .import-confirm-form button:disabled { cursor: not-allowed; opacity: .55; }
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
    .product-operator-top { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .9fr); gap: 14px; margin: 0 0 18px; align-items: start; }
    .product-work-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; display: grid; gap: 12px; }
    .product-work-card h2, .product-work-card h3 { margin: 0; color: #17202a; }
    .product-work-card p { margin: 0; }
    .product-work-card > .settings-form, .product-work-card > .product-form { border: 0; padding: 0; margin: 0; background: transparent; }
    .product-status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
    .product-status-item { border: 1px solid var(--border); border-radius: 8px; background: #f8fafc; padding: 10px; }
    .product-status-item span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .product-status-item strong { display: block; margin-top: 3px; font-size: 20px; color: #17202a; }
    .product-primary-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
    .product-catalog-note { border: 1px solid #fde68a; background: #fffbeb; color: #854d0e; border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.45; }
    .product-form fieldset { grid-column: 1 / -1; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
    .product-form fieldset legend { color: #334155; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .product-form fieldset label.wide { grid-column: 1 / -1; }
    .product-form .help { color: var(--muted); font-size: 12px; font-weight: 400; text-transform: none; line-height: 1.4; }
    .product-name { min-width: 190px; }
    .product-row-primary td { background: #ffffff; }
    .product-row-secondary td { background: #f8fafc; color: #475569; }
    .product-actions { display: flex; gap: 6px; min-width: 122px; flex-wrap: wrap; align-items: center; }
    .product-actions .meta { max-width: 180px; }
    .inline-action { margin: 0 0 6px; }
    .inline-action:last-child { margin-bottom: 0; }
    .inline-action.secondary button { border-color: var(--border); background: #ffffff; color: #334155; }
    .inline-action.warning button { border-color: var(--warning); background: var(--warning); }
    .inline-action.danger button { border-color: var(--danger); background: var(--danger); }
    .product-row-edit { min-width: 78px; }
    .product-row-edit .button-link { min-height: 32px; font-size: 13px; }
    .product-thumb-warning { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 6px; background: #fffbeb; border: 1px dashed #f59e0b; color: #b45309; box-sizing: border-box; font-size: 16px; }
    .product-thumb-muted { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 6px; background: #f1f5f9; border: 1px dashed #cbd5e1; color: #64748b; box-sizing: border-box; font-size: 16px; }
    .import-steps { grid-column: 1 / -1; display: grid; gap: 6px; margin: 0; padding-left: 20px; color: #334155; font-size: 13px; line-height: 1.45; }
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
    .connection-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; display: grid; gap: 14px; margin: 14px 0 18px; }
    .connection-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .connection-card h3 { margin: 0; font-size: 17px; color: #17202a; }
    .connection-card p { margin: 4px 0 0; line-height: 1.45; }
    .environment-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .environment-badge.env-production { color: #991b1b; background: #fee2e2; }
    .environment-badge.env-staging { color: #854d0e; background: #fef3c7; }
    .environment-badge.env-local { color: #166534; background: #dcfce7; }
    .connection-state-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .connection-state-label { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; font-size: 13px; font-weight: 800; }
    .connection-state-label.state-ok { color: var(--success); background: #dcfce7; }
    .connection-state-label.state-warning { color: var(--warning); background: #fef3c7; }
    .connection-state-label.state-danger { color: var(--danger); background: #fee2e2; }
    .connection-state-label.state-neutral { color: var(--neutral); background: #e2e8f0; }
    .connection-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
    .connection-summary-item { border: 1px solid var(--border); border-radius: 8px; background: #f8fafc; padding: 10px; }
    .connection-summary-item span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .connection-summary-item strong { display: block; margin-top: 4px; font-size: 18px; color: #17202a; overflow-wrap: anywhere; }
    .connection-notes { margin: 0; padding-left: 18px; color: #334155; font-size: 13px; line-height: 1.5; }
    .connection-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .connection-action-disabled { display: inline-flex; align-items: center; min-height: 34px; border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; color: var(--muted); background: #f8fafc; font: inherit; font-size: 14px; font-weight: 700; cursor: not-allowed; }
    .credential-replace-panel { border: 1px solid #fecaca; border-radius: 8px; background: #fff7f7; padding: 12px; display: grid; gap: 10px; min-width: 260px; }
    .credential-replace-panel h4 { margin: 0; color: #991b1b; font-size: 14px; }
    .credential-replace-panel p { margin: 0; color: #7f1d1d; font-size: 13px; line-height: 1.45; }
    .credential-safety-list { margin: 0; padding-left: 18px; color: #334155; font-size: 12px; line-height: 1.45; }
    .credential-safety-list li + li { margin-top: 3px; }
    .credential-confirm-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .credential-confirm-grid label { margin: 0; }
    .credential-no-js-note { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    body.js-enabled .credential-js-fallback-control,
    body.js-enabled .credential-no-js-note { display: none; }
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; overflow-x: auto; flex-wrap: wrap; padding-bottom: 1px; }
    .tabs a { padding: 8px 16px; text-decoration: none; color: var(--muted); font-weight: 600; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: normal; overflow-wrap: anywhere; }
    .tabs a:hover { color: #17202a; }
    .tabs a.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tab-section { display: none; }
    .tab-section.active { display: block; }
    .health-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 16px 0; }
    .health-card h2 { margin-top: 0; font-size: 16px; }
    .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .health-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .safety-stack { display: grid; gap: 16px; margin-top: 14px; }
    .safety-section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; display: grid; gap: 12px; }
    .safety-section h3, .safety-section h4 { margin: 0; color: #17202a; }
    .safety-section p { margin: 0; }
    .safety-section > .settings-form { margin: 0; }
    .safety-status-table { margin: 2px 0; }
    .safety-callouts { display: grid; gap: 8px; }
    .safety-callouts .banner { margin: 0; }
    .safety-operate-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .safety-operate-card { background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: grid; gap: 10px; align-content: start; }
    .safety-operate-card h4 { font-size: 14px; }
    .safety-operate-card .settings-form { padding: 0; margin: 0; border: 0; background: transparent; }
    .safety-danger-zone { border-left: 4px solid var(--danger); background: var(--surface); }
    .safety-danger-zone summary { cursor: pointer; color: #991b1b; font-weight: 800; }
    .safety-danger-zone summary h3 { display: inline; color: #991b1b; font-size: 16px; }
    .safety-danger-content { display: grid; gap: 12px; margin-top: 12px; }
    .safety-danger-card { border: 1px solid #fecaca; border-left: 4px solid var(--danger); border-radius: 8px; background: #ffffff; padding: 14px; display: grid; gap: 10px; }
    .safety-danger-card h4 { color: #991b1b; font-size: 14px; }

    /* Guidance Card */
    .guidance-card {
      display: flex;
      gap: 12px;
      padding: 14px 16px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      margin: 16px 0;
      align-items: flex-start;
    }
    .guidance-card-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
    .guidance-card-body { min-width: 0; text-align: left; }
    .guidance-card-title { display: block; font-size: 14px; color: #1e40af; margin-bottom: 4px; font-weight: bold; }
    .guidance-card-desc { margin: 0; font-size: 13px; color: #1e3a5f; line-height: 1.5; white-space: pre-line; }

    /* Empty State */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      background: var(--surface-muted);
      border: 1px dashed var(--border);
      border-radius: 10px;
      text-align: center;
      margin: 16px 0;
    }
    .empty-state-icon { font-size: 32px; margin-bottom: 10px; }
    .empty-state-title { font-size: 15px; color: #334155; margin-bottom: 6px; font-weight: bold; display: block; }
    .empty-state-desc { margin: 0; font-size: 13px; color: var(--muted); max-width: 420px; line-height: 1.5; }

    /* Requirement List */
    .requirement-list { display: grid; gap: 8px; margin: 14px 0; }
    .requirement-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .requirement-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; }
    .requirement-icon { font-size: 16px; flex-shrink: 0; }
    .requirement-detail { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .requirement-detail-text { font-size: 12px; color: var(--muted); }

    /* Danger Confirmation Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-backdrop.visible {
      display: flex;
    }
    .modal-container {
      background: #ffffff;
      border: 1px solid #fee2e2;
      border-radius: 12px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      animation: modalFadeIn 0.2s ease-out;
    }
    @keyframes modalFadeIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .modal-header {
      background: #fef2f2;
      border-bottom: 1px solid #fee2e2;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .modal-header h3 {
      margin: 0;
      color: #991b1b;
      font-size: 16px;
      font-weight: 700;
    }
    .modal-body {
      padding: 20px;
      display: grid;
      gap: 16px;
    }
    .modal-warning-box {
      background: #fff5f5;
      border-left: 4px solid #ef4444;
      padding: 12px 14px;
      border-radius: 4px;
      font-size: 13px;
      color: #7f1d1d;
      line-height: 1.5;
    }
    .modal-consequence {
      font-size: 13px;
      color: #4b5563;
      line-height: 1.5;
    }
    .modal-slug-label {
      font-size: 12px;
      font-weight: bold;
      color: #374151;
      text-transform: uppercase;
      margin-bottom: 4px;
      display: block;
    }
    .modal-slug-input {
      min-height: 38px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 14px;
      width: 100%;
      box-sizing: border-box;
      background: #ffffff;
      color: #111827;
    }
    .modal-checkbox-label {
      display: inline-flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      font-size: 13px;
      color: #374151;
      user-select: none;
      line-height: 1.4;
    }
    .modal-checkbox-label input {
      margin-top: 2px;
      width: 16px;
      height: 16px;
    }
    .modal-footer {
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
      padding: 14px 20px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
    .modal-footer button {
      min-height: 36px;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }
    .modal-btn-cancel {
      border: 1px solid #d1d5db;
      background: #ffffff;
      color: #374151;
    }
    .modal-btn-cancel:hover {
      background: #f3f4f6;
    }
    .modal-btn-confirm {
      border: 1px solid #dc2626;
      background: #dc2626;
      color: #ffffff;
    }
    .modal-btn-confirm:disabled {
      background: #fca5a5;
      border-color: #fca5a5;
      cursor: not-allowed;
    }

    /* Reusable Drawer/Modal styling */
    .drawer-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(2px);
      z-index: 999;
      justify-content: flex-end;
    }
    .drawer-backdrop.visible {
      display: flex;
    }
    .drawer-panel {
      background: #ffffff;
      width: 100%;
      max-width: 500px;
      height: 100%;
      box-shadow: -10px 0 25px -5px rgba(0, 0, 0, 0.1), -5px 0 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      animation: drawerSlideIn 0.25s ease-out;
    }
    @keyframes drawerSlideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    .drawer-header {
      background: var(--surface-muted);
      border-bottom: 1px solid var(--border);
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-header h3 {
      margin: 0;
      color: var(--primary-dark);
      font-size: 16px;
      font-weight: 700;
    }
    .drawer-close-btn {
      background: transparent;
      border: 0;
      font-size: 28px;
      line-height: 1;
      cursor: pointer;
      color: var(--muted);
      padding: 4px 8px;
    }
    .drawer-close-btn:hover {
      color: var(--primary-dark);
    }
    .drawer-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }
    .drawer-body .product-form {
      border: 0;
      padding: 0;
      background: transparent;
      margin: 0;
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr;
    }
    body.js-enabled #add-product-section {
      display: none;
    }
    body.js-enabled .js-fallback-form-container {
      display: none;
    }
    body:not(.js-enabled) .js-edit-product-btn {
      display: none;
    }
    .duplicate-code-hint {
      display: none;
      color: var(--danger);
      font-size: 12px;
      font-weight: 700;
      text-transform: none;
      line-height: 1.4;
    }
    .duplicate-code-hint.visible {
      display: block;
    }
    .js-cancel-drawer { display: none; }
    body.js-enabled .drawer-body .js-cancel-drawer { display: inline-flex; }
    @media (max-width: 640px) {
      .product-operator-top { grid-template-columns: 1fr; }
      .product-actions { min-width: 0; }
      .product-section table { display: none !important; }
      .product-mobile-list { display: flex !important; flex-direction: column; gap: 12px; }
    }
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
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return '<div class="empty">Không có dữ liệu.</div>';
  return `<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${safeRows.map(renderRow).join('')}</tbody></table>`;
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
    ? `<a href="${escapeHtml(queryString(filters, { [pageParam]: page.previousPage }))}">Previous</a>`
    : '<span>Previous</span>';
  const next = page.hasNext
    ? `<a href="${escapeHtml(queryString(filters, { [pageParam]: page.nextPage }))}">Next</a>`
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
            <td><a href="${escapeHtml(`/admin/dashboard/users/${encodeRoutePart(row.sender_id)}${dashboardQueryString(filters)}`)}">${escapeHtml(row.sender_id)}</a></td>
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
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(displayPageIdRef(model.pageId))}</code> | list limit ${escapeHtml(model.limits.overviewRows)} | active filters ${escapeHtml(model.filters?.activeCount || 0)}</p>
    ${renderFilterForm(model.filters || {})}
    ${renderCounts(model.counts)}
    ${renderOperations(model.operations || {}, model.filters || {})}

    <h2>Orders</h2>
    ${renderPagination(pagination.orders, model.filters || {}, dashboardQueryString, 'ordersPage')}
    ${renderTable(['updated', 'sender', 'status', 'product', 'name', 'phone', 'address', 'items'], model.orders, order => `
      <tr>
        <td>${escapeHtml(formatDate(order.updated_at))}</td>
        <td><a href="${escapeHtml(`/admin/dashboard/users/${encodeRoutePart(order.sender_id)}${dashboardQueryString(model.filters)}`)}">${escapeHtml(order.sender_id)}</a></td>
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
        <td><a href="${escapeHtml(`/admin/dashboard/users/${encodeRoutePart(item.sender_id)}${dashboardQueryString(model.filters)}`)}">${escapeHtml(item.sender_id)}</a></td>
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
        <td><a href="${escapeHtml(`/admin/dashboard/users/${encodeRoutePart(event.sender_id)}${dashboardQueryString(model.filters)}`)}">${escapeHtml(event.sender_id)}</a></td>
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
    <p class="meta">Tenant <code>${escapeHtml(model.tenantId)}</code> | Page <code>${escapeHtml(displayPageIdRef(model.pageId))}</code> | audit limit ${escapeHtml(model.limits.auditRows)} | audit page ${escapeHtml(model.filters?.page || 1)} | active filters ${escapeHtml(model.filters?.activeCount || 0)}</p>
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
    <fieldset>
      <legend>Thông tin cơ bản</legend>
      <label>Product code <span class="required">required</span>
        <input name="code" maxlength="80" required aria-required="true" autocomplete="off">
        <span class="help">Mã khách nhắn cho bot để xem chi tiết (Ví dụ: M1, M2).</span>
        <span class="js-duplicate-code-hint duplicate-code-hint" role="alert"></span>
      </label>
      <label>Name / title <span class="required">required</span><input name="name" maxlength="180" required aria-required="true"></label>
      <label>Price text<input name="price_text" maxlength="120" placeholder="150k"></label>
    </fieldset>
    <fieldset>
      <legend>Phản hồi khách hàng</legend>
      <label class="wide">Description<textarea name="description" maxlength="2000"></textarea></label>
    </fieldset>
    <fieldset>
      <legend>Điều khiển nội bộ</legend>
      <label>Status
        <select name="status"><option value="active">active</option><option value="hidden">hidden</option></select>
        <span class="help">Active cho phép bot tư vấn sản phẩm này.</span>
      </label>
      <label>Sort order<input name="sort_order" type="number" value="0"></label>
      <label>Category<input name="category" maxlength="80"></label>
      <label>Tags<input name="tags" maxlength="240"></label>
      <span class="help wide">Mã sản phẩm là dấu vết lịch sử. Không dùng lại mã của sản phẩm đã lưu trữ.</span>
    </fieldset>
    <div class="form-actions"><button type="submit" class="js-product-save-btn">Tạo sản phẩm (Lưu mới)</button><button type="button" class="js-cancel-drawer secondary-button">Hủy bỏ</button><span class="meta">Required fields: code and name/title.</span></div>
  </form>`;
}

function renderProductBulkImportForm(shopId = '') {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/products/import`;
  const storageKey = productImportStorageKey(shopId);
  const sample = [
    'code,name,price_text,description,image_url,category,tags,metadata_json,status,sort_order',
    'M7,Demo Product M7,150k,Demo product,https://example.com/m7.png,demo,"hot,new","{""size"":""M""}",active,1'
  ].join('\n');
  return `<form class="product-form bulk-import" method="post" action="${escapeHtml(action)}" data-product-import-form data-product-import-storage-key="${escapeHtml(storageKey)}">
    <h3>Nhập hàng loạt</h3>
    <div class="import-help">
      <p><strong>Làm theo thứ tự:</strong> dán CSV, bấm <strong>Xem trước CSV</strong>, chỉ nhập chính thức khi bản xem trước không còn lỗi chặn.</p>
      <ol class="import-steps">
        <li>Xem trước CSV trước. Bước này không ghi dữ liệu.</li>
        <li>Sửa các dòng bị chặn nếu có.</li>
        <li>Nhập chính thức sẽ kiểm tra lại ở server và áp dụng all-or-nothing.</li>
      </ol>
      <details class="collapsible-section">
        <summary>Cột CSV và ví dụ</summary>
        <p><strong>Required columns:</strong> <code>code</code>, <code>name</code></p>
        <p><strong>Optional columns:</strong> <code>price_text</code>, <code>description</code>, <code>image_url</code>, <code>category</code>, <code>tags</code>, <code>metadata_json</code>, <code>status</code>, <code>sort_order</code></p>
        <div class="import-example">${escapeHtml(sample)}</div>
      </details>
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
      <button type="submit" name="validate_only" value="true" class="secondary-button" data-product-import-server-preview>Xem trước CSV</button>
      <span class="meta">Nhập chính thức chỉ mở sau khi không có lỗi chặn.</span>
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

function renderProductImportPreviewStatus(value = '') {
  const status = String(value || '').trim().toLowerCase();
  const label = {
    create: 'Tạo mới',
    update: 'Cập nhật',
    archived_conflict: 'Trùng mã đã lưu trữ',
    duplicate_in_csv: 'Trùng trong tệp',
    error: 'Lỗi'
  }[status] || 'Lỗi';
  const css = {
    create: 'status status-success',
    update: 'status status-neutral',
    archived_conflict: 'status status-danger',
    duplicate_in_csv: 'status status-warning',
    error: 'status status-danger'
  }[status] || 'status status-danger';
  return `<span class="${css}">${escapeHtml(label)}</span>`;
}

function renderProductImportSummaryBand(result = {}) {
  const ignoredColumns = Array.isArray(result?.ignored_columns) ? result.ignored_columns : [];
  const items = [{
    label: 'Sẽ tạo',
    value: Number(result?.create_count || 0)
  }, {
    label: 'Sẽ cập nhật',
    value: Number(result?.update_count || 0)
  }, {
    label: 'Trùng mã đã lưu trữ',
    value: Number(result?.archived_conflict_count || 0)
  }, {
    label: 'Trùng trong tệp',
    value: Number(result?.duplicate_count || 0)
  }, {
    label: 'Lỗi',
    value: Number(result?.error_count || 0)
  }, {
    label: 'Cột bị bỏ qua',
    value: ignoredColumns.length,
    title: ignoredColumns.join(', ')
  }];
  return `<div class="import-summary-band">
    ${items.map(item => `<div class="import-summary-item"${item.title ? ` title="${escapeHtml(item.title)}"` : ''}><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}
  </div>`;
}

function safeCount(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function renderProductImportFinalSummaryBand(result = {}) {
  const createdCount = safeCount(result?.created_count ?? result?.create_count ?? result?.products_created);
  const updatedCount = safeCount(result?.updated_count ?? result?.update_count ?? result?.products_updated);
  const explicitSkipped = result?.unchanged_skipped_count
    ?? result?.unchanged_or_skipped_count
    ?? result?.unchanged_count
    ?? result?.skipped_count
    ?? result?.products_unchanged
    ?? result?.products_skipped;
  const totalProcessed = safeCount(result?.total_processed ?? result?.rows_processed ?? result?.rows_received);
  const skippedCount = explicitSkipped == null
    ? Math.max(0, totalProcessed - createdCount - updatedCount)
    : safeCount(explicitSkipped);
  const items = [{
    label: 'Đã tạo mới',
    value: createdCount
  }, {
    label: 'Đã cập nhật',
    value: updatedCount
  }, {
    label: 'Bỏ qua / Không đổi',
    value: skippedCount
  }, {
    label: 'Tổng dòng xử lý',
    value: totalProcessed
  }];
  return `<div class="import-summary-band" aria-label="Product import result summary">
    ${items.map(item => `<div class="import-summary-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}
  </div>`;
}

function renderProductImportPreviewTable(rows = []) {
  const previewRows = Array.isArray(rows) ? rows : [];
  if (!previewRows.length) return '<div class="empty">No preview rows were returned.</div>';
  return renderTable(['row', 'status', 'code', 'name', 'product status', 'sort_order', 'image', 'message'], previewRows, row => `
    <tr>
      <td>${escapeHtml(row.row || 0)}</td>
      <td>${renderProductImportPreviewStatus(row.status || '')}</td>
      <td><code>${escapePreviewHtml(row.code || '')}</code></td>
      <td>${escapePreviewHtml(row.name || '')}</td>
      <td>${row.product_status ? renderStatus(row.product_status) : '<span class="meta">not shown</span>'}</td>
      <td>${escapeHtml(row.sort_order || 0)}</td>
      <td>${escapeHtml(row.has_image_url ? 'yes' : 'no')}</td>
      <td>${escapePreviewHtml(row.message || '')}</td>
    </tr>
  `);
}

function renderProductImportConfirmForm(shopId = '', result = {}) {
  const hasBlocking = Boolean(result?.blocking || result?.blocking_error_count > 0);
  if (!result?.validate_only || hasBlocking) return '';
  const action = `/admin/shops/${encodeRoutePart(shopId)}/products/import`;
  const storageKey = productImportStorageKey(shopId);
  return `
    <form class="import-confirm-form" method="post" action="${escapeHtml(action)}" data-product-import-confirm data-product-import-storage-key="${escapeHtml(storageKey)}">
      <textarea name="csv" hidden aria-hidden="true"></textarea>
      <button type="submit" disabled>Nhập chính thức</button>
      <span class="meta">Import sẽ được kiểm tra lại ở server và vẫn là all-or-nothing.</span>
      <span class="meta" data-product-import-confirm-missing hidden>Không tìm thấy CSV đã xem trước trong trình duyệt này. Quay lại form nhập CSV để xem trước lại.</span>
    </form>
    <script>
      (() => {
        const form = document.querySelector('[data-product-import-confirm]');
        if (!form) return;
        const field = form.querySelector('textarea[name="csv"]');
        const button = form.querySelector('button[type="submit"]');
        const missing = form.querySelector('[data-product-import-confirm-missing]');
        const key = ${jsString(storageKey)};
        let csv = '';
        try {
          csv = window.sessionStorage.getItem(key) || '';
        } catch (_) {}
        if (csv && field) {
          field.value = csv;
          if (button) button.disabled = false;
          if (missing) missing.hidden = true;
        } else {
          if (button) button.disabled = true;
          if (missing) missing.hidden = false;
        }
        form.addEventListener('submit', (event) => {
          if (!field || !field.value) {
            event.preventDefault();
            if (button) button.disabled = true;
            if (missing) missing.hidden = false;
          }
        });
      })();
    </script>
  `;
}

function renderProductImportNextActions(shopId = '') {
  const productHref = `/admin/shops/${encodeRoutePart(shopId)}#products`;
  const assetHref = `/admin/shops/${encodeRoutePart(shopId)}#assets`;
  const readinessAction = `/admin/shops/${encodeRoutePart(shopId)}/readiness-check`;
  return `<section class="checklist-card" aria-label="Product import next actions">
    <h2>Tiếp theo</h2>
    <div class="import-confirm-form">
      <a class="button-link" href="${escapeHtml(productHref)}">Quay lại Danh mục sản phẩm</a>
      <a class="button-link secondary-button" href="${escapeHtml(assetHref)}">Kiểm tra sản phẩm thiếu ảnh</a>
      <form method="post" action="${escapeHtml(readinessAction)}" style="margin: 0;">
        <button type="submit" class="button-link secondary-button">Chạy kiểm tra hoàn tất nếu cần</button>
      </form>
    </div>
  </section>`;
}

function renderProductImportResultHtml({ shopId = '', result = null, error = null } = {}) {
  const backHref = `/admin/shops/${encodeRoutePart(shopId)}#products`;
  const resultHasBlocking = Boolean(result?.blocking || result?.blocking_error_count > 0);
  const resultIsPreview = Boolean(result?.validate_only);
  const body = error
    ? `
      <p><a href="${escapeHtml(backHref)}">Quay lại Danh mục sản phẩm</a></p>
      <div class="banner banner-error" role="alert">${escapeHtml(error.message || 'Product import validation failed.')} Import chưa được áp dụng. Không có sản phẩm nào được tạo mới hoặc cập nhật.</div>
      <p class="meta">Rows received: ${escapeHtml(error.rows_received || 0)}${Array.isArray(error.ignored_columns) && error.ignored_columns.length ? ` | ignored columns: ${escapeHtml(error.ignored_columns.join(', '))}` : ''}</p>
      ${renderProductImportErrorsTable(error.errors || [])}
    `
    : !resultIsPreview
      ? `
      <p><a href="${escapeHtml(backHref)}">Quay lại Danh mục sản phẩm</a></p>
      <div class="banner banner-success" role="status">Nhập sản phẩm CSV đã hoàn tất. Import được áp dụng theo cơ chế all-or-nothing.</div>
      ${renderProductImportFinalSummaryBand(result || {})}
      <p class="meta">Ảnh đã tạo/cập nhật: ${escapeHtml(result?.image_assets_touched || 0)} | Dòng không có ảnh: ${escapeHtml(result?.product_images_skipped || 0)}</p>
      ${Array.isArray(result?.ignored_columns) && result.ignored_columns.length ? `<p class="meta">Ignored columns: ${escapeHtml(result.ignored_columns.join(', '))}</p>` : ''}
      ${renderProductImportNextActions(shopId)}
    `
    : `
      <p><a href="${escapeHtml(backHref)}">Quay lại Danh mục sản phẩm</a></p>
      <div class="banner ${resultHasBlocking ? 'banner-warning' : 'banner-success'}" role="status">${escapeHtml(result?.validate_only ? (resultHasBlocking ? 'CSV preview found blocking rows. No products were written.' : 'CSV preview passed. No products were written.') : 'Product import completed.')}</div>
      <p class="meta">Rows received: ${escapeHtml(result?.rows_received || 0)} | products created: ${escapeHtml(result?.products_created || 0)} | products updated: ${escapeHtml(result?.products_updated || 0)} | image assets touched: ${escapeHtml(result?.image_assets_touched || 0)}</p>
      ${renderProductImportSummaryBand(result || {})}
      ${Array.isArray(result?.ignored_columns) && result.ignored_columns.length ? `<p class="meta">Ignored columns: ${escapeHtml(result.ignored_columns.join(', '))}</p>` : ''}
      <h2>Server Preview</h2>
      <p class="meta">Preview is read-only, sanitized, and capped at the CSV import row limit. Final import revalidates server-side.</p>
      ${renderProductImportPreviewTable(result?.preview_rows || [])}
      ${resultHasBlocking ? renderProductImportErrorsTable(result?.errors || []) : ''}
      ${renderProductImportConfirmForm(shopId, result || {})}
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
    <h3>Thêm kết nối Fanpage (Page Mapping)</h3>
    <label>ID Trang (Page ID) <span class="required">bắt buộc</span><input name="page_id" maxlength="120" required aria-required="true" autocomplete="off" pattern="[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}"><span class="page-id-help">ID Trang Facebook dạng số. Bạn có thể tìm thấy tại <strong>Cài đặt Trang Facebook &rarr; Giới thiệu</strong> hoặc trong URL của trang. Bảo mật giá trị này cẩn thận &mdash; nó liên kết bot với một trang cụ thể.</span></label>
    <label>Tên Trang (Không bắt buộc)<input name="page_name" maxlength="180"></label>
    <div class="form-actions"><button type="submit">Thêm liên kết Trang</button><span class="meta">Chỉ tạo liên kết định danh. Mã Token gửi tin sẽ được điền riêng ở cột bên phải bên dưới.</span></div>
  </form>`;
}

function renderCredentialReplacementSafetyList() {
  const items = [
    'Không dán token staging vào production.',
    'Token sẽ được mã hóa bằng khóa của môi trường hiện tại.',
    'Token không hiển thị lại sau khi lưu.',
    'Thay token có thể ảnh hưởng khả năng bot trả lời nếu token sai môi trường, hết quyền, hoặc không thuộc Page này.',
    'Không tự động gọi Meta Graph API hoặc chạy kiểm tra sức khỏe token khi lưu.',
    'Sau khi thay token, hãy chạy lại kiểm tra hoàn tất.'
  ];
  return `<ul class="credential-safety-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderPageCredentialForm(shopId = '', page = {}, shop = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/pages/${encodeRoutePart(page.id)}/credentials`;
  const isReplacing = Number(page.active_credential_count || 0) > 0;
  const expectedShopSlug = String(shop.slug || shop.id || shopId || '').trim();
  const credentialSafetyList = renderCredentialReplacementSafetyList();

  if (isReplacing) {
    const warningText = 'Bạn đang chuẩn bị thay thế mã Token đang hoạt động của Fanpage. Không dán token staging vào production.';
    const consequenceText = 'Token sẽ được mã hóa bằng khóa của môi trường hiện tại. Token không hiển thị lại sau khi lưu. Không có Meta/token health check tự động; bot có thể mất khả năng trả lời nếu token không đúng. Sau khi thay token, hãy chạy lại kiểm tra hoàn tất.';
    return `<div class="credential-replace-panel" data-credential-replacement="true">
      <h4>Thay thế Quyền gửi tin (Token)</h4>
      <p>Đây là thay đổi nhạy cảm với môi trường. Token mới chỉ được lưu mã hóa và không được hiển thị lại.</p>
      ${credentialSafetyList}
      <form class="product-form compact" method="post" action="${escapeHtml(action)}" data-danger-confirm="true" data-danger-confirm-scope="credential-replacement" data-action-title="Thay thế Quyền gửi tin (Token)" data-warning-text="${escapeHtml(warningText)}" data-consequence-text="${escapeHtml(consequenceText)}" data-checkbox-text="Tôi hiểu thay token có thể ảnh hưởng khả năng bot trả lời và hệ thống không chạy kiểm tra Meta tự động." data-countdown-seconds="3" data-submit-label="Thay thế mã Token" data-expected-confirm-text="ROTATE" data-shop-slug="${escapeHtml(expectedShopSlug)}">
      <input type="hidden" name="credential_type" value="fb_page_token">
      <input type="hidden" name="rotate" value="true">
      <div class="credential-confirm-grid">
        <label>Mã Token mới <span class="required">bắt buộc</span><input name="token" type="password" minlength="20" maxlength="5000" required aria-required="true" autocomplete="new-password"></label>
        <label class="credential-js-fallback-control">Nhập mã cửa hàng <code>${escapeHtml(expectedShopSlug)}</code> <span class="required">bắt buộc</span>
          <input name="shop_slug_confirmation" maxlength="160" required aria-required="true" autocomplete="off" pattern="${escapeHtml(escapeHtmlPattern(expectedShopSlug))}" title="Nhập đúng shop slug để xác nhận." data-js-confirm-fallback="true">
        </label>
        <label>Xác nhận bằng chữ ROTATE <span class="required">bắt buộc</span>
          <input name="confirmation_text" placeholder="ROTATE" maxlength="20" required aria-required="true" autocomplete="off" pattern="ROTATE" data-confirm-text-input="true">
        </label>
        <label class="checkbox-label credential-js-fallback-control">
          <input type="checkbox" name="operator_ack" value="credential-replace-risk" required aria-required="true" data-js-confirm-fallback="true">
          Tôi hiểu token phải nhập đúng môi trường và việc thay token có thể làm bot không trả lời được.
        </label>
      </div>
      <p class="credential-no-js-note">Khi bật JavaScript, bước cuối sẽ mở hộp xác nhận yêu cầu checkbox, nhập shop slug và chờ 3 giây trước khi gửi. Không có kiểm tra Meta tự động trong thao tác này.</p>
      <div class="form-actions"><button type="submit">Thay thế mã Token</button></div>
    </form>
    </div>`;
  }

  return `<form class="product-form compact" method="post" action="${escapeHtml(action)}">
    <input type="hidden" name="credential_type" value="fb_page_token">
    <label>Mã Token kết nối <span class="required">bắt buộc</span><input name="token" type="password" minlength="20" maxlength="5000" required aria-required="true" autocomplete="new-password"></label>
    <label class="checkbox-label">
      <input type="checkbox" name="rotate" value="true">
      Thay thế (Rotate) mã Token cũ đang hoạt động
    </label>
    <div class="form-actions"><button type="submit">Lưu mã Token</button></div>
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

function resolveAdminEnvironmentBadge(env = process.env) {
  const values = [
    env.ADMIN_ENV,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.NODE_ENV
  ].map(value => String(value || '').trim().toLowerCase());
  if (values.some(value => value.includes('prod'))) return { label: 'production', className: 'env-production' };
  if (values.some(value => value.includes('staging'))) return { label: 'staging', className: 'env-staging' };
  return { label: 'local', className: 'env-local' };
}

function isAdultShopView(shop = {}) {
  return [shop.id, shop.slug]
    .map(value => String(value || '').trim().toLowerCase())
    .includes('adult-shop');
}

function pageStatus(page = {}) {
  return String(page.status || '').trim().toLowerCase();
}

function isShopReadinessStale(shop = {}) {
  return String(shop.last_readiness_status || '').trim().toLowerCase() === 'unknown'
    && !shop.last_readiness_checked_at;
}

function renderPageCredentialCount(page = {}) {
  if (page.active_credential_count == null) return '<span class="meta">unknown</span>';
  return escapeHtml(Number(page.active_credential_count || 0));
}

function renderPageArchiveForm(shopId = '', page = {}, shop = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/pages/${encodeRoutePart(page.id)}/archive`;
  return `<form class="product-form compact inline-action danger" method="post" action="${escapeHtml(action)}" data-danger-confirm="true" data-action-title="Lưu trữ liên kết Fanpage" data-warning-text="Hành động này sẽ ngắt kết nối Fanpage khỏi cửa hàng." data-consequence-text="Bot sẽ không nhận được tin nhắn và không thể gửi tin nhắn tự động qua trang này nữa. Credentials liên kết cũng sẽ bị lưu trữ." data-submit-label="Lưu trữ liên kết Fanpage" data-expected-confirm-text="ARCHIVE MAPPING" data-shop-slug="${escapeHtml(shop.slug || '')}">
    <input type="hidden" name="source" value="admin_ui">
    <label>Nhập từ khóa xác nhận
      <input name="confirmation_text" maxlength="80" required aria-required="true" autocomplete="off" placeholder="ARCHIVE MAPPING" data-confirm-text-input="true">
    </label>
    <div class="form-actions"><button type="submit">Lưu trữ liên kết Fanpage</button></div>
  </form>`;
}

function renderActivePageMappingsTable({
  shopId = '',
  pages = [],
  pageSetupPreviewMode = false,
  archiveEnabled = false,
  shop = {}
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
      <td>${pageSetupPreviewMode ? renderPageCredentialPreviewDisabled() : renderPageCredentialForm(shopId, page, shop)}</td>
      ${archiveEnabled ? `<td>${renderPageArchiveForm(shopId, page, shop)}</td>` : ''}
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

function resolveActiveCredentialCount(model = {}, activeMappings = []) {
  const counts = activeMappings
    .map(page => page.active_credential_count)
    .filter(value => value != null)
    .map(value => Number(value || 0));
  if (counts.length) return counts.reduce((sum, value) => sum + value, 0);
  if (model.onboarding?.counts?.active_credential_count != null) {
    return Number(model.onboarding.counts.active_credential_count || 0);
  }
  if (model.credentials?.active_fb_page_token_count != null) {
    return Number(model.credentials.active_fb_page_token_count || 0);
  }
  return 0;
}

function resolveFanpageConnectionState({ activeMappingCount = 0, activeCredentialCount = 0 } = {}) {
  if (activeMappingCount > 1 || activeCredentialCount > 1) {
    return {
      code: 'S6',
      label: 'XUNG ĐỘT KẾT NỐI',
      className: 'state-danger',
      help: 'Có nhiều liên kết hoặc nhiều quyền gửi tin đang hoạt động. Cần kỹ thuật kiểm tra trước khi vận hành.'
    };
  }
  if (activeMappingCount === 0) {
    return {
      code: 'S0',
      label: 'CHƯA KẾT NỐI',
      className: 'state-danger',
      help: 'Shop chưa có Page Mapping đang hoạt động nên bot chưa biết tin nhắn từ Page nào thuộc shop này.'
    };
  }
  if (activeMappingCount === 1 && activeCredentialCount === 0) {
    return {
      code: 'S1',
      label: 'THIẾU QUYỀN GỬI TIN',
      className: 'state-warning',
      help: 'Shop đã biết Page nhận tin nhưng chưa có token được mã hóa để bot trả lời khách.'
    };
  }
  if (activeMappingCount === 1 && activeCredentialCount === 1) {
    return {
      code: 'S2',
      label: 'ĐÃ KẾT NỐI',
      className: 'state-ok',
      help: 'Shop có đúng một Page Mapping và một quyền gửi tin đang hoạt động.'
    };
  }
  return {
    code: 'UNKNOWN',
    label: 'CẦN KIỂM TRA',
    className: 'state-neutral',
    help: 'Trạng thái hiện tại không khớp mẫu vận hành chuẩn. Cần kiểm tra dữ liệu trước khi chạy thật.'
  };
}

function renderFanpageConnectionCard(model = {}) {
  const shop = model.shop || {};
  const pages = Array.isArray(model.pages) ? model.pages : [];
  const activeMappings = pages.filter(page => pageStatus(page) === 'active');
  const activeCredentialCount = resolveActiveCredentialCount(model, activeMappings);
  const state = resolveFanpageConnectionState({
    activeMappingCount: activeMappings.length,
    activeCredentialCount
  });
  const envBadge = resolveAdminEnvironmentBadge();
  const activeRefs = activeMappings
    .map(page => page.page_ref || (page.page_id ? pageRef(page.page_id) : ''))
    .filter(Boolean);
  const primaryRef = activeRefs.length === 1 ? activeRefs[0] : '';
  const tokenCta = activeMappings.length === 1
    ? '<a class="button-link" href="#page-credential-actions">Thay thế Token</a>'
    : '<button type="button" class="connection-action-disabled" disabled>Thay thế Token</button>';

  return `
    <section class="connection-card" aria-label="Current Fanpage connection">
      <div class="connection-card-header">
        <div>
          <h3>Current Connection / Kết nối hiện tại</h3>
          <p class="meta">Kết nối Fanpage = cho ZenBot biết tin nhắn từ Page nào thuộc shop này.</p>
        </div>
        <span class="environment-badge ${escapeHtml(envBadge.className)}">Môi trường: ${escapeHtml(envBadge.label)}</span>
      </div>
      <div class="connection-state-row">
        <span class="connection-state-label ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
        <span class="meta">${escapeHtml(state.code)} - ${escapeHtml(state.help)}</span>
      </div>
      ${isShopReadinessStale(shop) ? '<p class="meta">Cần chạy lại kiểm tra hoàn tất</p>' : ''}
      <div class="connection-summary-grid">
        <div class="connection-summary-item">
          <span>Active mapping</span>
          <strong>${escapeHtml(activeMappings.length)}</strong>
          <span class="meta">${primaryRef ? `Page ref ${escapeHtml(primaryRef)}` : 'Không hiển thị Page ID thô'}</span>
        </div>
        <div class="connection-summary-item">
          <span>Quyền gửi tin</span>
          <strong>${escapeHtml(activeCredentialCount)}</strong>
          <span class="meta">Token được mã hóa để bot trả lời khách.</span>
        </div>
        <div class="connection-summary-item">
          <span>Token visibility</span>
          <strong>Không hiển thị lại</strong>
          <span class="meta">Token không bao giờ hiển thị lại sau khi lưu.</span>
        </div>
      </div>
      ${activeRefs.length > 1 ? `
        <div class="empty">
          <strong>Page refs đang active:</strong>
          ${activeRefs.map(ref => `<code>${escapeHtml(ref)}</code>`).join(' ')}
        </div>
      ` : ''}
      <ul class="connection-notes">
        <li>Token phải nhập đúng môi trường vì staging/prod keys khác nhau.</li>
        <li>Không tự động kiểm tra Meta trong màn hình này.</li>
      </ul>
      <div class="connection-actions" id="connection-actions">
        ${tokenCta}
        <button type="button" class="connection-action-disabled" disabled title="Chưa triển khai thay thế Trang trong tác vụ này">Thay thế Trang</button>
        <span class="meta">Các nút thay thế là lối vào UX; tác vụ này không đổi hành vi thay thế.</span>
      </div>
    </section>
  `;
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
    <section class="asset-group" id="page-credential-actions">
      <h3>Active Mappings</h3>
      ${renderActivePageMappingsTable({
        shopId: shop.id,
        pages: activeMappings,
        pageSetupPreviewMode,
        archiveEnabled: canArchive,
        shop
      })}
    </section>
    ${otherMappings.length ? `
      <section class="asset-group">
        <h3>Other Mappings</h3>
        ${renderReadOnlyPageMappingsTable(otherMappings)}
      </section>
    ` : ''}
    ${archivedMappings.length ? `<details class="collapsible-section">
      <summary>Archived Mappings (${escapeHtml(archivedMappings.length)})</summary>
      ${renderReadOnlyPageMappingsTable(archivedMappings)}
    </details>` : ''}
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

function renderDryRunControls(shop = {}) {
  const shopId = String(shop.id || '');
  const dryRun = shop.dry_run;
  const readinessStatus = String(shop.last_readiness_status || '').toLowerCase();
  const enableAction = `/admin/shops/${encodeRoutePart(shopId)}/dry-run/enable`;
  const disableAction = `/admin/shops/${encodeRoutePart(shopId)}/dry-run/disable`;

  const globalNote = '<p class="meta"><strong>Lưu ý:</strong> Chế độ an toàn toàn cục <code>MESSENGER_DRY_RUN=true</code> đang bật và sẽ luôn ngăn tất cả tin nhắn thật gửi đi, bất kể cấu hình riêng của shop này.</p>';

  // dry_run=false → show warning and re-enable form
  if (dryRun === false) {
    return `
      <div class="banner banner-warning" role="alert" id="dry-run-warning">
        <strong>&#9888; Cửa hàng đang ở chế độ CHẠY THẬT (Gửi tin nhắn thật).</strong>
        Chế độ test an toàn hiện đang <strong>TẮT</strong>. Tin nhắn có thể được gửi trực tiếp đến người dùng thật nếu hệ thống toàn cục cho phép.
        Sử dụng biểu mẫu bên dưới để bật lại chế độ test an toàn.
      </div>
      ${globalNote}
      <form class="settings-form compact" method="post" action="${escapeHtml(enableAction)}" id="form-enable-dry-run" data-danger-confirm="true" data-action-title="Bật lại chế độ test an toàn cho cửa hàng" data-warning-text="Bạn chuẩn bị bật lại chế độ test an toàn cho cửa hàng." data-consequence-text="Bot sẽ chuyển sang chế độ test giả lập an toàn và không gửi tin nhắn Messenger thật đến khách hàng nữa." data-submit-label="Bật chế độ an toàn" data-expected-confirm-text="ENABLE DRY RUN" data-shop-slug="${escapeHtml(shop.slug || '')}">
        <label>Nhập từ khóa xác nhận
          <input name="confirmation_text" placeholder="ENABLE DRY RUN" maxlength="40" required aria-required="true" autocomplete="off" data-confirm-text-input="true">
        </label>
        <div class="form-actions">
          <button type="submit">Bật lại chế độ test an toàn cho cửa hàng</button>
          <span class="meta">Nhập chính xác từ khóa <code>ENABLE DRY RUN</code> để xác nhận.</span>
        </div>
      </form>`;
  }

  // dry_run=true, readiness passed → show allow-real-send form
  if (dryRun === true && readinessStatus === 'passed') {
    return `
      ${globalNote}
      <form class="settings-form compact" method="post" action="${escapeHtml(disableAction)}" id="form-disable-dry-run" data-danger-confirm="true" data-action-title="Tắt chế độ test an toàn (Cho phép gửi thật)" data-warning-text="Bạn chuẩn bị tắt chế độ test an toàn cho cửa hàng." data-consequence-text="Hành động này cho phép bot gửi tin nhắn Messenger thật cho cửa hàng này nếu chế độ an toàn toàn cục cũng tắt. Vui lòng kiểm tra kỹ cấu hình trước khi xác nhận." data-submit-label="Cho phép gửi tin thật" data-expected-confirm-text="DISABLE DRY RUN" data-shop-slug="${escapeHtml(shop.slug || '')}">
        <label>Nhập từ khóa xác nhận <span class="required">bắt buộc</span>
          <input name="confirmation_text" placeholder="DISABLE DRY RUN" maxlength="40" required aria-required="true" autocomplete="off" data-confirm-text-input="true">
        </label>
        <div class="form-actions">
          <button type="submit" class="inline-action warning">Tắt chế độ test an toàn (Cho phép gửi thật)</button>
          <span class="meta">Nhập chính xác <code>DISABLE DRY RUN</code>. Yêu cầu trạng thái kiểm tra sẵn sàng phải ĐẠT. Không tự động bật live_enabled hay chuyển lifecycle thành live.</span>
        </div>
      </form>`;
  }

  // dry_run=true, readiness not passed → informational only
  return `
    ${globalNote}
    <p class="meta" id="dry-run-gate-note">Để tắt chế độ test an toàn, trạng thái kiểm tra sẵn sàng phải là <code>passed</code> (Đạt). Hiện tại: <strong>${escapeHtml(readinessStatus || 'unknown')}</strong>. Vui lòng chạy kiểm tra trước.</p>`;
}

function renderShopEmergencyControls(shop = {}) {
  const status = String(shop.status || '').trim().toLowerCase();
  const pauseAction = `/admin/shops/${encodeRoutePart(shop.id)}/pause`;
  const resumeAction = `/admin/shops/${encodeRoutePart(shop.id)}/resume`;
  const pauseForm = `
    <form class="settings-form compact" method="post" action="${escapeHtml(pauseAction)}" data-danger-confirm="true" data-action-title="Tạm dừng hoạt động Bot" data-warning-text="Bạn đang thực hiện tạm dừng hoạt động của Bot cho cửa hàng này." data-consequence-text="Tạm dừng sẽ ngắt mọi phản hồi tự động của bot, kích hoạt lại test an toàn, tắt chạy thật và giữ nguyên toàn bộ dữ liệu." data-submit-label="Tạm dừng hoạt động Bot" data-expected-confirm-text="PAUSE SHOP" data-shop-slug="${escapeHtml(shop.slug || '')}">
      <label>Nhập từ khóa xác nhận
        <input name="confirmation_text" placeholder="PAUSE SHOP" maxlength="40" required aria-required="true" data-confirm-text-input="true">
      </label>
      <div class="form-actions">
        <button type="submit">Tạm dừng hoạt động Bot</button>
        <span class="meta">Tạm dừng sẽ ngắt mọi phản hồi tự động của bot, kích hoạt lại test an toàn, tắt chạy thật và giữ nguyên toàn bộ dữ liệu.</span>
      </div>
    </form>`;
  const resumeForm = `
    <form class="settings-form compact" method="post" action="${escapeHtml(resumeAction)}" data-danger-confirm="true" data-action-title="Kích hoạt lại hoạt động Bot" data-warning-text="Bạn chuẩn bị kích hoạt lại hoạt động của Bot cho cửa hàng này." data-consequence-text="Kích hoạt lại sẽ đưa bot hoạt động trở lại ở chế độ test an toàn và tắt chạy thật." data-submit-label="Kích hoạt lại hoạt động Bot" data-expected-confirm-text="RESUME SHOP" data-shop-slug="${escapeHtml(shop.slug || '')}">
      <label>Nhập từ khóa xác nhận
        <input name="confirmation_text" placeholder="RESUME SHOP" maxlength="40" required aria-required="true" data-confirm-text-input="true">
      </label>
      <div class="form-actions">
        <button type="submit">Kích hoạt lại hoạt động Bot</button>
        <span class="meta">Kích hoạt lại sẽ đưa bot hoạt động trở lại ở chế độ test an toàn và tắt chạy thật.</span>
      </div>
    </form>`;
  if (status === 'active') return pauseForm;
  if (status === 'paused') return resumeForm;
  return '<p class="meta">Tính năng tạm dừng/kích hoạt lại khẩn cấp chỉ áp dụng cho shop đang hoạt động hoặc đang tạm dừng.</p>';
}

function isDeleteDraftShopEligible(shop = {}, model = {}) {
  // Block if protected slugs
  const protectedSlugs = ['adult-shop', 'demo-shop', 'nem-bui-xa'];
  const slug = String(shop.slug || '').trim().toLowerCase();
  const id = String(shop.id || '').trim().toLowerCase();
  const isProtected = protectedSlugs.includes(slug)
    || protectedSlugs.includes(id)
    || slug.includes('production')
    || slug.includes('prod')
    || id.includes('production')
    || id.includes('prod');

  if (isProtected) {
    return { eligible: false, reason: 'Shop này nằm trong danh sách bảo vệ hệ thống (chứa từ khóa nhạy cảm hoặc được bảo vệ).' };
  }

  // Block if live
  const lifecycle = String(shop.lifecycle || '').trim().toLowerCase();
  if (shop.live_enabled === true || lifecycle === 'live') {
    return { eligible: false, reason: 'Shop đang ở trạng thái hoạt động (live_enabled hoặc lifecycle=live).' };
  }

  // Block if not in draft/configuring
  if (lifecycle !== 'draft' && lifecycle !== 'configuring') {
    return { eligible: false, reason: 'Chỉ có thể xóa shop đang ở trạng thái thiết lập (draft hoặc configuring).' };
  }

  // Block if active page mappings
  const activeMappings = Array.isArray(model.pages) && model.pages.filter(page => pageStatus(page) === 'active');
  if (activeMappings && activeMappings.length > 0) {
    return { eligible: false, reason: 'Shop đã kết nối với Fanpage. Vui lòng gỡ liên kết trang trước.' };
  }

  // Block if credentials exist
  const hasCredentials = Array.isArray(model.pages) && model.pages.some(page => Number(page.active_credential_count || 0) > 0);
  if (hasCredentials) {
    return { eligible: false, reason: 'Shop đã có cấu hình Quyền gửi tin (Facebook Page Token).' };
  }

  // Block if customer conversations/messages/orders exist
  const health = model.health || {};
  if (Number(health.active_handoffs || 0) > 0 || Number(health.queue_total || 0) > 0) {
    return { eligible: false, reason: 'Shop có tiến trình hoạt động (active handoffs hoặc queue).' };
  }

  return { eligible: true };
}

function renderDeleteDraftShopSection(shop = {}, model = {}) {
  const check = isDeleteDraftShopEligible(shop, model);
  const action = `/admin/shops/${encodeRoutePart(shop.id)}/delete-draft`;

  if (check.eligible) {
    return `
      <p class="meta">Cửa hàng nháp này đủ điều kiện xóa vì chưa từng hoạt động thật và không có dữ liệu quan trọng liên kết.</p>
      <form class="settings-form compact" method="post" action="${escapeHtml(action)}" data-danger-confirm="true" data-action-title="Xóa vĩnh viễn Cửa hàng nháp" data-warning-text="Bạn đang chuẩn bị XÓA VĨNH VIỄN cửa hàng nháp này." data-consequence-text="Hành động này là hoàn toàn KHÔNG THỂ HOÀN TÁC. Toàn bộ thông tin cấu hình, sản phẩm nháp và thiết lập của cửa hàng sẽ bị xóa vĩnh viễn khỏi hệ thống." data-submit-label="Xóa vĩnh viễn Cửa hàng" data-expected-confirm-text="DELETE DRAFT" data-shop-slug="${escapeHtml(shop.slug || '')}">
        <label>Nhập từ khóa xác nhận <span class="required">bắt buộc</span>
          <input name="confirmation_text" placeholder="DELETE DRAFT" maxlength="40" required aria-required="true" autocomplete="off" data-confirm-text-input="true">
        </label>
        <div class="form-actions">
          <button type="submit" style="background: var(--danger); border-color: var(--danger);">Xóa shop nháp</button>
          <span class="meta">Nhập chính xác <code>DELETE DRAFT</code> để xác nhận hành động vĩnh viễn này.</span>
        </div>
      </form>
    `;
  } else {
    return `
      <p class="meta">Trạng thái xóa: <span class="status status-neutral">Không khả dụng (Blocked)</span></p>
      <div class="banner banner-warning">
        ⚠️ <strong>Không thể xóa:</strong> ${escapeHtml(check.reason)}
      </div>
      <button type="button" class="button-link secondary-button" disabled style="cursor: not-allowed; opacity: 0.6; pointer-events: none;">Không thể xóa — chỉ có thể lưu trữ</button>
      <p class="meta">Khuyến nghị: Bạn có thể thay đổi vòng đời của shop thành <strong>archived</strong> (lưu trữ) trong biểu mẫu Vòng đời hoạt động ở trên để ngắt hoàn toàn hoạt động của shop một cách an toàn.</p>
    `;
  }
}

function renderControlPlaneForm(shop = {}, model = {}) {
  const onboarding = model.onboarding || {};
  const action = `/admin/shops/${encodeRoutePart(shop.id)}/control-plane`;
  const readinessAction = `/admin/shops/${encodeRoutePart(shop.id)}/readiness-check`;
  const liveChecked = shop.live_enabled ? ' checked' : '';
  const blockers = (onboarding.checklist || []).filter(row => !row.passed);
  const hardBlockers = Array.isArray(onboarding.hard_blockers) ? onboarding.hard_blockers : [];
  const warnings = Array.isArray(onboarding.warnings) ? onboarding.warnings : [];
  const statusSummary = hardBlockers.length
    ? renderReadinessIssues('Lỗi chặn chưa hoàn tất (Hard blockers)', hardBlockers, 'banner-error')
    : (blockers.length ? `<div class="banner banner-error" role="status">Lỗi chặn chưa hoàn tất: ${escapeHtml(blockers.map(row => row.label || row.key).join(', '))}</div>` : '<div class="banner banner-success" role="status">Không có lỗi chặn nào hiện tại.</div>');
  return `<section id="control-plane" aria-label="Shop control plane">
    <h2>Vận hành an toàn / Control Plane</h2>
    <p class="meta">Bảng điều khiển nội bộ dành cho quản trị viên và vận hành viên hệ thống.</p>

    <div class="safety-stack">
      <section class="safety-section" aria-labelledby="safety-operational-status">
        <h3 id="safety-operational-status">Operational status</h3>
        <p class="meta">Normal checks, readiness, and current safe-state signals for this shop.</p>
        <table class="safety-status-table"><tbody>
          <tr><th>Trạng thái hiện tại</th><td>${renderStatus(shop.status || 'unknown')}</td></tr>
          <tr><th>Gói dịch vụ (Package)</th><td>${escapeHtml(shop.package || 'basic')}</td></tr>
          <tr><th>Vòng đời hoạt động (Lifecycle)</th><td>${renderStatus(shop.lifecycle || 'unknown')}</td></tr>
          <tr><th>Chế độ test an toàn (dry_run)</th><td>${renderDryRunStatus(shop.dry_run)}</td></tr>
          <tr><th>Cho phép chạy thật (live_enabled)</th><td>${renderStatus(shop.live_enabled ? 'enabled' : 'disabled')}</td></tr>
          <tr><th>Kiểm tra hoàn tất (Readiness)</th><td>${renderStatus(shop.last_readiness_status || 'unknown')}${isShopReadinessStale(shop) ? '<br><span class="meta">Cần chạy lại kiểm tra hoàn tất</span>' : ''}</td></tr>
          <tr><th>Lần kiểm tra hoàn tất cuối</th><td>${escapeHtml(formatDate(shop.last_readiness_checked_at))}</td></tr>
          <tr><th>Kiểm tra thủ công (Manual test)</th><td>${renderStatus(shop.last_manual_test_status || 'unknown')}</td></tr>
          <tr><th>Lần kiểm tra thủ công cuối</th><td>${escapeHtml(formatDate(shop.last_manual_test_at))}</td></tr>
          <tr><th>Người duyệt cuối</th><td>${escapeHtml(shop.last_ready_by || '')}</td></tr>
        </tbody></table>
        <div class="safety-callouts">
          ${statusSummary}
          ${warnings.length ? renderReadinessIssues('Cảnh báo (Warnings)', warnings, 'banner-warning') : ''}
        </div>
        <form class="settings-form compact" method="post" action="${escapeHtml(readinessAction)}">
          <div class="form-actions">
            <button type="submit">Chạy lại kiểm tra hoàn tất</button>
            <span class="meta">Chỉ cập nhật trạng thái kiểm tra sẵn sàng và thời gian kiểm tra.</span>
          </div>
        </form>
      </section>

      <section class="safety-section" aria-labelledby="safety-operate">
        <h3 id="safety-operate">Operate</h3>
        <p class="meta">Routine operating controls for pause/resume, safe test mode, package, lifecycle, live flag, and manual test status.</p>
        <div class="safety-operate-grid">
          <div class="safety-operate-card">
            <h4>Emergency controls</h4>
            <p class="meta">Pause or resume the bot without changing stored shop data.</p>
            ${renderShopEmergencyControls(shop)}
          </div>
          <div class="safety-operate-card">
            <h4>Chế độ test an toàn</h4>
            <p class="meta">Cấu hình <code>dry_run</code> để giữ bot trong chế độ giả lập an toàn hoặc cho phép gửi thật khi đủ điều kiện.</p>
            ${renderDryRunControls(shop)}
          </div>
        </div>
        <form class="settings-form" method="post" action="${escapeHtml(action)}">
          <label>Gói dịch vụ (Package)
            <select name="package">${renderControlPlaneOptions(['basic', 'sales_flow', 'self_closing_addons'], shop.package || 'basic')}</select>
          </label>
          <label>Vòng đời hoạt động (Lifecycle)
            <select name="lifecycle">${renderControlPlaneOptions(['draft', 'configuring', 'ready', 'live', 'paused', 'archived'], shop.lifecycle || 'draft')}</select>
          </label>
          <input type="hidden" name="live_enabled" value="false">
          <label class="checkbox-label">
            <input type="checkbox" name="live_enabled" value="true"${liveChecked}>
            live_enabled (Cho phép chạy thật)
          </label>
          <label>Trạng thái kiểm tra thủ công
            <select name="manual_test_status">${renderControlPlaneOptions(['unknown', 'passed', 'failed'], shop.last_manual_test_status || 'unknown')}</select>
          </label>
          <label class="checkbox-label" style="grid-column: 1 / -1; margin-top: 6px;">
            <input type="checkbox" name="confirm_live" value="true">
            <strong>Xác nhận cho phép chạy thật / thay đổi vòng đời chạy thật</strong>
          </label>
          <label class="checkbox-label" style="grid-column: 1 / -1;">
            <input type="checkbox" name="override_readiness" value="true">
            Bỏ qua các lỗi chặn kiểm tra sẵn sàng (Chỉ dành cho Quản trị viên)
          </label>
          <label class="checkbox-label" style="grid-column: 1 / -1;">
            <input type="checkbox" name="confirm_pause_archive" value="true">
            Xác nhận tạm dừng / lưu trữ vòng đời hoạt động
          </label>
          <div class="form-actions" style="margin-top: 12px;">
            <button type="submit">Lưu cấu hình vận hành</button>
            <span class="meta">Các thay đổi quan trọng đều được ghi nhận vào nhật ký hệ thống. Biểu mẫu này không kích hoạt các tính năng chưa hoàn thiện.</span>
          </div>
        </form>
      </section>

      <details class="safety-section safety-danger-zone">
        <summary><h3>Advanced / Danger Zone</h3></summary>
        <div class="safety-danger-content">
          <p class="meta">Destructive or irreversible shop actions are isolated here. Routine operating controls remain above.</p>
          <div class="safety-danger-card">
            <h4>Xóa cửa hàng nháp (Draft Shop Deletion)</h4>
            <p class="meta">Chỉ cho phép xóa các cửa hàng nháp chưa từng đi vào hoạt động thật (Go-Live) và không có dữ liệu khách hàng quan trọng. Đối với các shop đã chạy thật, bạn chỉ có thể Lưu trữ (Archive) shop.</p>
            ${renderDeleteDraftShopSection(shop, model)}
          </div>
        </div>
      </details>
    </div>
  </section>`;
}

function renderProductEditForm(shopId = '', product = {}) {
  const action = `/admin/shops/${encodeRoutePart(shopId)}/products/${encodeRoutePart(product.id)}`;
  return `<form class="product-form compact" method="post" action="${escapeHtml(action)}" data-current-code="${escapeHtml(product.code || '')}">
    <fieldset>
      <legend>Thông tin cơ bản</legend>
      <label>Code <span class="required">required</span>
        <input name="code" value="${escapeHtml(product.code)}" maxlength="80" required aria-required="true">
        <span class="help">Mã khách nhắn cho bot để xem chi tiết (Ví dụ: M1, M2).</span>
        <span class="js-duplicate-code-hint duplicate-code-hint" role="alert"></span>
      </label>
      <label>Name/title <span class="required">required</span><input name="name" value="${escapeHtml(product.name)}" maxlength="180" required aria-required="true"></label>
      <label>Price text<input name="price_text" value="${escapeHtml(product.price_text || product.price || '')}" maxlength="120"></label>
    </fieldset>
    <fieldset>
      <legend>Phản hồi khách hàng</legend>
      <label class="wide">Description<textarea name="description" maxlength="2000">${escapeHtml(product.description || '')}</textarea></label>
    </fieldset>
    <fieldset>
      <legend>Điều khiển nội bộ</legend>
      <label>Sort order<input name="sort_order" type="number" value="${escapeHtml(product.sort_order || 0)}"></label>
      <label>Category<input name="category" value="${escapeHtml(product.category || '')}" maxlength="80"></label>
      <label>Tags<input name="tags" value="${escapeHtml(Array.isArray(product.tags) ? product.tags.join(', ') : '')}" maxlength="240"></label>
      <span class="help wide">Mã sản phẩm là dấu vết lịch sử. Không dùng lại mã của sản phẩm đã lưu trữ.</span>
    </fieldset>
    <div class="form-actions"><button type="submit" class="js-product-save-btn">Lưu thay đổi (Cập nhật)</button><button type="button" class="js-cancel-drawer secondary-button">Hủy bỏ</button></div>
  </form>`;
}

function renderProductStatusActions(shopId = '', product = {}) {
  const status = String(product.status || '').toLowerCase();
  const statusAction = `/admin/shops/${encodeRoutePart(shopId)}/products/${encodeRoutePart(product.id)}/status`;
  const archiveAction = `/admin/shops/${encodeRoutePart(shopId)}/products/${encodeRoutePart(product.id)}/archive`;

  if (status === 'archived') {
    // Disabled placeholders — full restore and draft-delete flows land in P1.2e3b2+.
    return `
      <button type="button" class="inline-action" disabled title="Sẽ khả dụng ở bước khôi phục sản phẩm.">Khôi phục</button>
      <button type="button" class="inline-action" disabled title="Chỉ khả dụng cho sản phẩm nháp chưa có lịch sử, sẽ làm ở bước riêng.">Xóa nháp</button>
    `;
  }

  const nextEnabled = status === 'active' ? 'false' : 'true';
  const toggleLabel = status === 'active' ? 'Tạm ẩn' : 'Hiện lại';
  return `
    <form class="inline-action secondary" method="post" action="${escapeHtml(statusAction)}">
      <input type="hidden" name="enabled" value="${escapeHtml(nextEnabled)}">
      <button type="submit">${escapeHtml(toggleLabel)}</button>
    </form>
    <form class="inline-action danger" method="post" action="${escapeHtml(archiveAction)}" data-product-archive="true" data-product-name="${escapeHtml(product.name || '')}" data-product-code="${escapeHtml(product.code || '')}">
      <button type="submit">Lưu trữ</button>
    </form>
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
    <form class="inline-action danger" method="post" action="${escapeHtml(archiveAction)}" data-danger-confirm="true" data-action-title="Lưu trữ hình ảnh" data-warning-text="Bạn chuẩn bị lưu trữ hình ảnh này." data-consequence-text="Hình ảnh sẽ bị ẩn khỏi trạng thái hoạt động nhưng không bị xóa khỏi hệ thống." data-submit-label="Lưu trữ hình ảnh" data-shop-slug="${escapeHtml(shopId)}">
      <button type="submit">Lưu trữ hình ảnh</button>
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
    <label class="wide">Tin nhắn chuyển giao (Handoff message)
      <textarea name="handoff_message" maxlength="1000">${escapeHtml(settings?.handoff_message || '')}</textarea>
      <span class="help">Sent when the bot hands a customer to staff. / Tin nhắn tự động gửi cho khách khi bot chuyển cuộc hội thoại cho nhân viên trực fanpage hỗ trợ (khi khách yêu cầu gặp nhân viên hoặc khi bot không hiểu câu hỏi của khách).</span>
    </label>
    <label class="wide">Tin nhắn giới thiệu Menu (Menu intro text)
      <textarea name="menu_intro_text" maxlength="1000">${escapeHtml(settings?.menu_intro_text || '')}</textarea>
      <span class="help">Shown before menu or product-list content. / Lời chào dẫn dắt gửi kèm hình ảnh thực đơn/danh mục khi khách gõ chữ "menu" hoặc khi khách muốn xem danh sách sản phẩm.</span>
    </label>
    <label class="wide">Tin nhắn dự phòng (Fallback text)
      <textarea name="fallback_text" maxlength="1000">${escapeHtml(settings?.fallback_text || '')}</textarea>
      <span class="help">Used when the bot cannot confidently answer. / Tin nhắn tự động gửi khi bot không nhận diện được câu hỏi của khách hàng (nhằm xin lỗi lịch sự và hướng dẫn khách gõ đúng mã sản phẩm).</span>
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

  const onboarding = model.onboarding || {};
  const hasActiveMapping = Array.isArray(model.pages) && model.pages.some(page => pageStatus(page) === 'active');
  const hasActiveCredential = Array.isArray(model.pages) && model.pages.some(page => pageStatus(page) === 'active' && Number(page.active_credential_count || 0) > 0);

  // Status badges
  const botStatusBadge = shop.lifecycle === 'paused'
    ? '<span class="status status-danger">Tạm dừng (Paused)</span>'
    : (shop.lifecycle === 'archived'
      ? '<span class="status status-neutral">Đã lưu trữ (Archived)</span>'
      : '<span class="status status-success">Hoạt động (Active)</span>');
  const readinessBadge = onboarding.ready
    ? '<span class="status status-success">SẴN SÀNG (Passed)</span>'
    : '<span class="status status-danger">CHƯA ĐẠT (Incomplete)</span>';
  const dryRunBadge = shop.dry_run
    ? '<span class="status status-success">TEST AN TOÀN</span>'
    : (shop.live_enabled
      ? '<span class="status status-danger">CHẠY THẬT (Go-Live)</span>'
      : '<span class="status status-warning">TẮT (Non-Live)</span>');
  const connectionBadge = hasActiveMapping
    ? '<span class="status status-success">ĐÃ KẾT NỐI (Connected)</span>'
    : '<span class="status status-danger">CHƯA KẾT NỐI (No Mapping)</span>';

  // Recommended next action
  let recommendedTitle = '💡 Gợi ý hành động tiếp theo';
  let recommendedDesc = '';
  let recommendedAction = { href: '', label: '' };

  if (shop.lifecycle === 'paused') {
    recommendedDesc = 'Bot của cửa hàng hiện đang tạm dừng (Paused) và sẽ không phản hồi bất kỳ tin nhắn nào của khách hàng. Hãy kích hoạt lại bot để tiếp tục vận hành.';
    recommendedAction = { href: '#safety', label: 'Kích hoạt lại Bot ->' };
  } else if (!hasActiveMapping) {
    recommendedDesc = 'Cửa hàng chưa kết nối với bất kỳ trang Facebook (Fanpage) nào. Bot sẽ không nhận được tin nhắn từ khách hàng. Vui lòng kết nối Fanpage để tiếp tục.';
    recommendedAction = { href: '#pages', label: 'Kết nối Fanpage ngay ->' };
  } else if (!hasActiveCredential) {
    recommendedDesc = 'Cửa hàng đã kết nối Fanpage nhưng chưa cấu hình Quyền gửi tin (Facebook Page Token bảo mật). Bot không thể phản hồi tin nhắn tự động cho khách hàng.';
    recommendedAction = { href: '#pages', label: 'Cấu hình Quyền gửi tin ->' };
  } else if (!model.products || model.products.length === 0) {
    recommendedDesc = 'Danh mục sản phẩm của cửa hàng hiện đang trống. Bot cần có ít nhất 1 sản phẩm hoạt động để có thể tự động tư vấn và bán hàng.';
    recommendedAction = { href: '#products', label: 'Thêm sản phẩm ngay ->' };
  } else if (!onboarding.ready) {
    recommendedDesc = 'Cấu hình cửa hàng hiện tại chưa đạt một số điều kiện sẵn sàng bắt buộc (Hard blockers). Hãy kiểm tra danh sách bên dưới và khắc phục lỗi chặn.';
    recommendedAction = { href: '#safety', label: 'Khắc phục lỗi chặn ->' };
  } else if (shop.dry_run) {
    recommendedDesc = 'Cửa hàng đã hoàn thành cấu hình cơ bản ở chế độ test an toàn. Chatbot hiện đã sẵn sàng chạy thử nghiệm giả lập an toàn.';
    recommendedAction = { href: '#safety', label: 'Chạy thử an toàn ->' };
  } else {
    recommendedDesc = 'Cửa hàng hiện đã ở chế độ CHẠY THẬT (Go-Live). Chatbot đang hoạt động trực tiếp để phản hồi tin nhắn của khách hàng thật trên Facebook.';
    recommendedAction = { href: '#safety', label: 'Quản lý Vận hành an toàn' };
  }

  const overviewStatusGrid = `
    <div class="counts" style="margin-bottom: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
      <div class="count">
        <span>Trạng thái Bot (Bot Status)</span>
        <strong>${botStatusBadge}</strong>
      </div>
      <div class="count">
        <span>Kiểm tra Sẵn sàng (Readiness)</span>
        <strong>${readinessBadge}</strong>
      </div>
      <div class="count">
        <span>Chế độ gửi tin</span>
        <strong>${dryRunBadge}</strong>
      </div>
      <div class="count">
        <span>Kết nối Fanpage (Fanpage State)</span>
        <strong>${connectionBadge}</strong>
      </div>
    </div>
  `;

  const recommendedActionCard = renderGuidanceCard(
    recommendedTitle,
    recommendedDesc,
    recommendedAction.href,
    recommendedAction.label
  );

  const productRows = Array.isArray(model.products) ? model.products : [];
  const productHasActiveImage = product => assetRows.some(a =>
    a.asset_type === 'product_image' &&
    a.status === 'active' &&
    (
      (a.product_id && String(a.product_id) === String(product.id)) ||
      (a.product_code && String(a.product_code).trim().toLowerCase() === String(product.code).trim().toLowerCase())
    )
  );
  const activeProducts = productRows.filter(product => String(product.status || '').toLowerCase() === 'active');
  const secondaryProducts = productRows.filter(product => String(product.status || '').toLowerCase() !== 'active');
  const missingImageProducts = activeProducts.filter(product => !productHasActiveImage(product));
  const productStats = {
    active: activeProducts.length,
    secondary: secondaryProducts.length,
    missingImages: missingImageProducts.length,
    total: productRows.length
  };

  const productMobileListHtml = (!model.products || model.products.length === 0)
    ? ''
    : `<div class="product-mobile-list" style="display: none;">
        ${model.products.map(product => {
          const isArchived = String(product.status || '').toLowerCase() === 'archived';
          const isSecondary = String(product.status || '').toLowerCase() !== 'active';
          const style = isSecondary ? 'opacity: 0.72; ' : '';
          const productImage = assetRows.find(a =>
            a.asset_type === 'product_image' &&
            a.status === 'active' &&
            (
              (a.product_id && String(a.product_id) === String(product.id)) ||
              (a.product_code && String(a.product_code).trim().toLowerCase() === String(product.code).trim().toLowerCase())
            )
          );
          const hasImage = !!(productImage && productImage.public_url);
          let imgHtml = '';
          if (hasImage) {
            imgHtml = `<img src="${escapeHtml(productImage.public_url)}" alt="${escapeHtml(product.name)}" style="width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); display: block;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div style="display: none; width: 64px; height: 64px; border-radius: 6px; background: #fee2e2; border: 1px solid var(--border); align-items: center; justify-content: center; text-align: center; font-size: 10px; color: var(--danger);" class="thumb-broken">Lỗi ảnh</div>`;
          } else {
            const isActive = String(product.status || '').toLowerCase() === 'active';
            if (isActive) {
              imgHtml = `<div class="product-thumb-warning" style="width: 64px; height: 64px;" title="Thiếu ảnh" aria-label="Thiếu ảnh">⚠</div>`;
            } else {
              imgHtml = `<div class="product-thumb-muted" style="width: 64px; height: 64px;" title="Chưa có ảnh">Ảnh</div>`;
            }
          }

          return `
            <article class="product-card-fallback" style="${style}background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; gap: 12px; margin-bottom: 12px;">
              <div class="product-card-img" style="flex-shrink: 0;">${imgHtml}</div>
              <div class="product-card-info" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                  <code style="font-size: 13px; font-weight: bold;">${escapeHtml(product.code)}</code>
                  <span class="meta" style="font-size: 11px;">Mã khách nhắn</span>
                </div>
                <h4 style="margin: 0; font-size: 14px; color: #17202a; font-weight: bold;">${escapeHtml(product.name)}</h4>
                <p style="margin: 0; font-size: 12px; color: var(--muted);">${escapeHtml(limitText(product.description, 80))}</p>
                <div style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                  <strong style="color: var(--primary); font-size: 13px;">${escapeHtml(product.price_text || [product.price, product.currency].filter(Boolean).join(' '))}</strong>
                  <div>${renderProductStatus(product.status)}</div>
                </div>
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                  <span class="meta" style="font-size: 11px;">Thứ tự: ${escapeHtml(product.sort_order || 0)}</span>
                  <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;">
                    ${!isArchived ? `<button type="button" class="js-edit-product-btn button-link" data-product-id="${escapeHtml(product.id)}" style="padding: 4px 8px; font-size: 12px; font-weight: bold; background: var(--primary);">Sửa</button>` : ''}
                    ${renderProductStatusActions(shop.id, product)}
                  </div>
                </div>
                <div class="js-fallback-form-container" style="display: none; margin-top: 8px;">
                  ${renderProductEditForm(shop.id, product)}
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>`;

  const productsListHtml = (!model.products || model.products.length === 0)
    ? renderEmptyState('📦', 'Chưa có sản phẩm nào / Empty Catalog', 'Danh mục sản phẩm của shop đang trống. Hãy kéo xuống dưới để sử dụng form "Thêm sản phẩm thủ công" hoặc "Nhập sản phẩm từ CSV" nhằm khởi tạo dữ liệu.')
    : renderTable(['code', 'Ảnh', 'name/title', 'price_text', 'status', 'sort_order', 'updated', 'actions'], model.products, product => {
        const isArchived = String(product.status || '').toLowerCase() === 'archived';
        const isSecondary = String(product.status || '').toLowerCase() !== 'active';
        const rowClass = isSecondary ? ' class="product-row-secondary"' : ' class="product-row-primary"';
        const productImage = assetRows.find(a =>
          a.asset_type === 'product_image' &&
          a.status === 'active' &&
          (
            (a.product_id && String(a.product_id) === String(product.id)) ||
            (a.product_code && String(a.product_code).trim().toLowerCase() === String(product.code).trim().toLowerCase())
          )
        );
        const hasImage = !!(productImage && productImage.public_url);
        let imageHtml = '';
        if (hasImage) {
          imageHtml = `
            <div style="position: relative; width: 48px; height: 48px;">
              <img src="${escapeHtml(productImage.public_url)}" alt="${escapeHtml(product.name)}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); display: block;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div style="display: none; width: 48px; height: 48px; border-radius: 6px; background: #fee2e2; border: 1px solid var(--border); align-items: center; justify-content: center; text-align: center; font-size: 9px; color: var(--danger);" class="thumb-broken">Lỗi ảnh</div>
            </div>
          `;
        } else {
          const isActive = String(product.status || '').toLowerCase() === 'active';
          if (isActive) {
            imageHtml = `
              <div class="product-thumb-warning" title="Thiếu ảnh" aria-label="Thiếu ảnh">⚠</div>
            `;
          } else {
            imageHtml = `
              <div class="product-thumb-muted" title="Chưa có ảnh">Ảnh</div>
            `;
          }
        }
        return `
          <tr${rowClass}>
            <td><code>${escapeHtml(product.code)}</code><br><span class="meta" style="font-size: 11px; display: block; margin-top: 2px; font-weight: normal; text-transform: none; line-height: 1.3;">Mã khách nhắn cho bot</span></td>
            <td>${imageHtml}</td>
            <td class="product-name">${escapeHtml(product.name)}<br><span class="meta">${escapeHtml(limitText(product.description, 120))}</span></td>
            <td>${escapeHtml(product.price_text || [product.price, product.currency].filter(Boolean).join(' '))}</td>
            <td>${renderProductStatus(product.status)}</td>
            <td>${escapeHtml(product.sort_order || 0)}</td>
            <td>${escapeHtml(formatDate(product.updated_at))}</td>
            <td class="product-actions">
              ${!isArchived ? `<button type="button" class="js-edit-product-btn button-link" data-product-id="${escapeHtml(product.id)}" style="padding: 6px 12px; font-size: 13px; font-weight: bold; background: var(--primary);">Sửa</button>` : ''}
              ${renderProductStatusActions(shop.id, product)}
              <div class="js-fallback-form-container">
                ${renderProductEditForm(shop.id, product)}
              </div>
            </td>
          </tr>
        `;
      }) + productMobileListHtml;

  const assetsGuidanceCard = renderGuidanceCard(
    '💡 Phân biệt các loại hình ảnh',
    '• Menu Images (Ảnh thực đơn): Hiển thị khi khách gõ "menu", "xem thực đơn" hoặc yêu cầu xem danh mục. Cần có ít nhất 1 ảnh thực đơn hoạt động để bot hoạt động trọn vẹn.\n• Product Images (Ảnh sản phẩm): Gắn với từng sản phẩm thông qua mã code (e.g. M1). Hiển thị chi tiết khi khách xem sản phẩm cụ thể.'
  );

  const assetsHtml = (assetRows.length === 0)
    ? renderEmptyState('🖼️', 'Chưa có hình ảnh nào', 'Cửa hàng hiện chưa có hình ảnh sản phẩm hoặc hình ảnh thực đơn nào. Vui lòng thêm hình ảnh bên dưới để nâng cao hiệu quả tư vấn.')
    : renderAssetGroups(assetRows, shop.id, model.products || []);

  const pagesGuidanceCard = renderGuidanceCard(
    '💡 Hướng dẫn kết nối Fanpage & Mã Token',
    '• Kết nối Fanpage (Page Mapping): Liên kết trang Facebook (Fanpage) của bạn với cửa hàng thông qua Page ID. Bước này chỉ cấu hình định danh liên kết.\n• Quyền gửi tin (Credentials): Điền mã bảo mật Facebook Page Token để bot có quyền gửi tin nhắn phản hồi tự động. Token được mã hóa AES-256-GCM bảo mật và không hiển thị lại sau khi lưu.'
  );

  const pagesHtml = (!model.pages || model.pages.length === 0)
    ? renderEmptyState('🔗', 'Chưa có kết nối Fanpage', 'Shop này hiện chưa được liên kết với trang Facebook (Fanpage) nào. Hãy thực hiện kết nối bằng cách điền thông tin ID Trang phía bên dưới.')
    : renderPageMappingsSection({
        shop,
        pages: model.pages,
        pageSetupPreviewMode,
        archiveEnabled: Boolean(model.pageArchiveEnabled)
      });

  const safetyHtml = renderControlPlaneForm(shop, model);

  const body = `
    <p><a href="/admin/shops">Back to shops</a></p>
    ${model.schemaReady === false ? `<div class="empty">${escapeHtml(model.message || 'Multi-shop schema chưa sẵn sàng.')}</div>` : ''}
    ${!shop.id && model.schemaReady !== false ? '<div class="empty">Không tìm thấy shop.</div>' : ''}
    ${shop.id ? `
      <p class="meta">Shop <code>${escapeHtml(shop.id)}</code> | slug <code>${escapeHtml(shop.slug)}</code> | updated ${escapeHtml(formatDate(shop.updated_at))}</p>

      <nav class="tabs">
        <a href="#overview" class="active">Overview / Tổng quan</a>
        <a href="#products">Products &amp; Menu / Sản phẩm &amp; Menu</a>
        <a href="#assets">Images / Hình ảnh</a>
        <a href="#pages">Fanpage Connection / Kết nối Fanpage</a>
        <a href="#safety">Safety / Vận hành an toàn</a>
      </nav>

      <div id="overview" class="tab-section active">
        ${renderProductFlash(model.controlFlash || {})}
        ${overviewStatusGrid}
        ${recommendedActionCard}
        ${renderOnboardingChecklist(onboarding)}
        ${renderHealthCard(model.health)}
        <h2 id="metadata">Thông tin cơ bản / Metadata</h2>
        <table><tbody>
          <tr><th>Tên Cửa Hàng (Name)</th><td>${escapeHtml(shop.name)}</td></tr>
          <tr><th>Trạng thái (Status)</th><td>${renderStatus(shop.status)}</td></tr>
          <tr><th>Ngôn ngữ mặc định (Locale)</th><td>${escapeHtml(shop.default_locale)}</td></tr>
          <tr><th>Múi giờ (Timezone)</th><td>${escapeHtml(shop.timezone)}</td></tr>
          <tr><th>Ngày khởi tạo (Created)</th><td>${escapeHtml(formatDate(shop.created_at))}</td></tr>
        </tbody></table>
      </div>

      <div id="products" class="tab-section">
        ${renderProductFlash(model.productFlash || {})}
        <div class="product-operator-top">
          <section class="product-work-card" aria-labelledby="settings">
            <div>
              <h2 id="settings">Kịch bản phản hồi Bot</h2>
              <p class="meta">Chỉnh nội dung bot gửi cho khách: chuyển giao, giới thiệu menu và phản hồi khi không hiểu.</p>
            </div>
            ${renderChatBehaviorSettingsForm(shop.id, model.settings || {})}
            <details class="collapsible-section">
              <summary>Giá trị hiện tại và cấu hình kỹ thuật</summary>
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
          </section>
          <aside class="product-work-card" aria-label="Product catalog status">
            <div>
              <h3>Tình trạng danh mục</h3>
              <p class="meta">Ưu tiên xử lý sản phẩm đang hoạt động trước.</p>
            </div>
            <div class="product-status-grid">
              <div class="product-status-item"><span>Hoạt động</span><strong>${escapeHtml(productStats.active)}</strong></div>
              <div class="product-status-item"><span>Thiếu ảnh</span><strong>${escapeHtml(productStats.missingImages)}</strong></div>
              <div class="product-status-item"><span>Ẩn/lưu trữ</span><strong>${escapeHtml(productStats.secondary)}</strong></div>
            </div>
            ${productStats.missingImages > 0
              ? '<div class="product-catalog-note"><strong>Thiếu ảnh:</strong> chỉ là cảnh báo cho sản phẩm đang hoạt động. Bot vẫn có thể tư vấn bằng chữ; bổ sung ảnh ở tab Hình ảnh khi cần.</div>'
              : '<p class="meta">Sản phẩm đang hoạt động đều có ảnh minh họa.</p>'
            }
            <div class="product-primary-actions" aria-label="Primary product actions">
              <a href="#add-product-section" class="button-link">+ Thêm sản phẩm</a>
              <a href="#csv-import-section" class="button-link secondary-button">Nhập hàng loạt</a>
              <a href="#assets" class="button-link secondary-button">Quản lý ảnh</a>
            </div>
          </aside>
        </div>

        <section class="product-section">
          <div class="product-toolbar" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; flex-wrap: wrap;">
            <div>
              <h2 id="products-heading" style="margin: 0; color: var(--primary);">Danh mục sản phẩm</h2>
              <p class="meta" style="margin: 4px 0 0; font-weight: normal; text-transform: none;">Sản phẩm hoạt động nổi bật hơn; sản phẩm ẩn/lưu trữ được làm nhẹ để dễ quét.</p>
            </div>
          </div>
          <details class="collapsible-section">
            <summary>Quy tắc vận hành danh mục</summary>
            <ul style="margin: 6px 0 0; padding-left: 20px; line-height: 1.5;">
              <li><strong>Mã Code:</strong> mã khách nhắn cho bot để xem chi tiết sản phẩm.</li>
              <li><strong>Thiếu ảnh:</strong> cảnh báo nhẹ, không chặn bot tư vấn bằng chữ.</li>
              <li><strong>Lưu trữ:</strong> thao tác mềm để giữ lịch sử đơn/chat.</li>
            </ul>
          </details>

          ${renderProductFilterForm(shop.id, model.productFilters || {}, model.productFilterSummary || { total: (model.products || []).length, shown: (model.products || []).length })}

          <div style="background: var(--surface-muted); padding: 16px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 18px; display: grid; gap: 14px;">
            <div id="add-product-section" class="product-work-card">
              <h3>Thêm sản phẩm</h3>
              <p class="meta">Thêm một sản phẩm vào danh mục tư vấn của chatbot.</p>
              ${renderProductAddForm(shop.id)}
            </div>

            <section id="csv-import-section" class="product-work-card" aria-label="Nhập hàng loạt">
              <h3>Nhập hàng loạt</h3>
              <p class="meta">Dành cho nhiều sản phẩm. Luôn xem trước CSV trước khi nhập chính thức.</p>
              ${renderProductBulkImportForm(shop.id)}
            </section>
          </div>

          ${productsListHtml}
        </section>
      </div>

      <div id="assets" class="tab-section">
        <h2 id="assets-heading">Images / Hình ảnh &amp; Tài sản</h2>
        ${renderProductFlash(model.assetFlash || {})}
        ${assetsGuidanceCard}
        ${renderCounts(summary)}
        ${model.adminImageUploadEnabled ? renderAssetUploadForms(shop.id, assetProducts) : ''}
        ${renderAssetAddForm(shop.id, model.products || [])}
        ${renderBulkMenuImageImportForm(shop.id)}
        ${assetsHtml}
      </div>

      <div id="pages" class="tab-section">
        <h2 id="page-mappings">Fanpage Connection / Kết nối Fanpage</h2>
        ${renderProductFlash(model.pageFlash || {})}
        ${renderProductFlash(model.credentialFlash || {})}
        ${renderFanpageConnectionCard(model)}
        ${pagesGuidanceCard}
        ${pageSetupPreviewMode ? renderPageSetupPreviewSection(shop.id) : renderPageMappingAddForm(shop.id)}
        ${pagesHtml}
      </div>

      <div id="safety" class="tab-section">
        ${safetyHtml}
      </div>

      <!-- Standardized Red Danger Confirmation Modal -->
      <div id="danger-confirm-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-container">
          <div class="modal-header">
            <span style="font-size: 20px;">🚨</span>
            <h3 id="modal-title">Xác nhận thao tác nguy hiểm</h3>
          </div>
          <div class="modal-body">
            <div id="modal-warning" class="modal-warning-box"></div>
            <div id="modal-consequence" class="modal-consequence"></div>

            <div>
              <label for="modal-slug-input" class="modal-slug-label">Nhập mã cửa hàng (Shop Slug) <code id="modal-expected-slug" style="background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-weight: bold;"></code> để xác nhận:</label>
              <input type="text" id="modal-slug-input" class="modal-slug-input" autocomplete="off" placeholder="Nhập slug cửa hàng...">
            </div>

            <label class="modal-checkbox-label">
              <input type="checkbox" id="modal-checkbox">
              <span id="modal-checkbox-copy">Tôi hiểu rõ đây là hành động có thể ảnh hưởng trực tiếp đến hoạt động của bot và hoàn toàn chịu trách nhiệm.</span>
            </label>
          </div>
          <div class="modal-footer">
            <button type="button" id="modal-cancel-btn" class="modal-btn-cancel">Hủy bỏ</button>
            <button type="button" id="modal-submit-btn" class="modal-btn-confirm" disabled>Xác nhận (3s)</button>
          </div>
        </div>
      </div>

      <!-- Product Archive Confirmation Modal (replaces bare confirm()) -->
      <div id="product-archive-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-archive-title">
        <div class="modal-container">
          <div class="modal-header">
            <span style="font-size: 20px;">🗄️</span>
            <h3 id="product-archive-title">Lưu trữ sản phẩm</h3>
          </div>
          <div class="modal-body">
            <p id="product-archive-message" class="modal-consequence"></p>
          </div>
          <div class="modal-footer">
            <button type="button" id="product-archive-cancel" class="modal-btn-cancel">Hủy</button>
            <button type="button" id="product-archive-confirm" class="modal-btn-confirm">Lưu trữ</button>
          </div>
        </div>
      </div>

      <div id="drawer-discard-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="drawer-discard-title">
        <div class="modal-container">
          <div class="modal-header">
            <span style="font-size: 20px;">⚠️</span>
            <h3 id="drawer-discard-title">Bỏ thay đổi chưa lưu</h3>
          </div>
          <div class="modal-body">
            <p class="modal-consequence">Bạn có thay đổi chưa lưu trong form sản phẩm. Đóng ngăn chỉnh sửa sẽ bỏ các thay đổi này.</p>
          </div>
          <div class="modal-footer">
            <button type="button" id="drawer-discard-cancel" class="modal-btn-cancel">Tiếp tục chỉnh sửa</button>
            <button type="button" id="drawer-discard-confirm" class="modal-btn-confirm">Bỏ thay đổi</button>
          </div>
        </div>
      </div>

      <!-- Registry of all rendered product codes (incl. archived) for client-side duplicate hints -->
      <div id="product-codes-registry" hidden aria-hidden="true">${(model.products || []).map(product => `<span data-code="${escapeHtml(String(product.code || '').trim().toLowerCase())}"></span>`).join('')}</div>

      <!-- Reusable Product Add/Edit Drawer -->
      <div id="product-drawer" class="drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div class="drawer-panel">
          <div class="drawer-header">
            <h3 id="drawer-title">Thêm sản phẩm</h3>
            <button type="button" id="drawer-close-btn" class="drawer-close-btn" aria-label="Close">&times;</button>
          </div>
          <div class="drawer-body" id="drawer-body-container"></div>
        </div>
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

          // Standardized Danger Confirmation Modal Client Interceptor
          const modalBackdrop = document.getElementById('danger-confirm-modal');
          const modalTitle = document.getElementById('modal-title');
          const modalWarning = document.getElementById('modal-warning');
          const modalConsequence = document.getElementById('modal-consequence');
          const modalExpectedSlug = document.getElementById('modal-expected-slug');
          const modalSlugInput = document.getElementById('modal-slug-input');
          const modalCheckbox = document.getElementById('modal-checkbox');
          const modalCheckboxCopy = document.getElementById('modal-checkbox-copy');
          const modalCancelBtn = document.getElementById('modal-cancel-btn');
          const modalSubmitBtn = document.getElementById('modal-submit-btn');
          const defaultModalCheckboxCopy = modalCheckboxCopy ? modalCheckboxCopy.textContent : '';

          let activeForm = null;
          let countdownInterval = null;
          let countdownSeconds = 0;

          document.querySelectorAll('[data-js-confirm-fallback="true"]').forEach(input => {
            input.disabled = true;
            input.required = false;
            input.setAttribute('aria-required', 'false');
          });

          function updateSubmitButtonState() {
            const expectedSlug = modalExpectedSlug.textContent.trim().toLowerCase();
            const typedSlug = modalSlugInput.value.trim().toLowerCase();
            const checkboxChecked = modalCheckbox.checked;

            const isSlugMatched = (expectedSlug === typedSlug);
            const isCountdownDone = (countdownSeconds <= 0);

            modalSubmitBtn.disabled = !(isSlugMatched && checkboxChecked && isCountdownDone);
          }

          function startCountdown(seconds) {
            countdownSeconds = seconds;
            if (countdownInterval) clearInterval(countdownInterval);

            function updateBtnLabel() {
              if (countdownSeconds > 0) {
                modalSubmitBtn.textContent = 'Xác nhận (' + countdownSeconds + 's)';
              } else {
                modalSubmitBtn.textContent = 'Xác nhận';
              }
              updateSubmitButtonState();
            }

            updateBtnLabel();

            countdownInterval = setInterval(() => {
              countdownSeconds -= 1;
              updateBtnLabel();
              if (countdownSeconds <= 0) {
                clearInterval(countdownInterval);
              }
            }, 1000);
          }

          document.addEventListener('submit', (e) => {
            const form = e.target;
            if (form && form.dataset.dangerConfirm === 'true') {
              if (form.dataset.confirmed === 'true') {
                return;
              }

              e.preventDefault();
              activeForm = form;

              modalTitle.textContent = form.dataset.actionTitle || 'Xác nhận thao tác';
              modalWarning.textContent = form.dataset.warningText || 'Hành động này có độ rủi ro cao.';
              modalConsequence.textContent = form.dataset.consequenceText || '';
              modalExpectedSlug.textContent = form.dataset.shopSlug || '';
              if (modalCheckboxCopy) {
                modalCheckboxCopy.textContent = form.dataset.checkboxText || defaultModalCheckboxCopy;
              }

              modalSlugInput.value = '';
              modalCheckbox.checked = false;
              modalSubmitBtn.disabled = true;

              modalBackdrop.classList.add('visible');

              const seconds = parseInt(form.dataset.countdownSeconds || '3', 10);
              startCountdown(seconds);
            }
          });

          function closeModal() {
            modalBackdrop.classList.remove('visible');
            if (countdownInterval) {
              clearInterval(countdownInterval);
              countdownInterval = null;
            }
            activeForm = null;
          }

          modalCancelBtn.addEventListener('click', closeModal);
          modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) {
              closeModal();
            }
          });

          modalSlugInput.addEventListener('input', updateSubmitButtonState);
          modalCheckbox.addEventListener('change', updateSubmitButtonState);

          modalSubmitBtn.addEventListener('click', () => {
            if (!activeForm) return;

            const confirmInput = activeForm.querySelector('[data-confirm-text-input="true"]');
            if (confirmInput) {
              confirmInput.value = activeForm.dataset.expectedConfirmText || '';
            }

            activeForm.dataset.confirmed = 'true';
            const formToSubmit = activeForm;
            closeModal();
            formToSubmit.submit();
          });

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
          const importForm = document.querySelector('[data-product-import-form]');
          if (importForm && importTextarea) {
            importForm.addEventListener('submit', (event) => {
              const submitter = event.submitter || document.activeElement;
              if (!submitter || submitter.getAttribute('name') !== 'validate_only') return;
              const key = importForm.getAttribute('data-product-import-storage-key') || '';
              if (!key) return;
              try {
                window.sessionStorage.setItem(key, importTextarea.value || '');
              } catch (_) {}
            });
          }

          // Product Archive Confirmation Modal (replaces bare confirm())
          const productArchiveModal = document.getElementById('product-archive-modal');
          const productArchiveMessage = document.getElementById('product-archive-message');
          const productArchiveCancel = document.getElementById('product-archive-cancel');
          const productArchiveConfirm = document.getElementById('product-archive-confirm');
          let pendingArchiveForm = null;

          function closeArchiveModal() {
            if (productArchiveModal) productArchiveModal.classList.remove('visible');
            pendingArchiveForm = null;
          }

          if (productArchiveModal) {
            document.addEventListener('submit', (e) => {
              const form = e.target;
              if (!form || form.dataset.productArchive !== 'true') return;
              if (form.dataset.archiveConfirmed === 'true') return;
              e.preventDefault();
              pendingArchiveForm = form;
              const name = form.dataset.productName || '';
              const code = form.dataset.productCode || '';
              productArchiveMessage.textContent = "Lưu trữ '" + name + ' (' + code + ")'? Bot sẽ ngừng tư vấn sản phẩm này. Lịch sử đơn/chat cũ vẫn giữ nguyên. Bạn có thể khôi phục sau.";
              productArchiveModal.classList.add('visible');
            });
            productArchiveCancel.addEventListener('click', closeArchiveModal);
            productArchiveModal.addEventListener('click', (e) => {
              if (e.target === productArchiveModal) closeArchiveModal();
            });
            productArchiveConfirm.addEventListener('click', () => {
              if (!pendingArchiveForm) return;
              const formToSubmit = pendingArchiveForm;
              formToSubmit.dataset.archiveConfirmed = 'true';
              closeArchiveModal();
              formToSubmit.submit();
            });
          }

          // Client-side duplicate product code hint (best-effort; backend is source of truth).
          // The registry includes archived codes so reusing a retired code is flagged early.
          const productCodeRegistry = Array.prototype.slice
            .call(document.querySelectorAll('#product-codes-registry [data-code]'))
            .map(node => (node.getAttribute('data-code') || '').trim().toLowerCase())
            .filter(Boolean);

          function checkDuplicateCode(form) {
            if (!form) return;
            const codeInput = form.querySelector('input[name="code"]');
            const hint = form.querySelector('.js-duplicate-code-hint');
            const saveBtn = form.querySelector('.js-product-save-btn');
            if (!codeInput || !hint) return;
            const typed = String(codeInput.value || '').trim();
            const value = typed.toLowerCase();
            const currentCode = String(form.dataset.currentCode || '').trim().toLowerCase();
            let matches = productCodeRegistry.filter(code => code === value).length;
            // The product being edited is in the registry too; do not flag its own code.
            if (currentCode && value === currentCode && matches > 0) matches -= 1;
            const isDuplicate = Boolean(value) && matches > 0;
            if (isDuplicate) {
              hint.textContent = "⚠ Mã '" + typed + "' đã tồn tại trong shop này, kể cả sản phẩm đã lưu trữ. Hãy dùng mã khác hoặc khôi phục sản phẩm cũ.";
              hint.classList.add('visible');
              if (saveBtn) saveBtn.disabled = true;
            } else {
              hint.textContent = '';
              hint.classList.remove('visible');
              if (saveBtn) saveBtn.disabled = false;
            }
          }

          document.addEventListener('input', (e) => {
            const target = e.target;
            if (target && target.name === 'code' && target.closest('.product-form')) {
              checkDuplicateCode(target.closest('.product-form'));
            }
          });

          // Progressive Enhancement Drawer Controller
          document.body.classList.add('js-enabled');

          const drawerBackdrop = document.getElementById('product-drawer');
          const drawerTitle = document.getElementById('drawer-title');
          const drawerBody = document.getElementById('drawer-body-container');
          const drawerCloseBtn = document.getElementById('drawer-close-btn');
          const drawerDiscardModal = document.getElementById('drawer-discard-modal');
          const drawerDiscardCancel = document.getElementById('drawer-discard-cancel');
          const drawerDiscardConfirm = document.getElementById('drawer-discard-confirm');

          let activeDrawerFormParent = null;
          let activeDrawerForm = null;
          let drawerInitialState = '';

          function serializeDrawerForm(form) {
            if (!form) return '';
            const parts = [];
            const elements = form.querySelectorAll('input, textarea, select');
            Array.prototype.forEach.call(elements, el => {
              if (!el.name) return;
              if (el.type === 'checkbox' || el.type === 'radio') {
                parts.push(el.name + '=' + (el.checked ? '1' : '0'));
              } else {
                parts.push(el.name + '=' + el.value);
              }
            });
            return parts.join('&');
          }

          function openDrawer(form, titleText) {
            if (activeDrawerForm && activeDrawerFormParent) {
              activeDrawerFormParent.appendChild(activeDrawerForm);
            }
            activeDrawerForm = form;
            activeDrawerFormParent = form.parentElement;

            drawerTitle.textContent = titleText;
            drawerBody.appendChild(form);
            drawerBackdrop.classList.add('visible');
            drawerInitialState = serializeDrawerForm(form);
            checkDuplicateCode(form);
          }

          function closeDrawer() {
            if (activeDrawerForm && activeDrawerFormParent) {
              activeDrawerFormParent.appendChild(activeDrawerForm);
              activeDrawerForm = null;
              activeDrawerFormParent = null;
            }
            drawerInitialState = '';
            drawerBackdrop.classList.remove('visible');
          }

          function requestCloseDrawer() {
            if (activeDrawerForm && serializeDrawerForm(activeDrawerForm) !== drawerInitialState) {
              if (drawerDiscardModal) {
                drawerDiscardModal.classList.add('visible');
                return;
              }
            }
            closeDrawer();
          }

          function closeDrawerDiscardModal() {
            if (drawerDiscardModal) {
              drawerDiscardModal.classList.remove('visible');
            }
          }

          if (drawerDiscardCancel) {
            drawerDiscardCancel.addEventListener('click', closeDrawerDiscardModal);
          }
          if (drawerDiscardConfirm) {
            drawerDiscardConfirm.addEventListener('click', () => {
              closeDrawerDiscardModal();
              closeDrawer();
            });
          }
          if (drawerDiscardModal) {
            drawerDiscardModal.addEventListener('click', (e) => {
              if (e.target === drawerDiscardModal) {
                closeDrawerDiscardModal();
              }
            });
          }

          if (drawerCloseBtn) {
            drawerCloseBtn.addEventListener('click', requestCloseDrawer);
          }
          if (drawerBackdrop) {
            drawerBackdrop.addEventListener('click', (e) => {
              if (e.target === drawerBackdrop) {
                requestCloseDrawer();
              }
            });
          }

          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drawerBackdrop && drawerBackdrop.classList.contains('visible')) {
              requestCloseDrawer();
            }
          });

          window.addEventListener('hashchange', () => {
            if (drawerBackdrop && drawerBackdrop.classList.contains('visible')) {
              closeDrawerDiscardModal();
              closeDrawer();
            }
          });

          // Explicit "Hủy bỏ" button inside the drawer form
          document.addEventListener('click', (e) => {
            if (e.target && e.target.closest('.js-cancel-drawer')) {
              e.preventDefault();
              requestCloseDrawer();
            }
          });

          // Intercept "+ Thêm sản phẩm"
          const addProductBtn = document.querySelector('a[href="#add-product-section"]');
          if (addProductBtn) {
            addProductBtn.addEventListener('click', (e) => {
              e.preventDefault();
              const addSection = document.getElementById('add-product-section');
              if (addSection) {
                const form = addSection.querySelector('.product-form');
                if (form) {
                  openDrawer(form, 'Thêm sản phẩm');
                }
              }
            });
          }

          // Intercept "Sửa" buttons in row
          document.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.js-edit-product-btn');
            if (editBtn) {
              e.preventDefault();
              const parentTd = editBtn.closest('td');
              if (parentTd) {
                const form = parentTd.querySelector('.product-form');
                const row = editBtn.closest('tr');
                const productCode = row ? row.querySelector('td:first-child code').textContent : '';
                if (form) {
                  openDrawer(form, 'Sửa sản phẩm: ' + productCode);
                }
              }
            }
          });
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
    <p><a href="${escapeHtml(`/admin/dashboard${dashboardQueryString(model.filters || {})}`)}">Back to dashboard</a></p>
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

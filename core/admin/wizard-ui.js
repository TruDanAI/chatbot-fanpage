const { pageRef } = require('../utils/log-refs');

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STEP_LABELS = [
  'Kiểm tra điều kiện hệ thống',
  'Tạo shop nháp',
  'Sản phẩm & menu',
  'Kết nối Fanpage',
  'Quyền gửi tin Fanpage',
  'Kiểm tra hoàn tất',
  'Test thử an toàn'
];

/**
 * Renders the 7-step horizontal progress bar.
 * @param {number} currentStep - The index of the current step (0 to 6)
 * @param {Array<number>} completedSteps - Array or set of completed step numbers
 * @param {string} [shopId] - Shop ID slug (required for links on steps 1-6)
 */
function renderProgressBar(currentStep, completedSteps, shopId) {
  const completedSet = new Set(completedSteps);
  let html = `<div class="wizard-stepper">`;

  for (let i = 0; i < STEP_LABELS.length; i++) {
    const isActive = i === currentStep;
    const isCompleted = completedSet.has(i);
    const label = STEP_LABELS[i];

    let stepClass = 'wizard-step';
    if (isActive) stepClass += ' active';
    if (isCompleted) stepClass += ' completed';

    let circleContent = String(i);
    if (isCompleted) {
      circleContent = '✅';
    }

    // Determine link path
    let canClick = isCompleted || i === currentStep;
    let url = '';
    if (canClick) {
      if (i === 0) {
        url = '/admin/wizard/new';
      } else if (shopId) {
        url = `/admin/wizard/${encodeURIComponent(shopId)}/step/${i}`;
      } else {
        canClick = false;
      }
    }

    html += `<div class="${stepClass}">`;
    if (canClick) {
      html += `<a href="${url}" class="wizard-step-link">
        <span class="wizard-step-circle">${circleContent}</span>
        <span class="wizard-step-label">${escapeHtml(label)}</span>
      </a>`;
    } else {
      html += `<div class="wizard-step-link disabled">
        <span class="wizard-step-circle">${circleContent}</span>
        <span class="wizard-step-label">${escapeHtml(label)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Renders the safety/compliance footer showing dry-run status and protections.
 * @param {boolean} globalDryRun - process.env.MESSENGER_DRY_RUN status
 * @param {string} envName - Current environment name
 */
function renderSafetyFooter(globalDryRun, envName = process.env.NODE_ENV || 'staging') {
  const isDryRunActive = globalDryRun === true || globalDryRun === 'true';
  const dryRunText = isDryRunActive
    ? 'Chế độ test an toàn toàn cục đang bật'
    : 'Chế độ test an toàn toàn cục đang tắt';
  const dryRunClass = isDryRunActive ? 'dry-run' : 'dry-run inactive';

  return `
    <div class="safety-footer">
      <div class="safety-badges">
        <span class="safety-badge ${dryRunClass}">${escapeHtml(dryRunText)}</span>
        <span class="safety-badge env-staging">${escapeHtml(envName)} mode (Chạy thử nghiệm)</span>
        <span class="safety-badge adult-shop">Bảo vệ adult-shop 🛡️</span>
      </div>
      <div class="safety-info">
        🔒 Hệ thống mã hóa thông tin xác thực cao cấp kích hoạt
      </div>
    </div>
  `;
}

/**
 * Renders a guidance card with title, description, and optional action button.
 * Used for "what to do next" or "how to fix" operator guidance.
 */
function renderGuidanceCard(title, description, actionHref = '', actionLabel = '') {
  const actionHtml = actionHref && actionLabel
    ? `<a href="${escapeHtml(actionHref)}" class="btn btn-secondary" style="margin-top: 10px;">${escapeHtml(actionLabel)}</a>`
    : '';
  return `
    <div class="guidance-card">
      <div class="guidance-card-icon">💡</div>
      <div class="guidance-card-body">
        <strong class="guidance-card-title">${escapeHtml(title)}</strong>
        <p class="guidance-card-desc">${escapeHtml(description)}</p>
        ${actionHtml}
      </div>
    </div>
  `;
}

/**
 * Renders an empty-state placeholder with icon, heading, and explanation.
 * Used when a list/table has no data yet.
 */
function renderEmptyState(icon, title, description) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${escapeHtml(icon)}</div>
      <strong class="empty-state-title">${escapeHtml(title)}</strong>
      <p class="empty-state-desc">${escapeHtml(description)}</p>
    </div>
  `;
}

/**
 * Renders a requirement checklist showing pass/fail status.
 * @param {Array<{label: string, met: boolean, detail: string}>} items
 */
function renderRequirementList(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rows = items.map(item => {
    const icon = item.met ? '✅' : '⬜';
    const badgeClass = item.met ? 'badge-success' : 'badge-danger';
    const statusText = item.met ? 'Đạt' : 'Chưa đạt';
    return `
      <div class="requirement-item">
        <div class="requirement-label">
          <span class="requirement-icon">${icon}</span>
          <span>${escapeHtml(item.label)}</span>
        </div>
        <div class="requirement-detail">
          <span class="badge ${badgeClass}">${statusText}</span>
          ${item.detail ? `<span class="requirement-detail-text">${escapeHtml(item.detail)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  return `<div class="requirement-list">${rows}</div>`;
}

/**
 * Server-rendered layouts specifically for the Setup Wizard.
 * Embeds custom CSS styles in head to prevent altering index.css or views.js.
 */
function renderWizardLayout(title, body, { showLogout = true, shopId = '', currentStep = 0, completedSteps = [] } = {}) {
  const progressHtml = shopId || currentStep === 0
    ? renderProgressBar(currentStep, completedSteps, shopId)
    : '';

  const safetyFooterHtml = renderSafetyFooter(process.env.MESSENGER_DRY_RUN === 'true');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} | ZenBot Admin Setup Wizard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #f8fafc;
      --surface: #ffffff;
      --surface-muted: #f1f5f9;
      --border: #e2e8f0;
      --muted: #64748b;
      --primary: #0f766e;
      --primary-dark: #115e59;
      --link: #2563eb;
      --warning: #b45309;
      --success: #15803d;
      --danger: #b91c1c;
      --neutral: #475569;
    }
    body { margin: 0; background: #f8fafc; -webkit-font-smoothing: antialiased; }
    header { background: var(--primary-dark); color: white; padding: 18px 24px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); }
    .header-inner { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .logout-form { margin: 0; }
    .logout-form button { border: 1px solid rgba(255,255,255,.55); border-radius: 6px; background: transparent; color: #ffffff; padding: 7px 10px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
    .logout-form button:hover { background: rgba(255,255,255,.1); border-color: white; }
    main { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
    h1, h2 { margin: 0 0 12px; font-weight: 700; letter-spacing: -0.025em; }
    h1 { font-size: 26px; color: #0f172a; }
    h2 { font-size: 18px; margin-top: 24px; color: #1e293b; }
    a { color: var(--link); font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--muted); font-size: 13px; }
    
    /* Stepper Styling */
    .wizard-stepper {
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      margin: 10px 0 28px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 16px;
      box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05);
    }
    .wizard-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      position: relative;
      text-align: center;
    }
    .wizard-step::after {
      content: '';
      position: absolute;
      top: 17px;
      left: 50%;
      width: 100%;
      height: 2px;
      background: var(--border);
      z-index: 1;
    }
    .wizard-step:last-child::after {
      display: none;
    }
    .wizard-step-link {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-decoration: none;
      z-index: 2;
      color: var(--muted);
      font-weight: 500;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .wizard-step-link.disabled {
      cursor: not-allowed;
      pointer-events: none;
      opacity: 0.45;
    }
    .wizard-step-link:hover {
      text-decoration: none;
      color: var(--primary);
    }
    .wizard-step-circle {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #f8fafc;
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 8px;
      transition: all 0.2s ease;
    }
    .wizard-step.active .wizard-step-circle {
      background: #eff6ff;
      border-color: var(--link);
      color: var(--link);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    .wizard-step.active .wizard-step-link {
      color: var(--link);
      font-weight: 700;
    }
    .wizard-step.completed .wizard-step-circle {
      background: #f0fdf4;
      border-color: var(--success);
      color: var(--success);
    }
    .wizard-step.completed .wizard-step-link {
      color: var(--success);
    }
    .wizard-step-label {
      font-size: 12px;
      letter-spacing: -0.01em;
    }

    /* Wizard Content Styling */
    .wizard-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.03);
    }
    
    /* Form elements */
    .form-group {
      margin-bottom: 18px;
      display: grid;
      gap: 6px;
    }
    .form-group.row {
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    .form-group label {
      font-size: 13px;
      font-weight: bold;
      color: #334155;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-group input, .form-group select, .form-group textarea {
      min-height: 38px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      color: #17202a;
      background: #ffffff;
      font: inherit;
      font-size: 14px;
      box-sizing: border-box;
      width: 100%;
      transition: border-color 0.2s;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      border-color: var(--primary);
      outline: none;
    }
    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }
    .form-group .field-help {
      font-size: 12px;
      color: var(--muted);
      margin-top: 2px;
    }
    .form-group .required {
      color: var(--danger);
    }

    /* Banners & Badges */
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge-success { color: var(--success); background: #dcfce7; }
    .badge-danger { color: var(--danger); background: #fee2e2; }
    .badge-warning { color: var(--warning); background: #fef3c7; }
    .badge-neutral { color: var(--neutral); background: #e2e8f0; }

    .banner {
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 14px;
      margin: 12px 0 18px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .banner-success { color: var(--success); background: #dcfce7; border: 1px solid #bbf7d0; }
    .banner-warning { color: #854d0e; background: #fef3c7; border: 1px solid #fde68a; }
    .banner-error { color: var(--danger); background: #fee2e2; border: 1px solid #fecaca; }

    /* Action Buttons */
    .wizard-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 24px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      box-sizing: border-box;
      transition: all 0.2s;
    }
    .btn-primary {
      border: 1px solid var(--primary);
      background: var(--primary);
      color: #ffffff;
    }
    .btn-primary:hover {
      background: var(--primary-dark);
      text-decoration: none;
    }
    .btn-secondary {
      border: 1px solid var(--border);
      background: #ffffff;
      color: #334155;
    }
    .btn-secondary:hover {
      background: #f8fafc;
      text-decoration: none;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Checklist */
    .checklist-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px dashed var(--border);
    }
    .checklist-item:last-child {
      border-bottom: 0;
    }
    .checklist-label {
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Safety Footer styling */
    .safety-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 40px;
      padding: 16px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 13px;
      color: var(--muted);
      align-items: center;
      justify-content: space-between;
    }
    .safety-badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .safety-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .safety-badge.dry-run {
      background: #fef3c7;
      color: #d97706;
      border: 1px solid #fde68a;
    }
    .safety-badge.dry-run::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #d97706;
    }
    .safety-badge.dry-run.inactive {
      background: #e2e8f0;
      color: #475569;
      border-color: #cbd5e1;
    }
    .safety-badge.dry-run.inactive::before {
      background: #475569;
    }
    .safety-badge.adult-shop {
      background: #fee2e2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }
    .safety-badge.adult-shop::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #dc2626;
    }
    .safety-badge.env-staging {
      background: #e0f2fe;
      color: #0284c7;
      border: 1px solid #bae6fd;
    }
     .safety-badge.env-staging::before {
       content: '';
       width: 6px;
       height: 6px;
       border-radius: 50%;
       background: #0284c7;
     }

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
     .guidance-card-body { min-width: 0; }
     .guidance-card-title { display: block; font-size: 14px; color: #1e40af; margin-bottom: 4px; }
     .guidance-card-desc { margin: 0; font-size: 13px; color: #1e3a5f; line-height: 1.5; }

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
     .empty-state-title { font-size: 15px; color: #334155; margin-bottom: 6px; }
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

     /* Checklist Card (was used but undefined) */
     .checklist-card {
       background: var(--surface);
       border: 1px solid var(--border);
       border-radius: 10px;
       padding: 16px;
     }

     /* Count Card (was used but undefined) */
     .count {
       background: var(--surface);
       border: 1px solid var(--border);
       border-radius: 8px;
       padding: 12px;
     }
     .count span { color: var(--muted); font-size: 13px; display: block; margin-bottom: 4px; }
     .count strong { display: block; font-size: 18px; }
   </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <a href="/admin/dashboard" style="color: white; font-size: 18px; font-weight: bold;">ZenBot Admin Control Panel</a>
      <div style="display: flex; align-items: center; gap: 16px;">
        <a href="/admin/dashboard" style="color: #cbd5e1; font-size: 14px;">Quay lại Dashboard</a>
        ${showLogout ? `
          <form action="/admin/logout" method="post" class="logout-form">
            <button type="submit">Đăng xuất</button>
          </form>
        ` : ''}
      </div>
    </div>
  </header>
  <main>
    ${progressHtml}
    ${body}
    ${safetyFooterHtml}
  </main>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderProgressBar,
  renderSafetyFooter,
  renderWizardLayout,
  renderGuidanceCard,
  renderEmptyState,
  renderRequirementList,
  STEP_LABELS
};

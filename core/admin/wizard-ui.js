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
  'Pre-flight',
  'Shop Shell',
  'Products & Menu',
  'Map FB Page',
  'Page Credential',
  'Readiness Gate',
  'Dry-Run Test'
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
  const dryRunText = isDryRunActive ? 'Global Dry-Run Active' : 'Dry-Run Inactive';
  const dryRunClass = isDryRunActive ? 'dry-run' : 'dry-run inactive';

  return `
    <div class="safety-footer">
      <div class="safety-badges">
        <span class="safety-badge ${dryRunClass}">${escapeHtml(dryRunText)}</span>
        <span class="safety-badge adult-shop">adult-shop protected</span>
        <span class="safety-badge env-staging">${escapeHtml(envName)} mode</span>
      </div>
      <div class="safety-info">
        🔒 SSL &amp; AES-256-GCM Credential Encryption Active
      </div>
    </div>
  `;
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
    main { max-width: 960px; margin: 0 auto; padding: 20px 16px 40px; }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; margin-top: 24px; }
    a { color: var(--link); font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--muted); font-size: 13px; }
    
    /* Stepper Styling */
    .wizard-stepper {
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      margin: 10px 0 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
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
      top: 15px;
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
      font-weight: normal;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .wizard-step-link.disabled {
      cursor: not-allowed;
      pointer-events: none;
      opacity: 0.6;
    }
    .wizard-step-link:hover {
      text-decoration: none;
      color: var(--primary);
    }
    .wizard-step-circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #f8fafc;
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      color: var(--muted);
      margin-bottom: 6px;
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
      font-weight: bold;
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
      font-size: 11px;
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
  STEP_LABELS
};

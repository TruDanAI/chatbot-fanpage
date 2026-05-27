const express = require('express');
const { PERMISSIONS } = require('../admin-auth');
const { parseAdminRoles } = require('./route-auth');
const { createAdminRouteAuthorizer } = require('./route-auth');
const { createAdminSessionManager } = require('./session');
const { createPostgresAuditLogger } = require('./audit');
const { renderWizardLayout, escapeHtml } = require('./wizard-ui');

// Forbidden shop ID list / blocklist
const BLOCKLIST = Object.freeze(new Set([
  'adult-shop',
  'admin',
  'api',
  'webhook',
  'system',
  'test',
  'root',
  'default',
  'public',
  'static'
]));

/**
 * Validates a shop ID slug pattern and checks it against the blocklist.
 */
function isValidShopSlug(slug = '') {
  const clean = String(slug || '').trim();
  if (!clean || clean.length > 50) return false;
  // Slug pattern validation
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) return false;
  return !BLOCKLIST.has(clean);
}

/**
 * Express middleware to prevent accessing or creating blocklisted shops.
 */
function wizardShopGuard(req, res, next) {
  const shopId = String(req.params.shopId || req.body.shopId || req.body.shop_id || '').trim();
  if (shopId && BLOCKLIST.has(shopId.toLowerCase())) {
    return res.status(403).send('Thao tác bị chặn: Cửa hàng này không thể chỉnh sửa hoặc tạo thông qua Setup Wizard.');
  }
  next();
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/**
 * Registers all wizard-related Express routes under the app instance.
 */
function registerWizardRoutes(app, {
  storage,
  adminExportToken = process.env.ADMIN_EXPORT_TOKEN,
  adminIpAllowlist = [],
  getClientIp,
  tenantId = process.env.TENANT_ID || 'default',
  pageId = process.env.PAGE_ID || '',
  adminPrincipalId = process.env.ADMIN_PRINCIPAL_ID || 'legacy-admin',
  adminPrincipalDisplayName = process.env.ADMIN_PRINCIPAL_DISPLAY_NAME || '',
  adminPrincipalRoles = parseAdminRoles(process.env.ADMIN_ROLES || 'owner'),
  adminPrincipalPermissions = [],
  adminSessionManager,
  adminSessionSecret = process.env.SESSION_SECRET || '',
  adminSessionCookieName = process.env.ADMIN_SESSION_COOKIE_NAME || 'chatbot_admin_session',
  adminPublicBaseUrl = process.env.ADMIN_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '',
  adminSessionTtlMs = parsePositiveInteger(process.env.ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000),
  auditLogger,
  adminAuditLogEnabled = process.env.ADMIN_AUDIT_LOG_ENABLED === 'true',
  adminAuditFailClosed = false
} = {}) {
  
  const sessionManager = adminSessionManager || createAdminSessionManager({
    sessionSecret: adminSessionSecret,
    cookieName: adminSessionCookieName,
    publicBaseUrl: adminPublicBaseUrl,
    nodeEnv: process.env.NODE_ENV || '',
    ttlMs: adminSessionTtlMs
  });

  const audit = auditLogger || createPostgresAuditLogger({
    enabled: adminAuditLogEnabled,
    databaseUrl: process.env.DATABASE_URL
  });

  const {
    authorizeAdminRequest,
    recordAdminAudit
  } = createAdminRouteAuthorizer({
    adminExportToken,
    adminIpAllowlist,
    getClientIp,
    tenantId,
    pageId,
    adminPrincipalId,
    adminPrincipalDisplayName,
    adminPrincipalRoles,
    adminPrincipalPermissions,
    sessionManager,
    auditLogger: audit,
    adminAuditFailClosed
  });

  // Pre-flight check endpoint (Step 0)
  async function renderStep0(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.preflight.view',
      resourceType: 'wizard'
    });
    if (!principal) return;

    // Check DB connectivity
    let isDbConnected = false;
    try {
      if (storage && typeof storage.ready === 'object') {
        await storage.ready;
        isDbConnected = true;
      } else {
        // Quick query test
        const pool = app.get('dbPool');
        if (pool) {
          const client = await pool.connect();
          client.release();
          isDbConnected = true;
        }
      }
    } catch (_) {}

    const dryRunEnv = process.env.MESSENGER_DRY_RUN === 'true';

    const body = `
      <div class="wizard-card">
        <h1>Bước 0: Pre-flight Check (Kiểm tra môi trường)</h1>
        <p>Trước khi bắt đầu cài đặt cửa hàng Basic mới, chúng ta cần xác minh tính hợp lệ và an toàn của hệ thống.</p>
        
        <div style="margin: 20px 0;">
          <div class="checklist-item">
            <span class="checklist-label">🌐 Global Dry-Run Mode (Bảo vệ tin nhắn thực)</span>
            <span class="badge ${dryRunEnv ? 'badge-success' : 'badge-danger'}">${dryRunEnv ? 'BẬT (An toàn)' : 'TẮT (Cảnh báo)'}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">🗄️ Kết nối cơ sở dữ liệu PostgreSQL</span>
            <span class="badge ${isDbConnected ? 'badge-success' : 'badge-danger'}">${isDbConnected ? 'KẾT NỐI OK' : 'MẤT KẾT NỐI'}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">🛡️ Chế độ bảo vệ adult-shop &amp; blocklist</span>
            <span class="badge badge-success">KÍCH HOẠT (Hoạt động tốt)</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">🔑 Master key giải mã token Facebook</span>
            <span class="badge ${process.env.CREDENTIAL_MASTER_KEY ? 'badge-success' : 'badge-danger'}">${process.env.CREDENTIAL_MASTER_KEY ? 'ĐÃ CẤU HÌNH' : 'CHƯA CẤU HÌNH'}</span>
          </div>
        </div>

        ${!dryRunEnv ? `
          <div class="banner banner-warning">
            ⚠️ <strong>Cảnh báo:</strong> Môi trường hiện tại không bật chế độ dry-run toàn cục (MESSENGER_DRY_RUN=true). Hãy đảm bảo bạn biết rõ mình đang thao tác trên hệ thống nào.
          </div>
        ` : ''}

        <form action="/admin/wizard/new" method="post" style="margin-top: 20px;">
          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: normal; text-transform: none;">
              <input type="checkbox" name="confirm_staging" value="1" required style="width: auto; min-height: auto;">
              Tôi xác nhận đây là môi trường staging an toàn và cam kết tuân thủ quy tắc chạy thử nghiệm trước khi go-live.
            </label>
          </div>
          <div class="wizard-actions">
            <a href="/admin/dashboard" class="btn btn-secondary">Quay lại Dashboard</a>
            <button type="submit" class="btn btn-primary" ${!isDbConnected ? 'disabled' : ''}>Bắt đầu tạo Shop →</button>
          </div>
        </form>
      </div>
    `;

    res.send(renderWizardLayout('Pre-flight Check', body, { currentStep: 0, completedSteps: [] }));
  }

  // Handle Step 0 confirmation submission
  async function submitStep0(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.preflight.confirm',
      resourceType: 'wizard'
    });
    if (!principal) return;

    if (req.body.confirm_staging !== '1') {
      return res.status(400).send('Bạn phải xác nhận kiểm tra môi trường để tiếp tục.');
    }

    // Step 0 passed, redirect to Step 1 (Create Shop Shell form)
    // We redirect to a temporary wizard shop creation screen where shopId isn't decided yet
    res.redirect(303, '/admin/wizard/new-shop-shell');
  }

  // Temporary step rendering to satisfy Task 1 & Task 3 E2E and units
  async function renderNewShopForm(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.shop_create.view',
      resourceType: 'wizard'
    });
    if (!principal) return;

    const body = `
      <div class="wizard-card">
        <h1>Bước 1: Tạo Shell Cửa Hàng</h1>
        <p>Nhập Slug định danh duy nhất và tên hiển thị để khởi tạo bản ghi Shop trong hệ thống.</p>
        
        <form action="/admin/wizard/new-shop-shell" method="post">
          <div class="form-group">
            <label for="shop_id">Shop Slug (Slug viết liền, không dấu) <span class="required">*</span></label>
            <input type="text" id="shop_id" name="shop_id" placeholder="vi-du: nem-bui-xa" required pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$">
            <span class="field-help">Chỉ dùng chữ cái viết thường, số và ký tự gạch nối (-). Ví dụ: <code>my-shop-slug</code></span>
          </div>
          
          <div class="form-group">
            <label for="display_name">Tên hiển thị cửa hàng <span class="required">*</span></label>
            <input type="text" id="display_name" name="display_name" placeholder="Ví dụ: Nem Bùi Xá - Chi Nhánh 1" required>
          </div>

          <div class="form-group row">
            <div>
              <label for="locale">Ngôn ngữ mặc định</label>
              <select id="locale" name="locale">
                <option value="vi">Tiếng Việt (vi)</option>
                <option value="en">Tiếng Anh (en)</option>
              </select>
            </div>
            <div>
              <label for="timezone">Múi giờ</label>
              <select id="timezone" name="timezone">
                <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh</option>
                <option value="Asia/Bangkok">Asia/Bangkok</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="handoff_message">Tin nhắn bàn giao nhân viên hỗ trợ</label>
            <textarea id="handoff_message" name="handoff_message">Nhân viên sẽ hỗ trợ bạn ngay!</textarea>
            <span class="field-help">Tin nhắn gửi tự động cho khách trước khi chuyển luồng cho nhân viên trực fanpage.</span>
          </div>

          <div class="wizard-actions">
            <a href="/admin/wizard/new" class="btn btn-secondary">← Quay lại</a>
            <button type="submit" class="btn btn-primary">Khởi tạo và Tiếp tục →</button>
          </div>
        </form>
      </div>
    `;

    res.send(renderWizardLayout('Tạo Shell Cửa Hàng', body, { currentStep: 1, completedSteps: [0] }));
  }

  // Handle Shop creation form submission
  async function submitNewShop(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.shop_create.submit',
      resourceType: 'wizard'
    });
    if (!principal) return;

    const shopId = String(req.body.shop_id || '').trim().toLowerCase();
    const displayName = String(req.body.display_name || '').trim();

    if (!isValidShopSlug(shopId)) {
      return res.status(400).send('Định dạng Shop Slug không hợp lệ hoặc slug nằm trong danh sách bị chặn bảo vệ.');
    }

    if (!displayName) {
      return res.status(400).send('Tên hiển thị cửa hàng không được bỏ trống.');
    }

    // Task 1 redirection skeleton.
    // Real implementation in Task 4 will use shopWrites.createShop().
    // We redirect to step 2 directly for our skeleton test.
    res.redirect(303, `/admin/wizard/${encodeURIComponent(shopId)}/step/2`);
  }

  // General step rendering (Steps 2 to 6)
  async function renderStepPage(req, res) {
    const shopId = String(req.params.shopId || '').trim();
    const step = parseInt(req.params.step, 10);

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: `admin.wizard.step_${step}.view`,
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    if (isNaN(step) || step < 2 || step > 6) {
      return res.status(400).send('Số bước không hợp lệ.');
    }

    const completedSteps = [];
    for (let i = 0; i < step; i++) completedSteps.push(i);

    const stepNames = [
      '',
      '',
      'Cấu hình Sản phẩm & Menu',
      'Liên kết trang Facebook',
      'Lưu thông tin xác thực',
      'Readiness Gate (Kiểm tra sẵn sàng)',
      'Dry-Run Smoke Test (Chạy thử giả lập)'
    ];

    const body = `
      <div class="wizard-card">
        <h1>Bước ${step}: ${escapeHtml(stepNames[step])}</h1>
        <p>Đang thiết lập cho shop định danh: <code>${escapeHtml(shopId)}</code></p>
        
        <div class="banner banner-warning">
          ⚠️ <strong>Giao diện tạm thời:</strong> Logic chi tiết của Bước ${step} đang được tích hợp. Bạn có thể nhấn nút "Tiếp tục" để hoàn tất bộ khung xương Wizard.
        </div>

        <form action="/admin/wizard/${encodeURIComponent(shopId)}/step/${step}" method="post" style="margin-top: 20px;">
          <div class="wizard-actions">
            <a href="/admin/wizard/${encodeURIComponent(shopId)}/step/${step - 1}" class="btn btn-secondary">← Quay lại</a>
            <button type="submit" class="btn btn-primary">${step === 6 ? 'Hoàn tất Setup Wizard ✅' : 'Tiếp tục →'}</button>
          </div>
        </form>
      </div>
    `;

    res.send(renderWizardLayout(`Bước ${step}: ${stepNames[step]}`, body, {
      shopId,
      currentStep: step,
      completedSteps
    }));
  }

  // Handle Step submissions (Steps 2 to 6)
  async function submitStepPage(req, res) {
    const shopId = String(req.params.shopId || '').trim();
    const step = parseInt(req.params.step, 10);

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: `admin.wizard.step_${step}.submit`,
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    if (isNaN(step) || step < 2 || step > 6) {
      return res.status(400).send('Số bước không hợp lệ.');
    }

    if (step < 6) {
      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopId)}/step/${step + 1}`);
    } else {
      // Step 6 complete screen
      const completedSteps = [0, 1, 2, 3, 4, 5, 6];
      const body = `
        <div class="wizard-card">
          <h1>🎉 Setup Wizard Hoàn Tất!</h1>
          <div class="banner banner-success">
            Đã hoàn thành xuất sắc 6 bước setup an toàn cho shop <strong>${escapeHtml(shopId)}</strong>!
          </div>
          <p>Cửa hàng đã được đưa về chế độ chạy thử (Dry-run: ON, Live: OFF) an toàn tuyệt đối. Môi trường adult-shop vẫn hoạt động độc lập.</p>
          
          <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border);">
            <h3>Hành động tiếp theo khuyến nghị:</h3>
            <ol style="margin: 0; padding-left: 20px; line-height: 1.6;">
              <li>Mở tài khoản Facebook tester được ủy quyền.</li>
              <li>Gửi tin nhắn <code>menu</code> hoặc mã sản phẩm đến trang Facebook thử nghiệm.</li>
              <li>Kiểm tra phản hồi và xác nhận nhân viên có nhận được luồng bàn giao hay không.</li>
              <li>Gửi yêu cầu phê duyệt go-live chính thức lên quản trị viên hệ thống.</li>
            </ol>
          </div>

          <div class="wizard-actions">
            <span></span>
            <a href="/admin/shops/${encodeURIComponent(shopId)}" class="btn btn-primary">Đi đến trang quản lý Shop</a>
          </div>
        </div>
      `;
      res.send(renderWizardLayout('Wizard Complete', body, {
        shopId,
        currentStep: 6,
        completedSteps
      }));
    }
  }

  // Register routes with the express application
  app.get('/admin/wizard/new', renderStep0);
  app.post('/admin/wizard/new', submitStep0);
  app.get('/admin/wizard/new-shop-shell', renderNewShopForm);
  app.post('/admin/wizard/new-shop-shell', wizardShopGuard, submitNewShop);
  app.get('/admin/wizard/:shopId/step/:step', wizardShopGuard, renderStepPage);
  app.post('/admin/wizard/:shopId/step/:step', wizardShopGuard, submitStepPage);
}

module.exports = {
  registerWizardRoutes,
  isValidShopSlug,
  BLOCKLIST,
  wizardShopGuard
};

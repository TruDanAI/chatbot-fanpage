const express = require('express');
const { PERMISSIONS } = require('../admin-auth');
const { parseAdminRoles } = require('./route-auth');
const { createAdminRouteAuthorizer } = require('./route-auth');
const { createAdminSessionManager } = require('./session');
const { createPostgresAuditLogger } = require('./audit');
const { renderWizardLayout, escapeHtml } = require('./wizard-ui');
const { isProductionRuntime } = require('../storage-config');
const { createPostgresShopWriteService } = require('./shop-writes');
const { createPostgresShopSettingsWriteService } = require('./shop-settings-writes');
const { createPostgresProductWriteService } = require('./product-writes');
const { createPostgresDashboardReader } = require('./reader');
const { createPostgresPageMappingWriteService } = require('./page-mapping-writes');
const { createPostgresPageCredentialWriteService } = require('./page-credential-writes');
const { pageRef } = require('../utils/log-refs');
const { createPostgresShopReadinessCheckService } = require('./shop-readiness-check');
const { buildShopReadiness, resolveGlobalDryRunState } = require('./shop-readiness');


// Load pg Client safely
function loadPgClient() {
  try {
    return require('pg').Client;
  } catch {
    throw new Error('Gói "pg" là bắt buộc khi sử dụng database PostgreSQL.');
  }
}

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
  adminAuditFailClosed = false,
  Client = loadPgClient() // Allow injecting mock Client for tests
} = {}) {
  
  const shopWrites = createPostgresShopWriteService({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });

  const shopSettingsWrites = createPostgresShopSettingsWriteService({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });

  const productWrites = createPostgresProductWriteService({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });

  const reader = createPostgresDashboardReader({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });

  const pageMappingWrites = createPostgresPageMappingWriteService({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });

  const pageCredentialWrites = createPostgresPageCredentialWriteService({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });

  const shopReadinessChecks = createPostgresShopReadinessCheckService({
    databaseUrl: process.env.DATABASE_URL,
    Client
  });


  function buildRequestContext(req) {
    const ip = typeof getClientIp === 'function' ? String(getClientIp(req) || '').slice(0, 80) : '';
    return {
      requestId: '',
      ip,
      userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 240)
    };
  }

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

  // Perform Step 0 Pre-flight environment check
  async function performPreflightCheck() {
    const checks = {
      envSafe: !isProductionRuntime(process.env),
      dryRun: process.env.MESSENGER_DRY_RUN === 'true',
      dbConfig: process.env.MULTI_SHOP_DB_CONFIG_ENABLED === 'true',
      dbConnected: false,
      adultShopProtected: false
    };

    let activeShopCount = 0;
    let adultShopStatusText = 'Không tìm thấy';
    let existingShops = [];
    let dbErrorMessage = '';

    // Check DB Connection & query basic info
    if (process.env.DATABASE_URL) {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      try {
        await client.connect();
        checks.dbConnected = true;

        // Query active shops count safely (SELECT only)
        const countRes = await client.query('SELECT count(*) FROM shops WHERE status = \'active\';');
        activeShopCount = parseInt(countRes.rows[0]?.count || '0', 10);

        // Verify adult-shop exists in DB
        const adultRes = await client.query('SELECT id, slug, name, status, lifecycle FROM shops WHERE slug = \'adult-shop\';');
        if (adultRes.rows.length > 0) {
          const row = adultRes.rows[0];
          adultShopStatusText = `Tồn tại (${row.status || 'unknown'}, ${row.lifecycle || 'unknown'})`;
          checks.adultShopProtected = BLOCKLIST.has('adult-shop');
        } else {
          // If not in DB, is still protected by hardcoded blocklist
          adultShopStatusText = 'Chưa khởi tạo (Được bảo vệ bằng danh sách đen)';
          checks.adultShopProtected = true;
        }

        // List existing shops slug/name/status (SELECT only, no secrets or Page IDs)
        const shopsRes = await client.query('SELECT slug, name, status, lifecycle FROM shops ORDER BY created_at DESC LIMIT 5;');
        existingShops = shopsRes.rows.map(row => ({
          slug: row.slug || '',
          name: row.name || '',
          status: row.status || '',
          lifecycle: row.lifecycle || ''
        }));

      } catch (err) {
        dbErrorMessage = err.message;
        checks.dbConnected = false;
        checks.adultShopProtected = false;
      } finally {
        try {
          await client.end();
        } catch (_) {}
      }
    } else {
      dbErrorMessage = 'DATABASE_URL chưa được cấu hình biến môi trường.';
    }

    const isAllHardChecksPassed =
      checks.envSafe &&
      checks.dryRun &&
      checks.dbConfig &&
      checks.dbConnected &&
      checks.adultShopProtected;

    return {
      checks,
      activeShopCount,
      adultShopStatusText,
      existingShops,
      dbErrorMessage,
      isAllHardChecksPassed
    };
  }

  // Pre-flight check endpoint (Step 0)
  async function renderStep0(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.preflight.view',
      resourceType: 'wizard'
    });
    if (!principal) return;

    const {
      checks,
      activeShopCount,
      adultShopStatusText,
      existingShops,
      dbErrorMessage,
      isAllHardChecksPassed
    } = await performPreflightCheck();

    // Informational checks status
    const isCloudinaryConfigured = Boolean(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
    const isMasterKeyConfigured = Boolean(process.env.CREDENTIAL_MASTER_KEY);
    const deployedBranch = process.env.RAILWAY_GIT_BRANCH || 'Chưa rõ';

    let shopsListHtml = '<p class="meta">Chưa có cửa hàng nào được khởi tạo.</p>';
    if (existingShops.length > 0) {
      shopsListHtml = `
        <table style="margin-top: 8px; width: 100%;">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Tên Shop</th>
              <th>Status</th>
              <th>Lifecycle</th>
            </tr>
          </thead>
          <tbody>
            ${existingShops.map(s => `
              <tr>
                <td><code>${escapeHtml(s.slug)}</code></td>
                <td>${escapeHtml(s.name)}</td>
                <td><span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-warning'}">${escapeHtml(s.status)}</span></td>
                <td><span class="badge badge-neutral">${escapeHtml(s.lifecycle)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    const body = `
      <div class="wizard-card">
        <h1>Bước 0: Kiểm tra điều kiện hệ thống (Pre-flight Check)</h1>
        <p>Hệ thống tự động rà soát môi trường vận hành để đảm bảo an toàn tuyệt đối trước khi cho phép khởi tạo một cửa hàng mới.</p>
        
        <h2>🛡️ Điều kiện bắt buộc (Hard Checks)</h2>
        <div style="margin: 14px 0 20px; display: grid; gap: 10px;">
          <div class="checklist-item">
            <div class="checklist-label">
              <strong>1. Môi trường không phải Production:</strong>
              <span class="meta" style="display: block;">Yêu cầu chạy trên Staging hoặc Local.</span>
            </div>
            <span class="badge ${checks.envSafe ? 'badge-success' : 'badge-danger'}">${checks.envSafe ? 'ĐẠT (STAGING/LOCAL)' : 'THẤT BẠI (PRODUCTION)'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>2. Chế độ Global Dry-Run:</strong>
              <span class="meta" style="display: block;">Yêu cầu an toàn toàn cục MESSENGER_DRY_RUN=true trên Staging.</span>
            </div>
            <span class="badge ${checks.dryRun ? 'badge-success' : 'badge-danger'}">${checks.dryRun ? 'ĐẠT (DRY-RUN ON)' : 'THẤT BẠI (DRY-RUN OFF)'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>3. Cấu hình DB Multi-Shop:</strong>
              <span class="meta" style="display: block;">Định tuyến cơ sở dữ liệu động MULTI_SHOP_DB_CONFIG_ENABLED=true.</span>
            </div>
            <span class="badge ${checks.dbConfig ? 'badge-success' : 'badge-danger'}">${checks.dbConfig ? 'ĐẠT (DB-CONFIG ON)' : 'THẤT BẠI (DB-CONFIG OFF)'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>4. Kết nối Cơ sở dữ liệu:</strong>
              <span class="meta" style="display: block;">Kiểm tra khả năng truy xuất dữ liệu an toàn.</span>
            </div>
            <span class="badge ${checks.dbConnected ? 'badge-success' : 'badge-danger'}">${checks.dbConnected ? 'ĐẠT (KẾT NỐI OK)' : 'THẤT BẠI'}</span>
          </div>
          ${dbErrorMessage ? `<div class="banner banner-error" style="margin: -6px 0 0;">❌ Chi tiết lỗi kết nối DB: <code>${escapeHtml(dbErrorMessage)}</code></div>` : ''}

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>5. Bảo vệ adult-shop (Hạn chế rủi ro):</strong>
              <span class="meta" style="display: block;">Đảm bảo cửa hàng mặc định an toàn và bị chặn chỉnh sửa ngoài ý muốn.</span>
            </div>
            <span class="badge ${checks.adultShopProtected ? 'badge-success' : 'badge-danger'}">${checks.adultShopProtected ? 'ĐẠT (ĐÃ BẢO VỆ)' : 'THẤT BẠI'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>6. Quyền xác thực Admin:</strong>
              <span class="meta" style="display: block;">Phiên đăng nhập hợp lệ với vai trò quản trị viên.</span>
            </div>
            <span class="badge badge-success">ĐẠT (HỢP LỆ)</span>
          </div>
        </div>

        <h2>ℹ️ Thông tin bổ sung (Informational Checks)</h2>
        <div style="margin: 14px 0 20px; display: grid; gap: 8px;">
          <div class="checklist-item">
            <span class="checklist-label">Tổng số shop hoạt động (active):</span>
            <strong>${activeShopCount}</strong>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">Trạng thái của adult-shop:</span>
            <span>${escapeHtml(adultShopStatusText)}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">Mã khóa bảo mật (Master key):</span>
            <span class="badge ${isMasterKeyConfigured ? 'badge-success' : 'badge-warning'}">${isMasterKeyConfigured ? 'ĐÃ CẤU HÌNH' : 'CHƯA CẤU HÌNH'}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">Kho ảnh Cloudinary (Ảnh sản phẩm):</span>
            <span class="badge ${isCloudinaryConfigured ? 'badge-success' : 'badge-warning'}">${isCloudinaryConfigured ? 'SẴN SÀNG' : 'CHƯA CẤU HÌNH'}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">Nhánh vận hành (Railway branch):</span>
            <code>${escapeHtml(deployedBranch)}</code>
          </div>
        </div>

        <h2>🛒 Danh sách Shop hiện có (Top 5 mới nhất)</h2>
        <div style="margin: 10px 0 24px;">
          ${shopsListHtml}
        </div>

        ${!isAllHardChecksPassed ? `
          <div class="banner banner-error">
            ❌ <strong>Không đủ điều kiện:</strong> Một hoặc nhiều điều kiện bắt buộc (Hard Checks) chưa đạt. Nút "Bắt đầu tạo Shop" đã bị khóa. Hãy liên hệ kỹ thuật để cấu hình lại các biến môi trường hoặc cơ sở dữ liệu.
          </div>
        ` : ''}

        <form action="/admin/wizard/new" method="post" style="margin-top: 20px;">
          <div class="form-group" style="${!isAllHardChecksPassed ? 'display: none;' : ''}">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: normal; text-transform: none;">
              <input type="checkbox" name="confirm_staging" value="1" required style="width: auto; min-height: auto;">
              Tôi xác nhận đây là môi trường staging an toàn và cam kết tuân thủ quy tắc chạy thử nghiệm trước khi go-live.
            </label>
          </div>

          <div class="wizard-actions">
            <a href="/admin/dashboard" class="btn btn-secondary">Quay lại Dashboard</a>
            <button type="submit" class="btn btn-primary" ${!isAllHardChecksPassed ? 'disabled' : ''}>Bắt đầu tạo Shop →</button>
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

    const { isAllHardChecksPassed } = await performPreflightCheck();
    if (!isAllHardChecksPassed) {
      return res.status(400).send('Không đủ điều kiện bắt buộc (Hard Checks) để bắt đầu Wizard.');
    }

    if (req.body.confirm_staging !== '1') {
      return res.status(400).send('Bạn phải xác nhận kiểm tra môi trường để tiếp tục.');
    }

    // Step 0 passed, redirect to Step 1 (Create Shop Shell form)
    res.redirect(303, '/admin/wizard/new-shop-shell');
  }

  function renderNewShopFormHtml(res, { values = {}, error = '' } = {}) {
    const menuIntroDefault = 'Chào mừng bạn đến với cửa hàng! Vui lòng chọn sản phẩm bên dưới hoặc gửi mã để được tư vấn.';
    const handoffMessageDefault = 'Nhân viên sẽ hỗ trợ bạn ngay!';
    const fallbackTextDefault = 'Tôi chưa hiểu câu hỏi của bạn. Bạn muốn chat với nhân viên hỗ trợ không?';

    const body = `
      <div class="wizard-card">
        <h1>Bước 1: Tạo shop nháp (Bước 1: Tạo Shell Cửa Hàng)</h1>
        <p>Khởi tạo thông tin cửa hàng nháp ban đầu dưới chế độ test an toàn. Cửa hàng mới sẽ tự động bật chạy thử nghiệm an toàn và ngắt hoạt động thật (Go-Live) để bảo vệ hệ thống.</p>

        <div class="checklist-card" style="margin: 10px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">🛡️ Các cấu hình an toàn mặc định</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge badge-success">Chế độ test an toàn (Dry-Run: BẮT BUỘC BẬT)</span>
            <span class="badge badge-warning">Hoạt động thật (Go-Live): TẮT ❌</span>
            <span class="badge badge-neutral">Kết nối Fanpage: CHƯA CÓ</span>
            <span class="badge badge-neutral">Quyền gửi tin: CHƯA CÓ</span>
          </div>
        </div>

        ${error ? `<div class="banner banner-error">❌ <strong>Lỗi:</strong> ${escapeHtml(error)}</div>` : ''}

        <form action="/admin/wizard/new-shop-shell" method="post" style="margin-top: 14px;">
          <div class="form-group">
            <label for="shop_id">Đường dẫn rút gọn (Shop Slug) <span class="required">*</span></label>
            <input type="text" id="shop_id" name="shop_id" value="${escapeHtml(values.shop_id || '')}" placeholder="vi-du: nem-bui-xa" required pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$">
            <span class="field-help">Chỉ dùng chữ cái viết thường (a-z), số (0-9) và ký tự gạch nối (-). Ví dụ: <code>shop-cua-toi</code>. Không chấp nhận <code>adult-shop</code>.</span>
          </div>

          <div class="form-group">
            <label for="display_name">Tên hiển thị cửa hàng <span class="required">*</span></label>
            <input type="text" id="display_name" name="display_name" value="${escapeHtml(values.display_name || '')}" placeholder="Ví dụ: Nem Bùi Xá - Chi Nhánh 1" required>
          </div>

          <div class="form-group row">
            <div>
              <label for="locale">Ngôn ngữ mặc định</label>
              <select id="locale" name="locale">
                <option value="vi-VN" ${values.locale === 'vi-VN' || !values.locale ? 'selected' : ''}>Tiếng Việt (vi-VN)</option>
                <option value="en-US" ${values.locale === 'en-US' ? 'selected' : ''}>Tiếng Anh (en-US)</option>
              </select>
            </div>
            <div>
              <label for="timezone">Múi giờ</label>
              <select id="timezone" name="timezone">
                <option value="Asia/Ho_Chi_Minh" ${values.timezone === 'Asia/Ho_Chi_Minh' || !values.timezone ? 'selected' : ''}>Asia/Ho_Chi_Minh (Việt Nam)</option>
                <option value="Asia/Bangkok" ${values.timezone === 'Asia/Bangkok' ? 'selected' : ''}>Asia/Bangkok</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="menu_intro_text">Tin nhắn chào mừng đầu Menu <span class="required">*</span></label>
            <textarea id="menu_intro_text" name="menu_intro_text" required style="min-height: 70px;">${escapeHtml(values.menu_intro_text || menuIntroDefault)}</textarea>
            <span class="field-help">Lời chào tự động gửi cho khách hàng khi họ nhắn "menu" hoặc bắt đầu cuộc trò chuyện.</span>
          </div>

          <div class="form-group">
            <label for="handoff_message">Tin nhắn bàn giao nhân viên hỗ trợ <span class="required">*</span></label>
            <textarea id="handoff_message" name="handoff_message" required style="min-height: 70px;">${escapeHtml(values.handoff_message || handoffMessageDefault)}</textarea>
            <span class="field-help">Tin nhắn gửi tự động trước khi chuyển luồng chat cho nhân viên trực fanpage.</span>
          </div>

          <div class="form-group">
            <label for="fallback_text">Tin nhắn mặc định khi bot không hiểu <span class="required">*</span></label>
            <textarea id="fallback_text" name="fallback_text" required style="min-height: 70px;">${escapeHtml(values.fallback_text || fallbackTextDefault)}</textarea>
            <span class="field-help">Tin nhắn phản hồi tự động khi câu hỏi của khách hàng không khớp bất kỳ luật hay mã sản phẩm nào.</span>
          </div>

          <div class="wizard-actions" style="margin-top: 24px;">
            <a href="/admin/wizard/new" class="btn btn-secondary">← Quay lại Bước 0</a>
            <button type="submit" class="btn btn-primary">Lưu thông tin &amp; Tiếp tục →</button>
          </div>
        </form>
      </div>
    `;

    res.send(renderWizardLayout('Tạo Shell Cửa Hàng', body, { currentStep: 1, completedSteps: [0] }));
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

    renderNewShopFormHtml(res);
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

    const shopId = String(req.body.shop_id || req.body.shopId || '').trim().toLowerCase();
    const displayName = String(req.body.display_name || '').trim();
    const locale = String(req.body.locale || 'vi-VN').trim();
    const timezone = String(req.body.timezone || 'Asia/Ho_Chi_Minh').trim();
    const menuIntroText = String(req.body.menu_intro_text || '').trim();
    const handoffMessage = String(req.body.handoff_message || '').trim();
    const fallbackText = String(req.body.fallback_text || '').trim();

    if (!shopId) {
      return renderNewShopFormHtml(res, {
        values: req.body,
        error: 'Shop Slug không được bỏ trống.'
      });
    }

    if (BLOCKLIST.has(shopId)) {
      return res.status(403).send('Thao tác bị chặn: Cửa hàng này không thể chỉnh sửa hoặc tạo thông qua Setup Wizard.');
    }

    if (!isValidShopSlug(shopId)) {
      return renderNewShopFormHtml(res, {
        values: req.body,
        error: 'Định dạng Shop Slug không hợp lệ. Chỉ dùng chữ cái viết thường (a-z), số (0-9) và ký tự gạch nối (-). Ví dụ: shop-cua-toi'
      });
    }

    if (!displayName) {
      return renderNewShopFormHtml(res, {
        values: req.body,
        error: 'Tên hiển thị cửa hàng không được bỏ trống.'
      });
    }

    if (!menuIntroText || !handoffMessage || !fallbackText) {
      return renderNewShopFormHtml(res, {
        values: req.body,
        error: 'Tất cả tin nhắn mẫu bắt buộc phải được điền đầy đủ.'
      });
    }

    try {
      // 1. Create shop shell (forces dry_run=true, liveEnabled=false, status=active, package=basic, lifecycle=draft)
      const result = await shopWrites.createShop({
        principal,
        body: {
          shop_id: shopId,
          display_name: displayName,
          status: 'active',
          package: 'basic',
          lifecycle: 'draft',
          bot_mode: 'menu_code_handoff',
          locale,
          timezone
        },
        requestContext: buildRequestContext(req)
      });

      // 2. Set default Vietnamese templates into settings
      await shopSettingsWrites.updateSettings({
        principal,
        shopId: result.shopId,
        body: {
          bot_mode: 'menu_code_handoff',
          handoff_enabled: true,
          handoff_message: handoffMessage,
          menu_intro_text: menuIntroText,
          fallback_text: fallbackText
        },
        requestContext: buildRequestContext(req)
      });

      // Redirect to Step 2 on success
      res.redirect(303, `/admin/wizard/${encodeURIComponent(result.shopId)}/step/2`);
    } catch (err) {
      if (err.code === 'duplicate_shop') {
        console.warn('CREATE SHOP WARNING: Shop slug already exists:', shopId);
        return renderNewShopFormHtml(res, {
          values: req.body,
          error: 'Shop Slug này đã tồn tại trong hệ thống. Vui lòng chọn một slug khác.'
        });
      }
      console.error('DATABASE ERROR:', err);
      return renderNewShopFormHtml(res, {
        values: req.body,
        error: `Lỗi cơ sở dữ liệu: ${err.message}`
      });
    }
  }

  function renderStep2Html(res, { shop, settings = {}, products = [], assets = {}, error = '', success = '', values = {} } = {}) {
    const activeProducts = products.filter(p => p.status === 'active');
    const activeProductCount = activeProducts.length;
    const menuImageCount = assets?.summary?.menu_image_active || assets?.summary?.menu_image || 0;
    const menuTextExists = Boolean(settings?.menu_intro_text || values?.menu_intro_text);

    // completion gate rule: Step 2 passes when at least 1 active product exists AND menu intro text is non-empty
    const isStep2Passed = activeProductCount >= 1 && menuTextExists;

    const productsHtml = products.length === 0
      ? '<p class="meta" style="margin: 12px 0;">Cửa hàng chưa có sản phẩm nào. Vui lòng thêm ít nhất 1 sản phẩm hoạt động bên dưới.</p>'
      : `
        <table style="width: 100%; margin-top: 12px; margin-bottom: 18px;">
          <thead>
            <tr>
              <th>Mã SP</th>
              <th>Tên sản phẩm</th>
              <th>Giá hiển thị</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(p => `
              <tr>
                <td><code>${escapeHtml(p.code)}</code></td>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.price_text || 'Chưa rõ')}</td>
                <td>
                  <span class="badge ${p.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                    ${p.status === 'active' ? 'Hoạt động' : 'Ẩn'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    const body = `
      <div class="wizard-card">
        <h1>Bước 2: Cài đặt sản phẩm &amp; Lời chào bot (Bước 2: Cấu hình Sản phẩm & Menu)</h1>
        <p>Thiết lập danh sách sản phẩm hoạt động và lời nhắn chào mừng, bàn giao của cửa hàng: <strong>${escapeHtml(shop.name || shop.slug)}</strong></p>

        <div class="checklist-card" style="margin: 14px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">📊 Trạng thái hoàn thành bước 2</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge ${activeProductCount >= 1 ? 'badge-success' : 'badge-danger'}">
              Sản phẩm: ${activeProductCount} hoạt động (${activeProductCount >= 1 ? 'ĐẠT' : 'CHƯA ĐẠT'})
            </span>
            <span class="badge ${menuTextExists ? 'badge-success' : 'badge-danger'}">
              Lời chào Menu: ${menuTextExists ? 'ĐÃ ĐIỀN' : 'CHƯA CÓ'}
            </span>
            <span class="badge ${menuImageCount > 0 ? 'badge-success' : 'badge-warning'}">
              Ảnh thực đơn: ${menuImageCount > 0 ? `ĐÃ CÓ (${menuImageCount} ảnh)` : 'THIẾU (CẢNH BÁO)'}
            </span>
          </div>
        </div>

        ${error ? `<div class="banner banner-error">❌ <strong>Lỗi:</strong> ${escapeHtml(error)}</div>` : ''}
        ${success ? `<div class="banner banner-success">✅ ${escapeHtml(success)}</div>` : ''}

        <h2>🛒 Danh sách Sản phẩm Hiện có</h2>
        ${productsHtml}

        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 18px; margin-bottom: 24px;">
          <h3 style="margin-top: 0; font-size: 16px; color: var(--primary-dark);">➕ Thêm sản phẩm mới</h3>
          <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/2/products" method="post" style="margin-top: 10px;">
            <div class="form-group row">
              <div>
                <label for="code">Mã sản phẩm <span class="required">*</span></label>
                <input type="text" id="code" name="code" value="${escapeHtml(values.code || '')}" placeholder="Ví dụ: SP01" required pattern="^[a-zA-Z0-9_-]+$">
                <span class="field-help">Chỉ dùng chữ cái, số, gạch dưới và gạch nối. Không khoảng trắng.</span>
              </div>
              <div>
                <label for="name">Tên sản phẩm <span class="required">*</span></label>
                <input type="text" id="name" name="name" value="${escapeHtml(values.name || '')}" placeholder="Ví dụ: Nem chua đặc sản" required>
              </div>
            </div>

            <div class="form-group row">
              <div>
                <label for="price_text">Giá hiển thị (price_text) <span class="required">*</span></label>
                <input type="text" id="price_text" name="price_text" value="${escapeHtml(values.price_text || '')}" placeholder="Ví dụ: 50.000đ/chục" required>
              </div>
              <div>
                <label for="category">Danh mục (Không bắt buộc)</label>
                <input type="text" id="category" name="category" value="${escapeHtml(values.category || '')}" placeholder="Ví dụ: nem-chua">
              </div>
            </div>

            <div class="form-group">
              <label for="description">Mô tả sản phẩm</label>
              <textarea id="description" name="description" placeholder="Mô tả chi tiết sản phẩm..." style="min-height: 60px;">${escapeHtml(values.description || '')}</textarea>
            </div>

            <div class="form-group">
              <label for="tags">Tags (Ngăn cách bằng dấu phẩy)</label>
              <input type="text" id="tags" name="tags" value="${escapeHtml(values.tags || '')}" placeholder="Ví dụ: hot, best-seller">
            </div>

            <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="is_active" name="is_active" value="1" checked style="width: auto; min-height: auto;">
              <label for="is_active" style="text-transform: none; font-weight: normal; margin: 0; cursor: pointer;">Kích hoạt bán sản phẩm này ngay lập tức</label>
            </div>

            <button type="submit" class="btn btn-secondary" style="margin-top: 10px;">Thêm sản phẩm</button>
          </form>
        </div>

        <h2>💬 Cấu hình Lời nhắn &amp; Hỗ trợ khách hàng</h2>
        <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/2/settings" method="post">
          <div class="form-group">
            <label for="menu_intro_text">Tin nhắn chào mừng đầu Menu <span class="required">*</span></label>
            <textarea id="menu_intro_text" name="menu_intro_text" required style="min-height: 70px;">${escapeHtml(values.menu_intro_text || settings.menu_intro_text || '')}</textarea>
            <span class="field-help">Hiển thị khi khách gõ "menu" hoặc khi bắt đầu cuộc hội thoại.</span>
          </div>

          <div class="form-group">
            <label for="handoff_message">Tin nhắn bàn giao nhân viên hỗ trợ <span class="required">*</span></label>
            <textarea id="handoff_message" name="handoff_message" required style="min-height: 70px;">${escapeHtml(values.handoff_message || settings.handoff_message || '')}</textarea>
            <span class="field-help">Lời nhắn gửi tự động trước khi chuyển cuộc trò chuyện sang nhân viên Fanpage để hỗ trợ thủ công.</span>
          </div>

          <div class="form-group">
            <label for="fallback_text">Tin nhắn mặc định khi bot không hiểu <span class="required">*</span></label>
            <textarea id="fallback_text" name="fallback_text" required style="min-height: 70px;">${escapeHtml(values.fallback_text || settings.fallback_text || '')}</textarea>
            <span class="field-help">Hiển thị khi khách hàng hỏi câu hỏi ngoài các kịch bản trả lời tự động có sẵn.</span>
          </div>

          <button type="submit" class="btn btn-secondary">Cập nhật tin nhắn</button>
        </form>

        <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border);">
          <h2>🖼️ Ảnh Thực đơn Cửa Hàng</h2>
          ${menuImageCount > 0 ? `
            <div class="banner banner-success">
              ✅ Cửa hàng đã có <strong>${menuImageCount}</strong> ảnh thực đơn hoạt động an toàn.
            </div>
          ` : `
            <div class="banner banner-warning">
              ⚠️ <strong>Chưa có ảnh Menu:</strong> Chatbot Fanpage Basic sẽ phản hồi bằng tin nhắn chữ thay vì hình ảnh menu trực quan nếu thiếu ảnh menu. Khuyến nghị tải ảnh lên trước khi chạy thử.
            </div>
          `}
          <p class="meta">Do đặc thù xử lý tệp tin và Cloudinary, tính năng tải ảnh trực tiếp được liên kết bảo mật với trang quản trị cửa hàng chính thức. Bạn có thể tải ảnh lên ở tab mới rồi quay lại đây tiếp tục.</p>
          <a href="/admin/shops/${encodeURIComponent(shop.id)}#assets" target="_blank" class="btn btn-secondary" style="display: inline-flex; align-items: center; gap: 6px;">
            🖼️ Đi đến trang quản lý Ảnh &amp; Tài sản (Tab mới) ↗
          </a>
        </div>

        <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/2" method="post" style="margin-top: 28px;">
          <div class="wizard-actions">
            <a href="/admin/wizard/new-shop-shell" class="btn btn-secondary">← Quay lại Bước 1</a>
            <button type="submit" class="btn btn-primary" ${!isStep2Passed ? 'disabled' : ''}>
              ${isStep2Passed ? 'Tiếp tục sang Bước 3 →' : 'Cần thêm SP &amp; Tin nhắn Menu để Tiếp tục'}
            </button>
          </div>
          ${!isStep2Passed ? `
            <p class="meta" style="color: var(--danger); text-align: right; margin-top: 8px;">
              * Vui lòng thêm ít nhất 1 sản phẩm hoạt động và điền tin nhắn chào mừng menu để có thể mở khóa nút Tiếp tục.
            </p>
          ` : ''}
        </form>
      </div>
    `;

    res.send(renderWizardLayout('Cấu hình Sản phẩm & Menu', body, {
      shopId: shop.id,
      currentStep: 2,
      completedSteps: [0, 1]
    }));
  }

  async function renderStep2(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.step_2.view',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const success = req.query.success === 'product'
        ? 'Sản phẩm đã được thêm thành công!'
        : req.query.success === 'settings'
        ? 'Tin nhắn cấu hình đã được cập nhật thành công!'
        : '';

      renderStep2Html(res, {
        shop: shopDetail.shop,
        settings: shopDetail.settings,
        products: shopDetail.products,
        assets: shopDetail.assets,
        success
      });
    } catch (err) {
      console.error('STEP 2 VIEW ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tải Bước 2 Setup Wizard.');
    }
  }

  async function submitStep2Product(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_2.product.submit',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    const code = String(req.body.code || '').trim();
    const name = String(req.body.name || '').trim();
    const priceText = String(req.body.price_text || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || '').trim();
    const tags = String(req.body.tags || '').trim();
    const isActive = req.body.is_active === '1' || req.body.is_active === true;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      if (!code) {
        return renderStep2Html(res, {
          shop: shopDetail.shop,
          settings: shopDetail.settings,
          products: shopDetail.products,
          assets: shopDetail.assets,
          error: 'Mã sản phẩm không được bỏ trống.',
          values: req.body
        });
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
        return renderStep2Html(res, {
          shop: shopDetail.shop,
          settings: shopDetail.settings,
          products: shopDetail.products,
          assets: shopDetail.assets,
          error: 'Định dạng Mã sản phẩm không hợp lệ. Chỉ chấp nhận ký tự chữ, số, gạch dưới và gạch nối.',
          values: req.body
        });
      }

      if (!name) {
        return renderStep2Html(res, {
          shop: shopDetail.shop,
          settings: shopDetail.settings,
          products: shopDetail.products,
          assets: shopDetail.assets,
          error: 'Tên sản phẩm không được bỏ trống.',
          values: req.body
        });
      }

      if (!priceText) {
        return renderStep2Html(res, {
          shop: shopDetail.shop,
          settings: shopDetail.settings,
          products: shopDetail.products,
          assets: shopDetail.assets,
          error: 'Giá hiển thị không được bỏ trống.',
          values: req.body
        });
      }

      await productWrites.createProduct({
        principal,
        shopId: shopDetail.shop.id,
        body: {
          code,
          name,
          price_text: priceText,
          description,
          category,
          tags,
          status: isActive ? 'active' : 'hidden'
        },
        requestContext: buildRequestContext(req)
      });

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/2?success=product`);
    } catch (err) {
      const shopDetail = await reader.getShopDetail(shopId);
      let errorMsg = `Lỗi hệ thống: ${err.message}`;

      if (err.code === 'duplicate_product_code') {
        console.warn('STEP 2 ADD PRODUCT WARNING: Product code already exists in this shop:', code);
        errorMsg = 'Mã sản phẩm này đã tồn tại trong cửa hàng này. Vui lòng chọn mã sản phẩm khác.';
      } else {
        console.error('STEP 2 ADD PRODUCT DATABASE ERROR:', err);
      }

      renderStep2Html(res, {
        shop: shopDetail.shop,
        settings: shopDetail.settings,
        products: shopDetail.products,
        assets: shopDetail.assets,
        error: errorMsg,
        values: req.body
      });
    }
  }

  async function submitStep2Settings(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_2.settings.submit',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    const menuIntroText = String(req.body.menu_intro_text || '').trim();
    const handoffMessage = String(req.body.handoff_message || '').trim();
    const fallbackText = String(req.body.fallback_text || '').trim();

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      if (!menuIntroText || !handoffMessage || !fallbackText) {
        return renderStep2Html(res, {
          shop: shopDetail.shop,
          settings: shopDetail.settings,
          products: shopDetail.products,
          assets: shopDetail.assets,
          error: 'Tất cả các tin nhắn cấu hình bắt buộc phải điền đầy đủ.',
          values: req.body
        });
      }

      await shopSettingsWrites.updateSettings({
        principal,
        shopId: shopDetail.shop.id,
        body: {
          bot_mode: 'menu_code_handoff',
          handoff_enabled: true,
          handoff_message: handoffMessage,
          menu_intro_text: menuIntroText,
          fallback_text: fallbackText
        },
        requestContext: buildRequestContext(req)
      });

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/2?success=settings`);
    } catch (err) {
      console.error('STEP 2 SETTINGS DATABASE ERROR:', err);

      const shopDetail = await reader.getShopDetail(shopId);
      renderStep2Html(res, {
        shop: shopDetail.shop,
        settings: shopDetail.settings,
        products: shopDetail.products,
        assets: shopDetail.assets,
        error: `Lỗi hệ thống khi cập nhật tin nhắn: ${err.message}`,
        values: req.body
      });
    }
  }

  async function submitStep2Progress(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_2.progress',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const activeProductCount = (shopDetail.products || []).filter(p => p.status === 'active').length;
      const menuTextExists = Boolean(shopDetail.settings?.menu_intro_text);

      if (activeProductCount < 1 || !menuTextExists) {
        return renderStep2Html(res, {
          shop: shopDetail.shop,
          settings: shopDetail.settings,
          products: shopDetail.products,
          assets: shopDetail.assets,
          error: 'Không đủ điều kiện để tiếp tục: Cần ít nhất 1 sản phẩm hoạt động và Tin nhắn chào mừng Menu.'
        });
      }

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/3`);
    } catch (err) {
      console.error('STEP 2 PROGRESSION DATABASE ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tiếp tục sang bước 3.');
    }
  }

  // ──── Step 3: Facebook Page Mapping ────

  function renderStep3Html(res, { shop, mappings = [], error = '', success = '', previewResult = null, values = {} } = {}) {
    const activeMappings = mappings.filter(m => m.status === 'active');
    const archivedMappings = mappings.filter(m => m.status === 'archived');
    const hasActiveMapping = activeMappings.length > 0;
    const isStep3Passed = hasActiveMapping;

    const mappingsHtml = activeMappings.length === 0
      ? '<p class="meta" style="margin: 12px 0;">Cửa hàng chưa có liên kết trang Facebook nào. Vui lòng thêm liên kết trang ở phần bên dưới.</p>'
      : `
        <table style="width: 100%; margin-top: 12px; margin-bottom: 18px;">
          <thead>
            <tr>
              <th>Page Ref (Mã tham chiếu)</th>
              <th>Tên trang</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            ${activeMappings.map(m => `
              <tr>
                <td><code>${escapeHtml(m.page_ref || 'unknown')}</code></td>
                <td>${escapeHtml(m.page_name || 'Chưa đặt tên')}</td>
                <td><span class="badge badge-success">Hoạt động</span></td>
                <td class="meta">${escapeHtml(String(m.created_at || '').slice(0, 19))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    const archivedHtml = archivedMappings.length === 0 ? '' : `
      <details style="margin-top: 12px;">
        <summary class="meta" style="cursor: pointer;">Xem ${archivedMappings.length} liên kết đã lưu trữ (archived)</summary>
        <table style="width: 100%; margin-top: 8px;">
          <thead>
            <tr>
              <th>Page Ref</th>
              <th>Tên trang</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            ${archivedMappings.map(m => `
              <tr>
                <td><code>${escapeHtml(m.page_ref || 'unknown')}</code></td>
                <td>${escapeHtml(m.page_name || '')}</td>
                <td><span class="badge badge-neutral">Archived</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </details>
    `;

    let previewHtml = '';
    if (previewResult) {
      const previewOk = previewResult.page_format_valid && !previewResult.conflict;
      previewHtml = `
        <div class="checklist-card" style="margin: 18px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">📋 Kết quả kiểm tra (Preview)</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <span class="badge ${previewResult.page_format_valid ? 'badge-success' : 'badge-danger'}">
              Định dạng Page ID: ${previewResult.page_format_valid ? 'HỢP LỆ' : 'KHÔNG HỢP LỆ'}
            </span>
            <span class="badge ${!previewResult.conflict ? 'badge-success' : 'badge-danger'}">
              Trùng lặp Mapping: ${!previewResult.conflict ? 'KHÔNG CÓ' : 'ĐÃ TỒN TẠI'}
            </span>
          </div>
          <p style="margin: 10px 0 0; font-size: 13px;">Page Ref (Mã tham chiếu an toàn): <code>${escapeHtml(previewResult.page_ref || '')}</code></p>
          ${previewOk ? `
            <div class="banner banner-success" style="margin-top: 12px;">
              ✅ Page ID đã kiểm tra thành công. Bạn có thể tạo liên kết trang bên dưới.
            </div>
            <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/3" method="post" style="margin-top: 10px;">
              <input type="hidden" name="page_id" value="${escapeHtml(values.page_id || '')}">
              <input type="hidden" name="page_name" value="${escapeHtml(values.page_name || '')}">
              <div class="form-group">
                <label for="confirmation_text">Nhập <strong>CREATE PAGE MAPPING</strong> để xác nhận tạo liên kết <span class="required">*</span></label>
                <input type="text" id="confirmation_text" name="confirmation_text" placeholder="CREATE PAGE MAPPING" required pattern="CREATE PAGE MAPPING">
              </div>
              <button type="submit" class="btn btn-primary" style="margin-top: 8px;">Tạo liên kết trang Facebook</button>
            </form>
          ` : `
            <div class="banner banner-error" style="margin-top: 12px;">
              ❌ Không thể tạo liên kết: ${previewResult.conflict ? 'Page ID này đã có liên kết hoạt động với một cửa hàng khác.' : 'Định dạng Page ID không hợp lệ.'}
            </div>
          `}
        </div>
      `;
    }

    const body = `
      <div class="wizard-card">
        <h1>Bước 3: Kết nối Fanpage (Bước 3: Liên kết trang Facebook)</h1>
        <p>Kết nối cửa hàng <strong>${escapeHtml(shop.name || shop.slug)}</strong> với một trang Facebook (Fanpage) để nhận tin nhắn khách hàng gửi đến.</p>

        <div class="banner banner-warning" style="margin: 14px 0;">
          ⚠️ <strong>Lưu ý quan trọng:</strong> Bước này chỉ tạo liên kết định danh (Kết nối Fanpage / Page Mapping) giữa shop và Page ID. Bước này <strong>không</strong> lưu token xác thực và <strong>không</strong> gửi bất kỳ tin nhắn thật nào. Mã quyền gửi tin (AccessToken) sẽ được thiết lập an toàn ở Bước 4.
        </div>

        <div class="checklist-card" style="margin: 14px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">📊 Trạng thái hoàn thành bước 3</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge ${hasActiveMapping ? 'badge-success' : 'badge-danger'}">
              Kết nối Fanpage (Page Mapping): ${hasActiveMapping ? 'ĐÃ LIÊN KẾT (' + activeMappings.length + ')' : 'CHƯA CÓ'}
            </span>
            <span class="badge badge-warning">
              Quyền gửi tin (Credential): CHƯA CÓ (Cài đặt ở Bước 4)
            </span>
          </div>
        </div>

        ${error ? '<div class="banner banner-error">❌ <strong>Lỗi:</strong> ' + escapeHtml(error) + '</div>' : ''}
        ${success ? '<div class="banner banner-success">✅ ' + escapeHtml(success) + '</div>' : ''}

        <h2>📄 Kết nối Fanpage hiện có</h2>
        ${mappingsHtml}
        ${archivedHtml}

        ${hasActiveMapping ? `
          <div class="banner banner-success" style="margin: 16px 0;">
            ✅ Cửa hàng đã có liên kết trang Facebook hoạt động. Nếu đã kết nối nhầm trang, bạn có thể lưu trữ (archive) liên kết hiện tại tại <a href="/admin/shops/${encodeURIComponent(shop.id)}" target="_blank">trang quản lý cửa hàng ↗</a> rồi quay lại đây tạo liên kết mới.
          </div>
        ` : `
          <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 18px; margin: 20px 0;">
            <h3 style="margin-top: 0; font-size: 16px; color: var(--primary-dark);">🔗 Kiểm tra và kết nối trang Fanpage mới</h3>
            <p class="meta" style="margin: 6px 0 14px;">Nhập Page ID của trang Facebook. Page ID là chuỗi số dài (ví dụ: 123456789012345) lấy từ phần Giới thiệu của trang Fanpage hoặc Trình quản lý kinh doanh Facebook.</p>
            <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/3/preview" method="post">
              <div class="form-group row">
                <div>
                  <label for="page_id">Mã định danh trang (Page ID) <span class="required">*</span></label>
                  <input type="text" id="page_id" name="page_id" value="${escapeHtml(values.page_id || '')}" placeholder="Ví dụ: 123456789012345" required pattern="^[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}$">
                  <span class="field-help">Chỉ nhập chuỗi số Page ID lấy từ Facebook. Tuyệt đối không nhập Token quyền gửi tin ở đây.</span>
                </div>
                <div>
                  <label for="page_name">Tên trang (Không bắt buộc)</label>
                  <input type="text" id="page_name" name="page_name" value="${escapeHtml(values.page_name || '')}" placeholder="Ví dụ: Nem Bùi Xá Official">
                </div>
              </div>
              <button type="submit" class="btn btn-secondary" style="margin-top: 10px;">Kiểm tra Page ID (Preview)</button>
            </form>
          </div>
        `}

        ${previewHtml}

        <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/3/continue" method="post" style="margin-top: 28px;">
          <div class="wizard-actions">
            <a href="/admin/wizard/${encodeURIComponent(shop.id)}/step/2" class="btn btn-secondary">← Quay lại Bước 2</a>
            <button type="submit" class="btn btn-primary" ${!isStep3Passed ? 'disabled' : ''}>
              ${isStep3Passed ? 'Tiếp tục sang Bước 4 →' : 'Cần liên kết Page để Tiếp tục'}
            </button>
          </div>
          ${!isStep3Passed ? '<p class="meta" style="color: var(--danger); text-align: right; margin-top: 8px;">* Không đủ điều kiện: Vui lòng kết nối và xác nhận thành công liên kết trang Facebook hoạt động để mở khóa nút Tiếp tục.</p>' : ''}
        </form>
      </div>
    `;

    res.send(renderWizardLayout('Liên kết trang Facebook', body, {
      shopId: shop.id,
      currentStep: 3,
      completedSteps: [0, 1, 2]
    }));
  }

  async function renderStep3(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.step_3.view',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const success = req.query.success === 'mapping'
        ? 'Liên kết trang Facebook đã được tạo thành công!'
        : '';

      // Build safe mappings list with page_ref only (no raw page_id)
      const safeMappings = (shopDetail.pages || []).map(p => ({
        id: p.id || '',
        page_ref: p.page_id ? pageRef(p.page_id) : 'unknown',
        page_name: p.page_name || '',
        status: p.status || '',
        created_at: p.created_at || ''
      }));

      renderStep3Html(res, {
        shop: shopDetail.shop,
        mappings: safeMappings,
        success
      });
    } catch (err) {
      console.error('STEP 3 VIEW ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tải Bước 3 Setup Wizard.');
    }
  }

  async function submitStep3Preview(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_3.preview',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    const rawPageId = String(req.body.page_id || '').trim();
    const pageName = String(req.body.page_name || '').trim();

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      if (!rawPageId) {
        const safeMappings = (shopDetail.pages || []).map(p => ({
          id: p.id || '',
          page_ref: p.page_id ? pageRef(p.page_id) : 'unknown',
          page_name: p.page_name || '',
          status: p.status || '',
          created_at: p.created_at || ''
        }));
        return renderStep3Html(res, {
          shop: shopDetail.shop,
          mappings: safeMappings,
          error: 'Page ID không được bỏ trống.',
          values: req.body
        });
      }

      // Check format validity
      const pageIdFormatValid = /^\d{5,32}$/.test(rawPageId);

      // Check for active mapping conflict globally
      let conflict = false;
      if (pageIdFormatValid) {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        try {
          await client.connect();
          const conflictRes = await client.query(
            "SELECT id, shop_id FROM shop_pages WHERE page_id = $1 AND status = 'active' LIMIT 1",
            [rawPageId]
          );
          conflict = conflictRes.rows.length > 0;
        } finally {
          try { await client.end(); } catch (_) {}
        }
      }

      const safePageRef = pageRef(rawPageId);
      const previewResult = {
        page_ref: safePageRef,
        page_format_valid: pageIdFormatValid,
        conflict,
        duplicate_active_mapping: conflict
      };

      const safeMappings = (shopDetail.pages || []).map(p => ({
        id: p.id || '',
        page_ref: p.page_id ? pageRef(p.page_id) : 'unknown',
        page_name: p.page_name || '',
        status: p.status || '',
        created_at: p.created_at || ''
      }));

      renderStep3Html(res, {
        shop: shopDetail.shop,
        mappings: safeMappings,
        previewResult,
        values: { page_id: rawPageId, page_name: pageName }
      });
    } catch (err) {
      console.error('STEP 3 PREVIEW ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi kiểm tra Page ID.');
    }
  }

  async function submitStep3Create(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_3.create',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    const rawPageId = String(req.body.page_id || '').trim();
    const pageName = String(req.body.page_name || '').trim();
    const confirmationText = String(req.body.confirmation_text || '').trim();

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const safeMappings = (shopDetail.pages || []).map(p => ({
        id: p.id || '',
        page_ref: p.page_id ? pageRef(p.page_id) : 'unknown',
        page_name: p.page_name || '',
        status: p.status || '',
        created_at: p.created_at || ''
      }));

      // Check confirmation text
      if (confirmationText.toUpperCase() !== 'CREATE PAGE MAPPING') {
        return renderStep3Html(res, {
          shop: shopDetail.shop,
          mappings: safeMappings,
          error: 'Bạn phải nhập đúng "CREATE PAGE MAPPING" để xác nhận tạo liên kết.',
          values: req.body
        });
      }

      // Check if shop already has active mapping
      const existingActive = (shopDetail.pages || []).filter(p => p.status === 'active');
      if (existingActive.length > 0) {
        return renderStep3Html(res, {
          shop: shopDetail.shop,
          mappings: safeMappings,
          error: 'Cửa hàng đã có liên kết trang Facebook hoạt động. Vui lòng lưu trữ liên kết cũ trước khi tạo mới.'
        });
      }

      // Use canonical page mapping write service
      const result = await pageMappingWrites.createPageMapping({
        principal,
        shopId: shopDetail.shop.id,
        body: {
          page_id: rawPageId,
          page_name: pageName,
          status: 'active'
        },
        requestContext: buildRequestContext(req)
      });

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/3?success=mapping`);
    } catch (err) {
      if (err.code === 'duplicate_active_page_id') {
        console.warn('STEP 3 CREATE WARNING: Page ID already has an active mapping.');
      } else if (err.code === 'invalid_page_id') {
        console.warn('STEP 3 CREATE WARNING: Invalid page ID format.');
      } else {
        console.error('STEP 3 CREATE DATABASE ERROR:', err);
      }

      const shopDetail = await reader.getShopDetail(shopId);
      const safeMappings = (shopDetail.pages || []).map(p => ({
        id: p.id || '',
        page_ref: p.page_id ? pageRef(p.page_id) : 'unknown',
        page_name: p.page_name || '',
        status: p.status || '',
        created_at: p.created_at || ''
      }));

      let errorMsg = `Lỗi hệ thống: ${err.message}`;
      if (err.code === 'duplicate_active_page_id') {
        errorMsg = 'Page ID này đã có liên kết hoạt động với cửa hàng khác. Vui lòng dùng Page ID khác.';
      } else if (err.code === 'invalid_page_id') {
        errorMsg = 'Định dạng Page ID không hợp lệ.';
      } else if (err.code === 'page_setup_preview_only') {
        errorMsg = 'Cửa hàng này chỉ cho phép xem trước (preview-only), không thể tạo liên kết trực tiếp.';
      }

      renderStep3Html(res, {
        shop: shopDetail.shop,
        mappings: safeMappings,
        error: errorMsg,
        values: req.body
      });
    }
  }

  async function submitStep3Progress(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_3.progress',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const activeMappingCount = (shopDetail.pages || []).filter(p => p.status === 'active').length;

      if (activeMappingCount < 1) {
        const safeMappings = (shopDetail.pages || []).map(p => ({
          id: p.id || '',
          page_ref: p.page_id ? pageRef(p.page_id) : 'unknown',
          page_name: p.page_name || '',
          status: p.status || '',
          created_at: p.created_at || ''
        }));
        return renderStep3Html(res, {
          shop: shopDetail.shop,
          mappings: safeMappings,
          error: 'Không đủ điều kiện để tiếp tục: Cần ít nhất 1 liên kết trang Facebook hoạt động.'
        });
      }

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/4`);
    } catch (err) {
      console.error('STEP 3 PROGRESSION ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tiếp tục sang bước 4.');
    }
  }

  // ──── Step 4: Page Credentials ────

  function renderStep4Html(res, { shop, activeMapping = null, error = '', success = '' } = {}) {
    const hasActiveMapping = Boolean(activeMapping);
    const activeCredentialCount = activeMapping ? (activeMapping.active_credential_count || 0) : 0;
    const hasActiveCredential = activeCredentialCount > 0;
    const isStep4Passed = hasActiveMapping && hasActiveCredential;

    let mappingDetailsHtml = '';
    if (hasActiveMapping) {
      mappingDetailsHtml = `
        <table style="width: 100%; margin-top: 12px; margin-bottom: 18px;">
          <thead>
            <tr>
              <th>Page Ref (Mã tham chiếu)</th>
              <th>Tên trang</th>
              <th>Trạng thái Mapping</th>
              <th>Số Credential hoạt động</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>${escapeHtml(activeMapping.page_ref || 'unknown')}</code></td>
              <td>${escapeHtml(activeMapping.page_name || 'Chưa đặt tên')}</td>
              <td><span class="badge badge-success">Hoạt động</span></td>
              <td><span class="badge ${hasActiveCredential ? 'badge-success' : 'badge-danger'}">${activeCredentialCount}</span></td>
            </tr>
          </tbody>
        </table>
      `;
    } else {
      mappingDetailsHtml = `
        <div class="banner banner-error" style="margin: 14px 0;">
          ❌ <strong>Lỗi:</strong> Cửa hàng này chưa có liên kết trang Facebook hoạt động. Vui lòng hoàn thành <a href="/admin/wizard/${encodeURIComponent(shop.id)}/step/3">Bước 3: Liên kết trang Facebook</a> trước khi thực hiện bước này.
        </div>
      `;
    }

    const formHtml = (!hasActiveMapping || hasActiveCredential)
      ? ''
      : `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <h3 style="margin-top: 0; font-size: 16px; color: var(--primary-dark);">🔑 Nhập thông tin xác thực mới (AccessToken)</h3>
          <p class="meta" style="margin: 6px 0 14px;">Nhập Facebook Page Access Token từ Cổng phát triển ứng dụng Facebook (Facebook Developers Portal). Token này sẽ được mã hóa an toàn tuyệt đối bằng thuật toán AES-256-GCM.</p>
          <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/4" method="post">
            <div class="form-group">
              <label for="page_token">Mã bảo mật Fanpage (Page Access Token) <span class="required">*</span></label>
              <input type="password" id="page_token" name="page_token" placeholder="Nhập Facebook Page Access Token (EAA...)" required minlength="20" autocomplete="new-password">
              <span class="field-help">Mã token quyền gửi tin bắt đầu bằng EAA... có độ dài từ 20 đến 5000 ký tự.</span>
            </div>
            <div class="form-group">
              <label for="confirmation_text">Nhập chính xác dòng chữ <strong>CREATE PAGE CREDENTIAL</strong> để xác nhận <span class="required">*</span></label>
              <input type="text" id="confirmation_text" name="confirmation_text" placeholder="CREATE PAGE CREDENTIAL" required pattern="CREATE PAGE CREDENTIAL">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top: 10px;">🔒 Mã hóa &amp; Lưu mã bảo mật</button>
          </form>
        </div>
      `;

    const body = `
      <div class="wizard-card">
        <h1>Bước 4: Quyền gửi tin Fanpage (Bước 4: Lưu thông tin xác thực)</h1>
        <p>Kết nối thông tin mã bảo mật xác thực quyền gửi tin an toàn cho shop <strong>${escapeHtml(shop.name || shop.slug)}</strong>.</p>

        <div class="banner banner-warning" style="margin: 14px 0;">
          ⚠️ <strong>Bảo mật thông tin tối đa:</strong> Token của bạn sẽ được mã hóa chuẩn quân đội và lưu trữ an toàn trong cơ sở dữ liệu. Quy trình này **không** gọi Meta Graph API, **không** chạy kiểm tra sức khỏe token, và **không** gửi bất kỳ tin nhắn Messenger thật nào.
        </div>

        <div class="checklist-card" style="margin: 14px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">📊 Trạng thái hoàn thành bước 4</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge ${hasActiveMapping ? 'badge-success' : 'badge-danger'}">
              Kết nối Fanpage (Page Mapping): ${hasActiveMapping ? 'ĐÃ LIÊN KẾT' : 'CHƯA CÓ'}
            </span>
            <span class="badge ${hasActiveCredential ? 'badge-success' : 'badge-danger'}">
              Quyền gửi tin (Credential): ${hasActiveCredential ? 'ĐÃ LƯU AN TOÀN (' + activeCredentialCount + ')' : 'CHƯA CÓ'}
            </span>
          </div>
        </div>

        ${error ? '<div class="banner banner-error">❌ <strong>Lỗi:</strong> ' + escapeHtml(error) + '</div>' : ''}
        ${success ? '<div class="banner banner-success">✅ ' + escapeHtml(success) + '</div>' : ''}

        <h2>📄 Thông tin liên kết Fanpage hiện tại</h2>
        ${mappingDetailsHtml}

        ${hasActiveCredential ? `
          <div class="banner banner-success" style="margin: 16px 0;">
            ✅ Quyền gửi tin (Page Credential) Facebook Page đã được lưu trữ và mã hóa thành công. Bạn đã sẵn sàng để chuyển sang bước tiếp theo.
          </div>
        ` : ''}

        ${formHtml}

        <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/4/continue" method="post" style="margin-top: 28px;">
          <div class="wizard-actions">
            <a href="/admin/wizard/${encodeURIComponent(shop.id)}/step/3" class="btn btn-secondary">← Quay lại Bước 3</a>
            <button type="submit" class="btn btn-primary" ${!isStep4Passed ? 'disabled' : ''}>
              ${isStep4Passed ? 'Tiếp tục sang Bước 5 →' : 'Cần lưu Credential để Tiếp tục'}
            </button>
          </div>
          ${!isStep4Passed ? '<p class="meta" style="color: var(--danger); text-align: right; margin-top: 8px;">* Không đủ điều kiện: Vui lòng nhập và lưu thành công thông tin xác thực Facebook Page hoạt động để có thể mở khóa nút Tiếp tục.</p>' : ''}
        </form>
      </div>
    `;

    res.send(renderWizardLayout('Lưu thông tin xác thực', body, {
      shopId: shop.id,
      currentStep: 4,
      completedSteps: [0, 1, 2, 3]
    }));
  }

  async function renderStep4(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.step_4.view',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      // Check for active mapping
      const activeMapping = (shopDetail.pages || []).find(p => p.status === 'active');
      let safeActiveMapping = null;
      if (activeMapping) {
        safeActiveMapping = {
          id: activeMapping.id || '',
          page_ref: activeMapping.page_id ? pageRef(activeMapping.page_id) : 'unknown',
          page_name: activeMapping.page_name || '',
          status: activeMapping.status || '',
          active_credential_count: activeMapping.active_credential_count || 0
        };
      }

      const success = req.query.success === 'credential'
        ? 'Thông tin xác thực đã được lưu trữ và mã hóa an toàn!'
        : '';

      renderStep4Html(res, {
        shop: shopDetail.shop,
        activeMapping: safeActiveMapping,
        success
      });
    } catch (err) {
      console.error('STEP 4 VIEW ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tải Bước 4 Setup Wizard.');
    }
  }

  async function submitStep4Create(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_4.create',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    const pageToken = String(req.body.page_token || '').trim();
    const confirmationText = String(req.body.confirmation_text || '').trim();

    let shopDetail;
    try {
      shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const activeMapping = (shopDetail.pages || []).find(p => p.status === 'active');
      if (!activeMapping) {
        return renderStep4Html(res, {
          shop: shopDetail.shop,
          activeMapping: null,
          error: 'Không tìm thấy liên kết trang Facebook hoạt động để lưu thông tin xác thực.'
        });
      }

      const safeActiveMapping = {
        id: activeMapping.id || '',
        page_ref: activeMapping.page_id ? pageRef(activeMapping.page_id) : 'unknown',
        page_name: activeMapping.page_name || '',
        status: activeMapping.status || '',
        active_credential_count: activeMapping.active_credential_count || 0
      };

      // Check confirmation text
      if (confirmationText.toUpperCase() !== 'CREATE PAGE CREDENTIAL') {
        return renderStep4Html(res, {
          shop: shopDetail.shop,
          activeMapping: safeActiveMapping,
          error: 'Bạn phải nhập đúng "CREATE PAGE CREDENTIAL" để xác nhận.'
        });
      }

      // Reject duplicate credential if active already exists (wizard constraint)
      if (activeMapping.active_credential_count > 0) {
        return renderStep4Html(res, {
          shop: shopDetail.shop,
          activeMapping: safeActiveMapping,
          error: 'Thông tin xác thực hoạt động đã tồn tại cho trang Facebook này. Không thể tạo trùng lặp.'
        });
      }

      if (!pageToken) {
        return renderStep4Html(res, {
          shop: shopDetail.shop,
          activeMapping: safeActiveMapping,
          error: 'Token xác thực không được bỏ trống.'
        });
      }

      // Use canonical credential service
      await pageCredentialWrites.createPageCredential({
        principal,
        shopId: shopDetail.shop.id,
        pageMappingId: activeMapping.id,
        body: {
          token: pageToken
        },
        requestContext: buildRequestContext(req)
      });

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/4?success=credential`);
    } catch (err) {
      console.error('STEP 4 CREATE ERROR:', err);

      let errorMsg = `Lỗi hệ thống: ${err.message}`;
      if (err.code === 'active_credential_exists' || err.code === 'duplicate_active_credential') {
        errorMsg = 'Thông tin xác thực hoạt động đã tồn tại cho trang Facebook này. Không thể tạo trùng lặp.';
      } else if (
        err.code === 'credential_master_key_missing' ||
        err.message.includes('master_key') ||
        err.message.includes('key_missing') ||
        err.message.includes('encryption')
      ) {
        errorMsg = 'Lỗi cấu hình hệ thống: Không thể mã hóa thông tin xác thực tại thời điểm này. Vui lòng liên hệ quản trị viên.';
      } else if (err.code === 'credential_token_invalid') {
        errorMsg = 'Định dạng token xác thực không hợp lệ hoặc độ dài không đúng.';
      }

      // Re-read shop detail to get updated mappings
      if (!shopDetail) {
        try {
          shopDetail = await reader.getShopDetail(shopId);
        } catch (_) {}
      }

      let safeActiveMapping = null;
      if (shopDetail && shopDetail.pages) {
        const activeMapping = (shopDetail.pages || []).find(p => p.status === 'active');
        if (activeMapping) {
          safeActiveMapping = {
            id: activeMapping.id || '',
            page_ref: activeMapping.page_id ? pageRef(activeMapping.page_id) : 'unknown',
            page_name: activeMapping.page_name || '',
            status: activeMapping.status || '',
            active_credential_count: activeMapping.active_credential_count || 0
          };
        }
      }

      // Never echo token or preserve it!
      renderStep4Html(res, {
        shop: shopDetail ? shopDetail.shop : { id: shopId, slug: shopId },
        activeMapping: safeActiveMapping,
        error: errorMsg
      });
    }
  }

  async function submitStep4Progress(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_4.progress',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const activeMapping = (shopDetail.pages || []).find(p => p.status === 'active');
      const activeCredentialCount = activeMapping ? (activeMapping.active_credential_count || 0) : 0;

      if (!activeMapping || activeCredentialCount < 1) {
        let safeActiveMapping = null;
        if (activeMapping) {
          safeActiveMapping = {
            id: activeMapping.id || '',
            page_ref: activeMapping.page_id ? pageRef(activeMapping.page_id) : 'unknown',
            page_name: activeMapping.page_name || '',
            status: activeMapping.status || '',
            active_credential_count: activeCredentialCount
          };
        }
        return renderStep4Html(res, {
          shop: shopDetail.shop,
          activeMapping: safeActiveMapping,
          error: 'Không đủ điều kiện để tiếp tục: Cần ít nhất 1 thông tin xác thực hoạt động.'
        });
      }

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopDetail.shop.id)}/step/5`);
    } catch (err) {
      console.error('STEP 4 PROGRESSION ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tiếp tục sang bước 5.');
    }
  }

  // ──── Step 5: Readiness Gate ────


  function getStepUrlForCheckKey(key, shopId) {
    const mapping = {
      bot_mode_ready: 2,
      product_ready: 2,
      menu_assets_ready: 2,
      product_assets_ready: 2,
      multiple_menu_images: 2,
      page_mapping_ready: 3,
      credential_ready: 4
    };
    const step = mapping[key];
    if (step) {
      return `/admin/wizard/${encodeURIComponent(shopId)}/step/${step}`;
    }
    return `/admin/wizard/${encodeURIComponent(shopId)}/step/5`;
  }

  function renderStep5Html(res, { shop, readiness = {}, success = '', error = '' } = {}) {
    const hardBlockerCount = readiness.hard_blockers?.length || 0;
    const hasHardBlockers = hardBlockerCount > 0;
    const isStep5Passed = !hasHardBlockers;

    let checkersHtml = '';
    if (readiness.checks && readiness.checks.length > 0) {
      checkersHtml = `
        <div style="display: grid; gap: 12px; margin: 20px 0;">
          ${readiness.checks.map(check => {
            let statusBadgeClass = 'badge-neutral';
            let statusLabel = 'Chưa rõ';
            if (check.status === 'pass') {
              statusBadgeClass = 'badge-success';
              statusLabel = 'ĐẠT';
            } else if (check.status === 'warning') {
              statusBadgeClass = 'badge-warning';
              statusLabel = 'CẢNH BÁO';
            } else if (check.status === 'fail') {
              statusBadgeClass = 'badge-danger';
              statusLabel = 'CHƯA ĐẠT';
            }

            const stepUrl = getStepUrlForCheckKey(check.key, shop.id);
            const isIssue = check.status === 'fail' || check.status === 'warning';

            return `
              <div class="checklist-item" style="border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: #ffffff;">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
                  <div style="min-width: 0; flex: 1;">
                    <strong style="font-size: 15px; color: var(--primary-dark);">${escapeHtml(check.label || '')}</strong>
                    <p style="margin: 4px 0; font-size: 13px; color: #334155;">${escapeHtml(check.detail || '')}</p>
                    ${isIssue && check.next_action ? `
                      <div style="margin-top: 8px; font-size: 13px; color: var(--warning); display: flex; align-items: center; gap: 6px;">
                        <span>🔧 <strong>Khuyến nghị:</strong> ${escapeHtml(check.next_action)}</span>
                        <a href="${stepUrl}" style="text-decoration: underline; font-weight: bold; margin-left: auto;">Đi đến Bước liên quan →</a>
                      </div>
                    ` : ''}
                  </div>
                  <span class="badge ${statusBadgeClass}" style="flex-shrink: 0; min-width: 90px; text-align: center;">${statusLabel}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const warningBannerHtml = `
      <div class="banner banner-warning" style="margin: 14px 0;">
        ⚠️ <strong>Bước 6 Tiếp theo:</strong> Nhấn "Tiếp tục" sẽ đưa bạn sang <strong>Bước 6: Chạy thử giả lập (Dry-Run Smoke Test)</strong>.
        Tại Bước 6, hệ thống chỉ chạy thử nghiệm giả lập (Dry-run: ON, Live: OFF) để bảo vệ tuyệt đối dữ liệu và không gửi tin nhắn thật hay gọi Meta API.
      </div>
    `;

    const blockerBannerHtml = hasHardBlockers
      ? `
        <div class="banner banner-error" style="margin: 16px 0;">
          ❌ <strong>Chưa đủ điều kiện:</strong> Phát hiện <strong>${hardBlockerCount}</strong> điều kiện bắt buộc chưa đạt.
          Vui lòng khắc phục các lỗi (được đánh dấu <span class="badge badge-danger">CHƯA ĐẠT</span>) bằng cách truy cập các bước tương ứng trước khi tiếp tục.
        </div>
      `
      : `
        <div class="banner banner-success" style="margin: 16px 0;">
          ✅ <strong>Sẵn sàng:</strong> Tất cả các điều kiện bắt buộc đã ĐẠT! Bạn có thể tiếp tục sang Bước 6.
        </div>
      `;

    const body = `
      <div class="wizard-card">
        <h1>Bước 5: Kiểm tra hoàn tất (Bước 5: Readiness Gate - Kiểm tra sẵn sàng)</h1>
        <p>Hệ thống tự động phân tích cấu hình của shop <strong>${escapeHtml(shop.name || shop.slug)}</strong> để đảm bảo bot có thể vận hành ổn định và an toàn tuyệt đối.</p>

        ${warningBannerHtml}

        <div class="checklist-card" style="margin: 14px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">📊 Trạng thái kiểm tra sẵn sàng</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge ${isStep5Passed ? 'badge-success' : 'badge-danger'}">
              Readiness Status: ${(readiness.readiness_status || 'failed').toUpperCase()} (Trạng thái kiểm tra sẵn sàng)
            </span>
            <span class="badge badge-neutral">Lỗi cần xử lý (Hard Blockers): ${hardBlockerCount}</span>
            <span class="badge badge-neutral">Cảnh báo không chặn (Warnings): ${readiness.warnings?.length || 0}</span>
          </div>
        </div>

        ${error ? `<div class="banner banner-error">❌ <strong>Lỗi:</strong> ${escapeHtml(error)}</div>` : ''}
        ${success ? `<div class="banner banner-success">✅ ${escapeHtml(success)}</div>` : ''}

        ${blockerBannerHtml}

        <h2>📋 Danh sách hạng mục kiểm tra hoàn tất (Readiness Checklist)</h2>
        ${checkersHtml}

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border);">
          <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/5/recheck" method="post" style="margin: 0;">
            <button type="submit" class="btn btn-secondary">🔄 Cập nhật &amp; Kiểm tra lại (Recheck)</button>
          </form>

          <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/5/continue" method="post" style="margin: 0;">
            <div class="wizard-actions" style="margin: 0;">
              <a href="/admin/wizard/${encodeURIComponent(shop.id)}/step/4" class="btn btn-secondary">← Quay lại Bước 4</a>
              <button type="submit" class="btn btn-primary" ${!isStep5Passed ? 'disabled' : ''}>
                ${isStep5Passed ? 'Tiếp tục sang Bước 6 →' : 'Cần đạt điều kiện bắt buộc để Tiếp tục'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    res.send(renderWizardLayout('Kiểm tra sẵn sàng', body, {
      shopId: shop.id,
      currentStep: 5,
      completedSteps: [0, 1, 2, 3, 4]
    }));
  }

  async function renderStep5(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.step_5.view',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      const counts = {
        products: shopDetail.products.filter(p => p.status === 'active').length,
        menu_images: shopDetail.assets?.summary?.menu_image_active || 0,
        product_images: shopDetail.assets?.summary?.product_image_active || 0,
        active_page_mappings: shopDetail.pages.filter(p => p.status === 'active').length,
        active_credentials: shopDetail.credentials?.active_fb_page_token_count || 0
      };

      const readiness = buildShopReadiness({
        shop: shopDetail.shop,
        settings: shopDetail.settings,
        counts,
        manualTestStatus: shopDetail.shop.last_manual_test_status,
        globalDryRunState: resolveGlobalDryRunState(process.env)
      });

      const success = req.query.success === 'rechecked'
        ? 'Kiểm tra trạng thái sẵn sàng thành công!'
        : '';

      renderStep5Html(res, {
        shop: shopDetail.shop,
        readiness,
        success
      });
    } catch (err) {
      console.error('STEP 5 VIEW ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tải Bước 5 Setup Wizard.');
    }
  }

  async function submitStep5Recheck(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_5.recheck',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      await shopReadinessChecks.checkReadiness({
        principal,
        shopId,
        requestContext: buildRequestContext(req)
      });

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopId)}/step/5?success=rechecked`);
    } catch (err) {
      console.error('STEP 5 RECHECK ERROR:', err);

      let shopDetail;
      try {
        shopDetail = await reader.getShopDetail(shopId);
      } catch (_) {}

      let counts = { products: 0, menu_images: 0, product_images: 0, active_page_mappings: 0, active_credentials: 0 };
      if (shopDetail) {
        counts = {
          products: shopDetail.products.filter(p => p.status === 'active').length,
          menu_images: shopDetail.assets?.summary?.menu_image_active || 0,
          product_images: shopDetail.assets?.summary?.product_image_active || 0,
          active_page_mappings: shopDetail.pages.filter(p => p.status === 'active').length,
          active_credentials: shopDetail.credentials?.active_fb_page_token_count || 0
        };
      }

      const readiness = buildShopReadiness({
        shop: shopDetail ? shopDetail.shop : { id: shopId, slug: shopId },
        settings: shopDetail ? shopDetail.settings : null,
        counts,
        manualTestStatus: shopDetail ? shopDetail.shop.last_manual_test_status : 'unknown',
        globalDryRunState: resolveGlobalDryRunState(process.env)
      });

      renderStep5Html(res, {
        shop: shopDetail ? shopDetail.shop : { id: shopId, slug: shopId },
        readiness,
        error: `Kiểm tra thất bại: ${err.message}`
      });
    }
  }

  async function submitStep5Progress(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_5.progress',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const result = await shopReadinessChecks.checkReadiness({
        principal,
        shopId,
        requestContext: buildRequestContext(req)
      });

      if (result.readiness.hard_blockers.length > 0) {
        const shopDetail = await reader.getShopDetail(shopId);
        return renderStep5Html(res, {
          shop: shopDetail.shop,
          readiness: result.readiness,
          error: 'Không đủ điều kiện để tiếp tục: Vui lòng hoàn thành toàn bộ điều kiện bắt buộc.'
        });
      }

      res.redirect(303, `/admin/wizard/${encodeURIComponent(shopId)}/step/6`);
    } catch (err) {
      console.error('STEP 5 PROGRESS ERROR:', err);

      let shopDetail;
      try {
        shopDetail = await reader.getShopDetail(shopId);
      } catch (_) {}

      let counts = { products: 0, menu_images: 0, product_images: 0, active_page_mappings: 0, active_credentials: 0 };
      if (shopDetail) {
        counts = {
          products: shopDetail.products.filter(p => p.status === 'active').length,
          menu_images: shopDetail.assets?.summary?.menu_image_active || 0,
          product_images: shopDetail.assets?.summary?.product_image_active || 0,
          active_page_mappings: shopDetail.pages.filter(p => p.status === 'active').length,
          active_credentials: shopDetail.credentials?.active_fb_page_token_count || 0
        };
      }

      const readiness = buildShopReadiness({
        shop: shopDetail ? shopDetail.shop : { id: shopId, slug: shopId },
        settings: shopDetail ? shopDetail.settings : null,
        counts,
        manualTestStatus: shopDetail ? shopDetail.shop.last_manual_test_status : 'unknown',
        globalDryRunState: resolveGlobalDryRunState(process.env)
      });

      renderStep5Html(res, {
        shop: shopDetail ? shopDetail.shop : { id: shopId, slug: shopId },
        readiness,
        error: `Tiếp tục thất bại: ${err.message}`
      });
    }
  }

  // ──── Step 6: Dry-Run Smoke Test (Chạy thử giả lập) ────

  function renderStep6Html(res, {
    shop,
    globalDryRun,
    isShopDryRun,
    defaultProductCode = '',
    manualTestStatus = 'unknown',
    showSimulation = false,
    simulationResults = {},
    error = '',
    success = ''
  } = {}) {
    const isCompleted = manualTestStatus === 'passed';

    let simulationResultHtml = '';
    if (showSimulation) {
      const { menuPass, productPass, handoffPass, mappingPass, credentialPass } = simulationResults;
      const allPass = menuPass && productPass && mappingPass && credentialPass;

      simulationResultHtml = `
        <div class="checklist-card" style="margin: 20px 0; border: 1px solid var(--border); border-radius: 8px; padding: 16px; background: #ffffff;">
          <h3 style="margin-top: 0; font-size: 15px; color: var(--primary-dark);">📊 Kết quả chạy thử giả lập mới nhất:</h3>

          <div style="display: grid; gap: 10px; margin-top: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13px; color: #334155;">1. Tin nhắn "menu" phản hồi đầu Menu:</span>
              <span class="badge ${menuPass ? 'badge-success' : 'badge-danger'}">${menuPass ? 'ĐẠT' : 'CHƯA ĐẠT'}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13px; color: #334155;">2. Tra cứu mã sản phẩm hoạt động:</span>
              <span class="badge ${productPass ? 'badge-success' : 'badge-danger'}">${productPass ? 'ĐẠT' : 'CHƯA ĐẠT'}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13px; color: #334155;">3. Liên kết trang Facebook hoạt động:</span>
              <span class="badge ${mappingPass ? 'badge-success' : 'badge-danger'}">${mappingPass ? 'ĐẠT' : 'CHƯA ĐẠT'}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13px; color: #334155;">4. Thông tin xác thực Page hoạt động:</span>
              <span class="badge ${credentialPass ? 'badge-success' : 'badge-danger'}">${credentialPass ? 'ĐẠT' : 'CHƯA ĐẠT'}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13px; color: #334155;">5. Phân phối bàn giao nhân viên (Handoff):</span>
              <span class="badge ${handoffPass ? 'badge-success' : 'badge-neutral'}">${handoffPass ? 'ĐẠT (Có bật)' : 'BỎ QUA (Không bật)'}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 13px; color: #334155;">6. Cách ly an toàn tuyệt đối (Không gửi Messenger thật):</span>
              <span class="badge badge-success">ĐẠT (Bảo vệ an toàn)</span>
            </div>
          </div>

          ${allPass
            ? `<div class="banner banner-success" style="margin-top: 14px; font-size: 13px;">✅ <strong>Giả lập thành công:</strong> Shop đã đạt toàn bộ tiêu chí chạy thử giả lập! Nút <strong>Hoàn tất Setup Wizard</strong> hiện đã khả dụng.</div>`
            : `<div class="banner banner-error" style="margin-top: 14px; font-size: 13px;">❌ <strong>Giả lập thất bại:</strong> Vui lòng hoàn tất cấu hình Menu (Bước 2), Sản phẩm (Bước 2), Page Mapping (Bước 3), hoặc Page Credential (Bước 4) để vượt qua bài test.</div>`
          }
        </div>
      `;
    }

    const body = `
      <div class="wizard-card">
        <h1>Bước 6: Test thử an toàn (Bước 6: Dry-Run Smoke Test - Chạy thử giả lập)</h1>
        <p>Hệ thống hỗ trợ chạy thử nghiệm giả lập offline an toàn tuyệt đối cho shop <strong>${escapeHtml(shop.name || shop.slug)}</strong> để kiểm thử luồng tin nhắn tự động mà không gọi Meta API hay gửi tin nhắn thật đến người dùng.</p>

        <div class="banner banner-warning" style="margin: 16px 0;">
          ⚠️ <strong>Simulation only:</strong> Chế độ test an toàn (Không có bất kỳ tin nhắn Messenger thật nào được gửi đi. Toàn bộ quá trình diễn ra giả lập hoàn toàn trong sandbox).
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 16px 0;">
          <div class="count">
            <span>Chế độ test an toàn (Global)</span>
            <strong style="color: ${globalDryRun ? 'var(--success)' : 'var(--danger)'};">${globalDryRun ? 'ĐANG BẬT (An toàn)' : 'ĐANG TẮT (Nguy hiểm)'}</strong>
          </div>
          <div class="count">
            <span>Chạy thử Shop (Local dry_run)</span>
            <strong style="color: ${isShopDryRun ? 'var(--success)' : 'var(--danger)'};">${isShopDryRun ? 'ĐANG BẬT (An toàn)' : 'ĐANG TẮT (Nguy hiểm)'}</strong>
          </div>
          <div class="count">
            <span>Trạng thái kiểm thử (Manual Test)</span>
            <strong style="color: ${isCompleted ? 'var(--success)' : 'var(--muted)'};">${manualTestStatus.toUpperCase()}</strong>
          </div>
        </div>

        ${error ? `<div class="banner banner-error">❌ <strong>Lỗi:</strong> ${escapeHtml(error)}</div>` : ''}
        ${success ? `<div class="banner banner-success">✅ ${escapeHtml(success)}</div>` : ''}

        ${simulationResultHtml}

        <div class="checklist-card" style="margin: 20px 0; border: 1px solid var(--border); border-radius: 8px; padding: 16px; background: #ffffff;">
          <h2 style="margin-top: 0; font-size: 16px;">🔄 Bảng điều khiển giả lập (Simulation Dashboard)</h2>
          <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/6/simulate" method="post">
            <div style="display: grid; gap: 12px; margin-top: 14px;">
              <label for="productCode" style="font-weight: bold; font-size: 13px;">Mã sản phẩm dùng để giả lập tra cứu:</label>
              <input type="text" id="productCode" name="productCode" required value="${escapeHtml(defaultProductCode)}" style="min-height: 38px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 14px;">
              <span class="page-id-help">Hệ thống sẽ giả lập người dùng gửi hai tin nhắn: <code>"menu"</code> và mã sản phẩm ở trên.</span>

              <button type="submit" class="btn btn-secondary" style="min-height: 40px; margin-top: 8px;">🚀 Bắt đầu giả lập chạy thử (Run Simulation)</button>
            </div>
          </form>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border);">
          <a href="/admin/wizard/${encodeURIComponent(shop.id)}/step/5" class="btn btn-secondary">← Quay lại Bước 5</a>

          <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/6/complete" method="post" style="margin: 0;">
            <button type="submit" class="btn btn-primary" ${!isCompleted ? 'disabled' : ''}>
              ${isCompleted ? 'Hoàn tất Setup Wizard ✅' : 'Cần đạt bài Chạy thử giả lập để Hoàn tất'}
            </button>
          </form>
        </div>
      </div>
    `;

    res.send(renderWizardLayout('Chạy thử giả lập', body, {
      shopId: shop.id,
      currentStep: 6,
      completedSteps: [0, 1, 2, 3, 4, 5]
    }));
  }

  async function renderStep6(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: 'admin.wizard.step_6.view',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      if (BLOCKLIST.has(shopId.toLowerCase())) {
        return res.status(403).send('Thao tác bị chặn.');
      }

      const globalDryRun = resolveGlobalDryRunState(process.env).dry_run;
      const isShopDryRun = Boolean(shopDetail.shop.dry_run);

      const activeProducts = shopDetail.products.filter(p => p.status === 'active');
      const defaultProductCode = activeProducts[0]?.code || '';

      const manualTestStatus = shopDetail.shop.last_manual_test_status || 'unknown';

      const showSimulation = req.query.success === 'simulated' || req.query.error === 'failed';
      const menuPass = req.query.menu_pass === '1';
      const productPass = req.query.product_pass === '1';
      const handoffPass = req.query.handoff_pass === '1';
      const mappingPass = req.query.mapping_pass === '1';
      const credentialPass = req.query.credential_pass === '1';

      renderStep6Html(res, {
        shop: shopDetail.shop,
        globalDryRun,
        isShopDryRun,
        defaultProductCode,
        manualTestStatus,
        showSimulation,
        simulationResults: {
          menuPass,
          productPass,
          handoffPass,
          mappingPass,
          credentialPass
        },
        error: req.query.error === 'failed' ? 'Giả lập thất bại: Vui lòng kiểm tra các điều kiện chưa đạt.' : '',
        success: req.query.success === 'simulated' ? 'Giả lập chạy thử thành công!' : ''
      });
    } catch (err) {
      console.error('STEP 6 VIEW ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi tải Bước 6 Setup Wizard.');
    }
  }

  async function submitStep6Simulate(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_6.simulate',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      if (BLOCKLIST.has(shopId.toLowerCase())) {
        return res.status(403).send('Thao tác bị chặn.');
      }

      const globalDryRun = resolveGlobalDryRunState(process.env).dry_run;
      const isShopDryRun = Boolean(shopDetail.shop.dry_run);

      if (globalDryRun !== true || !isShopDryRun) {
        return res.status(400).send('Giả lập chạy thử chỉ được thực hiện khi cả global dry-run và local shop dry-run đều được bật.');
      }

      const menuPass = Boolean(shopDetail.settings?.menu_intro_text?.trim());

      const inputProductCode = String(req.body.productCode || '').trim();
      const resolvedProduct = shopDetail.products.find(p => p.status === 'active' && p.code === inputProductCode);
      const productPass = Boolean(resolvedProduct);

      const mappingPass = shopDetail.pages.filter(p => p.status === 'active').length === 1;

      const credentialPass = (shopDetail.credentials?.active_fb_page_token_count || 0) === 1;

      const handoffPass = Boolean(shopDetail.settings?.handoff_enabled);

      const noRealSend = true;

      const success = menuPass && productPass && mappingPass && credentialPass && noRealSend;

      if (success) {
        const dbClient = new (Client || loadPgClient())({ connectionString: process.env.DATABASE_URL });
        await dbClient.connect();
        try {
          await dbClient.query(`
            UPDATE shops
            SET last_manual_test_status = $1,
                last_manual_test_at = now()
            WHERE id = $2
          `, ['passed', shopDetail.shop.id]);
        } finally {
          await dbClient.end();
        }

        res.redirect(303, `/admin/wizard/${encodeURIComponent(shopId)}/step/6?success=simulated&menu_pass=1&product_pass=1&mapping_pass=1&credential_pass=1&handoff_pass=${handoffPass ? 1 : 0}`);
      } else {
        res.redirect(303, `/admin/wizard/${encodeURIComponent(shopId)}/step/6?error=failed&menu_pass=${menuPass ? 1 : 0}&product_pass=${productPass ? 1 : 0}&mapping_pass=${mappingPass ? 1 : 0}&credential_pass=${credentialPass ? 1 : 0}&handoff_pass=${handoffPass ? 1 : 0}`);
      }
    } catch (err) {
      console.error('STEP 6 SIMULATE ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi chạy giả lập.');
    }
  }

  async function submitStep6Complete(req, res) {
    const shopId = String(req.params.shopId || '').trim();

    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.wizard.step_6.complete',
      resourceType: 'wizard',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const shopDetail = await reader.getShopDetail(shopId);
      if (!shopDetail.shop) {
        return res.status(404).send('Không tìm thấy cửa hàng.');
      }

      if (BLOCKLIST.has(shopId.toLowerCase())) {
        return res.status(403).send('Thao tác bị chặn.');
      }

      if (shopDetail.shop.last_manual_test_status !== 'passed') {
        return res.status(400).send('Cần hoàn thành chạy thử giả lập trước khi hoàn tất.');
      }

      try {
        await shopReadinessChecks.checkReadiness({
          principal,
          shopId: shopDetail.shop.id,
          requestContext: buildRequestContext(req)
        });
      } catch (readinessErr) {
        console.error('FINAL READINESS CHECK WARNING:', readinessErr.message);
      }

      const completedSteps = [0, 1, 2, 3, 4, 5, 6];
      const body = `
        <div class="wizard-card">
          <h1>🎉 Setup Wizard Hoàn Tất!</h1>
          <div class="banner banner-success">
            Đã cấu hình và hoàn thành chạy thử thành công cho shop <strong>${escapeHtml(shopDetail.shop.name || shopDetail.shop.slug)}</strong>!
          </div>
          
          <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border);">
            <h3>🛡️ Hoàn thành ở chế độ chạy thử (Dry-Run Mode):</h3>
            <p style="margin: 6px 0; line-height: 1.5; font-size: 14px; color: #334155;">
              Cửa hàng hiện đã kết thúc toàn bộ 6 bước thiết lập trong trạng thái <strong>Chạy thử an toàn (Dry-run: ON, Live: OFF)</strong>.
              Bot chỉ phản hồi giả lập, tuyệt đối không gửi tin nhắn thật hay gây ảnh hưởng tới người dùng Messenger của bạn.
            </p>
            <p style="margin: 12px 0 6px; font-weight: bold; font-size: 14px; color: var(--warning);">
              ⚠️ Việc kích hoạt chế độ chạy thật (Live) là hành động riêng biệt và cần có phê duyệt của quản trị viên hệ thống.
            </p>
          </div>

          <div style="margin: 20px 0; padding: 16px; background: #ffffff; border-radius: 8px; border: 1px solid var(--border);">
            <h3>📋 Các bước vận hành tiếp theo khuyến nghị:</h3>
            <ul style="margin: 0; padding-left: 20px; line-height: 1.6; font-size: 13px; color: #475569;">
              <li>Truy cập trang Quản lý Shop để xem chi tiết cấu hình.</li>
              <li>Tải lên thêm các hình ảnh sản phẩm hoạt động thiếu (nếu có).</li>
              <li>Sử dụng các công tắc bật/tắt Dry-run và Live ở trang chi tiết Shop sau khi được duyệt.</li>
            </ul>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border);">
            <span></span>
            <a href="/admin/shops/${encodeURIComponent(shopDetail.shop.id)}" class="btn btn-primary">Đi đến trang quản lý Shop →</a>
          </div>
        </div>
      `;

      res.send(renderWizardLayout('Wizard Complete', body, {
        shopId: shopDetail.shop.id,
        currentStep: 6,
        completedSteps
      }));
    } catch (err) {
      console.error('STEP 6 COMPLETE ERROR:', err);
      res.status(500).send('Lỗi máy chủ khi hoàn tất Setup Wizard.');
    }
  }

  // Legacy fallback routes
  async function renderStepPage(req, res) {
    const step = parseInt(req.params.step, 10);
    if (isNaN(step) || step < 7 || step > 7) {
      return res.status(400).send('Số bước không hợp lệ.');
    }
  }

  async function submitStepPage(req, res) {
    const step = parseInt(req.params.step, 10);
    if (isNaN(step) || step < 7 || step > 7) {
      return res.status(400).send('Số bước không hợp lệ.');
    }
  }

  // Register routes with the express application
  app.get('/admin/wizard/new', renderStep0);
  app.post('/admin/wizard/new', submitStep0);
  app.get('/admin/wizard/new-shop-shell', renderNewShopForm);
  app.post('/admin/wizard/new-shop-shell', wizardShopGuard, submitNewShop);
  app.get('/admin/wizard/:shopId/step/2', wizardShopGuard, renderStep2);
  app.post('/admin/wizard/:shopId/step/2', wizardShopGuard, submitStep2Progress);
  app.post('/admin/wizard/:shopId/step/2/products', wizardShopGuard, submitStep2Product);
  app.post('/admin/wizard/:shopId/step/2/settings', wizardShopGuard, submitStep2Settings);
  app.get('/admin/wizard/:shopId/step/3', wizardShopGuard, renderStep3);
  app.post('/admin/wizard/:shopId/step/3', wizardShopGuard, submitStep3Create);
  app.post('/admin/wizard/:shopId/step/3/preview', wizardShopGuard, submitStep3Preview);
  app.post('/admin/wizard/:shopId/step/3/continue', wizardShopGuard, submitStep3Progress);
  app.get('/admin/wizard/:shopId/step/4', wizardShopGuard, renderStep4);
  app.post('/admin/wizard/:shopId/step/4', wizardShopGuard, submitStep4Create);
  app.post('/admin/wizard/:shopId/step/4/continue', wizardShopGuard, submitStep4Progress);
  app.get('/admin/wizard/:shopId/step/5', wizardShopGuard, renderStep5);
  app.post('/admin/wizard/:shopId/step/5/recheck', wizardShopGuard, submitStep5Recheck);
  app.post('/admin/wizard/:shopId/step/5/continue', wizardShopGuard, submitStep5Progress);
  app.get('/admin/wizard/:shopId/step/6', wizardShopGuard, renderStep6);
  app.post('/admin/wizard/:shopId/step/6/simulate', wizardShopGuard, submitStep6Simulate);
  app.post('/admin/wizard/:shopId/step/6/complete', wizardShopGuard, submitStep6Complete);
  app.get('/admin/wizard/:shopId/step/:step', wizardShopGuard, renderStepPage);
  app.post('/admin/wizard/:shopId/step/:step', wizardShopGuard, submitStepPage);

}

module.exports = {
  registerWizardRoutes,
  isValidShopSlug,
  BLOCKLIST,
  wizardShopGuard
};

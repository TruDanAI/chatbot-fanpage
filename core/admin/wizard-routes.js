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
        <h1>Bước 0: Pre-flight Check (Kiểm tra môi trường)</h1>
        <p>Hệ thống tự động rà soát môi trường vận hành trước khi cho phép Operator thiết lập một shop Basic mới.</p>
        
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
              <span class="meta" style="display: block;">MESSENGER_DRY_RUN=true bắt buộc trên Staging.</span>
            </div>
            <span class="badge ${checks.dryRun ? 'badge-success' : 'badge-danger'}">${checks.dryRun ? 'ĐẠT (DRY-RUN ON)' : 'THẤT BẠI (DRY-RUN OFF)'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>3. Cấu hình DB Multi-Shop:</strong>
              <span class="meta" style="display: block;">MULTI_SHOP_DB_CONFIG_ENABLED=true để định tuyến động.</span>
            </div>
            <span class="badge ${checks.dbConfig ? 'badge-success' : 'badge-danger'}">${checks.dbConfig ? 'ĐẠT (DB-CONFIG ON)' : 'THẤT BẠI (DB-CONFIG OFF)'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>4. Kết nối Cơ sở dữ liệu:</strong>
              <span class="meta" style="display: block;">Kiểm tra đọc dữ liệu qua SELECT an toàn.</span>
            </div>
            <span class="badge ${checks.dbConnected ? 'badge-success' : 'badge-danger'}">${checks.dbConnected ? 'ĐẠT (KẾT NỐI OK)' : 'THẤT BẠI'}</span>
          </div>
          ${dbErrorMessage ? `<div class="banner banner-error" style="margin: -6px 0 0;">❌ Chi tiết lỗi kết nối DB: <code>${escapeHtml(dbErrorMessage)}</code></div>` : ''}

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>5. Bảo vệ adult-shop (Hạn chế rủi ro):</strong>
              <span class="meta" style="display: block;">Đảm bảo adult-shop tồn tại an toàn và bị chặn biến đổi.</span>
            </div>
            <span class="badge ${checks.adultShopProtected ? 'badge-success' : 'badge-danger'}">${checks.adultShopProtected ? 'ĐẠT (ĐÃ BẢO VỆ)' : 'THẤT BẠI'}</span>
          </div>

          <div class="checklist-item">
            <div class="checklist-label">
              <strong>6. Quyền xác thực Admin:</strong>
              <span class="meta" style="display: block;">Phiên đăng nhập hợp lệ với quyền ghi cấu hình.</span>
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
            <span class="checklist-label">Master key mã hóa token:</span>
            <span class="badge ${isMasterKeyConfigured ? 'badge-success' : 'badge-warning'}">${isMasterKeyConfigured ? 'ĐÃ CẤU HÌNH' : 'CHƯA CẤU HÌNH'}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">Upload Cloudinary (Ảnh sản phẩm):</span>
            <span class="badge ${isCloudinaryConfigured ? 'badge-success' : 'badge-warning'}">${isCloudinaryConfigured ? 'SẴN SÀNG' : 'CHƯA CẤU HÌNH'}</span>
          </div>
          <div class="checklist-item">
            <span class="checklist-label">Nhánh Deploy (Railway branch):</span>
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
        <h1>Bước 1: Tạo Shell Cửa Hàng (Shop Shell)</h1>
        <p>Khởi tạo bản ghi cửa hàng Basic mới dưới chế độ nháp an toàn. Cửa hàng sẽ tự động cấu hình chạy thử nghiệm (dry-run) và tắt Go-Live.</p>

        <div class="checklist-card" style="margin: 10px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">🛡️ Các cấu hình an toàn mặc định</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge badge-success">Dry-Run: BẮT BUỘC BẬT (An toàn)</span>
            <span class="badge badge-warning">Go-Live: TẮT</span>
            <span class="badge badge-neutral">Page Mapping: CHƯA CÓ</span>
            <span class="badge badge-neutral">Credentials: CHƯA CÓ</span>
          </div>
        </div>

        ${error ? `<div class="banner banner-error">❌ <strong>Lỗi:</strong> ${escapeHtml(error)}</div>` : ''}

        <form action="/admin/wizard/new-shop-shell" method="post" style="margin-top: 14px;">
          <div class="form-group">
            <label for="shop_id">Shop Slug (Slug viết liền, không dấu) <span class="required">*</span></label>
            <input type="text" id="shop_id" name="shop_id" value="${escapeHtml(values.shop_id || '')}" placeholder="vi-du: nem-bui-xa" required pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$">
            <span class="field-help">Chỉ dùng chữ cái viết thường (a-z), số (0-9) và ký tự gạch nối (-). ví-dụ: <code>shop-cua-toi</code>. Không chấp nhận <code>adult-shop</code>.</span>
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
            <span class="field-help">Gửi cho khách hàng khi họ nhắn "menu" hoặc bắt đầu cuộc trò chuyện.</span>
          </div>

          <div class="form-group">
            <label for="handoff_message">Tin nhắn bàn giao nhân viên hỗ trợ <span class="required">*</span></label>
            <textarea id="handoff_message" name="handoff_message" required style="min-height: 70px;">${escapeHtml(values.handoff_message || handoffMessageDefault)}</textarea>
            <span class="field-help">Tin nhắn gửi tự động trước khi chuyển luồng chat cho nhân viên trực fanpage.</span>
          </div>

          <div class="form-group">
            <label for="fallback_text">Tin nhắn mặc định khi bot không hiểu <span class="required">*</span></label>
            <textarea id="fallback_text" name="fallback_text" required style="min-height: 70px;">${escapeHtml(values.fallback_text || fallbackTextDefault)}</textarea>
            <span class="field-help">Tin nhắn phản hồi tự động khi câu hỏi không khớp bất kỳ luật hay sản phẩm nào.</span>
          </div>

          <div class="wizard-actions" style="margin-top: 24px;">
            <a href="/admin/wizard/new" class="btn btn-secondary">← Quay lại Bước 0</a>
            <button type="submit" class="btn btn-primary">Khởi tạo và Tiếp tục →</button>
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
      console.error('DATABASE ERROR:', err);
      if (err.code === 'duplicate_shop') {
        return renderNewShopFormHtml(res, {
          values: req.body,
          error: 'Shop Slug này đã tồn tại trong hệ thống. Vui lòng chọn một slug khác.'
        });
      }
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
        <h1>Bước 2: Cấu hình Sản phẩm & Menu</h1>
        <p>Thiết lập danh sách sản phẩm và tin nhắn chào mừng, bàn giao của cửa hàng: <strong>${escapeHtml(shop.name || shop.slug)}</strong></p>

        <div class="checklist-card" style="margin: 14px 0 20px;">
          <h3 style="margin-top: 0; font-size: 14px; color: var(--muted); text-transform: uppercase;">📊 Trạng thái hoàn thành bước 2</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span class="badge ${activeProductCount >= 1 ? 'badge-success' : 'badge-danger'}">
              Sản phẩm: ${activeProductCount} hoạt động (${activeProductCount >= 1 ? 'ĐẠT' : 'CHƯA ĐẠT'})
            </span>
            <span class="badge ${menuTextExists ? 'badge-success' : 'badge-danger'}">
              Tin nhắn Menu: ${menuTextExists ? 'ĐÃ ĐIỀN' : 'CHƯA CÓ'}
            </span>
            <span class="badge ${menuImageCount > 0 ? 'badge-success' : 'badge-warning'}">
              Ảnh Menu: ${menuImageCount > 0 ? `ĐÃ CÓ (${menuImageCount} ảnh)` : 'THIẾU (CẢNH BÁO)'}
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

        <h2>💬 Cấu hình Tin nhắn & Hỗ trợ</h2>
        <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/2/settings" method="post">
          <div class="form-group">
            <label for="menu_intro_text">Tin nhắn chào mừng đầu Menu <span class="required">*</span></label>
            <textarea id="menu_intro_text" name="menu_intro_text" required style="min-height: 70px;">${escapeHtml(values.menu_intro_text || settings.menu_intro_text || '')}</textarea>
            <span class="field-help">Hiển thị khi khách gõ "menu" hoặc khi bắt đầu cuộc hội thoại.</span>
          </div>

          <div class="form-group">
            <label for="handoff_message">Tin nhắn bàn giao nhân viên hỗ trợ <span class="required">*</span></label>
            <textarea id="handoff_message" name="handoff_message" required style="min-height: 70px;">${escapeHtml(values.handoff_message || settings.handoff_message || '')}</textarea>
            <span class="field-help">Hiển thị ngay trước khi tắt bot để nhân viên Fanpage nhảy vào trực tiếp.</span>
          </div>

          <div class="form-group">
            <label for="fallback_text">Tin nhắn mặc định khi bot không hiểu <span class="required">*</span></label>
            <textarea id="fallback_text" name="fallback_text" required style="min-height: 70px;">${escapeHtml(values.fallback_text || settings.fallback_text || '')}</textarea>
            <span class="field-help">Hiển thị khi khách hàng hỏi câu hỏi ngoài các kịch bản trả lời tự động có sẵn.</span>
          </div>

          <button type="submit" class="btn btn-secondary">Cập nhật tin nhắn</button>
        </form>

        <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border);">
          <h2>🖼️ Ảnh Menu Cửa Hàng</h2>
          ${menuImageCount > 0 ? `
            <div class="banner banner-success">
              ✅ Cửa hàng đã có <strong>${menuImageCount}</strong> ảnh menu hoạt động an toàn.
            </div>
          ` : `
            <div class="banner banner-warning">
              ⚠️ <strong>Chưa có ảnh Menu:</strong> Chatbot Fanpage Basic sẽ phản hồi bằng tin nhắn chữ thay vì hình ảnh menu trực quan nếu thiếu ảnh menu. Khuyến nghị tải ảnh lên trước khi chạy thử.
            </div>
          `}
          <p class="meta">Do đặc thù xử lý tệp tin và Cloudinary, tính năng tải ảnh trực tiếp được liên kết bảo mật với trang quản trị cửa hàng chính thức. Bạn có thể tải ảnh lên ở tab mới rồi quay lại đây tiếp tục.</p>
          <a href="/admin/shops/${encodeURIComponent(shop.id)}#assets" target="_blank" class="btn btn-secondary" style="display: inline-flex; align-items: center; gap: 6px;">
            🖼️ Đi đến trang quản lý Ảnh & Tài sản (Tab mới) ↗
          </a>
        </div>

        <form action="/admin/wizard/${encodeURIComponent(shop.id)}/step/2" method="post" style="margin-top: 28px;">
          <div class="wizard-actions">
            <a href="/admin/wizard/new-shop-shell" class="btn btn-secondary">← Quay lại Bước 1</a>
            <button type="submit" class="btn btn-primary" ${!isStep2Passed ? 'disabled' : ''}>
              ${isStep2Passed ? 'Tiếp tục sang Bước 3 →' : 'Cần thêm SP & Tin nhắn Menu để Tiếp tục'}
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
      console.error('STEP 2 ADD PRODUCT DATABASE ERROR:', err);

      const shopDetail = await reader.getShopDetail(shopId);
      let errorMsg = `Lỗi hệ thống: ${err.message}`;
      if (err.code === 'duplicate_product_code') {
        errorMsg = 'Mã sản phẩm này đã tồn tại trong cửa hàng này. Vui lòng chọn mã sản phẩm khác.';
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

  // General step rendering (Steps 3 to 6)
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

    if (isNaN(step) || step < 3 || step > 6) {
      return res.status(400).send('Số bước không hợp lệ.');
    }

    const completedSteps = [];
    for (let i = 0; i < step; i++) completedSteps.push(i);

    const stepNames = [
      '',
      '',
      '',
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

  // Handle Step submissions (Steps 3 to 6)
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

    if (isNaN(step) || step < 3 || step > 6) {
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
  app.get('/admin/wizard/:shopId/step/2', wizardShopGuard, renderStep2);
  app.post('/admin/wizard/:shopId/step/2', wizardShopGuard, submitStep2Progress);
  app.post('/admin/wizard/:shopId/step/2/products', wizardShopGuard, submitStep2Product);
  app.post('/admin/wizard/:shopId/step/2/settings', wizardShopGuard, submitStep2Settings);
  app.get('/admin/wizard/:shopId/step/:step', wizardShopGuard, renderStepPage);
  app.post('/admin/wizard/:shopId/step/:step', wizardShopGuard, submitStepPage);
}

module.exports = {
  registerWizardRoutes,
  isValidShopSlug,
  BLOCKLIST,
  wizardShopGuard
};

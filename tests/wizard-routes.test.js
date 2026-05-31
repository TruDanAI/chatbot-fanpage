const { describe, it, expect } = require('./harness');
const { registerWizardRoutes, isValidShopSlug, BLOCKLIST, wizardShopGuard } = require('../core/admin/wizard-routes');
const { PERMISSIONS } = require('../core/admin-auth');

class MockPgClient {
  constructor() {
    this.connected = false;
  }
  async connect() {
    this.connected = true;
  }
  async query(sql, params) {
    const cleanSql = String(sql || '').replace(/\s+/g, ' ').trim().toUpperCase();
    console.log('SQL QUERY RUNNING:', cleanSql, 'PARAMS:', params);
    if (cleanSql === 'BEGIN' || cleanSql === 'COMMIT' || cleanSql === 'ROLLBACK') {
      return { command: cleanSql, rows: [] };
    }
    if (cleanSql.includes('ACTIVE_PAGE_MAPPING_COUNT')) {
      if (params && params[0] === 'has-credentials-shop') {
        return { rows: [{
          active_page_mapping_count: 1,
          active_product_count: 1,
          active_menu_image_count: 1,
          active_product_image_count: 1
        }] };
      }
      if (params && (params[0] === 'has-page-shop' || params[0] === 'wizard-smoke-shop')) {
        return { rows: [{
          active_page_mapping_count: 1,
          active_product_count: 1,
          active_menu_image_count: 0,
          active_product_image_count: 0
        }] };
      }
      return { rows: [{
        active_page_mapping_count: 0,
        active_product_count: 0,
        active_menu_image_count: 0,
        active_product_image_count: 0
      }] };
    }
    if (cleanSql.includes("SLUG = 'ADULT-SHOP'") || (params && params.includes('adult-shop'))) {
      return { rows: [{ id: 'adult-shop', slug: 'adult-shop', name: 'Adult Shop', status: 'active', lifecycle: 'live' }] };
    }

    if (cleanSql.includes('SELECT COUNT(*) FROM SHOPS')) {
      return { rows: [{ count: '5' }] };
    }
    if (cleanSql.includes('FROM SHOPS WHERE ID = $1 OR SLUG = $1')) {
      if (cleanSql.includes('ORDER BY')) {
        return { rows: [{ id: params[0], slug: params[0], name: 'My Staging Shop', status: 'active', package: 'basic', lifecycle: 'draft', last_manual_test_status: 'passed', dry_run: true }] };
      }

      if (params && params[0] === 'duplicate-slug') {
        return { rows: [{ id: 'duplicate-slug', slug: 'duplicate-slug' }] };
      }
      return { rows: [] };
    }
    if (cleanSql.includes('INSERT INTO SHOPS')) {
      return { rows: [{
        id: params[0],
        slug: params[1],
        name: params[2],
        status: params[3],
        package: params[4],
        lifecycle: params[5],
        live_enabled: params[6],
        default_locale: params[7],
        timezone: params[8]
      }] };
    }
    if (cleanSql.includes('INSERT INTO SHOP_SETTINGS') || cleanSql.includes('ON CONFLICT (SHOP_ID)')) {
      return { rows: [{
        shop_id: params ? params[0] : 'some-shop',
        bot_mode: params ? params[1] : 'menu_code_handoff',
        handoff_enabled: params ? params[2] : true,
        handoff_message: params ? params[3] : '',
        menu_intro_text: params ? params[4] : '',
        fallback_text: params ? params[5] : '',
        settings_json: {}
      }] };
    }
    if (sql.includes('SELECT id, slug FROM shops WHERE id = $1')) {
      return { rows: [{ id: params[0], slug: params[0] }] };
    }
    if (cleanSql.includes('FROM SHOP_SETTINGS WHERE SHOP_ID = $1')) {
      return { rows: [{
        shop_id: params[0],
        bot_mode: 'menu_code_handoff',
        handoff_enabled: true,
        handoff_message: 'Handoff text',
        menu_intro_text: 'Menu intro text',
        fallback_text: 'Fallback text',
        settings_json: {}
      }] };
    }
    if (cleanSql.includes('FROM SHOP_PRODUCTS WHERE SHOP_ID = $1')) {
      if (cleanSql.includes('LOWER(CODE) = LOWER($2)')) {
        if (params && params[1] === 'duplicate-code') {
          return { rows: [{ id: 'prod-dup' }] };
        }
        return { rows: [] };
      }
      if (params && params[0] === 'empty-products-shop') {
        return { rows: [] };
      }
      return { rows: [
        { id: 'prod-1', code: 'code1', name: 'Product 1', price: null, currency: '', status: 'active', sort_order: 0, metadata_json: { priceText: '10k' } }
      ] };
    }
    if (cleanSql.includes('FROM SHOP_ASSETS WHERE SHOP_ID = $1')) {
      return { rows: [] };
    }
    if (cleanSql.includes('FROM SHOP_ASSETS A LEFT JOIN SHOP_PRODUCTS P')) {
      return { rows: [] };
    }
    // Page mapping queries
    if (cleanSql.includes('FROM SHOP_PAGES WHERE SHOP_ID = $1')) {
      if (params && (params[0] === 'has-page-shop' || params[0] === 'has-credentials-shop')) {
        return { rows: [
          { id: 'page_abc123', page_id: '111222333444555', page_name: 'Test Page', status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
        ] };
      }
      if (params && params[0] === 'has-archived-page-shop') {
        return { rows: [
          { id: 'page_old', page_id: '999888777666', page_name: 'Old Page', status: 'archived', created_at: '2025-12-01T00:00:00Z', updated_at: '2025-12-15T00:00:00Z' }
        ] };
      }
      return { rows: [] };
    }
    if (cleanSql.includes('FROM SHOP_PAGES WHERE ID = $1') && cleanSql.includes('SHOP_ID = $2')) {
      return { rows: [{ id: params[0], shop_id: params[1], page_id: '111222333444555', page_name: 'Test Page', status: 'active' }] };
    }
    if (cleanSql.includes('FROM SHOP_PAGES WHERE PAGE_ID = $1') && cleanSql.includes("STATUS = 'ACTIVE'")) {
      if (params && params[0] === '999999999999999') {
        return { rows: [{ id: 'page_conflict', shop_id: 'other-shop' }] };
      }
      return { rows: [] };
    }
    if (cleanSql.includes('INSERT INTO SHOP_PAGES')) {
      return { rows: [{
        id: params[0],
        shop_id: params[1],
        page_id: params[2],
        page_name: params[3],
        status: params[4],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }] };
    }
    if (cleanSql.includes('INSERT INTO SHOP_PRODUCTS')) {
      return { rows: [{
        id: params[0],
        shop_id: params[1],
        code: params[2],
        name: params[3],
        description: params[4],
        status: params[5],
        sort_order: params[6],
        metadata_json: JSON.parse(params[7])
      }] };
    }
    // Audit log inserts
    if (cleanSql.includes('INSERT INTO AUDIT_LOG') || cleanSql.includes('INSERT INTO ADMIN_AUDIT_LOG')) {
      return { rows: [{ id: 'audit-1' }] };
    }
    // Credential queries for getShopDetail & pageCredentialWrites
    if (cleanSql.includes('FROM SHOP_PAGE_CREDENTIALS') || (cleanSql.includes('SELECT') && cleanSql.includes('SHOP_PAGE_CREDENTIALS'))) {
      if (params && params[0] === 'has-credentials-shop') {
        if (cleanSql.includes('AS COUNT') || cleanSql.includes('ACTIVE_CREDENTIAL_COUNT')) {
          return { rows: [{ count: 1, active_credential_count: 1 }] };
        }
        return { rows: [
          { id: 'credential_123', page_mapping_id: 'page_abc123', status: 'active', credential_type: 'fb_page_token', page_status: 'active', total: 1 }
        ] };
      }
      if (cleanSql.includes('AS COUNT') || cleanSql.includes('ACTIVE_CREDENTIAL_COUNT')) {
        return { rows: [{ count: 0, active_credential_count: 0 }] };
      }
      return { rows: [] };
    }

    if (cleanSql.includes('INSERT INTO SHOP_PAGE_CREDENTIALS')) {
      return { rows: [{
        id: params[0],
        shop_id: params[1],
        page_mapping_id: params[2],
        credential_type: params[3],
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }] };
    }
    if (cleanSql.includes('FROM SHOP_ASSETS WHERE SHOP_ID = $1 GROUP BY ASSET_TYPE')) {
      if (params && params[0] === 'has-credentials-shop') {
        return { rows: [
          { asset_type: 'menu_image', total: 1, active: 1 },
          { asset_type: 'product_image', total: 1, active: 1 }
        ] };
      }
      return { rows: [] };
    }
    if (cleanSql.includes('ACTIVE_PAGE_MAPPING_COUNT')) {
      if (params && params[0] === 'has-credentials-shop') {
        return { rows: [{
          active_page_mapping_count: 1,
          active_product_count: 1,
          active_menu_image_count: 1,
          active_product_image_count: 1
        }] };
      }
      if (params && (params[0] === 'has-page-shop' || params[0] === 'wizard-smoke-shop')) {
        return { rows: [{
          active_page_mapping_count: 1,
          active_product_count: 1,
          active_menu_image_count: 0,
          active_product_image_count: 0
        }] };
      }
      return { rows: [{
        active_page_mapping_count: 0,
        active_product_count: 0,
        active_menu_image_count: 0,
        active_product_image_count: 0
      }] };
    }
    if (cleanSql.includes('UPDATE SHOPS') && cleanSql.includes('LAST_READINESS_STATUS')) {
      return { rows: [{
        id: params ? params[0] : 'some-shop',
        last_readiness_status: params ? params[1] : 'passed',
        last_readiness_checked_at: new Date().toISOString()
      }] };
    }
    if (cleanSql.includes('UPDATE SHOPS') && cleanSql.includes('LAST_MANUAL_TEST_STATUS')) {
      return { rows: [{
        id: params ? params[1] : 'some-shop',
        last_manual_test_status: params ? params[0] : 'passed',
        last_manual_test_at: new Date().toISOString()
      }] };
    }
    if (sql.includes('SELECT slug, name, status, lifecycle FROM shops')) {
      return { rows: [
        { slug: 'demo-shop', name: 'Demo Shop', status: 'active', lifecycle: 'configuring' },
        { slug: 'nem-bui-xa', name: 'Nem Bui Xa', status: 'active', lifecycle: 'configuring' }
      ] };
    }
    return { rows: [[1]] };

  }
  async end() {
    this.connected = false;
  }
}

class MockFailPgClient {
  async connect() {
    throw new Error('Connection timed out');
  }
  async end() {}
}

function createApp() {
  const routes = {};
  function makeChain(handlers) {
    return async (req, res) => {
      for (const fn of handlers) {
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        await fn(req, res, next);
        if (!nextCalled) break;
      }
    };
  }
  return {
    routes,
    get(path, ...handlers) {
      routes[path] = handlers.length === 1 ? handlers[0] : makeChain(handlers);
    },
    post(path, ...handlers) {
      routes[`POST ${path}`] = handlers.length === 1 ? handlers[0] : makeChain(handlers);
    },
    patch(path, ...handlers) {
      routes[`PATCH ${path}`] = handlers.length === 1 ? handlers[0] : makeChain(handlers);
    },
    delete(path, ...handlers) {
      routes[`DELETE ${path}`] = handlers.length === 1 ? handlers[0] : makeChain(handlers);
    }
  };
}

function createReq({ headers = {}, params = {}, query = {}, body = {} } = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    body,
    params,
    query,
    get(name) {
      return normalized[String(name).toLowerCase()] || '';
    }
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = String(body || '');
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      this.body = String(code);
      return this;
    },
    type(value) {
      this.headers['content-type'] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    redirect(statusOrLocation, maybeLocation) {
      if (typeof statusOrLocation === 'number') {
        this.statusCode = statusOrLocation;
        this.headers.location = maybeLocation;
      } else {
        this.statusCode = 302;
        this.headers.location = statusOrLocation;
      }
      this.body = 'Redirect';
      return this;
    }
  };
}

describe('Setup Wizard Slug pattern and blocklist validation', () => {
  it('validates correct and incorrect shop slugs', () => {
    expect(isValidShopSlug('nem-bui-xa')).toBeTrue();
    expect(isValidShopSlug('my-new-shop-123')).toBeTrue();

    // Pattern fails
    expect(isValidShopSlug('Nem-Bui-Xa')).toBeFalse(); // capital letters not allowed
    expect(isValidShopSlug('nem_bui_xa')).toBeFalse(); // underscore not allowed
    expect(isValidShopSlug('nem--bui')).toBeFalse(); // consecutive dashes
    expect(isValidShopSlug('-nem-bui')).toBeFalse(); // starts with dash

    // Blocklist checks
    expect(isValidShopSlug('adult-shop')).toBeFalse();
    expect(isValidShopSlug('admin')).toBeFalse();
    expect(isValidShopSlug('webhook')).toBeFalse();
  });
});

describe('Setup Wizard Router Skeleton & Guards', () => {
  it('registers all Express endpoints', () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      adminIpAllowlist: []
    });

    expect(app.routes['/admin/wizard/new'] !== undefined).toBeTrue();
    expect(app.routes['POST /admin/wizard/new'] !== undefined).toBeTrue();
    expect(app.routes['/admin/wizard/new-shop-shell'] !== undefined).toBeTrue();
    expect(app.routes['POST /admin/wizard/new-shop-shell'] !== undefined).toBeTrue();
    expect(app.routes['/admin/wizard/:shopId/step/:step'] !== undefined).toBeTrue();
    expect(app.routes['POST /admin/wizard/:shopId/step/:step'] !== undefined).toBeTrue();
  });

  it('restricts access to unauthenticated requests', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      adminIpAllowlist: []
    });

    const req = createReq({ headers: { authorization: 'Bearer wrong-token' } });
    const res = createRes();

    // Call Pre-flight step 0 view
    await app.routes['/admin/wizard/new'](req, res);

    expect(res.statusCode).toBe(401);
  });

  it('allows access to authenticated requests and blocks adult-shop via wizardShopGuard', async () => {
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    const reqValid = createReq({ params: { shopId: 'nem-bui-xa' } });
    const resValid = createRes();

    wizardShopGuard(reqValid, resValid, next);
    expect(nextCalled).toBeTrue();
    expect(resValid.statusCode).toBe(200);

    nextCalled = false;
    const reqBlocked = createReq({ params: { shopId: 'adult-shop' } });
    const resBlocked = createRes();

    wizardShopGuard(reqBlocked, resBlocked, next);
    expect(nextCalled).toBeFalse();
    expect(resBlocked.statusCode).toBe(403);
  });
});

describe('Setup Wizard Step 0 Pre-flight check page logic', () => {
  it('GET renders pre-flight check cards when auth passes under safe env', async () => {
    const app = createApp();

    // Set safe env variables
    const originalEnv = { ...process.env };
    process.env.MESSENGER_DRY_RUN = 'true';
    process.env.MULTI_SHOP_DB_CONFIG_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.NODE_ENV = 'development';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      adminIpAllowlist: [],
      Client: MockPgClient
    });

    const req = createReq({ headers: { authorization: 'Bearer test-token' } });
    const res = createRes();

    await app.routes['/admin/wizard/new'](req, res);

    expect(res.statusCode).toBe(200);
    // Check it renders hard check cards
    expect(res.body.includes('Pre-flight Check')).toBeTrue();
    expect(res.body.includes('Môi trường không phải Production')).toBeTrue();
    expect(res.body.includes('Chế độ test an toàn toàn cục')).toBeTrue();
    expect(res.body.includes('Cấu hình DB Multi-Shop')).toBeTrue();
    expect(res.body.includes('Bắt đầu tạo Shop →')).toBeTrue();

    // Verify the button itself is NOT disabled
    expect(res.body.includes('class="btn btn-primary" >Bắt đầu tạo Shop')).toBeTrue();

    // Restore environment
    process.env = originalEnv;
  });

  it('GET disables Start Wizard button and shows failure when MESSENGER_DRY_RUN=false', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.MESSENGER_DRY_RUN = 'false';
    process.env.MULTI_SHOP_DB_CONFIG_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.NODE_ENV = 'development';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({ headers: { authorization: 'Bearer test-token' } });
    const res = createRes();

    await app.routes['/admin/wizard/new'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('THẤT BẠI (TEST AN TOÀN TẮT)')).toBeTrue();

    // Verify the button has the disabled attribute
    expect(res.body.includes('class="btn btn-primary" disabled>Bắt đầu tạo Shop')).toBeTrue();

    process.env = originalEnv;
  });

  it('GET disables Start Wizard button and shows safe error when DB read fails', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.MESSENGER_DRY_RUN = 'true';
    process.env.MULTI_SHOP_DB_CONFIG_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.NODE_ENV = 'development';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockFailPgClient
    });

    const req = createReq({ headers: { authorization: 'Bearer test-token' } });
    const res = createRes();

    await app.routes['/admin/wizard/new'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Chi tiết lỗi kết nối DB: <code>Connection timed out</code>')).toBeTrue();

    // Verify the button has the disabled attribute
    expect(res.body.includes('class="btn btn-primary" disabled>Bắt đầu tạo Shop')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/new redirects only when all hard checks pass', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.MESSENGER_DRY_RUN = 'true';
    process.env.MULTI_SHOP_DB_CONFIG_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.NODE_ENV = 'development';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqValid = createReq({
      headers: { authorization: 'Bearer test-token' },
      body: { confirm_staging: '1' }
    });
    const resValid = createRes();

    await app.routes['POST /admin/wizard/new'](reqValid, resValid);

    expect(resValid.statusCode).toBe(303);
    expect(resValid.headers.location).toBe('/admin/wizard/new-shop-shell');

    // Simulate dry run off failure
    process.env.MESSENGER_DRY_RUN = 'false';
    const reqInvalid = createReq({
      headers: { authorization: 'Bearer test-token' },
      body: { confirm_staging: '1' }
    });
    const resInvalid = createRes();

    await app.routes['POST /admin/wizard/new'](reqInvalid, resInvalid);

    expect(resInvalid.statusCode).toBe(400);
    expect(resInvalid.body.includes('Không đủ điều kiện bắt buộc')).toBeTrue();

    process.env = originalEnv;
  });
});

describe('Setup Wizard Step 1 Create Shop Shell Form logic', () => {
  it('GET /admin/wizard/new-shop-shell requires auth and renders safe form defaults', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqUnauth = createReq({ headers: { authorization: 'Bearer wrong' } });
    const resUnauth = createRes();
    await app.routes['/admin/wizard/new-shop-shell'](reqUnauth, resUnauth);
    expect(resUnauth.statusCode).toBe(401);

    const reqAuth = createReq({ headers: { authorization: 'Bearer test-token' } });
    const resAuth = createRes();
    await app.routes['/admin/wizard/new-shop-shell'](reqAuth, resAuth);

    expect(resAuth.statusCode).toBe(200);
    expect(resAuth.body.includes('Bước 1: Tạo shop nháp')).toBeTrue();
    expect(resAuth.body.includes('Chế độ test an toàn bắt buộc bật')).toBeTrue();
    expect(resAuth.body.includes('Tin nhắn chào mừng đầu Menu')).toBeTrue();
    expect(resAuth.body.includes('Tin nhắn bàn giao nhân viên hỗ trợ')).toBeTrue();
    expect(resAuth.body.includes('Tin nhắn mặc định khi bot không hiểu')).toBeTrue();
  });

  it('POST /admin/wizard/new-shop-shell creates shop shell with transactional safe defaults and redirects to Step 2', async () => {
    const app = createApp();

    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      body: {
        shop_id: 'my-new-shop',
        display_name: 'My New Shop Name',
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
        menu_intro_text: 'Custom Welcome Intro',
        handoff_message: 'Custom Handoff message',
        fallback_text: 'Custom Fallback message'
      }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/new-shop-shell'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/my-new-shop/step/2');

    process.env = originalEnv;
  });

  it('POST /admin/wizard/new-shop-shell rejects adult-shop and reserved slugs', async () => {
    const app = createApp();
    process.env.DATABASE_URL = 'postgres://localhost/test';
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqBlocked = createReq({
      headers: { authorization: 'Bearer test-token' },
      body: { shop_id: 'adult-shop', display_name: 'Adult Shop' }
    });
    const resBlocked = createRes();

    await app.routes['POST /admin/wizard/new-shop-shell'](reqBlocked, resBlocked);
    expect(resBlocked.statusCode).toBe(403);
  });

  it('POST /admin/wizard/new-shop-shell rejects invalid slugs and handles duplicates safely', async () => {
    const app = createApp();
    process.env.DATABASE_URL = 'postgres://localhost/test';
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // Invalid slug format
    const reqInvalid = createReq({
      headers: { authorization: 'Bearer test-token' },
      body: { shop_id: 'Invalid_Slug_123', display_name: 'Some shop' }
    });
    const resInvalid = createRes();
    await app.routes['POST /admin/wizard/new-shop-shell'](reqInvalid, resInvalid);
    expect(resInvalid.statusCode).toBe(200); // Renders form with error
    expect(resInvalid.body.includes('Định dạng Shop Slug không hợp lệ')).toBeTrue();

    // Duplicate slug
    const reqDuplicate = createReq({
      headers: { authorization: 'Bearer test-token' },
      body: {
        shop_id: 'duplicate-slug',
        display_name: 'Duplicate Shop',
        menu_intro_text: 'Welcome',
        handoff_message: 'Handoff',
        fallback_text: 'Fallback'
      }
    });
    const resDuplicate = createRes();
    await app.routes['POST /admin/wizard/new-shop-shell'](reqDuplicate, resDuplicate);
    expect(resDuplicate.statusCode).toBe(200); // Renders form with error
    expect(resDuplicate.body.includes('Shop Slug này đã tồn tại')).toBeTrue();
  });
});

describe('Setup Wizard Step 2 Products and Menu configuration logic', () => {
  it('GET /admin/wizard/:shopId/step/2 requires auth', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqUnauth = createReq({ params: { shopId: 'my-shop' } });
    const resUnauth = createRes();
    await app.routes['/admin/wizard/:shopId/step/2'](reqUnauth, resUnauth);
    expect(resUnauth.statusCode).toBe(401);
  });

  it('GET /admin/wizard/:shopId/step/2 blocks adult-shop', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqBlocked = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'adult-shop' }
    });
    const resBlocked = createRes();
    await app.routes['/admin/wizard/:shopId/step/2'](reqBlocked, resBlocked);
    expect(resBlocked.statusCode).toBe(403);
  });

  it('GET /admin/wizard/:shopId/step/2 renders existing products and settings', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' }
    });
    const res = createRes();

    await app.routes['/admin/wizard/:shopId/step/2'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Bước 2')).toBeTrue();
    expect(res.body.includes('Product 1')).toBeTrue();
    expect(res.body.includes('Menu intro text')).toBeTrue();
    expect(res.body.includes('Chưa có ảnh Menu')).toBeTrue(); // Shows warning since we mocked empty assets

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/2/products adds product successfully', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: {
        code: 'SP02',
        name: 'New Product Name',
        price_text: '20.000đ',
        description: 'Product description here',
        is_active: '1'
      }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/2/products'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/my-shop/step/2?success=product');

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/2/products rejects duplicate product code', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: {
        code: 'duplicate-code',
        name: 'Duplicate Product Name',
        price_text: '20.000đ'
      }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/2/products'](req, res);

    expect(res.statusCode).toBe(200); // Re-renders the form with error
    expect(res.body.includes('Mã sản phẩm này đã tồn tại trong cửa hàng này')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/2/settings updates settings successfully', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: {
        menu_intro_text: 'New Welcome Intro Text',
        handoff_message: 'New Handoff Message Text',
        fallback_text: 'New Fallback Text'
      }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/2/settings'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/my-shop/step/2?success=settings');

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/2 progress validation handles rules', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // Case 1: passing criteria is met
    const reqPass = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' }
    });
    const resPass = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/2'](reqPass, resPass);
    expect(resPass.statusCode).toBe(303);
    expect(resPass.headers.location).toBe('/admin/wizard/my-shop/step/3');

    // Case 2: empty products blocks progression
    const reqFail = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'empty-products-shop' }
    });
    const resFail = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/2'](reqFail, resFail);
    expect(resFail.statusCode).toBe(200); // Re-renders the form with warning
    expect(resFail.body.includes('Không đủ điều kiện để tiếp tục')).toBeTrue();

    process.env = originalEnv;
  });
});

describe('Setup Wizard Step 3 Page Mapping', () => {
  it('GET /admin/wizard/:shopId/step/3 renders page mapping form for shop without pages', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      query: {}
    });
    const res = createRes();

    await app.routes['/admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Liên kết trang Facebook')).toBeTrue();
    expect(res.body.includes('Page ID')).toBeTrue();
    expect(res.body.includes('Kiểm tra Page ID (Preview)')).toBeTrue();
    // Must have disabled continue button when no active mapping
    expect(res.body.includes('disabled')).toBeTrue();
    expect(res.body.includes('CHƯA CÓ')).toBeTrue();

    process.env = originalEnv;
  });

  it('GET /admin/wizard/:shopId/step/3 shows existing active mapping table', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' },
      query: {}
    });
    const res = createRes();

    await app.routes['/admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Hoạt động')).toBeTrue();
    expect(res.body.includes('ĐÃ LIÊN KẾT')).toBeTrue();
    // Must not contain raw page_id in output
    expect(res.body.includes('111222333444555')).toBeFalse();
    // Must contain page_ref hash
    expect(res.body.includes('p:')).toBeTrue();
    // Continue button should be enabled
    expect(res.body.includes('Tiếp tục sang Bước 4')).toBeTrue();

    process.env = originalEnv;
  });

  it('GET /admin/wizard/:shopId/step/3?success=mapping shows success message', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' },
      query: { success: 'mapping' }
    });
    const res = createRes();

    await app.routes['/admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Liên kết trang Facebook đã được tạo thành công')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3/preview validates empty page_id', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_id: '', page_name: '' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3/preview'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Page ID không được bỏ trống')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3/preview shows valid result for good page_id', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_id: '123456789012345', page_name: 'Test Page' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3/preview'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('HỢP LỆ')).toBeTrue();
    expect(res.body.includes('KHÔNG CÓ')).toBeTrue();
    expect(res.body.includes('CREATE PAGE MAPPING')).toBeTrue();
    // Must not leak raw page_id in preview output
    expect(res.body.includes('p:')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3/preview detects invalid format', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_id: 'not-a-number', page_name: '' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3/preview'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('KHÔNG HỢP LỆ')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3/preview detects conflict', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_id: '999999999999999', page_name: '' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3/preview'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('ĐÃ TỒN TẠI')).toBeTrue();
    expect(res.body.includes('đã có liên kết hoạt động')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3 rejects missing confirmation', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_id: '123456789012345', page_name: 'Test', confirmation_text: 'wrong' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('CREATE PAGE MAPPING')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3 blocks when shop already has active mapping', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' },
      body: { page_id: '123456789012345', page_name: 'Test', confirmation_text: 'CREATE PAGE MAPPING' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('đã có liên kết trang Facebook hoạt động')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3 creates page mapping with proper confirmation', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_id: '123456789012345', page_name: 'New Page', confirmation_text: 'CREATE PAGE MAPPING' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location.includes('/step/3?success=mapping')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3/continue blocks without active mapping', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3/continue'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Không đủ điều kiện')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/3/continue advances to step 4 with active mapping', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();

    await app.routes['POST /admin/wizard/:shopId/step/3/continue'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/has-page-shop/step/4');

    process.env = originalEnv;
  });

  it('Step 3 never leaks raw page_id in HTML output', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // GET view with existing mapping
    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' },
      query: {}
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    // The raw page_id '111222333444555' must never appear in HTML
    expect(res.body.includes('111222333444555')).toBeFalse();
    // But page_ref hash should be present
    expect(res.body.includes('p:')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 3 registers all expected routes', () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      adminIpAllowlist: []
    });

    expect(app.routes['/admin/wizard/:shopId/step/3'] !== undefined).toBeTrue();
    expect(app.routes['POST /admin/wizard/:shopId/step/3'] !== undefined).toBeTrue();
    expect(app.routes['POST /admin/wizard/:shopId/step/3/preview'] !== undefined).toBeTrue();
    expect(app.routes['POST /admin/wizard/:shopId/step/3/continue'] !== undefined).toBeTrue();
  });

  it('Generic step handler now rejects step 3 (handled by dedicated routes)', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop', step: '3' }
    });
    const res = createRes();

    // The generic handler should reject step 3 since it now only handles 4-6
    await app.routes['/admin/wizard/:shopId/step/:step'](req, res);

    expect(res.statusCode).toBe(400);

    process.env = originalEnv;
  });
});

describe('Setup Wizard Step 4 Page Credentials', () => {
  it('GET /admin/wizard/:shopId/step/4 requires auth', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqUnauth = createReq({ params: { shopId: 'has-page-shop' } });
    const resUnauth = createRes();
    await app.routes['/admin/wizard/:shopId/step/4'](reqUnauth, resUnauth);
    expect(resUnauth.statusCode).toBe(401);
  });

  it('GET /admin/wizard/:shopId/step/4 blocks adult-shop', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const reqBlocked = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'adult-shop' }
    });
    const resBlocked = createRes();
    await app.routes['/admin/wizard/:shopId/step/4'](reqBlocked, resBlocked);
    expect(resBlocked.statusCode).toBe(403);
  });

  it('GET /admin/wizard/:shopId/step/4 blocks/warns when no active mapping exists', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // 'my-shop' has no active page mapping mocked
    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('chưa có liên kết trang Facebook hoạt động')).toBeTrue();
    // Continue button must be disabled
    expect(res.body.includes('disabled')).toBeTrue();
    expect(res.body.includes('Cần lưu Credential để Tiếp tục')).toBeTrue();

    process.env = originalEnv;
  });

  it('GET /admin/wizard/:shopId/step/4 never renders raw page_id, token, or encrypted value', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('111222333444555')).toBeFalse(); // raw page_id
    expect(res.body.includes('EAA12345678901234567890')).toBeFalse(); // secret token
    expect(res.body.includes('postgres://')).toBeFalse(); // DB URL
    expect(res.body.includes('credential_')).toBeFalse(); // internal credential prefix
    expect(res.body.includes('p:')).toBeTrue(); // page_ref

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/4 rejects missing or incorrect confirmation', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' },
      body: { page_token: 'EAA12345678901234567890', confirmation_text: 'wrong' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(200); // Re-renders
    expect(res.body.includes('CREATE PAGE CREDENTIAL')).toBeTrue();
    // Must never preserve or echo token in HTML
    expect(res.body.includes('EAA12345678901234567890')).toBeFalse();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/4 rejects when shop has no active mapping', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' },
      body: { page_token: 'EAA12345678901234567890', confirmation_text: 'CREATE PAGE CREDENTIAL' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Không tìm thấy liên kết trang Facebook hoạt động')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/4 stores active encrypted fb_page_token and redirects', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' },
      body: { page_token: 'EAA12345678901234567890', confirmation_text: 'CREATE PAGE CREDENTIAL' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/has-page-shop/step/4?success=credential');

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/4 rejects duplicate active credential safely', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // 'has-credentials-shop' is mocked to already have 1 credential
    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-credentials-shop' },
      body: { page_token: 'EAA999999999999999999999', confirmation_text: 'CREATE PAGE CREDENTIAL' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Không thể tạo trùng lặp')).toBeTrue();
    // Must never preserve or echo token in HTML
    expect(res.body.includes('EAA999999999999999999999')).toBeFalse();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/4/continue blocks progression when no credential exists', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' } // mocked to have active mapping but count=0
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/4/continue'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Không đủ điều kiện để tiếp tục')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/4/continue redirects to Step 5 with active credential', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-credentials-shop' } // mocked to have active mapping + active credentials count=1
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/4/continue'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/has-credentials-shop/step/5');

    process.env = originalEnv;
  });

  it('Generic step handler rejects step 4', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop', step: '4' }
    });
    const res = createRes();

    await app.routes['/admin/wizard/:shopId/step/:step'](req, res);

    expect(res.statusCode).toBe(400);

    process.env = originalEnv;
  });
});

describe('Setup Wizard Step 5 Readiness Gate', () => {
  it('GET /admin/wizard/:shopId/step/5 requires auth', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({ params: { shopId: 'has-page-shop' } });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/5'](req, res);
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/wizard/:shopId/step/5 blocks adult-shop', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'adult-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/5'](req, res);
    expect(res.statusCode).toBe(403);
  });

  it('GET /admin/wizard/:shopId/step/5 renders readiness checks and blockers safely', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // 'has-page-shop' is mocked to have active mapping=1, products=1, menu_images=0 (failed check)
    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/5'](req, res);

    expect(res.statusCode).toBe(200);
    // Hard blockers must be detected
    expect(res.body.includes('CHƯA ĐỦ ĐIỀU KIỆN')).toBeTrue();
    expect(res.body.includes('CHƯA ĐẠT')).toBeTrue();
    // Links to steps must exist
    expect(res.body.includes('/admin/wizard/has-page-shop/step/2')).toBeTrue();
    // Continue button must be disabled
    expect(res.body.includes('disabled')).toBeTrue();
    expect(res.body.includes('Cần đạt điều kiện bắt buộc để Tiếp tục')).toBeTrue();

    // No leaks
    expect(res.body.includes('111222333444555')).toBeFalse(); // raw page_id
    expect(res.body.includes('test-master-key')).toBeFalse(); // master key
    expect(res.body.includes('postgres://')).toBeFalse(); // DB URL

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/5/recheck runs readiness checks and redirects back', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/5/recheck'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/has-page-shop/step/5?success=rechecked');

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/5/continue blocks continuation when hard blockers exist', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // 'has-page-shop' has hard blockers (menu_images=0, credential=0)
    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/5/continue'](req, res);

    expect(res.statusCode).toBe(200); // Re-renders
    expect(res.body.includes('Không đủ điều kiện để tiếp tục')).toBeTrue();

    process.env = originalEnv;
  });

  it('POST /admin/wizard/:shopId/step/5/continue advances to Step 6 when hard blockers are empty', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    // 'has-credentials-shop' has mapping=1, products=1, menu_images=1, credentials=1 (passed)
    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-credentials-shop' }
    });
    const res = createRes();
    await app.routes['POST /admin/wizard/:shopId/step/5/continue'](req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/wizard/has-credentials-shop/step/6');

    process.env = originalEnv;
  });

  it('Generic step handler rejects step 5', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop', step: '5' }
    });
    const res = createRes();

    await app.routes['/admin/wizard/:shopId/step/:step'](req, res);

    expect(res.statusCode).toBe(400);

    process.env = originalEnv;
  });

  describe('Setup Wizard Step 6 Dry-Run Simulation', () => {
    it('GET /admin/wizard/:shopId/step/6 requires auth', async () => {
      const app = createApp();
      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({ params: { shopId: 'has-credentials-shop' } });
      const res = createRes();
      await app.routes['/admin/wizard/:shopId/step/6'](req, res);

      expect(res.statusCode).toBe(401);
    });

    it('GET /admin/wizard/:shopId/step/6 blocks adult-shop', async () => {
      const app = createApp();
      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'adult-shop' }
      });
      const res = createRes();
      await app.routes['/admin/wizard/:shopId/step/6'](req, res);

      expect(res.statusCode).toBe(403);
    });

    it('GET /admin/wizard/:shopId/step/6 renders dry-run status and simulation UI safely', async () => {
      const app = createApp();
      const originalEnv = { ...process.env };
      process.env.DATABASE_URL = 'postgres://localhost/test';
      process.env.MESSENGER_DRY_RUN = 'true';

      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'has-credentials-shop' }
      });
      const res = createRes();
      await app.routes['/admin/wizard/:shopId/step/6'](req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.includes('Test thử an toàn')).toBeTrue();
      expect(res.body.includes('Chỉ là giả lập an toàn')).toBeTrue();
      expect(res.body.includes('MESSENGER_DRY_RUN')).toBeFalse();
      expect(res.body.includes('DATABASE_URL')).toBeFalse();

      process.env = originalEnv;
    });

    it('POST /admin/wizard/:shopId/step/6/simulate blocks if global dry-run is false', async () => {
      const app = createApp();
      const originalEnv = { ...process.env };
      process.env.DATABASE_URL = 'postgres://localhost/test';
      process.env.MESSENGER_DRY_RUN = 'false';

      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'has-credentials-shop' },
        body: { productCode: 'code1' }
      });
      const res = createRes();
      await app.routes['POST /admin/wizard/:shopId/step/6/simulate'](req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.includes('Giả lập chạy thử chỉ được thực hiện khi cả chế độ test an toàn toàn cục và chế độ test an toàn của shop đều được bật.')).toBeTrue();

      process.env = originalEnv;
    });

    it('POST /admin/wizard/:shopId/step/6/simulate passes when menu text and active product code resolve', async () => {
      const app = createApp();
      const originalEnv = { ...process.env };
      process.env.DATABASE_URL = 'postgres://localhost/test';
      process.env.MESSENGER_DRY_RUN = 'true';

      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'has-credentials-shop' },
        body: { productCode: 'code1' }
      });
      const res = createRes();
      await app.routes['POST /admin/wizard/:shopId/step/6/simulate'](req, res);

      expect(res.statusCode).toBe(303);
      expect(res.headers.location.includes('success=simulated')).toBeTrue();
      expect(res.headers.location.includes('menu_pass=1')).toBeTrue();
      expect(res.headers.location.includes('product_pass=1')).toBeTrue();

      process.env = originalEnv;
    });

    it('POST /admin/wizard/:shopId/step/6/complete blocks without passed manual test', async () => {
      const app = createApp();
      const originalEnv = { ...process.env };
      process.env.DATABASE_URL = 'postgres://localhost/test';

      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'has-page-shop' }
      });
      const res = createRes();

      const originalQuery = MockPgClient.prototype.query;
      MockPgClient.prototype.query = async function(sql, params) {
        const cleanSql = String(sql || '').replace(/\s+/g, ' ').trim().toUpperCase();
        if (cleanSql.includes('FROM SHOPS WHERE ID = $1 OR SLUG = $1') && cleanSql.includes('ORDER BY')) {
          return { rows: [{ id: params[0], slug: params[0], status: 'active', lifecycle: 'draft', last_manual_test_status: 'unknown', dry_run: true }] };
        }
        return originalQuery.call(this, sql, params);
      };

      try {
        await app.routes['POST /admin/wizard/:shopId/step/6/complete'](req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.includes('Cần hoàn thành chạy thử giả lập trước khi hoàn tất.')).toBeTrue();
      } finally {
        MockPgClient.prototype.query = originalQuery;
        process.env = originalEnv;
      }
    });

    it('POST /admin/wizard/:shopId/step/6/complete succeeds after passed manual test', async () => {
      const app = createApp();
      const originalEnv = { ...process.env };
      process.env.DATABASE_URL = 'postgres://localhost/test';

      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'has-credentials-shop' }
      });
      const res = createRes();
      await app.routes['POST /admin/wizard/:shopId/step/6/complete'](req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.includes('Setup Wizard Hoàn Tất!')).toBeTrue();
      expect(res.body.includes('chế độ test an toàn (Live: TẮT)')).toBeTrue();

      process.env = originalEnv;
    });

    it('Generic step handler rejects step 6', async () => {
      const app = createApp();
      const originalEnv = { ...process.env };
      process.env.DATABASE_URL = 'postgres://localhost/test';

      registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

      const req = createReq({
        headers: { authorization: 'Bearer test-token' },
        params: { shopId: 'has-credentials-shop', step: '6' }
      });
      const res = createRes();
      await app.routes['/admin/wizard/:shopId/step/:step'](req, res);

      expect(res.statusCode).toBe(400);

      process.env = originalEnv;
    });
  });
});

describe('Setup Wizard Guidance States', () => {
  it('Step 0 shows actionable guidance when hard checks fail', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.MESSENGER_DRY_RUN = 'false';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.NODE_ENV = 'development';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({ headers: { authorization: 'Bearer test-token' } });
    const res = createRes();
    await app.routes['/admin/wizard/new'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Bạn cần làm gì nếu lỗi?')).toBeTrue();
    expect(res.body.includes('guidance-card')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 1 shows shop-nháp explanation and safe defaults guidance', async () => {
    const app = createApp();
    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({ headers: { authorization: 'Bearer test-token' } });
    const res = createRes();
    await app.routes['/admin/wizard/new-shop-shell'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Shop nháp')).toBeTrue();
    expect(res.body.includes('Chưa hoạt động thật')).toBeTrue();
    expect(res.body.includes('Đang ở chế độ test an toàn')).toBeTrue();
    expect(res.body.includes('nem-bui-xa')).toBeTrue();
    expect(res.body.includes('banh-mi-ha-noi')).toBeTrue();
  });

  it('Step 2 shows empty-state when no products and requirement list', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'empty-products-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/2'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('empty-state')).toBeTrue();
    expect(res.body.includes('Chưa có sản phẩm nào')).toBeTrue();
    expect(res.body.includes('requirement-list')).toBeTrue();
    expect(res.body.includes('Ít nhất 1 sản phẩm hoạt động')).toBeTrue();
    expect(res.body.includes('Cần làm tiếp')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 3 shows empty-state for no mapping and token clarification', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'my-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/3'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('empty-state')).toBeTrue();
    expect(res.body.includes('Chưa có kết nối Fanpage')).toBeTrue();
    expect(res.body.includes('Token')).toBeTrue();
    expect(res.body.includes('Bước 4')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 4 shows encryption guidance and archive note for wrong token', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/4'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('AES-256-GCM')).toBeTrue();
    expect(res.body.includes('không hiển thị lại')).toBeTrue();
    expect(res.body.includes('archive')).toBeTrue();
    expect(res.body.includes('guidance-card')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 5 clearly distinguishes blockers from warnings', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, {
      adminExportToken: 'test-token',
      Client: MockPgClient
    });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-page-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/5'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('chặn tiếp tục')).toBeTrue();
    expect(res.body.includes('không chặn tiếp tục')).toBeTrue();
    expect(res.body.includes('bắt buộc hoàn thành trước khi tiếp tục')).toBeTrue();
    expect(res.body.includes('khuyến nghị nhưng không chặn')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 6 shows safe simulation guidance and completion wording', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.MESSENGER_DRY_RUN = 'true';

    registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-credentials-shop' }
    });
    const res = createRes();
    await app.routes['/admin/wizard/:shopId/step/6'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Bước này kiểm tra gì?')).toBeTrue();
    expect(res.body.includes('guidance-card')).toBeTrue();
    expect(res.body.includes('giả lập an toàn')).toBeTrue();
    expect(res.body.includes('sandbox')).toBeTrue();

    process.env = originalEnv;
  });

  it('Step 6 completion page emphasizes test mode and Go-Live requires approval', async () => {
    const app = createApp();
    const originalEnv = { ...process.env };
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.MESSENGER_DRY_RUN = 'true';
    process.env.CREDENTIAL_MASTER_KEY = 'test-master-key-xyz-12345';

    registerWizardRoutes(app, { adminExportToken: 'test-token', Client: MockPgClient });

    // Patch for passed manual test
    const origClient = MockPgClient;
    const PatchedClient = class extends origClient {
      async query(sql, params) {
        const cleanSql = String(sql || '').replace(/\s+/g, ' ').trim().toUpperCase();
        if (cleanSql.includes('FROM SHOPS WHERE ID = $1 OR SLUG = $1') && cleanSql.includes('ORDER BY')) {
          return { rows: [{ id: params[0], slug: params[0], name: 'My Shop', status: 'active', package: 'basic', lifecycle: 'draft', last_manual_test_status: 'passed', dry_run: true }] };
        }
        return super.query(sql, params);
      }
    };

    const app2 = createApp();
    registerWizardRoutes(app2, { adminExportToken: 'test-token', Client: PatchedClient });

    const req = createReq({
      headers: { authorization: 'Bearer test-token' },
      params: { shopId: 'has-credentials-shop' }
    });
    const res = createRes();
    await app2.routes['POST /admin/wizard/:shopId/step/6/complete'](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes('Setup Wizard hoàn tất')).toBeTrue();
    expect(res.body.includes('chế độ test an toàn')).toBeTrue();
    expect(res.body.includes('Shop chưa hoạt động thật')).toBeTrue();
    expect(res.body.includes('Go-Live')).toBeTrue();
    expect(res.body.includes('Bạn cần làm gì tiếp theo')).toBeTrue();

    process.env = originalEnv;
  });
});

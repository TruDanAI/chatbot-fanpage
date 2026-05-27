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
    if (cleanSql.includes("SLUG = 'ADULT-SHOP'") || (params && params.includes('adult-shop'))) {
      return { rows: [{ id: 'adult-shop', slug: 'adult-shop', name: 'Adult Shop', status: 'active', lifecycle: 'live' }] };
    }
    if (cleanSql.includes('SELECT COUNT(*) FROM SHOPS')) {
      return { rows: [{ count: '5' }] };
    }
    if (cleanSql.includes('FROM SHOPS WHERE ID = $1 OR SLUG = $1')) {
      if (cleanSql.includes('ORDER BY')) {
        return { rows: [{ id: params[0], slug: params[0], name: 'My Staging Shop', status: 'active', package: 'basic', lifecycle: 'draft' }] };
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
    expect(res.body.includes('Chế độ Global Dry-Run')).toBeTrue();
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
    expect(res.body.includes('THẤT BẠI (DRY-RUN OFF)')).toBeTrue();

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
    expect(resAuth.body.includes('Bước 1: Tạo Shell Cửa Hàng')).toBeTrue();
    expect(resAuth.body.includes('Dry-Run: BẮT BUỘC BẬT')).toBeTrue();
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
    expect(res.body.includes('Bước 2: Cấu hình Sản phẩm & Menu')).toBeTrue();
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

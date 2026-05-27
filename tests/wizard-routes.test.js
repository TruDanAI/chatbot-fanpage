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
  async query(sql) {
    if (sql.includes("slug = 'adult-shop'")) {
      return { rows: [{ id: 'adult-shop', slug: 'adult-shop', name: 'Adult Shop', status: 'active', lifecycle: 'live' }] };
    }
    if (sql.includes('SELECT count(*) FROM shops')) {
      return { rows: [{ count: '5' }] };
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
  return {
    routes,
    get(path, handler) {
      routes[path] = handler;
    },
    post(path, handler) {
      routes[`POST ${path}`] = handler;
    },
    patch(path, handler) {
      routes[`PATCH ${path}`] = handler;
    },
    delete(path, handler) {
      routes[`DELETE ${path}`] = handler;
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

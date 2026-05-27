const { describe, it, expect } = require('./harness');
const { registerWizardRoutes, isValidShopSlug, BLOCKLIST, wizardShopGuard } = require('../core/admin/wizard-routes');
const { PERMISSIONS } = require('../core/admin-auth');

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

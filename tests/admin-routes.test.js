const { describe, it, expect } = require('./harness');
const {
  assertReadOnlySql,
  createAdminLoginRateLimiter,
  createAdminRouteAuthorizer,
  createPostgresAuditLogger,
  createPostgresDashboardReader,
  parseAdminRoles,
  registerAdminRoutes,
  setAdminNoStoreHeaders
} = require('../core/admin-routes');
const { createDashboardRepository } = require('../core/admin/dashboard-repository');
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
    },
    download(file, name) {
      this.body = `${name}:${file}`;
      return this;
    },
    json(body) {
      this.body = JSON.stringify(body);
      return this;
    }
  };
}

function createStorageStub() {
  return {
    getCustomersFile: () => 'customers.csv',
    getEventsFile: () => 'events.jsonl',
    getOrderDraft: () => ({}),
    inHandoff: () => false,
    getLastUserAt: () => '',
    getLastProductCode: () => '',
    getSessionState: () => '',
    getHistory: () => []
  };
}

function createDashboardReaderStub() {
  let calls = 0;
  let lastOverviewFilters = null;
  return {
    get calls() {
      return calls;
    },
    get lastOverviewFilters() {
      return lastOverviewFilters;
    },
    async getOverview(filters = {}) {
      calls += 1;
      lastOverviewFilters = filters;
      return {
        tenantId: 'default',
        pageId: 'page',
        counts: {
          profiles: 1,
          conversations: 1,
          messages: 1,
          orders: 1,
          order_items: 1,
          events: 1,
          processed_mids: 1
        },
        operations: {
          windowHours: 24,
          productWindowDays: 30,
          activity: {
            orders_24h: 2,
            confirmed_24h: 1,
            ready_orders: 1,
            abandoned_24h: 0,
            active_handoffs: 1,
            events_24h: 3,
            last_user_message_at: '2026-05-10T00:00:02.000Z',
            last_event_at: '2026-05-10T00:00:03.000Z'
          },
          orderStatusBreakdown: [
            { status: 'confirmed', total: 1 },
            { status: 'ready_to_confirm', total: 1 }
          ],
          topProducts: [
            { product_code: 'MÃ8', total_orders: 2, confirmed_orders: 1 }
          ],
          needsAttention: {
            orders: [{
              reason: 'ready_to_confirm',
              id: '2',
              sender_id: 'sender_1',
              status: 'ready_to_confirm',
              product_code: 'MÃ8',
              customer_name: 'Nguyen An',
              phone: '0987654321',
              address: '12 Tran Phu, Quan 1',
              updated_at: '2026-05-10T00:00:01.000Z',
              item_count: 1
            }],
            handoffs: [{
              sender_id: 'sender_2',
              session_state: 'HUMAN_HANDOFF',
              last_product_code: 'MÃ10',
              last_user_at: '2026-05-10T00:00:02.000Z',
              handoff_until: '2026-05-10T00:30:02.000Z',
              updated_at: '2026-05-10T00:00:03.000Z'
            }]
          }
        },
        conversations: [{
          sender_id: 'sender_1',
          session_state: 'READY_TO_CONFIRM',
          last_product_code: 'MÃ8',
          last_user_at: '2026-05-10T00:00:00.000Z',
          updated_at: '2026-05-10T00:00:01.000Z'
        }],
        orders: [{
          id: '1',
          sender_id: 'sender_1',
          status: 'ready_to_confirm',
          product_code: 'MÃ8',
          customer_name: 'Nguyen An',
          phone: '0987654321',
          address: '12 Tran Phu, Quan 1',
          updated_at: '2026-05-10T00:00:01.000Z',
          item_count: 1
        }],
        events: [{
          id: '1',
          sender_id: 'sender_1',
          type: 'lead',
          source: 'runtime',
          session_state: 'READY_TO_CONFIRM',
          product_code: 'MÃ8',
          event_at: '2026-05-10T00:00:01.000Z',
          text: 'sdt 0987654321 dia chi 12 Tran Phu'
        }],
        filters: {
          senderId: filters.senderId || '',
          status: filters.status || '',
          productCode: filters.productCode || '',
          eventType: filters.eventType || '',
          limit: Number(filters.limit || 25),
          activeCount: 0
        },
        limits: { overviewRows: 25 }
      };
    },
    async getUserDetail(senderId) {
      calls += 1;
      return {
        tenantId: 'default',
        pageId: 'page',
        senderId,
        profile: { name: 'Nguyen An', created_at: '', updated_at: '' },
        conversation: {
          session_state: 'READY_TO_CONFIRM',
          last_product_code: 'MÃ8',
          last_user_at: '2026-05-10T00:00:00.000Z'
        },
        orders: [],
        orders: [{
          id: '2',
          sender_id: senderId,
          status: 'ready_to_confirm',
          product_code: 'MÃ8',
          customer_name: 'Nguyen An',
          phone: '0987654321',
          address: '12 Tran Phu, Quan 1',
          updated_at: '2026-05-10T00:00:01.000Z'
        }],
        orderItems: [{
          order_id: '2',
          item_index: 0,
          code: 'MÃ8',
          name: 'Product 8',
          qty: 1,
          variant: '',
          display: '1 x Product 8',
          created_at: '2026-05-10T00:00:01.000Z'
        }],
        messages: [{
          id: '10',
          role: 'user',
          text: 'sdt 0987654321 dia chi 12 Tran Phu',
          source: 'messenger',
          created_at: '2026-05-10T00:00:02.000Z'
        }],
        events: [{
          id: '11',
          type: 'lead',
          source: 'runtime',
          session_state: 'READY_TO_CONFIRM',
          product_code: 'MÃ8',
          text: 'sdt 0987654321 dia chi 12 Tran Phu',
          event_at: '2026-05-10T00:00:03.000Z'
        }],
        limits: { detailOrders: 10, detailMessages: 30, detailEvents: 30 }
      };
    },
    async getAuditLog(filters = {}) {
      calls += 1;
      return {
        tenantId: 'default',
        pageId: 'page',
        rows: [{
          occurred_at: '2026-05-10T00:00:02.000Z',
          actor_id: 'admin-1',
          actor_roles: ['maintainer'],
          action: PERMISSIONS.DASHBOARD_READ,
          resource_type: 'dashboard',
          resource_id: '',
          outcome: 'success',
          request_id: 'req-1',
          user_agent: 'test-agent'
        }],
        filters: {
          actorId: filters.actorId || '',
          action: filters.action || '',
          outcome: filters.outcome || '',
          limit: Number(filters.limit || 50),
          activeCount: 0
        },
        limits: { auditRows: Number(filters.limit || 50) }
      };
    }
  };
}

function createAuditLoggerStub() {
  const entries = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry);
      return { recorded: true };
    }
  };
}

const TEST_SESSION_SECRET = 'test-session-secret-64-characters-minimum-value-for-admin-login';

describe('admin dashboard routes', () => {
  it('parseAdminRoles chuẩn hóa role list từ env', () => {
    expect(parseAdminRoles(' Viewer, maintainer ,unknown-role ')).toEqual(['viewer', 'maintainer', 'unknown-role']);
    expect(parseAdminRoles('')).toEqual(['owner']);
  });

  it('admin no-store middleware set privacy headers', () => {
    const res = createRes();
    let nextCalled = false;

    setAdminNoStoreHeaders(createReq(), res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBeTrue();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.headers.expires).toBe('0');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('admin route authorizer chặn IP trước auth token và ghi audit denied', async () => {
    const auditLogger = createAuditLoggerStub();
    const authorizer = createAdminRouteAuthorizer({
      adminExportToken: 'secret',
      adminIpAllowlist: ['127.0.0.1'],
      getClientIp: () => '203.0.113.5',
      auditLogger,
      tenantId: 'default',
      pageId: 'page'
    });

    const res = createRes();
    const principal = await authorizer.authorizeAdminRequest(createReq({
      headers: {
        authorization: 'Bearer secret',
        'user-agent': 'unit-test'
      }
    }), res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: PERMISSIONS.DASHBOARD_READ,
      resourceType: 'dashboard'
    });

    expect(principal).toBe(null);
    expect(res.statusCode).toBe(403);
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].outcome).toBe('denied');
    expect(auditLogger.entries[0].metadata.reason).toBe('ip_not_allowed');
    expect(JSON.stringify(auditLogger.entries[0]).includes('secret')).toBeFalse();
  });

  it('dashboard chỉ nhận Authorization Bearer, không nhận x-admin-token hay query token', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader
    });

    const res = createRes();
    await app.routes['/admin/dashboard'](createReq({
      headers: { 'x-admin-token': 'secret' },
      query: { token: 'secret' }
    }), res);

    expect(res.statusCode).toBe(401);
    expect(reader.calls).toBe(0);
  });

  it('admin login tạo HttpOnly session cookie và ghi audit success', async () => {
    const app = createApp();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      auditLogger,
      adminSessionSecret: TEST_SESSION_SECRET,
      adminPublicBaseUrl: 'https://admin.example.test',
      adminPrincipalId: 'owner-1',
      adminPrincipalRoles: ['owner']
    });

    const res = createRes();
    await app.routes['POST /admin/login'](createReq({
      headers: { 'user-agent': 'unit-test' },
      body: { adminToken: 'secret' }
    }), res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/dashboard');
    expect(res.headers['set-cookie']).toContain('chatbot_admin_session=');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(res.headers['set-cookie']).toContain('Secure');
    expect(res.headers['set-cookie']).toContain('SameSite=Lax');
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].action).toBe('admin.login');
    expect(auditLogger.entries[0].outcome).toBe('success');
    expect(JSON.stringify(auditLogger.entries[0]).includes('secret')).toBeFalse();
  });

  it('admin login từ chối token sai và không set cookie', async () => {
    const app = createApp();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      auditLogger,
      adminSessionSecret: TEST_SESSION_SECRET
    });

    const res = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'wrong-secret' }
    }), res);

    expect(res.statusCode).toBe(401);
    expect(Boolean(res.headers['set-cookie'])).toBeFalse();
    expect(res.body).toContain('Admin Login');
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].action).toBe('admin.login');
    expect(auditLogger.entries[0].outcome).toBe('denied');
    expect(JSON.stringify(auditLogger.entries[0]).includes('wrong-secret')).toBeFalse();
  });

  it('admin login rate limit chặn nhiều lần sai token theo IP', async () => {
    const app = createApp();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '203.0.113.10',
      dashboardReader: createDashboardReaderStub(),
      auditLogger,
      adminSessionSecret: TEST_SESSION_SECRET,
      adminLoginRateLimitWindowMs: 60 * 1000,
      adminLoginRateLimitMax: 2
    });

    const firstRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'wrong-secret-1' }
    }), firstRes);
    const secondRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'wrong-secret-2' }
    }), secondRes);
    const limitedRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'wrong-secret-3' }
    }), limitedRes);

    expect(firstRes.statusCode).toBe(401);
    expect(secondRes.statusCode).toBe(401);
    expect(limitedRes.statusCode).toBe(429);
    expect(limitedRes.headers['retry-after']).toBeTruthy();
    expect(Boolean(limitedRes.headers['set-cookie'])).toBeFalse();
    expect(limitedRes.body).toContain('Admin Login');
    expect(auditLogger.entries.length).toBe(3);
    expect(auditLogger.entries[0].metadata.reason).toBe('invalid_bearer_token');
    expect(auditLogger.entries[1].metadata.reason).toBe('invalid_bearer_token');
    expect(auditLogger.entries[2].metadata.reason).toBe('login_rate_limited');
    expect(JSON.stringify(auditLogger.entries).includes('wrong-secret')).toBeFalse();
  });

  it('admin login rate limiter mở lại sau khi hết window', () => {
    let currentTime = 1000;
    const limiter = createAdminLoginRateLimiter({
      windowMs: 1000,
      max: 2,
      getClientIp: () => '203.0.113.11',
      now: () => currentTime
    });
    const req = createReq();

    expect(limiter.check(req).allowed).toBeTrue();
    expect(limiter.check(req).allowed).toBeTrue();
    expect(limiter.check(req).allowed).toBeFalse();

    currentTime += 1000;
    expect(limiter.check(req).allowed).toBeTrue();
  });

  it('dashboard nhận session cookie sau login nhưng vẫn không nhận query token', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader,
      adminSessionSecret: TEST_SESSION_SECRET,
      adminPrincipalRoles: ['viewer']
    });

    const loginRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'secret' }
    }), loginRes);
    const cookie = loginRes.headers['set-cookie'].split(';')[0];

    const queryOnlyRes = createRes();
    await app.routes['/admin/dashboard'](createReq({
      query: { token: 'secret' }
    }), queryOnlyRes);
    expect(queryOnlyRes.statusCode).toBe(401);

    const sessionRes = createRes();
    await app.routes['/admin/dashboard'](createReq({
      headers: { cookie }
    }), sessionRes);

    expect(sessionRes.statusCode).toBe(200);
    expect(sessionRes.body).toContain('Admin Dashboard');
  });

  it('admin logout xóa session cookie', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminSessionSecret: TEST_SESSION_SECRET
    });

    const loginRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'secret' }
    }), loginRes);

    const logoutRes = createRes();
    await app.routes['POST /admin/logout'](createReq({
      headers: { cookie: loginRes.headers['set-cookie'].split(';')[0] }
    }), logoutRes);

    expect(logoutRes.statusCode).toBe(303);
    expect(logoutRes.headers.location).toBe('/admin/login');
    expect(logoutRes.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('dashboard trả HTML với list đã mask SĐT và địa chỉ', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader
    });

    const res = createRes();
    await app.routes['/admin/dashboard'](createReq({
      headers: { authorization: 'Bearer secret' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('html');
    expect(res.body).toContain('Admin Dashboard');
    expect(res.body).toContain('Ops Snapshot');
    expect(res.body).toContain('Needs Attention');
    expect(res.body).toContain('Top Products');
    expect(res.body.includes('0987654321')).toBeFalse();
    expect(res.body.includes('12 Tran Phu')).toBeFalse();
    expect(res.body).toContain('[masked-address]');
  });

  it('dashboard API trả JSON đã mask dữ liệu nhạy cảm', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader,
      auditLogger,
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/api/dashboard'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: { senderId: 'sender_1', limit: '5' }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(body.counts.orders).toBe(1);
    expect(body.operations.activity.ready_orders).toBe(1);
    expect(body.operations.topProducts[0].product_code).toBe('MÃ8');
    expect(body.operations.needsAttention.orders[0].phone).toBe('********21');
    expect(body.operations.needsAttention.orders[0].address).toBe('[masked-address]');
    expect(body.orders[0].phone).toBe('********21');
    expect(body.orders[0].address).toBe('[masked-address]');
    expect(body.events[0].text).toContain('[masked-phone]');
    expect(bodyText.includes('0987654321')).toBeFalse();
    expect(bodyText.includes('12 Tran Phu')).toBeFalse();
    expect(auditLogger.entries[0].resource_type).toBe('dashboard_api');
  });

  it('dashboard API vẫn không nhận x-admin-token hoặc query token', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader
    });

    const res = createRes();
    await app.routes['/admin/api/dashboard'](createReq({
      headers: { 'x-admin-token': 'secret' },
      query: { token: 'secret' }
    }), res);

    expect(res.statusCode).toBe(401);
    expect(reader.calls).toBe(0);
  });

  it('dashboard truyền filter query vào reader và render form filter', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader
    });

    const res = createRes();
    await app.routes['/admin/dashboard'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: {
        senderId: 'sender_1',
        status: 'confirmed',
        productCode: 'MÃ8',
        eventType: 'lead',
        limit: '5'
      }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(reader.lastOverviewFilters).toEqual({
      senderId: 'sender_1',
      status: 'confirmed',
      productCode: 'MÃ8',
      eventType: 'lead',
      limit: '5'
    });
    expect(res.body).toContain('name="senderId"');
    expect(res.body).toContain('name="productCode"');
    expect(res.body).toContain('Order Status');
  });

  it('dashboard detail giới hạn theo senderId và vẫn cần Bearer token', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Admin User Detail');
    expect(res.body).toContain('sender_1');
  });

  it('dashboard detail API trả timeline đã mask dữ liệu nhạy cảm', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader,
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/api/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(body.senderId).toBe('sender_1');
    expect(body.orders[0].phone).toBe('********21');
    expect(body.orders[0].address).toBe('[masked-address]');
    expect(body.messages[0].text).toContain('[masked-phone]');
    expect(body.events[0].text).toContain('[masked-address]');
    expect(bodyText.includes('0987654321')).toBeFalse();
    expect(bodyText.includes('12 Tran Phu')).toBeFalse();
  });

  it('dashboard dùng RBAC và ghi audit success khi audit logger được bật', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader,
      auditLogger,
      adminPrincipalId: 'viewer-1',
      adminPrincipalRoles: ['viewer'],
      tenantId: 'default',
      pageId: 'page'
    });

    const res = createRes();
    await app.routes['/admin/dashboard'](createReq({
      headers: {
        authorization: 'Bearer secret',
        'x-request-id': 'req-1',
        'user-agent': 'unit-test'
      },
      query: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].actor_id).toBe('viewer-1');
    expect(auditLogger.entries[0].action).toBe(PERMISSIONS.DASHBOARD_READ);
    expect(auditLogger.entries[0].outcome).toBe('success');
    expect(JSON.stringify(auditLogger.entries[0]).includes('secret')).toBeFalse();
  });

  it('RBAC chặn export với viewer nhưng vẫn giữ legacy x-admin-token compatibility', async () => {
    const app = createApp();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      auditLogger,
      adminPrincipalId: 'viewer-1',
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/customers.csv'](createReq({
      headers: { 'x-admin-token': 'secret' }
    }), res);

    expect(res.statusCode).toBe(403);
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].action).toBe(PERMISSIONS.EXPORT_READ);
    expect(auditLogger.entries[0].outcome).toBe('denied');
    expect(auditLogger.entries[0].actor_id).toBe('viewer-1');
  });

  it('legacy export route ghi audit 404 khi file chưa có', async () => {
    const app = createApp();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      auditLogger,
      adminPrincipalId: 'maintainer-1',
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/customers.csv'](createReq({
      headers: { 'x-admin-token': 'secret' }
    }), res);

    expect(res.statusCode).toBe(404);
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].actor_id).toBe('maintainer-1');
    expect(auditLogger.entries[0].resource_id).toBe('customers.csv');
    expect(auditLogger.entries[0].outcome).toBe('error');
    expect(auditLogger.entries[0].metadata.statusCode).toBe(404);
  });

  it('legacy state route cho support đọc state và ghi audit success', async () => {
    const app = createApp();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      auditLogger,
      adminPrincipalId: 'support-1',
      adminPrincipalRoles: ['support']
    });

    const res = createRes();
    await app.routes['/admin/state/:userId'](createReq({
      headers: { 'x-admin-token': 'secret' },
      params: { userId: 'sender_1' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.userId).toBe('sender_1');
    expect(body.historyLength).toBe(0);
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].action).toBe(PERMISSIONS.LEGACY_STATE_READ);
    expect(auditLogger.entries[0].outcome).toBe('success');
  });

  it('audit log route cần quyền audit read và render bảng read-only', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/audit'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: { action: 'dashboard', outcome: 'success', limit: '10' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Admin Audit Log');
    expect(res.body).toContain(PERMISSIONS.DASHBOARD_READ);
    expect(res.body.includes('metadata')).toBeFalse();
  });

  it('audit log API cần quyền audit read và không trả metadata', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/api/audit'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: { action: 'dashboard', outcome: 'success', limit: '10' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.rows[0].action).toBe(PERMISSIONS.DASHBOARD_READ);
    expect(JSON.stringify(body).includes('metadata')).toBeFalse();
  });

  it('audit log route từ chối viewer', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/audit'](createReq({
      headers: { authorization: 'Bearer secret' }
    }), res);

    expect(res.statusCode).toBe(403);
  });
});

describe('admin dashboard PostgreSQL reader', () => {
  it('từ chối SQL không phải SELECT', () => {
    let refused = false;
    try {
      assertReadOnlySql('UPDATE orders SET status = $1');
    } catch (_) {
      refused = true;
    }
    expect(refused).toBeTrue();
  });

  it('dashboard repository giữ audit query parameterized và read-only', async () => {
    const queries = [];
    const repository = createDashboardRepository({
      tenantId: 'default',
      pageId: 'page',
      limits: { auditRows: 50 }
    });
    const client = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        return { rows: [] };
      }
    };

    const model = await repository.getAuditLog(client, {
      actorId: 'admin_1',
      action: 'dashboard%',
      outcome: 'success',
      limit: 7
    });

    expect(model.schemaReady).toBeTrue();
    expect(queries.length).toBe(2);
    expect(queries[0].sql.trim()).toMatch(/^SELECT/i);
    expect(queries[1].sql.trim()).toMatch(/^SELECT/i);
    expect(queries[0].params).toEqual(['default', 'page', '%admin\\_1%', '%dashboard\\%%', 'success']);
    expect(queries[1].params).toEqual(['default', 'page', '%admin\\_1%', '%dashboard\\%%', 'success', 7, 0]);
    expect(queries[1].sql).toContain('actor_id ILIKE $3');
    expect(queries[1].sql).toContain('action ILIKE $4');
    expect(queries[1].sql).toContain('outcome = $5');
    expect(queries[1].sql).toContain('LIMIT $6');
    expect(queries[1].sql).toContain('OFFSET $7');
  });

  it('reader chỉ gửi SELECT statements tới client', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('AS profiles')) {
          return { rows: [{ profiles: 0, conversations: 0, messages: 0, orders: 0, order_items: 0, events: 0, processed_mids: 0 }] };
        }
        return { rows: [] };
      }
    }
    const reader = createPostgresDashboardReader({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: FakeClient
    });

    await reader.getOverview();
    await reader.getUserDetail('sender_1');

    if (!queries.length) throw new Error('expected dashboard reader to query database');
    for (const { sql } of queries) {
      expect(sql.trim()).toMatch(/^SELECT/i);
      if (/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(sql)) {
        throw new Error(`unexpected write SQL: ${sql}`);
      }
    }
  });

  it('reader dùng filter parameterized và giới hạn limit', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('AS profiles')) {
          return { rows: [{ profiles: 0, conversations: 0, messages: 0, orders: 0, order_items: 0, events: 0, processed_mids: 0 }] };
        }
        return { rows: [] };
      }
    }
    const reader = createPostgresDashboardReader({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: FakeClient
    });

    const model = await reader.getOverview({
      senderId: 'sender_1',
      status: 'confirmed',
      productCode: 'MÃ8',
      eventType: 'lead',
      limit: '5',
      ordersPage: '3',
      eventsPage: '2'
    });

    const orderQuery = queries.find(item => item.sql.includes('FROM orders o') && item.sql.includes('GROUP BY o.id'));
    const eventQuery = queries.find(item => item.sql.includes('FROM events e') && item.sql.includes('ORDER BY event_at DESC'));
    expect(Boolean(orderQuery)).toBeTrue();
    expect(Boolean(eventQuery)).toBeTrue();
    expect(orderQuery.params).toEqual(['default', 'page', '%sender\\_1%', '%MÃ8%', 'confirmed', 5, 10]);
    expect(eventQuery.params).toEqual(['default', 'page', '%sender\\_1%', '%MÃ8%', '%lead%', 5, 5]);
    expect(orderQuery.sql).toContain('o.sender_id ILIKE $3');
    expect(orderQuery.sql).toContain('o.status = $5');
    expect(orderQuery.sql).toContain('LIMIT $6');
    expect(orderQuery.sql).toContain('OFFSET $7');
    expect(model.filters.ordersPage).toBe(3);
    expect(model.filters.ordersOffset).toBe(10);
    expect(model.filters.eventsPage).toBe(2);
    expect(model.filters.eventsOffset).toBe(5);
    expect(model.pagination.orders.page).toBe(3);
  });

  it('reader trả operational insights bằng SELECT read-only', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('AS profiles')) {
          return { rows: [{ profiles: 1, conversations: 2, messages: 3, orders: 4, order_items: 5, events: 6, processed_mids: 7 }] };
        }
        if (sql.includes('AS orders_24h')) {
          return { rows: [{ orders_24h: 2, confirmed_24h: 1, ready_orders: 1, abandoned_24h: 0, active_handoffs: 1, events_24h: 3, last_user_message_at: '2026-05-10T00:00:02.000Z', last_event_at: '2026-05-10T00:00:03.000Z' }] };
        }
        if (sql.includes('GROUP BY status')) {
          return { rows: [{ status: 'ready_to_confirm', total: 1 }] };
        }
        if (sql.includes('total_orders')) {
          return { rows: [{ product_code: 'MÃ8', total_orders: 2, confirmed_orders: 1 }] };
        }
        if (sql.includes('reminder_failed')) {
          return { rows: [{ reason: 'ready_to_confirm', id: '1', sender_id: 'sender_1', status: 'ready_to_confirm', product_code: 'MÃ8', phone: '0987654321', address: '12 Tran Phu', updated_at: '2026-05-10T00:00:01.000Z', item_count: 1 }] };
        }
        if (sql.includes('handoff_until > now()')) {
          return { rows: [{ sender_id: 'sender_2', session_state: 'HUMAN_HANDOFF', last_product_code: 'MÃ10', handoff_until: '2026-05-10T00:30:00.000Z', updated_at: '2026-05-10T00:00:00.000Z' }] };
        }
        return { rows: [] };
      }
    }
    const reader = createPostgresDashboardReader({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: FakeClient
    });

    const model = await reader.getOverview();

    expect(model.operations.activity.ready_orders).toBe(1);
    expect(model.operations.orderStatusBreakdown[0].status).toBe('ready_to_confirm');
    expect(model.operations.topProducts[0].product_code).toBe('MÃ8');
    expect(model.operations.needsAttention.orders[0].reason).toBe('ready_to_confirm');
    expect(model.operations.needsAttention.handoffs[0].sender_id).toBe('sender_2');
    for (const { sql } of queries) {
      expect(sql.trim()).toMatch(/^SELECT/i);
    }
  });

  it('reader audit log chỉ gửi SELECT parameterized', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        queries.push({ sql, params });
        return { rows: [] };
      }
    }
    const reader = createPostgresDashboardReader({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: FakeClient
    });

    const model = await reader.getAuditLog({
      actorId: 'admin_1',
      action: 'dashboard',
      outcome: 'success',
      limit: '7'
    });

    expect(queries.length).toBe(2);
    expect(queries[0].sql.trim()).toMatch(/^SELECT/i);
    expect(queries[1].sql.trim()).toMatch(/^SELECT/i);
    expect(queries[0].params).toEqual(['default', 'page', '%admin\\_1%', '%dashboard%', 'success']);
    expect(queries[1].params).toEqual(['default', 'page', '%admin\\_1%', '%dashboard%', 'success', 7, 0]);
    expect(queries[1].sql).toContain('actor_id ILIKE $3');
    expect(queries[1].sql).toContain('action ILIKE $4');
    expect(queries[1].sql).toContain('outcome = $5');
    expect(queries[1].sql).toContain('LIMIT $6');
    expect(queries[1].sql).toContain('OFFSET $7');
    expect(model.pagination.audit.page).toBe(1);
    expect(model.pagination.audit.limit).toBe(7);
  });

  it('reader audit log trả trạng thái chưa sẵn sàng khi thiếu schema audit', async () => {
    class FakeClient {
      async connect() {}
      async end() {}
      async query() {
        const err = new Error('relation "admin_audit_log" does not exist');
        err.code = '42P01';
        throw err;
      }
    }
    const reader = createPostgresDashboardReader({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: FakeClient
    });

    const model = await reader.getAuditLog();

    expect(model.schemaReady).toBeFalse();
    expect(model.rows).toEqual([]);
  });
});

describe('admin audit PostgreSQL writer', () => {
  it('disabled audit logger không tạo kết nối database', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const logger = createPostgresAuditLogger({
      enabled: false,
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    const result = await logger.record({ action: PERMISSIONS.DASHBOARD_READ });

    expect(result.skipped).toBeTrue();
    expect(constructed).toBeFalse();
  });

  it('enabled audit logger ghi INSERT parameterized', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        queries.push({ sql, params });
        return { rows: [] };
      }
    }
    const logger = createPostgresAuditLogger({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    await logger.record({
      occurred_at: '2026-05-10T00:00:00.000Z',
      tenant_id: 'default',
      page_id: 'page',
      actor_id: 'admin-1',
      actor_roles: ['maintainer'],
      action: PERMISSIONS.DASHBOARD_READ,
      resource_type: 'dashboard',
      resource_id: '',
      outcome: 'success',
      request_id: 'req-1',
      request_ip_hash: 'hash',
      user_agent: 'unit-test',
      metadata: { filter: 'masked' }
    });

    expect(queries.length).toBe(1);
    expect(queries[0].sql.trim()).toMatch(/^INSERT INTO admin_audit_log/i);
    expect(queries[0].params[5]).toBe(PERMISSIONS.DASHBOARD_READ);
    expect(queries[0].params[12]).toBe(JSON.stringify({ filter: 'masked' }));
  });
});

const { describe, it, expect } = require('./harness');
const {
  assertReadOnlySql,
  createPostgresAuditLogger,
  createPostgresDashboardReader,
  registerAdminRoutes
} = require('../core/admin-routes');
const { PERMISSIONS } = require('../core/admin-auth');

function createApp() {
  const routes = {};
  return {
    routes,
    get(path, handler) {
      routes[path] = handler;
    }
  };
}

function createReq({ headers = {}, params = {}, query = {} } = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
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
        orderItems: [],
        messages: [],
        events: [],
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

describe('admin dashboard routes', () => {
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
    expect(res.body.includes('0987654321')).toBeFalse();
    expect(res.body.includes('12 Tran Phu')).toBeFalse();
    expect(res.body).toContain('[masked-address]');
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

    await reader.getOverview({
      senderId: 'sender_1',
      status: 'confirmed',
      productCode: 'MÃ8',
      eventType: 'lead',
      limit: '5'
    });

    const orderQuery = queries.find(item => item.sql.includes('FROM orders o'));
    const eventQuery = queries.find(item => item.sql.includes('FROM events e'));
    expect(Boolean(orderQuery)).toBeTrue();
    expect(Boolean(eventQuery)).toBeTrue();
    expect(orderQuery.params).toEqual(['default', 'page', '%sender\\_1%', '%MÃ8%', 'confirmed', 5]);
    expect(eventQuery.params).toEqual(['default', 'page', '%sender\\_1%', '%MÃ8%', '%lead%', 5]);
    expect(orderQuery.sql).toContain('o.sender_id ILIKE $3');
    expect(orderQuery.sql).toContain('o.status = $5');
    expect(orderQuery.sql).toContain('LIMIT $6');
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

    await reader.getAuditLog({
      actorId: 'admin_1',
      action: 'dashboard',
      outcome: 'success',
      limit: '7'
    });

    expect(queries.length).toBe(1);
    expect(queries[0].sql.trim()).toMatch(/^SELECT/i);
    expect(queries[0].params).toEqual(['default', 'page', '%admin\\_1%', '%dashboard%', 'success', 7]);
    expect(queries[0].sql).toContain('actor_id ILIKE $3');
    expect(queries[0].sql).toContain('action ILIKE $4');
    expect(queries[0].sql).toContain('outcome = $5');
    expect(queries[0].sql).toContain('LIMIT $6');
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

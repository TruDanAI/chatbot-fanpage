const express = require('express');
const http = require('http');
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
const { createPostgresInternalNoteService } = require('../core/admin/internal-notes');
const { createPostgresProductWriteService } = require('../core/admin/product-writes');
const {
  createPostgresShopSettingsWriteService,
  normalizeSettingsInput
} = require('../core/admin/shop-settings-writes');

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

function requestExpress(app, {
  method = 'GET',
  path = '/',
  headers = {},
  body = ''
} = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers
      }, res => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          responseBody += chunk;
        });
        res.on('end', () => {
          server.close(() => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: responseBody
            });
          });
        });
      });
      req.on('error', err => {
        server.close(() => reject(err));
      });
      if (body) req.write(body);
      req.end();
    });
    server.on('error', reject);
  });
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
    },
    async getShops() {
      calls += 1;
      return {
        schemaReady: true,
        shops: [{
          id: 'adult-shop',
          slug: 'adult-shop',
          name: 'Adult Shop',
          status: 'active',
          page_count: 2,
          active_page_count: 1,
          product_count: 2,
          asset_count: 3,
          bot_mode: 'menu_code_handoff',
          updated_at: '2026-05-12T00:00:00.000Z',
          page_access_token: 'do-not-return'
        }]
      };
    },
    async getShopDetail(shopId) {
      calls += 1;
      return {
        schemaReady: true,
        shop: {
          id: shopId,
          slug: 'adult-shop',
          name: 'Adult Shop',
          status: 'active',
          default_locale: 'vi-VN',
          timezone: 'Asia/Bangkok',
          created_at: '2026-05-11T00:00:00.000Z',
          updated_at: '2026-05-12T00:00:00.000Z',
          secret_note: 'do-not-return'
        },
        pages: [{
          id: 'adult-page',
          page_id: 'page_1',
          page_name: 'Adult Page',
          status: 'active',
          created_at: '2026-05-11T00:00:00.000Z',
          updated_at: '2026-05-12T00:00:00.000Z',
          page_access_token: 'do-not-return'
        }],
        settings: {
          bot_mode: 'menu_code_handoff',
          handoff_enabled: true,
          handoff_message: 'handoff',
          menu_intro_text: 'menu',
          fallback_text: 'fallback',
          settings_json: {
            minAge: 18,
            ruleToggles: {
              productCodeLookupEnabled: true,
              menuSendingEnabled: false,
              postProductHandoffEnabled: true,
              fallbackEnabled: true,
              leadCaptureEnabled: false
            },
            accessToken: 'do-not-return',
            nested: {
              api_secret: 'do-not-return'
            }
          },
          updated_at: '2026-05-12T00:00:00.000Z'
        },
        products: [{
          id: 'prod-1',
          code: 'DB1',
          name: 'DB Product',
          description: 'safe product',
          price: '150000.00',
          currency: 'VND',
          status: 'active',
          sort_order: 1,
          metadata_json: {
            size: 'M',
            customerPhone: '0987654321'
          },
          updated_at: '2026-05-12T00:00:00.000Z'
        }, {
          id: 'prod-2',
          code: 'DB2',
          name: 'Hidden Product',
          description: 'hidden product',
          price_text: '220k',
          status: 'hidden',
          sort_order: 2,
          metadata_json: {},
          updated_at: '2026-05-12T00:10:00.000Z'
        }, {
          id: 'prod-3',
          code: 'DB3',
          name: 'Archived Product',
          description: 'archived product',
          price_text: '330k',
          status: 'archived',
          sort_order: 3,
          metadata_json: {},
          updated_at: '2026-05-12T00:20:00.000Z'
        }],
        assets: {
          summary: {
            total: 2,
            active: 2,
            product_image: 1,
            menu_image: 1,
            shop_image: 0
          },
          rows: [{
            id: 'asset-1',
            product_id: 'prod-1',
            product_code: 'DB1',
            asset_type: 'product_image',
            storage_provider: 'public_url',
            storage_key: 'do-not-return',
            public_url: 'https://cdn.example.test/db1.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1234,
            status: 'active',
            sort_order: 1,
            updated_at: '2026-05-12T00:00:00.000Z'
          }]
        }
      };
    }
  };
}

function createInternalNoteServiceStub({ failWith, noteRows, createFailWith, createdNote } = {}) {
  const calls = [];
  const createCalls = [];
  return {
    calls,
    createCalls,
    async listNotes(filters = {}) {
      calls.push(filters);
      if (failWith) throw failWith;
      const rows = typeof noteRows === 'function' ? noteRows(filters) : noteRows;
      return {
        targetType: filters.targetType,
        targetId: filters.targetId,
        limit: filters.limit,
        offset: filters.offset,
        visibleOnly: filters.visibleOnly !== false,
        notes: rows == null ? [{
          id: 7,
          target_type: filters.targetType,
          target_id: filters.targetId,
          body: 'safe staff context',
          status: 'visible',
          created_by: 'admin-1',
          created_at: '2026-05-12T01:00:00.000Z',
          hidden_by: 'admin-2',
          hide_reason: 'do not return',
          raw_customer: { phone: '0987654321' },
          raw_order: { address: '12 Tran Phu' },
          raw_message: { text: 'raw message' }
        }] : rows
      };
    },
    async createNote(input = {}) {
      createCalls.push(input);
      if (createFailWith) throw createFailWith;
      const normalizedBody = String(input.body || '').replace(/\r\n/g, '\n').trim();
      return createdNote || {
        id: 'created-1',
        targetType: String(input.targetType || '').trim().toLowerCase(),
        targetId: String(input.targetId || '').trim(),
        bodyLength: normalizedBody.length,
        status: 'visible',
        createdBy: input.principal?.id || '',
        createdAt: '2026-05-12T02:00:00.000Z'
      };
    }
  };
}

function createProductWriteServiceStub({ failWith, createdProduct, updatedProduct, statusProduct, archivedProduct } = {}) {
  const calls = [];
  const baseProduct = {
    id: 'prod-1',
    shop_id: 'adult-shop',
    code: 'DB1',
    name: 'DB Product',
    description: 'safe product',
    price_text: '150k',
    status: 'active',
    enabled: true,
    sort_order: 1,
    tags: ['featured'],
    category: 'demo',
    metadata_json: {
      priceText: '150k',
      customerPhone: '0987654321',
      accessToken: 'do-not-return'
    },
    updated_at: '2026-05-12T04:00:00.000Z'
  };
  return {
    calls,
    async createProduct(input = {}) {
      calls.push({ method: 'createProduct', input });
      if (failWith) throw failWith;
      return {
        shopId: input.shopId,
        product: createdProduct || { ...baseProduct, code: 'DB2', name: 'Created Product' }
      };
    },
    async updateProduct(input = {}) {
      calls.push({ method: 'updateProduct', input });
      if (failWith) throw failWith;
      return {
        shopId: input.shopId,
        product: updatedProduct || { ...baseProduct, name: 'Updated Product' }
      };
    },
    async setProductEnabled(input = {}) {
      calls.push({ method: 'setProductEnabled', input });
      if (failWith) throw failWith;
      return {
        shopId: input.shopId,
        product: statusProduct || { ...baseProduct, status: input.enabled ? 'active' : 'hidden', enabled: Boolean(input.enabled) }
      };
    },
    async archiveProduct(input = {}) {
      calls.push({ method: 'archiveProduct', input });
      if (failWith) throw failWith;
      return {
        shopId: input.shopId,
        product: archivedProduct || { ...baseProduct, status: 'archived', enabled: false }
      };
    }
  };
}

function createShopSettingsWriteServiceStub({ failWith, updatedSettings } = {}) {
  const calls = [];
  return {
    calls,
    async updateSettings(input = {}) {
      calls.push({ method: 'updateSettings', input });
      if (failWith) throw failWith;
      const body = input.body || {};
      return {
        shopId: input.shopId,
        settings: updatedSettings || {
          shop_id: input.shopId,
          bot_mode: String(body.bot_mode || 'disabled').trim(),
          handoff_enabled: Array.isArray(body.handoff_enabled)
            ? body.handoff_enabled.some(item => /^(1|true|yes|on|enabled|active)$/i.test(String(item || '').trim()))
            : /^(1|true|yes|on|enabled|active)$/i.test(String(body.handoff_enabled || '').trim()),
          handoff_message: String(body.handoff_message || '').trim(),
          menu_intro_text: String(body.menu_intro_text || '').trim(),
          fallback_text: String(body.fallback_text || '').trim(),
          settings_json: {
            ruleToggles: {
              productCodeLookupEnabled: body.productCodeLookupEnabled === 'false' ? false : true,
              menuSendingEnabled: body.menuSendingEnabled === 'false' ? false : true,
              postProductHandoffEnabled: body.postProductHandoffEnabled === 'false' ? false : true,
              fallbackEnabled: body.fallbackEnabled === 'false' ? false : true,
              leadCaptureEnabled: body.leadCaptureEnabled === 'true'
            },
            accessToken: 'do-not-return',
            nested: { api_secret: 'do-not-return' }
          },
          updated_at: '2026-05-12T06:00:00.000Z'
        }
      };
    }
  };
}

function createInternalNoteRouteFakeClientClass({
  failAudit = false,
  failNoteCode = '',
  queries = []
} = {}) {
  return class FakeClient {
    async connect() {
      queries.push({ sql: 'CONNECT', params: [] });
    }

    async end() {
      queries.push({ sql: 'END', params: [] });
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').trim();
      queries.push({ sql: normalized, params });
      if (/^INSERT INTO internal_notes/i.test(normalized)) {
        if (failNoteCode) {
          const err = new Error(`raw PostgreSQL ${failNoteCode} relation "internal_notes" at postgres://secret`);
          err.code = failNoteCode;
          throw err;
        }
        return {
          rows: [{
            id: '99',
            status: 'visible',
            created_by: params[5],
            created_at: '2026-05-12T03:00:00.000Z'
          }]
        };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAudit) throw new Error('audit insert failed at postgres://secret');
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

function findRouteQuery(queries, pattern) {
  return queries.find(item => pattern.test(item.sql));
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

function registerInternalNoteRouteApp({
  internalNoteService = createInternalNoteServiceStub(),
  auditLogger,
  adminPrincipalRoles = ['maintainer'],
  adminPrincipalId = 'admin-1',
  adminSessionSecret = ''
} = {}) {
  const app = createApp();
  registerAdminRoutes(app, {
    storage: createStorageStub(),
    adminExportToken: 'secret',
    getClientIp: () => '127.0.0.1',
    dashboardReader: createDashboardReaderStub(),
    internalNoteService,
    auditLogger,
    adminPrincipalRoles,
    adminPrincipalId,
    adminSessionSecret,
    tenantId: 'default',
    pageId: 'page'
  });
  return app;
}

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

  it('internal notes API trả visible notes với field an toàn và audit metadata hẹp', async () => {
    const app = createApp();
    const notes = createInternalNoteServiceStub();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      internalNoteService: notes,
      auditLogger,
      adminPrincipalRoles: ['viewer'],
      tenantId: 'default',
      pageId: 'page'
    });

    const res = createRes();
    await app.routes['/admin/api/internal-notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: {
        target_type: 'Customer',
        target_id: 'sender_1',
        limit: '5',
        offset: '2',
        body: 'must not be audited'
      }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['notes', 'pagination', 'schemaReady']);
    expect(body.schemaReady).toBeTrue();
    expect(body.pagination).toEqual({
      limit: 5,
      offset: 2,
      count: 1,
      hasNext: false
    });
    expect(notes.calls[0]).toEqual({
      targetType: 'customer',
      targetId: 'sender_1',
      limit: 5,
      offset: 2,
      visibleOnly: true
    });
    expect(Object.keys(body.notes[0]).sort()).toEqual([
      'body',
      'created_at',
      'created_by',
      'id',
      'status',
      'target_id',
      'target_type'
    ]);
    expect(body.notes[0].body).toBe('safe staff context');
    expect(bodyText.includes('hidden_by')).toBeFalse();
    expect(bodyText.includes('hide_reason')).toBeFalse();
    expect(bodyText.includes('raw_customer')).toBeFalse();
    expect(bodyText.includes('raw_order')).toBeFalse();
    expect(bodyText.includes('raw_message')).toBeFalse();
    expect(bodyText.includes('0987654321')).toBeFalse();
    expect(bodyText.includes('12 Tran Phu')).toBeFalse();
    expect(auditLogger.entries.length).toBe(1);
    expect(auditLogger.entries[0].action).toBe('admin.internal_note.read');
    expect(auditLogger.entries[0].resource_type).toBe('internal_note');
    expect(auditLogger.entries[0].outcome).toBe('success');
    expect(auditLogger.entries[0].metadata).toEqual({
      target_type: 'customer',
      target_id: 'sender_1',
      limit: 5,
      offset: 2,
      schemaReady: true
    });
    expect(JSON.stringify(auditLogger.entries[0]).includes('must not be audited')).toBeFalse();
    expect(JSON.stringify(auditLogger.entries[0]).includes('safe staff context')).toBeFalse();
  });

  it('internal notes API dùng quyền đọc target detail cho viewer support maintainer owner', async () => {
    for (const role of ['viewer', 'support', 'maintainer', 'owner']) {
      const app = createApp();
      const notes = createInternalNoteServiceStub({ noteRows: [] });
      registerAdminRoutes(app, {
        storage: createStorageStub(),
        adminExportToken: 'secret',
        getClientIp: () => '127.0.0.1',
        dashboardReader: createDashboardReaderStub(),
        internalNoteService: notes,
        adminPrincipalRoles: [role],
        tenantId: 'default',
        pageId: 'page'
      });

      const customerRes = createRes();
      await app.routes['/admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        query: { target_type: 'customer', target_id: 'sender_1' }
      }), customerRes);
      const orderRes = createRes();
      await app.routes['/admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        query: { target_type: 'order', target_id: '123' }
      }), orderRes);

      expect(customerRes.statusCode).toBe(200);
      expect(orderRes.statusCode).toBe(200);
      expect(notes.calls.length).toBe(2);
    }
  });

  it('internal notes API nhận browser session và vẫn không nhận x-admin-token', async () => {
    const app = createApp();
    const notes = createInternalNoteServiceStub({ noteRows: [] });
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      internalNoteService: notes,
      adminSessionSecret: TEST_SESSION_SECRET,
      adminPrincipalRoles: ['viewer'],
      tenantId: 'default',
      pageId: 'page'
    });

    const tokenRes = createRes();
    await app.routes['/admin/api/internal-notes'](createReq({
      headers: { 'x-admin-token': 'secret' },
      query: { token: 'secret', target_type: 'customer', target_id: 'sender_1' }
    }), tokenRes);
    expect(tokenRes.statusCode).toBe(401);

    const loginRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'secret' }
    }), loginRes);
    const sessionRes = createRes();
    await app.routes['/admin/api/internal-notes'](createReq({
      headers: { cookie: loginRes.headers['set-cookie'].split(';')[0] },
      query: { target_type: 'customer', target_id: 'sender_1' }
    }), sessionRes);

    expect(sessionRes.statusCode).toBe(200);
    expect(JSON.parse(sessionRes.body).schemaReady).toBeTrue();
  });

  it('internal notes API rejects invalid target_type and target_id safely', async () => {
    const app = createApp();
    const notes = createInternalNoteServiceStub();
    const auditLogger = createAuditLoggerStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      internalNoteService: notes,
      auditLogger,
      adminPrincipalRoles: ['owner'],
      tenantId: 'default',
      pageId: 'page'
    });

    const invalidTypeRes = createRes();
    await app.routes['/admin/api/internal-notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: { target_type: 'profile', target_id: 'sender_1' }
    }), invalidTypeRes);
    const emptyTargetRes = createRes();
    await app.routes['/admin/api/internal-notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: { target_type: 'customer', target_id: '   ' }
    }), emptyTargetRes);

    expect(invalidTypeRes.statusCode).toBe(400);
    expect(emptyTargetRes.statusCode).toBe(400);
    expect(JSON.parse(invalidTypeRes.body).error).toBe('invalid_internal_note_target');
    expect(JSON.parse(emptyTargetRes.body).notes).toEqual([]);
    expect(notes.calls.length).toBe(0);
    expect(JSON.stringify(invalidTypeRes.body).includes('secret')).toBeFalse();
    expect(auditLogger.entries.every(entry => entry.action === 'admin.internal_note.read')).toBeTrue();
  });

  it('internal notes API bounds limit to 100', async () => {
    const app = createApp();
    const notes = createInternalNoteServiceStub({ noteRows: [] });
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      internalNoteService: notes,
      adminPrincipalRoles: ['support'],
      tenantId: 'default',
      pageId: 'page'
    });

    const res = createRes();
    await app.routes['/admin/api/internal-notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      query: { target_type: 'conversation', target_id: 'sender_1', limit: '10000' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(notes.calls[0].limit).toBe(100);
    expect(body.pagination.limit).toBe(100);
  });

  it('internal notes API handles missing schema without raw DB error', async () => {
    for (const code of ['42P01', '42703']) {
      const err = new Error(`raw PostgreSQL ${code} relation "internal_notes" at postgres://secret`);
      err.code = code;
      const app = createApp();
      const notes = createInternalNoteServiceStub({ failWith: err });
      const auditLogger = createAuditLoggerStub();
      registerAdminRoutes(app, {
        storage: createStorageStub(),
        adminExportToken: 'secret',
        getClientIp: () => '127.0.0.1',
        dashboardReader: createDashboardReaderStub(),
        internalNoteService: notes,
        auditLogger,
        adminPrincipalRoles: ['viewer'],
        tenantId: 'default',
        pageId: 'page'
      });

      const res = createRes();
      await app.routes['/admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        query: { target_type: 'customer', target_id: 'sender_1', limit: '5', offset: '1' }
      }), res);
      const body = JSON.parse(res.body);
      const bodyText = JSON.stringify(body);

      expect(res.statusCode).toBe(200);
      expect(body.schemaReady).toBeFalse();
      expect(body.notes).toEqual([]);
      expect(body.pagination).toEqual({
        limit: 5,
        offset: 1,
        count: 0,
        hasNext: false
      });
      expect(bodyText.includes(`raw PostgreSQL ${code}`)).toBeFalse();
      expect(bodyText.includes('relation "internal_notes"')).toBeFalse();
      expect(bodyText.includes('postgres://secret')).toBeFalse();
      expect(auditLogger.entries[0].outcome).toBe('success');
      expect(auditLogger.entries[0].metadata.schemaReady).toBeFalse();
    }
  });

  it('user detail renders internal notes section with latest visible customer and conversation notes', async () => {
    const notes = createInternalNoteServiceStub({
      noteRows: filters => {
        if (filters.targetType === 'customer') {
          return [
            {
              id: 2,
              target_type: 'customer',
              target_id: filters.targetId,
              body: 'customer note',
              status: 'visible',
              created_by: 'admin-1',
              created_at: '2026-05-12T01:00:00.000Z'
            },
            {
              id: 3,
              target_type: 'customer',
              target_id: filters.targetId,
              body: 'hidden customer note',
              status: 'hidden',
              created_by: 'admin-1',
              created_at: '2026-05-12T03:00:00.000Z'
            }
          ];
        }
        return [{
          id: 4,
          target_type: 'conversation',
          target_id: filters.targetId,
          body: 'newer conversation note',
          status: 'visible',
          created_by: 'admin-2',
          created_at: '2026-05-12T02:00:00.000Z'
        }];
      }
    });
    const app = registerInternalNoteRouteApp({
      internalNoteService: notes,
      adminPrincipalRoles: ['viewer'],
      adminPrincipalId: 'viewer-actor'
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ghi Chú Nội Bộ');
    expect(res.body.indexOf('Ghi Chú Nội Bộ') > res.body.indexOf('<h2>Profile</h2>')).toBeTrue();
    expect(res.body.indexOf('Ghi Chú Nội Bộ') < res.body.indexOf('<h2>Orders</h2>')).toBeTrue();
    expect(notes.calls.map(call => call.targetType).sort()).toEqual(['conversation', 'customer']);
    expect(notes.calls.every(call => call.targetId === 'sender_1')).toBeTrue();
    expect(notes.calls.every(call => call.limit === 21 && call.offset === 0 && call.visibleOnly === true)).toBeTrue();
    expect(res.body.indexOf('newer conversation note') < res.body.indexOf('customer note')).toBeTrue();
    expect(res.body.includes('hidden customer note')).toBeFalse();
    expect(notes.calls.some(call => call.targetType === 'order')).toBeFalse();
  });

  it('actual Express user detail route renders internal notes through real admin composition', async () => {
    const notes = createInternalNoteServiceStub({
      noteRows: filters => [{
        id: filters.targetType === 'customer' ? 10 : 11,
        target_type: filters.targetType,
        target_id: filters.targetId,
        body: filters.targetType === 'customer' ? '<script>alert(1)</script>' : 'conversation context',
        status: 'visible',
        created_by: 'admin-1',
        created_at: filters.targetType === 'customer'
          ? '2026-05-12T03:00:00.000Z'
          : '2026-05-12T02:00:00.000Z'
      }]
    });
    const app = express();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      internalNoteService: notes,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'maintainer-actor',
      tenantId: 'default',
      pageId: 'page'
    });

    const res = await requestExpress(app, {
      path: '/admin/dashboard/users/sender_1',
      headers: { authorization: 'Bearer secret' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ghi Chú Nội Bộ');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body.includes('<script>alert(1)</script>')).toBeFalse();
    expect(res.body).toContain('conversation context');
    expect(res.body).toContain('method="post" action="/admin/dashboard/users/sender_1/notes"');
    expect(notes.calls.map(call => call.targetType).sort()).toEqual(['conversation', 'customer']);
  });

  it('user detail renders empty internal notes state', async () => {
    const app = registerInternalNoteRouteApp({
      internalNoteService: createInternalNoteServiceStub({ noteRows: [] }),
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ghi Chú Nội Bộ');
    expect(res.body).toContain('Chưa có ghi chú nào.');
  });

  it('user detail renders notes section when default internal note service is unavailable', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      dashboardDatabaseUrl: '',
      adminPrincipalRoles: ['viewer'],
      tenantId: 'default',
      pageId: 'page'
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ghi Chú Nội Bộ');
    expect(res.body).toContain('Không đọc được ghi chú nội bộ.');
    expect(res.body.includes('DATABASE_URL')).toBeFalse();
    expect(res.body.includes('postgres://')).toBeFalse();
  });

  it('user detail exposes top-level internal note model fields to the renderer', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      target_type: index % 2 === 0 ? 'customer' : 'conversation',
      target_id: 'sender_1',
      body: `note ${index + 1}`,
      status: 'visible',
      created_by: 'admin-1',
      created_at: new Date(Date.UTC(2026, 4, 12, 1, index)).toISOString()
    }));
    const app = registerInternalNoteRouteApp({
      internalNoteService: createInternalNoteServiceStub({
        noteRows: filters => rows.filter(row => row.target_type === filters.targetType)
      }),
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ghi Chú Nội Bộ');
    expect(res.body).toContain('Đang hiển thị các ghi chú mới nhất.');
    expect(res.body).toContain('method="post" action="/admin/dashboard/users/sender_1/notes"');
  });

  it('user detail escapes internal note body and does not render unsafe HTML', async () => {
    const app = registerInternalNoteRouteApp({
      internalNoteService: createInternalNoteServiceStub({
        noteRows: [{
          id: 8,
          target_type: 'customer',
          target_id: 'sender_1',
          body: '<script>alert(1)</script>\nline 2',
          status: 'visible',
          created_by: '<b>admin</b>',
          created_at: '2026-05-12T01:00:00.000Z'
        }]
      }),
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('class="note-body"');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body).toContain('&lt;b&gt;admin&lt;/b&gt;');
    expect(res.body.includes('<script>alert(1)</script>')).toBeFalse();
    expect(res.body.includes('<b>admin</b>')).toBeFalse();
  });

  it('internal note form is visible for maintainer and owner only', async () => {
    for (const role of ['maintainer', 'owner']) {
      const app = registerInternalNoteRouteApp({
        internalNoteService: createInternalNoteServiceStub({ noteRows: [] }),
        adminPrincipalRoles: [role],
        adminPrincipalId: `${role}-actor`
      });

      const res = createRes();
      await app.routes['/admin/dashboard/users/:senderId'](createReq({
        headers: { authorization: 'Bearer secret' },
        params: { senderId: 'sender_1' }
      }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('method="post" action="/admin/dashboard/users/sender_1/notes"');
      expect(res.body).toContain('name="target_type" value="customer" checked');
      expect(res.body).toContain('name="target_type" value="conversation"');
      expect(res.body).toContain('textarea name="body" required maxlength="2000"');
      expect(res.body).toContain('Lưu ghi chú');
    }

    for (const role of ['viewer', 'support']) {
      const app = registerInternalNoteRouteApp({
        internalNoteService: createInternalNoteServiceStub({ noteRows: [] }),
        adminPrincipalRoles: [role],
        adminPrincipalId: `${role}-actor`
      });

      const res = createRes();
      await app.routes['/admin/dashboard/users/:senderId'](createReq({
        headers: { authorization: 'Bearer secret' },
        params: { senderId: 'sender_1' }
      }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.includes('action="/admin/dashboard/users/sender_1/notes"')).toBeFalse();
      expect(res.body.includes('Lưu ghi chú')).toBeFalse();
    }
  });

  it('user detail internal notes read handles missing schema safely', async () => {
    const err = new Error('raw PostgreSQL relation "internal_notes" at postgres://secret');
    err.code = '42P01';
    const app = registerInternalNoteRouteApp({
      internalNoteService: createInternalNoteServiceStub({ failWith: err }),
      adminPrincipalRoles: ['owner']
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ghi chú nội bộ chưa sẵn sàng.');
    expect(res.body.includes('relation "internal_notes"')).toBeFalse();
    expect(res.body.includes('postgres://secret')).toBeFalse();
    expect(res.body.includes('raw PostgreSQL')).toBeFalse();
  });

  it('user detail internal notes read hides non-schema DB errors and secrets', async () => {
    const err = new Error('raw DB failure password=secret postgres://secret');
    err.code = 'XX000';
    const app = registerInternalNoteRouteApp({
      internalNoteService: createInternalNoteServiceStub({ failWith: err }),
      adminPrincipalRoles: ['owner']
    });

    const res = createRes();
    await app.routes['/admin/dashboard/users/:senderId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Không đọc được ghi chú nội bộ.');
    expect(res.body.includes('raw DB failure')).toBeFalse();
    expect(res.body.includes('password=secret')).toBeFalse();
    expect(res.body.includes('postgres://secret')).toBeFalse();
  });

  it('internal notes POST lets maintainer and owner create notes through Bearer auth', async () => {
    for (const role of ['maintainer', 'owner']) {
      const notes = createInternalNoteServiceStub();
      const app = registerInternalNoteRouteApp({
        internalNoteService: notes,
        adminPrincipalRoles: [role],
        adminPrincipalId: `${role}-actor`
      });

      const res = createRes();
      await app.routes['POST /admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        body: {
          target_type: 'Customer',
          target_id: ' sender_1 ',
          body: 'safe route note'
        }
      }), res);
      const body = JSON.parse(res.body);
      const responseText = JSON.stringify(body);

      expect(res.statusCode).toBe(201);
      expect(body.ok).toBeTrue();
      expect(body.schemaReady).toBeTrue();
      expect(body.note).toEqual({
        id: 'created-1',
        target_type: 'customer',
        target_id: 'sender_1',
        status: 'visible',
        created_by: `${role}-actor`,
        created_at: '2026-05-12T02:00:00.000Z',
        body_length: 'safe route note'.length
      });
      expect(notes.createCalls.length).toBe(1);
      expect(notes.createCalls[0].principal.roles).toEqual([role]);
      expect(notes.createCalls[0].targetType).toBe('Customer');
      expect(responseText.includes('safe route note')).toBeFalse();
      expect(responseText.includes('raw_customer')).toBeFalse();
      expect(responseText.includes('raw_order')).toBeFalse();
      expect(responseText.includes('raw_message')).toBeFalse();
    }
  });

  it('internal notes POST denies viewer and support without calling create service', async () => {
    for (const role of ['viewer', 'support']) {
      const notes = createInternalNoteServiceStub();
      const auditLogger = createAuditLoggerStub();
      const app = registerInternalNoteRouteApp({
        internalNoteService: notes,
        auditLogger,
        adminPrincipalRoles: [role],
        adminPrincipalId: `${role}-actor`
      });

      const res = createRes();
      await app.routes['POST /admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        body: {
          target_type: 'customer',
          target_id: 'sender_1',
          body: 'must not be audited'
        }
      }), res);

      expect(res.statusCode).toBe(403);
      expect(notes.createCalls.length).toBe(0);
      expect(auditLogger.entries.length).toBe(1);
      expect(auditLogger.entries[0].action).toBe('admin.internal_note.create');
      expect(auditLogger.entries[0].resource_type).toBe('internal_note');
      expect(auditLogger.entries[0].outcome).toBe('denied');
      expect(auditLogger.entries[0].metadata.permission).toBe(PERMISSIONS.INTERNAL_NOTE_WRITE);
      expect(JSON.stringify(auditLogger.entries[0]).includes('must not be audited')).toBeFalse();
    }
  });

  it('internal notes POST accepts browser sessions and rejects x-admin-token or query token', async () => {
    const notes = createInternalNoteServiceStub();
    const app = registerInternalNoteRouteApp({
      internalNoteService: notes,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'session-actor',
      adminSessionSecret: TEST_SESSION_SECRET
    });

    const tokenRes = createRes();
    await app.routes['POST /admin/api/internal-notes'](createReq({
      headers: { 'x-admin-token': 'secret' },
      query: { token: 'secret' },
      body: {
        target_type: 'customer',
        target_id: 'sender_1',
        body: 'safe note'
      }
    }), tokenRes);
    expect(tokenRes.statusCode).toBe(401);
    expect(notes.createCalls.length).toBe(0);

    const noAuthRes = createRes();
    await app.routes['POST /admin/api/internal-notes'](createReq({
      body: {
        target_type: 'customer',
        target_id: 'sender_1',
        body: 'safe note'
      }
    }), noAuthRes);
    expect(noAuthRes.statusCode).toBe(401);
    expect(notes.createCalls.length).toBe(0);

    const loginRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'secret' }
    }), loginRes);
    const sessionRes = createRes();
    await app.routes['POST /admin/api/internal-notes'](createReq({
      headers: { cookie: loginRes.headers['set-cookie'].split(';')[0] },
      body: {
        target_type: 'customer',
        target_id: 'sender_1',
        body: 'safe note'
      }
    }), sessionRes);

    expect(sessionRes.statusCode).toBe(201);
    expect(notes.createCalls.length).toBe(1);
    expect(JSON.parse(sessionRes.body).note.created_by).toBe('session-actor');
  });

  it('internal notes POST rejects invalid target and body input safely', async () => {
    const cases = [
      {
        label: 'invalid target_type',
        body: { target_type: 'profile', target_id: 'sender_1', body: 'safe note' },
        expectedError: 'invalid_internal_note_target'
      },
      {
        label: 'empty target_id',
        body: { target_type: 'customer', target_id: '   ', body: 'safe note' },
        expectedError: 'invalid_internal_note_target'
      },
      {
        label: 'empty body',
        body: { target_type: 'conversation', target_id: 'sender_1', body: '   ' },
        expectedError: 'invalid_internal_note_body'
      },
      {
        label: 'body too long',
        body: { target_type: 'order', target_id: '123', body: 'x'.repeat(2001) },
        expectedError: 'invalid_internal_note_body'
      }
    ];

    for (const item of cases) {
      const queries = [];
      const service = createPostgresInternalNoteService({
        databaseUrl: 'postgres://example.test/db',
        tenantId: 'default',
        pageId: 'page',
        Client: createInternalNoteRouteFakeClientClass({ queries })
      });
      const app = registerInternalNoteRouteApp({
        internalNoteService: service,
        adminPrincipalRoles: ['maintainer'],
        adminPrincipalId: 'maintainer-actor'
      });

      const res = createRes();
      await app.routes['POST /admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        body: item.body
      }), res);
      const responseText = String(res.body || '');
      const auditInsert = findRouteQuery(queries, /^INSERT INTO admin_audit_log/i);
      const metadataText = auditInsert?.params?.[12] || '';

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe(item.expectedError);
      expect(Boolean(findRouteQuery(queries, /^INSERT INTO internal_notes/i))).toBeFalse();
      expect(Boolean(auditInsert)).toBeTrue();
      expect(auditInsert.params[8]).toBe('denied');
      expect(Boolean(findRouteQuery(queries, /^COMMIT$/))).toBeTrue();
      expect(responseText.includes(item.body.body)).toBeFalse();
      expect(responseText.includes('postgres://')).toBeFalse();
      expect(metadataText.includes(item.body.body)).toBeFalse();
      expect(metadataText.includes('raw_customer')).toBeFalse();
      expect(metadataText.includes('raw_order')).toBeFalse();
      expect(metadataText.includes('raw_message')).toBeFalse();
      expect(item.label.length > 0).toBeTrue();
    }
  });

  it('internal notes POST returns safe success shape and writes safe audit metadata', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createInternalNoteRouteFakeClientClass({ queries })
    });
    const app = registerInternalNoteRouteApp({
      internalNoteService: service,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'maintainer-safe'
    });
    const noteBody = 'do not leak this note body token DATABASE_URL 0987654321 address 12 Tran Phu';

    const res = createRes();
    await app.routes['POST /admin/api/internal-notes'](createReq({
      headers: {
        authorization: 'Bearer secret',
        'x-request-id': 'req-create-1',
        'user-agent': 'unit-test'
      },
      body: {
        target_type: 'customer',
        target_id: 'sender_1',
        body: noteBody
      }
    }), res);
    const body = JSON.parse(res.body);
    const responseText = JSON.stringify(body);
    const noteInsert = findRouteQuery(queries, /^INSERT INTO internal_notes/i);
    const auditInsert = findRouteQuery(queries, /^INSERT INTO admin_audit_log/i);
    const auditMetadata = JSON.parse(auditInsert.params[12]);
    const metadataText = JSON.stringify(auditMetadata);

    expect(res.statusCode).toBe(201);
    expect(Object.keys(body).sort()).toEqual(['note', 'ok', 'schemaReady']);
    expect(Object.keys(body.note).sort()).toEqual([
      'body_length',
      'created_at',
      'created_by',
      'id',
      'status',
      'target_id',
      'target_type'
    ]);
    expect(body.note.id).toBe('99');
    expect(body.note.created_by).toBe('maintainer-safe');
    expect(body.note.body_length).toBe(noteBody.length);
    expect(noteInsert.params[5]).toBe('maintainer-safe');
    expect(auditInsert.params[5]).toBe('admin.internal_note.create');
    expect(auditInsert.params[6]).toBe('internal_note');
    expect(auditInsert.params[7]).toBe('99');
    expect(auditInsert.params[8]).toBe('success');
    expect(auditMetadata).toEqual({
      target_type: 'customer',
      target_id: 'sender_1',
      body_length: noteBody.length,
      auth_method: 'static_bearer'
    });
    expect(responseText.includes(noteBody)).toBeFalse();
    expect(responseText.includes('token')).toBeFalse();
    expect(responseText.includes('DATABASE_URL')).toBeFalse();
    expect(responseText.includes('0987654321')).toBeFalse();
    expect(responseText.includes('12 Tran Phu')).toBeFalse();
    expect(metadataText.includes(noteBody)).toBeFalse();
    expect(metadataText.includes('DATABASE_URL')).toBeFalse();
    expect(metadataText.includes('0987654321')).toBeFalse();
    expect(metadataText.includes('12 Tran Phu')).toBeFalse();
    expect(metadataText.includes('raw_customer')).toBeFalse();
    expect(metadataText.includes('raw_order')).toBeFalse();
    expect(metadataText.includes('raw_message')).toBeFalse();
    expect(Boolean(findRouteQuery(queries, /^COMMIT$/))).toBeTrue();
    expect(Boolean(findRouteQuery(queries, /^ROLLBACK$/))).toBeFalse();
  });

  it('internal notes POST rolls back note insert when audit insert fails', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createInternalNoteRouteFakeClientClass({ queries, failAudit: true })
    });
    const app = registerInternalNoteRouteApp({
      internalNoteService: service,
      adminPrincipalRoles: ['owner'],
      adminPrincipalId: 'owner-actor'
    });

    const res = createRes();
    await app.routes['POST /admin/api/internal-notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      body: {
        target_type: 'customer',
        target_id: 'sender_1',
        body: 'safe note'
      }
    }), res);
    const bodyText = String(res.body || '');

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('internal_note_create_failed');
    expect(Boolean(findRouteQuery(queries, /^INSERT INTO internal_notes/i))).toBeTrue();
    expect(Boolean(findRouteQuery(queries, /^INSERT INTO admin_audit_log/i))).toBeTrue();
    expect(Boolean(findRouteQuery(queries, /^ROLLBACK$/))).toBeTrue();
    expect(Boolean(findRouteQuery(queries, /^COMMIT$/))).toBeFalse();
    expect(bodyText.includes('audit insert failed')).toBeFalse();
    expect(bodyText.includes('postgres://secret')).toBeFalse();
  });

  it('internal notes POST handles missing schema without raw DB error', async () => {
    for (const code of ['42P01', '42703']) {
      const queries = [];
      const service = createPostgresInternalNoteService({
        databaseUrl: 'postgres://example.test/db',
        tenantId: 'default',
        pageId: 'page',
        Client: createInternalNoteRouteFakeClientClass({ queries, failNoteCode: code })
      });
      const app = registerInternalNoteRouteApp({
        internalNoteService: service,
        adminPrincipalRoles: ['maintainer'],
        adminPrincipalId: 'maintainer-actor'
      });

      const res = createRes();
      await app.routes['POST /admin/api/internal-notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        body: {
          target_type: 'customer',
          target_id: 'sender_1',
          body: 'safe note'
        }
      }), res);
      const body = JSON.parse(res.body);
      const bodyText = JSON.stringify(body);

      expect(res.statusCode).toBe(503);
      expect(body.ok).toBeFalse();
      expect(body.schemaReady).toBeFalse();
      expect(body.error).toBe('internal_notes_schema_not_ready');
      expect(Boolean(findRouteQuery(queries, /^ROLLBACK$/))).toBeTrue();
      expect(bodyText.includes(`raw PostgreSQL ${code}`)).toBeFalse();
      expect(bodyText.includes('relation "internal_notes"')).toBeFalse();
      expect(bodyText.includes('postgres://secret')).toBeFalse();
    }
  });

  it('user detail note form POST accepts browser session, calls create service, and redirects', async () => {
    const notes = createInternalNoteServiceStub();
    const app = registerInternalNoteRouteApp({
      internalNoteService: notes,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'session-maintainer',
      adminSessionSecret: TEST_SESSION_SECRET
    });

    const loginRes = createRes();
    await app.routes['POST /admin/login'](createReq({
      body: { adminToken: 'secret' }
    }), loginRes);
    const res = createRes();
    await app.routes['POST /admin/dashboard/users/:senderId/notes'](createReq({
      headers: { cookie: loginRes.headers['set-cookie'].split(';')[0] },
      params: { senderId: 'sender_1' },
      body: {
        target_type: 'conversation',
        body: 'safe browser note'
      }
    }), res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/dashboard/users/sender_1');
    expect(notes.createCalls.length).toBe(1);
    expect(notes.createCalls[0].targetType).toBe('conversation');
    expect(notes.createCalls[0].targetId).toBe('sender_1');
    expect(notes.createCalls[0].body).toBe('safe browser note');
    expect(notes.createCalls[0].allowedTargetTypes).toEqual(['customer', 'conversation']);
    expect(notes.createCalls[0].principal.id).toBe('session-maintainer');
    expect(notes.createCalls[0].principal.authMethod).toBe('admin_session');
  });

  it('user detail note form POST does not perform a second manual audit', async () => {
    const queries = [];
    const auditLogger = createAuditLoggerStub();
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createInternalNoteRouteFakeClientClass({ queries })
    });
    const app = registerInternalNoteRouteApp({
      internalNoteService: service,
      auditLogger,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'maintainer-actor'
    });

    const res = createRes();
    await app.routes['POST /admin/dashboard/users/:senderId/notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' },
      body: {
        target_type: 'customer',
        body: 'safe form note'
      }
    }), res);
    const auditInserts = queries.filter(item => /^INSERT INTO admin_audit_log/i.test(item.sql));

    expect(res.statusCode).toBe(303);
    expect(Boolean(findRouteQuery(queries, /^INSERT INTO internal_notes/i))).toBeTrue();
    expect(auditInserts.length).toBe(1);
    expect(auditLogger.entries.length).toBe(0);
  });

  it('user detail note form POST denies viewer and support before create service', async () => {
    for (const role of ['viewer', 'support']) {
      const notes = createInternalNoteServiceStub();
      const auditLogger = createAuditLoggerStub();
      const app = registerInternalNoteRouteApp({
        internalNoteService: notes,
        auditLogger,
        adminPrincipalRoles: [role],
        adminPrincipalId: `${role}-actor`
      });

      const res = createRes();
      await app.routes['POST /admin/dashboard/users/:senderId/notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        params: { senderId: 'sender_1' },
        body: {
          target_type: 'customer',
          body: 'must not be created'
        }
      }), res);

      expect(res.statusCode).toBe(403);
      expect(String(res.body).includes('must not be created')).toBeFalse();
      expect(notes.createCalls.length).toBe(0);
      expect(auditLogger.entries.length).toBe(1);
      expect(auditLogger.entries[0].action).toBe('admin.internal_note.create');
      expect(auditLogger.entries[0].outcome).toBe('denied');
      expect(auditLogger.entries[0].metadata.permission).toBe(PERMISSIONS.INTERNAL_NOTE_WRITE);
    }
  });

  it('user detail note form POST rejects x-admin-token and query token', async () => {
    const notes = createInternalNoteServiceStub();
    const app = registerInternalNoteRouteApp({
      internalNoteService: notes,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'maintainer-actor',
      adminSessionSecret: TEST_SESSION_SECRET
    });

    const res = createRes();
    await app.routes['POST /admin/dashboard/users/:senderId/notes'](createReq({
      headers: { 'x-admin-token': 'secret' },
      query: { token: 'secret' },
      params: { senderId: 'sender_1' },
      body: {
        target_type: 'customer',
        body: 'safe note'
      }
    }), res);

    expect(res.statusCode).toBe(401);
    expect(notes.createCalls.length).toBe(0);
  });

  it('user detail note form POST rejects empty body, overlong body, invalid target type, and empty sender', async () => {
    const cases = [
      {
        label: 'empty body',
        params: { senderId: 'sender_1' },
        body: { target_type: 'customer', body: '   ' }
      },
      {
        label: 'overlong body',
        params: { senderId: 'sender_1' },
        body: { target_type: 'conversation', body: 'x'.repeat(2001) }
      },
      {
        label: 'invalid target type',
        params: { senderId: 'sender_1' },
        body: { target_type: 'order', body: 'safe note' }
      },
      {
        label: 'empty sender',
        params: { senderId: '   ' },
        body: { target_type: 'customer', body: 'safe note' }
      }
    ];

    for (const item of cases) {
      const queries = [];
      const service = createPostgresInternalNoteService({
        databaseUrl: 'postgres://example.test/db',
        tenantId: 'default',
        pageId: 'page',
        Client: createInternalNoteRouteFakeClientClass({ queries })
      });
      const app = registerInternalNoteRouteApp({
        internalNoteService: service,
        adminPrincipalRoles: ['maintainer'],
        adminPrincipalId: 'maintainer-actor'
      });

      const res = createRes();
      await app.routes['POST /admin/dashboard/users/:senderId/notes'](createReq({
        headers: { authorization: 'Bearer secret' },
        params: item.params,
        body: item.body
      }), res);
      const auditInsert = findRouteQuery(queries, /^INSERT INTO admin_audit_log/i);

      expect(res.statusCode).toBe(400);
      expect(Boolean(findRouteQuery(queries, /^INSERT INTO internal_notes/i))).toBeFalse();
      expect(Boolean(auditInsert)).toBeTrue();
      expect(auditInsert.params[8]).toBe('denied');
      expect(String(res.body).includes(item.body.body)).toBeFalse();
      expect(String(res.body).includes('postgres://')).toBeFalse();
      expect(item.label.length > 0).toBeTrue();
    }
  });

  it('user detail note form POST handles missing schema without raw DB error', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createInternalNoteRouteFakeClientClass({ queries, failNoteCode: '42P01' })
    });
    const app = registerInternalNoteRouteApp({
      internalNoteService: service,
      adminPrincipalRoles: ['maintainer'],
      adminPrincipalId: 'maintainer-actor'
    });

    const res = createRes();
    await app.routes['POST /admin/dashboard/users/:senderId/notes'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { senderId: 'sender_1' },
      body: {
        target_type: 'customer',
        body: 'safe note'
      }
    }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('Internal notes schema is not ready.');
    expect(String(res.body).includes('relation "internal_notes"')).toBeFalse();
    expect(String(res.body).includes('postgres://secret')).toBeFalse();
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
      dashboardReader: reader,
      internalNoteService: createInternalNoteServiceStub({ noteRows: [] })
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

  it('shops API trả shop list read-only bằng field an toàn', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/api/shops'](createReq({
      headers: { authorization: 'Bearer secret' }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(body.schemaReady).toBeTrue();
    expect(body.shops[0]).toEqual({
      id: 'adult-shop',
      slug: 'adult-shop',
      name: 'Adult Shop',
      status: 'active',
      page_count: 2,
      active_page_count: 1,
      product_count: 2,
      asset_count: 3,
      bot_mode: 'menu_code_handoff',
      updated_at: '2026-05-12T00:00:00.000Z'
    });
    expect(bodyText.includes('page_access_token')).toBeFalse();
    expect(bodyText.includes('do-not-return')).toBeFalse();
  });

  it('shop detail API trả products/assets bằng field an toàn', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/api/shops/:shopId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(body.schemaReady).toBeTrue();
    expect(body.shop.id).toBe('adult-shop');
    expect(body.pages[0].page_id).toBe('page_1');
    expect(body.settings.bot_mode).toBe('menu_code_handoff');
    expect(body.settings.settings_json.minAge).toBe(18);
    expect(body.products[0].code).toBe('DB1');
    expect(body.products[0].metadata_json.size).toBe('M');
    expect(body.assets.summary.product_image).toBe(1);
    expect(body.assets.rows[0].public_url).toBe('https://cdn.example.test/db1.jpg');
    expect(bodyText.includes('do-not-return')).toBeFalse();
    expect(bodyText.includes('page_access_token')).toBeFalse();
    expect(bodyText.includes('secret_note')).toBeFalse();
    expect(bodyText.includes('storage_key')).toBeFalse();
    expect(bodyText.includes('accessToken')).toBeFalse();
    expect(bodyText.includes('api_secret')).toBeFalse();
    expect(bodyText.includes('customerPhone')).toBeFalse();
    expect(bodyText.includes('0987654321')).toBeFalse();
  });

  it('shop detail HTML render product search/filter controls, badges, and archive confirmation', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/shops/:shopId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="productSearch"');
    expect(res.body).toContain('name="productStatus"');
    expect(res.body).toContain('name/title');
    expect(res.body).toContain('price_text');
    expect(res.body).toContain('sort_order');
    expect(res.body).toContain('status status-success">active');
    expect(res.body).toContain('status status-warning">hidden');
    expect(res.body).toContain('status status-danger">archived');
    expect(res.body).toContain('data-confirm="Archive product"');
    expect(res.body).toContain('Archive this product? It will be hidden from active use, not deleted.');
  });

  it('shop detail HTML renders chat behavior settings edit form', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/shops/:shopId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' },
      query: { productMessage: 'settings-updated' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Chat Behavior Settings');
    expect(res.body).toContain('action="/admin/shops/adult-shop/settings"');
    expect(res.body).toContain('name="bot_mode"');
    expect(res.body).toContain('value="menu_code_handoff" selected');
    expect(res.body).toContain('name="handoff_enabled"');
    expect(res.body).toContain('name="handoff_message"');
    expect(res.body).toContain('name="menu_intro_text"');
    expect(res.body).toContain('name="fallback_text"');
    expect(res.body).toContain('Rule toggles');
    expect(res.body).toContain('name="productCodeLookupEnabled"');
    expect(res.body).toContain('name="menuSendingEnabled"');
    expect(res.body).toContain('name="postProductHandoffEnabled"');
    expect(res.body).toContain('name="fallbackEnabled"');
    expect(res.body).toContain('name="leadCaptureEnabled"');
    expect(res.body).toContain('Save settings');
    expect(res.body).toContain('Chat behavior settings updated.');
    expect(res.body.includes('do-not-return')).toBeFalse();
  });

  it('shop settings API reads current sanitized settings', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/api/shops/:shopId/settings'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(body.schemaReady).toBeTrue();
    expect(body.shop_id).toBe('adult-shop');
    expect(body.settings.bot_mode).toBe('menu_code_handoff');
    expect(body.settings.settings_json.minAge).toBe(18);
    expect(bodyText.includes('do-not-return')).toBeFalse();
    expect(bodyText.includes('accessToken')).toBeFalse();
    expect(bodyText.includes('api_secret')).toBeFalse();
  });

  it('shop detail HTML filters products by code/name and status without exposing secrets', async () => {
    const app = createApp();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['/admin/shops/:shopId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' },
      query: {
        productSearch: 'hidden',
        productStatus: 'hidden'
      }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Hidden Product');
    expect(res.body).toContain('1 of 3 products');
    expect(res.body.includes('DB Product')).toBeFalse();
    expect(res.body.includes('Archived Product')).toBeFalse();
    expect(res.body.includes('do-not-return')).toBeFalse();
    expect(res.body.includes('page_access_token')).toBeFalse();
    expect(res.body.includes('secret_note')).toBeFalse();
    expect(res.body.includes('accessToken')).toBeFalse();
    expect(res.body.includes('api_secret')).toBeFalse();
    expect(res.body.includes('customerPhone')).toBeFalse();
    expect(res.body.includes('0987654321')).toBeFalse();
    expect(res.body.toLowerCase().includes('token')).toBeFalse();
    expect(res.body.toLowerCase().includes('secret')).toBeFalse();
  });

  it('product create API trims input and returns sanitized product fields', async () => {
    const app = createApp();
    const productWrites = createProductWriteServiceStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      productWriteService: productWrites,
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['POST /admin/api/shops/:shopId/products'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' },
      body: {
        code: ' DB2 ',
        name: ' Created Product ',
        price_text: ' 180k ',
        description: ' new product ',
        token: 'do-not-return'
      }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(201);
    expect(body.ok).toBeTrue();
    expect(body.product.code).toBe('DB2');
    expect(body.product.name).toBe('Created Product');
    expect(body.product.price_text).toBe('150k');
    expect(body.product.metadata_json.customerPhone).toBe(undefined);
    expect(bodyText.includes('0987654321')).toBeFalse();
    expect(bodyText.includes('do-not-return')).toBeFalse();
    expect(productWrites.calls[0].method).toBe('createProduct');
    expect(productWrites.calls[0].input.shopId).toBe('adult-shop');
    expect(productWrites.calls[0].input.body.code).toBe(' DB2 ');
  });

  it('product update API succeeds and keeps write scoped to route shop/product', async () => {
    const app = createApp();
    const productWrites = createProductWriteServiceStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      productWriteService: productWrites,
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['PATCH /admin/api/shops/:shopId/products/:productId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop', productId: 'prod-1' },
      body: { title: 'Updated Product', sort_order: '5' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBeTrue();
    expect(body.product.name).toBe('Updated Product');
    expect(productWrites.calls[0].method).toBe('updateProduct');
    expect(productWrites.calls[0].input.shopId).toBe('adult-shop');
    expect(productWrites.calls[0].input.productId).toBe('prod-1');
  });

  it('product enable/disable API succeeds', async () => {
    const app = createApp();
    const productWrites = createProductWriteServiceStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      productWriteService: productWrites,
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['POST /admin/api/shops/:shopId/products/:productId/status'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop', productId: 'prod-1' },
      body: { enabled: 'false' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.product.status).toBe('hidden');
    expect(body.product.enabled).toBeFalse();
    expect(productWrites.calls[0].method).toBe('setProductEnabled');
    expect(productWrites.calls[0].input.enabled).toBeFalse();
  });

  it('product archive API uses soft archive response without hard delete wording', async () => {
    const app = createApp();
    const productWrites = createProductWriteServiceStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      productWriteService: productWrites,
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['DELETE /admin/api/shops/:shopId/products/:productId'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop', productId: 'prod-1' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.product.status).toBe('archived');
    expect(productWrites.calls[0].method).toBe('archiveProduct');
  });

  it('product write API maps duplicate code and missing schema to safe errors', async () => {
    for (const item of [
      { code: 'duplicate_product_code', status: 409, error: 'duplicate_product_code' },
      { code: '42P01', status: 503, error: 'multi_shop_schema_not_ready' },
      { code: 'product_commit_failed', status: 500, error: 'product_commit_failed' }
    ]) {
      const err = new Error(`raw PostgreSQL ${item.code} relation "shop_products" at postgres://secret`);
      err.code = item.code;
      const app = createApp();
      registerAdminRoutes(app, {
        storage: createStorageStub(),
        adminExportToken: 'secret',
        getClientIp: () => '127.0.0.1',
        dashboardReader: createDashboardReaderStub(),
        productWriteService: createProductWriteServiceStub({ failWith: err }),
        adminPrincipalRoles: ['maintainer']
      });

      const res = createRes();
      await app.routes['POST /admin/api/shops/:shopId/products'](createReq({
        headers: { authorization: 'Bearer secret' },
        params: { shopId: 'adult-shop' },
        body: { code: 'DB1', name: 'Duplicate Product' }
      }), res);
      const body = JSON.parse(res.body);
      const bodyText = JSON.stringify(body);

      expect(res.statusCode).toBe(item.status);
      expect(body.error).toBe(item.error);
      expect(bodyText.includes('relation')).toBeFalse();
      expect(bodyText.includes('postgres://secret')).toBeFalse();
    }
  });

  it('shop settings update API trims input and returns sanitized settings', async () => {
    const app = createApp();
    const settingsWrites = createShopSettingsWriteServiceStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      shopSettingsWriteService: settingsWrites,
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['PATCH /admin/api/shops/:shopId/settings'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' },
      body: {
        bot_mode: ' menu_only ',
        handoff_enabled: 'true',
        handoff_message: ' Staff will reply ',
        menu_intro_text: ' Menu intro ',
        fallback_text: ' Fallback ',
        productCodeLookupEnabled: 'false',
        menuSendingEnabled: 'true',
        postProductHandoffEnabled: 'false',
        fallbackEnabled: 'true',
        leadCaptureEnabled: 'true',
        unknownToggle: 'true',
        token: 'do-not-return'
      }
    }), res);
    const body = JSON.parse(res.body);
    const bodyText = JSON.stringify(body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBeTrue();
    expect(body.settings.bot_mode).toBe('menu_only');
    expect(body.settings.handoff_enabled).toBeTrue();
    expect(body.settings.handoff_message).toBe('Staff will reply');
    expect(body.settings.settings_json.ruleToggles.productCodeLookupEnabled).toBeFalse();
    expect(body.settings.settings_json.ruleToggles.postProductHandoffEnabled).toBeFalse();
    expect(body.settings.settings_json.ruleToggles.leadCaptureEnabled).toBeTrue();
    expect(body.settings.settings_json.ruleToggles.unknownToggle).toBe(undefined);
    expect(body.settings.settings_json.accessToken).toBe(undefined);
    expect(bodyText.includes('do-not-return')).toBeFalse();
    expect(bodyText.includes('api_secret')).toBeFalse();
    expect(settingsWrites.calls[0].method).toBe('updateSettings');
    expect(settingsWrites.calls[0].input.shopId).toBe('adult-shop');
    expect(settingsWrites.calls[0].input.body.unknownToggle).toBe('true');
  });

  it('shop settings update API maps invalid bot mode and missing schema to safe errors', async () => {
    for (const item of [
      { code: 'invalid_bot_mode', status: 400, error: 'invalid_bot_mode' },
      { code: '42P01', status: 503, error: 'multi_shop_schema_not_ready' },
      { code: 'settings_commit_failed', status: 500, error: 'settings_commit_failed' }
    ]) {
      const err = new Error(`raw PostgreSQL ${item.code} relation "shop_settings" at postgres://secret`);
      err.code = item.code;
      const app = createApp();
      registerAdminRoutes(app, {
        storage: createStorageStub(),
        adminExportToken: 'secret',
        getClientIp: () => '127.0.0.1',
        dashboardReader: createDashboardReaderStub(),
        shopSettingsWriteService: createShopSettingsWriteServiceStub({ failWith: err }),
        adminPrincipalRoles: ['maintainer']
      });

      const res = createRes();
      await app.routes['PATCH /admin/api/shops/:shopId/settings'](createReq({
        headers: { authorization: 'Bearer secret' },
        params: { shopId: 'adult-shop' },
        body: { bot_mode: 'invalid' }
      }), res);
      const body = JSON.parse(res.body);
      const bodyText = JSON.stringify(body);

      expect(res.statusCode).toBe(item.status);
      expect(body.error).toBe(item.error);
      expect(bodyText.includes('relation')).toBeFalse();
      expect(bodyText.includes('postgres://secret')).toBeFalse();
    }
  });

  it('shop settings HTML update redirects with success banner key', async () => {
    const app = createApp();
    const settingsWrites = createShopSettingsWriteServiceStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: createDashboardReaderStub(),
      shopSettingsWriteService: settingsWrites,
      adminPrincipalRoles: ['maintainer']
    });

    const res = createRes();
    await app.routes['POST /admin/shops/:shopId/settings'](createReq({
      headers: { authorization: 'Bearer secret' },
      params: { shopId: 'adult-shop' },
      body: {
        bot_mode: 'disabled',
        handoff_enabled: ['false'],
        handoff_message: '',
        menu_intro_text: '',
        fallback_text: '',
        productCodeLookupEnabled: ['false', 'true'],
        menuSendingEnabled: ['false'],
        postProductHandoffEnabled: ['false', 'true'],
        fallbackEnabled: ['false', 'true'],
        leadCaptureEnabled: ['false']
      }
    }), res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin/shops/adult-shop?productMessage=settings-updated');
    expect(settingsWrites.calls[0].input.body.handoff_enabled).toEqual(['false']);
    expect(settingsWrites.calls[0].input.body.productCodeLookupEnabled).toEqual(['false', 'true']);
    expect(settingsWrites.calls[0].input.body.menuSendingEnabled).toEqual(['false']);
  });

  it('shops API trả schemaReady=false khi thiếu multi-shop schema', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    reader.getShops = async () => ({
      schemaReady: false,
      shops: [],
      message: 'Multi-shop schema is not ready.'
    });
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader,
      adminPrincipalRoles: ['viewer']
    });

    const res = createRes();
    await app.routes['/admin/api/shops'](createReq({
      headers: { authorization: 'Bearer secret' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.schemaReady).toBeFalse();
    expect(body.shops).toEqual([]);
    expect(JSON.stringify(body).includes('relation')).toBeFalse();
    expect(JSON.stringify(body).includes('postgres://')).toBeFalse();
  });

  it('shops routes dùng dashboard read permission và từ chối role không có quyền', async () => {
    const app = createApp();
    const reader = createDashboardReaderStub();
    registerAdminRoutes(app, {
      storage: createStorageStub(),
      adminExportToken: 'secret',
      getClientIp: () => '127.0.0.1',
      dashboardReader: reader,
      adminPrincipalRoles: ['unknown-role']
    });

    const res = createRes();
    await app.routes['/admin/api/shops'](createReq({
      headers: { authorization: 'Bearer secret' }
    }), res);

    expect(res.statusCode).toBe(403);
    expect(reader.calls).toBe(0);
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
    await reader.getShops();
    await reader.getShopDetail('adult-shop');

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

  it('reader shops trả schemaReady=false khi thiếu multi-shop schema', async () => {
    class FakeClient {
      async connect() {}
      async end() {}
      async query() {
        const err = new Error('relation "shops" does not exist at postgres://secret');
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

    const list = await reader.getShops();
    const detail = await reader.getShopDetail('adult-shop');

    expect(list.schemaReady).toBeFalse();
    expect(list.shops).toEqual([]);
    expect(detail.schemaReady).toBeFalse();
    expect(detail.products).toEqual([]);
    expect(JSON.stringify(list).includes('postgres://secret')).toBeFalse();
    expect(JSON.stringify(detail).includes('relation')).toBeFalse();
  });

  it('reader shops dùng SELECT read-only và parameterized detail lookup', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM shops') && sql.includes('WHERE id = $1 OR slug = $1')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop', name: 'Adult Shop', status: 'active' }] };
        }
        if (sql.includes('asset_type') && sql.includes('COUNT(*)')) {
          return { rows: [{ asset_type: 'product_image', total: 1, active: 1 }] };
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

    await reader.getShops();
    await reader.getShopDetail('adult-shop');

    const detailLookup = queries.find(item => item.sql.includes('WHERE id = $1 OR slug = $1'));
    expect(Boolean(detailLookup)).toBeTrue();
    expect(detailLookup.params).toEqual(['adult-shop']);
    for (const { sql } of queries) {
      expect(sql.trim()).toMatch(/^SELECT/i);
      if (/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|MERGE|COPY|GRANT|REVOKE|CALL|DO|VACUUM|ANALYZE)\b/i.test(sql)) {
        throw new Error(`unexpected write SQL: ${sql}`);
      }
    }
  });

  it('product write service rejects cross-shop update before issuing UPDATE', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        const normalized = String(sql || '').trim();
        queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized.includes('FROM shops')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop' }] };
        }
        if (normalized.includes('FROM shop_products') && normalized.includes('WHERE shop_id = $1 AND id = $2')) {
          expect(params).toEqual(['adult-shop', 'prod-other']);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${normalized}`);
      }
    }
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    let err = null;
    try {
      await service.updateProduct({
        principal: {
          id: 'admin-1',
          roles: ['maintainer'],
          tenantId: 'default',
          pageId: 'page',
          authMethod: 'static_bearer'
        },
        shopId: 'adult-shop',
        productId: 'prod-other',
        body: { name: 'Should Not Write' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('product_not_found');
    expect(queries.some(item => /^UPDATE shop_products/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^DELETE\b/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('product write service rejects duplicate code within same shop', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        const normalized = String(sql || '').trim();
        queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized.includes('FROM shops')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop' }] };
        }
        if (normalized.includes('SELECT id, shop_id, code')) {
          return {
            rows: [{
              id: 'prod-1',
              shop_id: 'adult-shop',
              code: 'DB1',
              name: 'DB Product',
              description: '',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('AND lower(code) = lower($2)')) {
          expect(params).toEqual(['adult-shop', 'DB2', 'prod-1']);
          return { rows: [{ id: 'prod-2' }] };
        }
        throw new Error(`unexpected query: ${normalized}`);
      }
    }
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    let err = null;
    try {
      await service.updateProduct({
        principal: {
          id: 'admin-1',
          roles: ['maintainer'],
          tenantId: 'default',
          pageId: 'page',
          authMethod: 'static_bearer'
        },
        shopId: 'adult-shop',
        productId: 'prod-1',
        body: { code: ' DB2 ', name: 'Updated Product' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('duplicate_product_code');
    expect(queries.some(item => /^UPDATE shop_products/i.test(item.sql))).toBeFalse();
  });

  it('product write service uses parameterized shop-scoped UPDATE and fails closed when audit insert fails', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        const normalized = String(sql || '').trim();
        queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized === 'COMMIT') return { rows: [], command: 'COMMIT' };
        if (normalized.includes('FROM shops')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop' }] };
        }
        if (normalized.includes('SELECT id, shop_id, code')) {
          return {
            rows: [{
              id: 'prod-1',
              shop_id: 'adult-shop',
              code: 'DB1',
              name: 'DB Product',
              description: 'old',
              status: 'active',
              sort_order: 1,
              metadata_json: { priceText: '150k' }
            }]
          };
        }
        if (normalized.includes('AND lower(code) = lower($2)')) {
          return { rows: [] };
        }
        if (/^UPDATE shop_products/i.test(normalized)) {
          expect(normalized).toContain('WHERE shop_id = $1 AND id = $2');
          expect(params.slice(0, 2)).toEqual(['adult-shop', 'prod-1']);
          return {
            rows: [{
              id: 'prod-1',
              shop_id: 'adult-shop',
              code: params[2],
              name: params[3],
              description: params[4],
              status: params[5],
              sort_order: params[6],
              metadata_json: JSON.parse(params[7]),
              updated_at: '2026-05-12T05:00:00.000Z'
            }]
          };
        }
        if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
          const err = new Error('relation "admin_audit_log" does not exist at postgres://secret');
          err.code = '42P01';
          throw err;
        }
        throw new Error(`unexpected query: ${normalized}`);
      }
    }
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    let err = null;
    try {
      await service.updateProduct({
        principal: {
          id: 'admin-1',
          roles: ['maintainer'],
          tenantId: 'default',
          pageId: 'page',
          authMethod: 'static_bearer'
        },
        shopId: 'adult-shop',
        productId: 'prod-1',
        body: {
          code: ' DB1 ',
          name: ' Updated Product ',
          price_text: ' 180k ',
          description: ' new description ',
          sort_order: '3'
        }
      });
    } catch (caught) {
      err = caught;
    }

    const updateQuery = queries.find(item => /^UPDATE shop_products/i.test(item.sql));
    expect(err && err.code).toBe('42P01');
    expect(Boolean(updateQuery)).toBeTrue();
    expect(updateQuery.params[2]).toBe('DB1');
    expect(updateQuery.params[3]).toBe('Updated Product');
    expect(queries.some(item => /^DELETE\b/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
  });

  it('shop settings write service validates bot mode before UPDATE', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        const normalized = String(sql || '').trim();
        queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized.includes('FROM shops')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop' }] };
        }
        if (normalized.includes('FROM shop_settings')) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: 'handoff',
              menu_intro_text: 'menu',
              fallback_text: 'fallback',
              settings_json: {}
            }]
          };
        }
        throw new Error(`unexpected query: ${normalized}`);
      }
    }
    const service = createPostgresShopSettingsWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    let err = null;
    try {
      await service.updateSettings({
        principal: {
          id: 'admin-1',
          roles: ['maintainer'],
          tenantId: 'default',
          pageId: 'page',
          authMethod: 'static_bearer'
        },
        shopId: 'adult-shop',
        body: { bot_mode: 'invalid_mode' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('invalid_bot_mode');
    expect(queries.some(item => /^UPDATE shop_settings/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_settings/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('shop settings input normalizes invalid or missing rule toggles to defaults', () => {
    const input = normalizeSettingsInput({
      bot_mode: 'menu_code_handoff',
      handoff_enabled: true,
      settings_json: {
        ruleToggles: {
          productCodeLookupEnabled: 'invalid',
          menuSendingEnabled: 'wat',
          postProductHandoffEnabled: '',
          fallbackEnabled: 'off',
          leadCaptureEnabled: 'enabled',
          unknownToggle: true
        }
      }
    }, {
      bot_mode: 'menu_code_handoff'
    });

    expect(input.settings_json.ruleToggles).toEqual({
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      fallbackEnabled: false,
      leadCaptureEnabled: true
    });
  });

  it('shop settings write service updates settings, writes audit, and commits atomically', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        const normalized = String(sql || '').trim();
        queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN') return { rows: [] };
        if (normalized === 'COMMIT') return { rows: [], command: 'COMMIT' };
        if (normalized === 'ROLLBACK') return { rows: [] };
        if (normalized.includes('FROM shops')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop' }] };
        }
        if (normalized.includes('FROM shop_settings')) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: 'old',
              menu_intro_text: 'old menu',
              fallback_text: 'old fallback',
              settings_json: {
                shopName: 'Adult Shop',
                minAge: 18,
                botMode: { productCodeLookupEnabled: true },
                followUp: { enabled: true },
                policies: { privacy: 'masked' },
                recommendations: { budget: ['DB1'] },
                hotCarouselProductCodes: ['DB1'],
                intents: { disabled: ['X'] },
                templates: { systemBusy: 'busy' },
                ruleToggles: {
                  productCodeLookupEnabled: true,
                  menuSendingEnabled: true,
                  postProductHandoffEnabled: true,
                  fallbackEnabled: true,
                  leadCaptureEnabled: false,
                  unknownToggle: true
                }
              }
            }]
          };
        }
        if (/^INSERT INTO shop_settings/i.test(normalized)) {
          expect(normalized).toContain('ON CONFLICT (shop_id) DO UPDATE');
          expect(normalized).toContain('settings_json = EXCLUDED.settings_json');
          expect(params.slice(0, 6)).toEqual([
            'adult-shop',
            'menu_only',
            false,
            'Staff will reply',
            'Menu intro',
            'Fallback'
          ]);
          const mergedSettingsJson = JSON.parse(params[6]);
          expect(mergedSettingsJson.shopName).toBe('Adult Shop');
          expect(mergedSettingsJson.minAge).toBe(18);
          expect(mergedSettingsJson.botMode.productCodeLookupEnabled).toBe(true);
          expect(mergedSettingsJson.followUp.enabled).toBe(true);
          expect(mergedSettingsJson.policies.privacy).toBe('masked');
          expect(mergedSettingsJson.recommendations.budget).toEqual(['DB1']);
          expect(mergedSettingsJson.hotCarouselProductCodes).toEqual(['DB1']);
          expect(mergedSettingsJson.intents.disabled).toEqual(['X']);
          expect(mergedSettingsJson.templates.systemBusy).toBe('busy');
          expect(mergedSettingsJson.ruleToggles).toEqual({
            productCodeLookupEnabled: false,
            menuSendingEnabled: true,
            postProductHandoffEnabled: true,
            fallbackEnabled: true,
            leadCaptureEnabled: true
          });
          return {
            rows: [{
              shop_id: params[0],
              bot_mode: params[1],
              handoff_enabled: params[2],
              handoff_message: params[3],
              menu_intro_text: params[4],
              fallback_text: params[5],
              settings_json: JSON.parse(params[6]),
              updated_at: '2026-05-12T06:00:00.000Z'
            }]
          };
        }
        if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
          const metadata = JSON.parse(params[12]);
          expect(params[5]).toBe('admin.shop_settings.update');
          expect(params[6]).toBe('shop_settings');
          expect(params[7]).toBe('adult-shop');
          expect(metadata.shop_id).toBe('adult-shop');
          expect(metadata.bot_mode).toBe('menu_only');
          expect(metadata.handoff_message).toBe(undefined);
          expect(metadata.rule_toggles).toEqual({
            productCodeLookupEnabled: false,
            menuSendingEnabled: true,
            postProductHandoffEnabled: true,
            fallbackEnabled: true,
            leadCaptureEnabled: true
          });
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${normalized}`);
      }
    }
    const service = createPostgresShopSettingsWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    const result = await service.updateSettings({
      principal: {
        id: 'admin-1',
        roles: ['maintainer'],
        tenantId: 'default',
        pageId: 'page',
        authMethod: 'static_bearer'
      },
      shopId: 'adult-shop',
      body: {
        bot_mode: ' menu_only ',
        handoff_enabled: 'false',
        handoff_message: ' Staff will reply ',
        menu_intro_text: ' Menu intro ',
        fallback_text: ' Fallback ',
        productCodeLookupEnabled: 'false',
        leadCaptureEnabled: 'true',
        unknownToggle: 'true'
      }
    });

    expect(result.settings.bot_mode).toBe('menu_only');
    expect(result.settings.handoff_enabled).toBeFalse();
    expect(result.settings.handoff_message).toBe('Staff will reply');
    expect(result.settings.settings_json.ruleToggles.productCodeLookupEnabled).toBeFalse();
    expect(result.settings.settings_json.ruleToggles.leadCaptureEnabled).toBeTrue();
    expect(result.settings.settings_json.ruleToggles.unknownToggle).toBe(undefined);
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
  });

  it('shop settings write service fails closed when audit insert fails', async () => {
    const queries = [];
    class FakeClient {
      async connect() {}
      async end() {}
      async query(sql, params = []) {
        const normalized = String(sql || '').trim();
        queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized === 'COMMIT') return { rows: [], command: 'COMMIT' };
        if (normalized.includes('FROM shops')) {
          return { rows: [{ id: 'adult-shop', slug: 'adult-shop' }] };
        }
        if (normalized.includes('FROM shop_settings')) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: 'old',
              menu_intro_text: 'old menu',
              fallback_text: 'old fallback',
              settings_json: {}
            }]
          };
        }
        if (/^INSERT INTO shop_settings/i.test(normalized)) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              bot_mode: params[1],
              handoff_enabled: params[2],
              handoff_message: params[3],
              menu_intro_text: params[4],
              fallback_text: params[5],
              settings_json: {},
              updated_at: '2026-05-12T06:00:00.000Z'
            }]
          };
        }
        if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
          const err = new Error('relation "admin_audit_log" does not exist at postgres://secret');
          err.code = '42P01';
          throw err;
        }
        throw new Error(`unexpected query: ${normalized}`);
      }
    }
    const service = createPostgresShopSettingsWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    let err = null;
    try {
      await service.updateSettings({
        principal: {
          id: 'admin-1',
          roles: ['maintainer'],
          tenantId: 'default',
          pageId: 'page',
          authMethod: 'static_bearer'
        },
        shopId: 'adult-shop',
        body: { bot_mode: 'disabled' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('42P01');
    expect(queries.some(item => /^INSERT INTO shop_settings/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
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

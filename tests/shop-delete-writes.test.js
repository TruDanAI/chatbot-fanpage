const { describe, it, expect } = require('./harness');
const {
  createPostgresShopDeleteService,
  isProtectedSlug
} = require('../core/admin/shop-delete-writes');

function createPrincipal(permissions = ['admin.product.write']) {
  return {
    id: 'admin-1',
    roles: permissions.includes('admin.product.write') ? ['maintainer'] : [],
    permissions: permissions,
    tenantId: 'default',
    pageId: 'page-safe',
    authMethod: 'test'
  };
}

function createFakeClientClass({
  shop = {},
  pageCount = 0,
  credentialCount = 0,
  ordersCount = 0,
  messagesCount = 0,
  conversationsCount = 0,
  eventsCount = 0,
  queueCount = 0,
  profilesCount = 0,
  midsCount = 0,
  queries = [],
  auditEntries = []
} = {}) {
  const state = {
    shop: shop === null ? null : {
      id: 'draft-shop',
      slug: 'draft-shop',
      name: 'Draft Shop',
      status: 'active',
      package: 'basic',
      lifecycle: 'draft',
      live_enabled: false,
      dry_run: true,
      ...shop
    }
  };

  return class FakeClient {
    async connect() {
      queries.push({ sql: 'CONNECT', params: [] });
    }

    async end() {
      queries.push({ sql: 'END', params: [] });
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
      const lowerSql = normalized.toLowerCase();
      queries.push({ sql: normalized, params });

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { command: normalized, rows: [] };
      }

      if (lowerSql.includes('from shops') && (lowerSql.includes('where id = $1') || lowerSql.includes('slug = $1'))) {
        return { rows: state.shop ? [state.shop] : [] };
      }

      if (lowerSql.includes('from shop_pages') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: pageCount }] };
      }

      if (lowerSql.includes('from shop_page_credentials') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: credentialCount }] };
      }

      if (lowerSql.includes('from orders') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: ordersCount }] };
      }

      if (lowerSql.includes('from messages') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: messagesCount }] };
      }

      if (lowerSql.includes('from conversations') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: conversationsCount }] };
      }

      if (lowerSql.includes('from events') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: eventsCount }] };
      }

      if (lowerSql.includes('from webhook_queue') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: queueCount }] };
      }

      if (lowerSql.includes('from profiles') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: profilesCount }] };
      }

      if (lowerSql.includes('from processed_mids') && lowerSql.includes('count(*)')) {
        return { rows: [{ count: midsCount }] };
      }

      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        auditEntries.push({
          action: params[5],
          resource_type: params[6],
          resource_id: params[7],
          outcome: params[8],
          metadata: JSON.parse(params[12])
        });
        return { rows: [] };
      }

      return { rows: [] };
    }
  };
}

function createService(options = {}) {
  return createPostgresShopDeleteService({
    databaseUrl: 'postgres://test-url',
    Client: createFakeClientClass(options),
    env: options.env || { RAILWAY_ENVIRONMENT: 'staging' }
  });
}

async function runDelete(options = {}, body = { confirmation_text: 'DELETE DRAFT', shop_slug: 'draft-shop' }, shopId = 'draft-shop', permissions = ['admin.product.write']) {
  const service = createService(options);
  return service.deleteDraftShop({
    principal: createPrincipal(permissions),
    shopId,
    body,
    requestContext: {
      requestId: 'req-delete-1',
      ip: '127.0.0.1',
      userAgent: 'test-agent'
    }
  });
}

describe('shop delete writes service', () => {
  it('successfully deletes an eligible draft shop', async () => {
    const queries = [];
    const auditEntries = [];
    const result = await runDelete({ queries, auditEntries });

    expect(result.success).toBeTrue();
    expect(result.shopId).toBe('draft-shop');
    expect(result.slug).toBe('draft-shop');

    // Confirm transactional flow
    const begin = queries.find(q => q.sql === 'BEGIN');
    const commit = queries.find(q => q.sql === 'COMMIT');
    expect(Boolean(begin)).toBeTrue();
    expect(Boolean(commit)).toBeTrue();

    // Confirm safe cascading deletes in order
    const deletes = queries.filter(q => q.sql.startsWith('DELETE FROM')).map(q => q.sql);
    expect(deletes).toEqual([
      'DELETE FROM shop_page_credentials WHERE shop_id = $1',
      'DELETE FROM shop_pages WHERE shop_id = $1',
      'DELETE FROM shop_assets WHERE shop_id = $1',
      'DELETE FROM shop_products WHERE shop_id = $1',
      'DELETE FROM shop_settings WHERE shop_id = $1',
      'DELETE FROM shops WHERE id = $1'
    ]);

    // Confirm audit log
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].action).toBe('admin.shop.delete');
    expect(auditEntries[0].metadata.shop_id).toBe('draft-shop');
  });

  it('blocks deletion on production runtime', async () => {
    let error;
    try {
      await runDelete({ env: { RAILWAY_ENVIRONMENT: 'production' } });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('staging_only');
    expect(error.statusCode).toBe(403);
  });

  it('requires write permission', async () => {
    let error;
    try {
      await runDelete({}, { confirmation_text: 'DELETE DRAFT', shop_slug: 'draft-shop' }, 'draft-shop', []);
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('permission_denied');
    expect(error.statusCode).toBe(403);
  });

  it('requires confirmation text', async () => {
    let error;
    try {
      await runDelete({}, { confirmation_text: 'WRONG TEXT', shop_slug: 'draft-shop' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('confirmation_required');
    expect(error.statusCode).toBe(400);
  });

  it('requires exact shop slug match', async () => {
    let error;
    try {
      await runDelete({}, { confirmation_text: 'DELETE DRAFT', shop_slug: 'wrong-slug' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('slug_mismatch');
    expect(error.statusCode).toBe(400);
  });

  it('blocks protected slugs: adult-shop, demo-shop, nem-bui-xa', async () => {
    for (const slug of ['adult-shop', 'demo-shop', 'nem-bui-xa']) {
      let error;
      try {
        await runDelete({ shop: { id: slug, slug } }, { confirmation_text: 'DELETE DRAFT', shop_slug: slug }, slug);
      } catch (err) {
        error = err;
      }
      expect(error).toBeTruthy();
      expect(error.code).toBe('shop_deletion_blocked');
      expect(error.statusCode).toBe(409);
      expect(error.details.reasons[0].includes('danh sách bảo vệ')).toBeTrue();
    }
  });

  it('blocks slugs containing prod or production', async () => {
    for (const slug of ['my-prod-shop', 'production-shop']) {
      let error;
      try {
        await runDelete({ shop: { id: slug, slug } }, { confirmation_text: 'DELETE DRAFT', shop_slug: slug }, slug);
      } catch (err) {
        error = err;
      }
      expect(error).toBeTruthy();
      expect(error.code).toBe('shop_deletion_blocked');
      expect(error.details.reasons[0].includes('danh sách bảo vệ')).toBeTrue();
    }
  });

  it('blocks non-draft / non-configuring lifecycles', async () => {
    for (const lifecycle of ['ready', 'live', 'paused', 'archived']) {
      let error;
      try {
        await runDelete({ shop: { lifecycle } });
      } catch (err) {
        error = err;
      }
      expect(error).toBeTruthy();
      expect(error.code).toBe('shop_deletion_blocked');
      expect(error.details.reasons.some(r => r.includes('trạng thái thiết lập'))).toBeTrue();
    }
  });

  it('blocks when live_enabled is true', async () => {
    let error;
    try {
      await runDelete({ shop: { live_enabled: true } });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('shop_deletion_blocked');
    expect(error.details.reasons.some(r => r.includes('hoạt động'))).toBeTrue();
  });

  it('blocks when dry_run is false', async () => {
    let error;
    try {
      await runDelete({ shop: { dry_run: false } });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('shop_deletion_blocked');
    expect(error.details.reasons.some(r => r.includes('dry_run'))).toBeTrue();
  });

  it('blocks when page mappings exist', async () => {
    let error;
    try {
      await runDelete({ pageCount: 1 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('shop_deletion_blocked');
    expect(error.details.reasons.some(r => r.includes('gỡ liên kết trang'))).toBeTrue();
  });

  it('blocks when page credentials exist', async () => {
    let error;
    try {
      await runDelete({ credentialCount: 1 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('shop_deletion_blocked');
    expect(error.details.reasons.some(r => r.includes('Page Token'))).toBeTrue();
  });

  it('blocks when runtime customer data exists: orders, messages, conversations, events, queue, profiles', async () => {
    const checks = [
      { options: { ordersCount: 1 }, text: 'đơn hàng' },
      { options: { messagesCount: 1 }, text: 'tin nhắn' },
      { options: { conversationsCount: 1 }, text: 'hội thoại' },
      { options: { eventsCount: 1 }, text: 'sự kiện' },
      { options: { queueCount: 1 }, text: 'tiến trình hoạt động' },
      { options: { profilesCount: 1 }, text: 'hồ sơ khách hàng' },
      { options: { midsCount: 1 }, text: 'processed_mids' }
    ];

    for (const check of checks) {
      let error;
      try {
        await runDelete(check.options);
      } catch (err) {
        error = err;
      }
      expect(error).toBeTruthy();
      expect(error.code).toBe('shop_deletion_blocked');
      expect(error.details.reasons.some(r => r.includes(check.text))).toBeTrue();
    }
  });

  it('confirms rollback on check failures (no partial delete)', async () => {
    const queries = [];
    let error;
    try {
      await runDelete({ pageCount: 1, queries });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    expect(queries.find(q => q.sql === 'BEGIN')).toBeTruthy();
    expect(queries.find(q => q.sql === 'ROLLBACK')).toBeTruthy();
    expect(queries.find(q => q.sql === 'COMMIT')).toBe(undefined);
    expect(queries.some(q => q.sql.startsWith('DELETE FROM'))).toBeFalse();
  });
});

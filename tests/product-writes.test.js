const { describe, it, expect } = require('./harness');
const { createDashboardRepository } = require('../core/admin/dashboard-repository');
const { createPostgresProductWriteService } = require('../core/admin/product-writes');

const principal = Object.freeze({
  id: 'maintainer-1',
  roles: ['maintainer'],
  tenantId: 'default',
  pageId: 'page',
  authMethod: 'static_bearer'
});

function cloneRows(rows = []) {
  return rows.map(row => ({
    ...row,
    metadata_json: { ...(row.metadata_json || {}) }
  }));
}

function createState() {
  return {
    shops: [{
      id: 'adult-shop',
      slug: 'adult-shop',
      name: 'Adult Shop',
      status: 'active',
      default_locale: 'vi-VN',
      timezone: 'Asia/Bangkok',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    products: [{
      id: 'prod-1',
      shop_id: 'adult-shop',
      code: 'DB1',
      name: 'Existing Product',
      description: 'seed',
      price: null,
      currency: '',
      status: 'active',
      sort_order: 1,
      metadata_json: { priceText: '150k' },
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    audits: []
  };
}

function makeClientClass({
  state,
  queries,
  insertReturnsRow = true,
  commitCommand = 'COMMIT',
  failAuditCode = ''
} = {}) {
  return class FakeClient {
    constructor() {
      this.inTransaction = false;
      this.txProducts = null;
    }

    async connect() {
      queries.push({ sql: 'CONNECT', params: [] });
    }

    async end() {
      queries.push({ sql: 'END', params: [] });
    }

    get products() {
      return this.inTransaction ? this.txProducts : state.products;
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').trim().replace(/\s+/g, ' ');
      queries.push({ sql: normalized, params });

      if (normalized === 'BEGIN') {
        this.inTransaction = true;
        this.txProducts = cloneRows(state.products);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') {
          state.products = cloneRows(this.txProducts);
        }
        this.inTransaction = false;
        this.txProducts = null;
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.inTransaction = false;
        this.txProducts = null;
        return { rows: [] };
      }

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: state.shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_pages')) return { rows: [] };
      if (normalized.includes('FROM shop_settings')) return { rows: [] };
      if (normalized.includes('FROM shop_assets')) return { rows: [] };
      if (normalized.includes('FROM shop_page_credentials')) {
        return { rows: [{ active_fb_page_token_count: 0 }] };
      }

      if (normalized.includes('FROM shop_products') && normalized.includes('WHERE shop_id = $1 AND id = $2')) {
        const [shopId, productId] = params;
        return { rows: this.products.filter(row => row.shop_id === shopId && row.id === productId).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_products') && normalized.includes('AND lower(code) = lower($2)')) {
        const [shopId, code, excludeProductId = ''] = params;
        return {
          rows: this.products
            .filter(row => row.shop_id === shopId)
            .filter(row => row.code.toLowerCase() === String(code || '').toLowerCase())
            .filter(row => !excludeProductId || row.id !== excludeProductId)
            .sort((a, b) => {
              const aArchived = a.status === 'archived' ? 1 : 0;
              const bArchived = b.status === 'archived' ? 1 : 0;
              if (aArchived !== bArchived) return aArchived - bArchived;
              return String(a.id).localeCompare(String(b.id));
            })
            .map(row => ({ id: row.id, status: row.status }))
            .slice(0, 1)
        };
      }
      if (/^INSERT INTO shop_products/i.test(normalized)) {
        if (!insertReturnsRow) return { rows: [] };
        const row = {
          id: params[0],
          shop_id: params[1],
          code: params[2],
          name: params[3],
          description: params[4],
          price: null,
          currency: '',
          status: params[5],
          sort_order: params[6],
          metadata_json: JSON.parse(params[7]),
          updated_at: '2026-05-12T01:00:00.000Z'
        };
        this.txProducts.push(row);
        return { rows: [row] };
      }
      if (/^UPDATE shop_products SET code =/i.test(normalized)) {
        const [shopId, productId, code, name, description, status, sortOrder, metadataText] = params;
        const row = this.txProducts.find(item => item.shop_id === shopId && item.id === productId);
        if (!row) return { rows: [] };
        Object.assign(row, {
          code,
          name,
          description,
          status,
          sort_order: sortOrder,
          metadata_json: JSON.parse(metadataText),
          updated_at: '2026-05-12T02:00:00.000Z'
        });
        return { rows: [row] };
      }
      if (/^UPDATE shop_products SET status = 'archived'/i.test(normalized)) {
        const [shopId, productId] = params;
        const row = this.txProducts.find(item => item.shop_id === shopId && item.id === productId);
        if (!row) return { rows: [] };
        row.status = 'archived';
        row.updated_at = '2026-05-12T03:00:00.000Z';
        return { rows: [row] };
      }
      if (/^UPDATE shop_products SET status = 'hidden'/i.test(normalized)) {
        const [shopId, productId] = params;
        const row = this.txProducts.find(item => item.shop_id === shopId && item.id === productId);
        if (!row || row.status !== 'archived') return { rows: [] };
        row.status = 'hidden';
        row.updated_at = '2026-05-12T03:30:00.000Z';
        return { rows: [row] };
      }
      if (normalized.includes('FROM shop_products') && normalized.includes('WHERE shop_id = $1')) {
        const [shopId] = params;
        return { rows: this.products.filter(row => row.shop_id === shopId) };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAuditCode) {
          const err = new Error(`raw PostgreSQL ${failAuditCode} relation "admin_audit_log" at postgres://secret`);
          err.code = failAuditCode;
          throw err;
        }
        state.audits.push({ params });
        return { rows: [] };
      }

      throw new Error(`unexpected query: ${normalized}`);
    }
  };
}

async function getDetail(state) {
  const repository = createDashboardRepository();
  const Client = makeClientClass({ state, queries: [] });
  return repository.getShopDetail(new Client(), 'adult-shop');
}

describe('product write persistence', () => {
  it('create product then read same product from dashboard repository', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    const created = await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'ZB-SMOKE-CREATE', name: 'Smoke Create', price_text: '180k' }
    });
    const detail = await getDetail(state);

    expect(detail.products.some(product => product.id === created.product.id)).toBeTrue();
    expect(detail.products.find(product => product.id === created.product.id).code).toBe('ZB-SMOKE-CREATE');
  });

  it('create product increases repository list count after commit', async () => {
    const state = createState();
    const before = await getDetail(state);
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'ZB-SMOKE-COUNT', name: 'Smoke Count' }
    });
    const after = await getDetail(state);

    expect(after.products.length).toBe(before.products.length + 1);
  });

  it('create then patch same product works', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    const created = await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'ZB-SMOKE-PATCH', name: 'Smoke Patch' }
    });
    const patched = await service.updateProduct({
      principal,
      shopId: 'adult-shop',
      productId: created.product.id,
      body: { name: 'Smoke Patched', status: 'hidden' }
    });

    expect(patched.product.name).toBe('Smoke Patched');
    expect(patched.product.status).toBe('hidden');
  });

  it('create then archive same product works', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    const created = await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'ZB-SMOKE-ARCHIVE', name: 'Smoke Archive' }
    });
    const archived = await service.archiveProduct({
      principal,
      shopId: 'adult-shop',
      productId: created.product.id
    });

    expect(archived.product.status).toBe('archived');
  });

  it('editing the same product with the same code is allowed', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    const patched = await service.updateProduct({
      principal,
      shopId: 'adult-shop',
      productId: 'prod-1',
      body: { code: 'DB1', name: 'Renamed Same Code' }
    });

    expect(patched.product.code).toBe('DB1');
    expect(patched.product.name).toBe('Renamed Same Code');
  });

  it('rejects creating a product whose code already exists on an active product', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    let err = null;
    try {
      await service.createProduct({
        principal,
        shopId: 'adult-shop',
        body: { code: ' db1 ', name: 'Duplicate Active Code' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('duplicate_product_code');
    expect(err && err.message).toBe('Mã sản phẩm này đã tồn tại trong shop, kể cả sản phẩm đã lưu trữ. Hãy dùng mã khác hoặc khôi phục sản phẩm cũ.');
    expect(state.products.length).toBe(1);
  });

  it('rejects creating a product whose code already exists on a hidden product', async () => {
    const state = createState();
    state.products[0].status = 'hidden';
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    let err = null;
    try {
      await service.createProduct({
        principal,
        shopId: 'adult-shop',
        body: { code: 'DB1', name: 'Duplicate Hidden Code' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('duplicate_product_code');
    expect(err && err.message).toBe('Mã sản phẩm này đã tồn tại trong shop, kể cả sản phẩm đã lưu trữ. Hãy dùng mã khác hoặc khôi phục sản phẩm cũ.');
    expect(state.products.filter(product => product.code === 'DB1').length).toBe(1);
  });

  it('rejects creating a product whose code is reserved by an archived product', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    const created = await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'ARCHV1', name: 'To Be Archived' }
    });
    await service.archiveProduct({
      principal,
      shopId: 'adult-shop',
      productId: created.product.id
    });

    let err = null;
    try {
      await service.createProduct({
        principal,
        shopId: 'adult-shop',
        body: { code: 'archv1', name: 'Reuse Archived Code' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('duplicate_product_code');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Mã sản phẩm này đã tồn tại trong shop, kể cả sản phẩm đã lưu trữ. Hãy dùng mã khác hoặc khôi phục sản phẩm cũ.');
    expect(state.products.filter(product => product.code.toLowerCase() === 'archv1').length).toBe(1);
  });

  it('blocks renaming an active product onto an archived product code', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    const created = await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'TOARCH', name: 'Soon Archived' }
    });
    await service.archiveProduct({
      principal,
      shopId: 'adult-shop',
      productId: created.product.id
    });

    let err = null;
    try {
      await service.updateProduct({
        principal,
        shopId: 'adult-shop',
        productId: 'prod-1',
        body: { code: 'TOARCH' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('duplicate_product_code');
    expect(state.products.find(product => product.id === 'prod-1').code).toBe('DB1');
  });

  it('restores an archived product to hidden, never active', async () => {
    const state = createState();
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] })
    });

    const created = await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'RESTORE1', name: 'Restore Target' }
    });
    await service.archiveProduct({
      principal,
      shopId: 'adult-shop',
      productId: created.product.id
    });

    const restored = await service.restoreProduct({
      principal,
      shopId: 'adult-shop',
      productId: created.product.id
    });

    expect(restored.product.status).toBe('hidden');
    expect(restored.product.enabled).toBeFalse();
    expect(state.products.find(product => product.id === created.product.id).status).toBe('hidden');
  });

  it('commits create transaction and does not persist on rollback path', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    await service.createProduct({
      principal,
      shopId: 'adult-shop',
      body: { code: 'ZB-SMOKE-COMMIT', name: 'Smoke Commit' }
    });

    expect(queries.some(item => item.sql === 'BEGIN')).toBeTrue();
    expect(queries.some(item => /^INSERT INTO shop_products/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
    expect(state.products.some(product => product.code === 'ZB-SMOKE-COMMIT')).toBeTrue();
  });

  it('does not return fake create success when insert returns no persisted row', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, insertReturnsRow: false })
    });

    let err = null;
    try {
      await service.createProduct({
        principal,
        shopId: 'adult-shop',
        body: { code: 'ZB-SMOKE-FAKE', name: 'Smoke Fake' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('product_persist_failed');
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
    expect(state.products.some(product => product.code === 'ZB-SMOKE-FAKE')).toBeFalse();
  });

  it('does not return success when COMMIT reports ROLLBACK', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, commitCommand: 'ROLLBACK' })
    });

    let err = null;
    try {
      await service.createProduct({
        principal,
        shopId: 'adult-shop',
        body: { code: 'ZB-SMOKE-ROLLBACK', name: 'Smoke Rollback' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('product_commit_failed');
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(state.products.some(product => product.code === 'ZB-SMOKE-ROLLBACK')).toBeFalse();
  });

  it('fails safe and rolls back when audit schema is missing', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresProductWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, failAuditCode: '42P01' })
    });

    let err = null;
    try {
      await service.createProduct({
        principal,
        shopId: 'adult-shop',
        body: { code: 'ZB-SMOKE-AUDIT', name: 'Smoke Audit' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('42P01');
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
    expect(state.products.some(product => product.code === 'ZB-SMOKE-AUDIT')).toBeFalse();
  });
});

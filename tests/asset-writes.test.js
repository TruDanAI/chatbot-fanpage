const { describe, it, expect } = require('./harness');
const { resolveShopConfigForPage } = require('../core/shops/db-shop-config');
const { createPostgresAssetWriteService } = require('../core/admin/asset-writes');

const principal = Object.freeze({
  id: 'maintainer-1',
  roles: ['maintainer'],
  tenantId: 'default',
  pageId: 'page',
  authMethod: 'static_bearer'
});

function cloneRows(rows = []) {
  return rows.map(row => ({ ...row }));
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
    }, {
      id: 'other-shop',
      slug: 'other-shop',
      name: 'Other Shop',
      status: 'active',
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    products: [{
      id: 'prod-1',
      shop_id: 'adult-shop',
      code: 'DB1',
      name: 'DB Product',
      description: '',
      price: null,
      currency: '',
      status: 'active',
      sort_order: 1,
      metadata_json: {}
    }, {
      id: 'prod-other',
      shop_id: 'other-shop',
      code: 'OTHER',
      name: 'Other Product',
      description: '',
      price: null,
      currency: '',
      status: 'active',
      sort_order: 1,
      metadata_json: {}
    }],
    assets: [{
      id: 'asset-1',
      shop_id: 'adult-shop',
      product_id: 'prod-1',
      asset_type: 'product_image',
      storage_provider: 'public_url',
      storage_key: '',
      public_url: 'https://cdn.example.test/db1.jpg',
      content_type: 'image/jpeg',
      size_bytes: null,
      status: 'active',
      sort_order: 1,
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    audits: []
  };
}

function makeClientClass({
  state,
  queries,
  commitCommand = 'COMMIT',
  failAuditCode = ''
} = {}) {
  return class FakeClient {
    constructor() {
      this.inTransaction = false;
      this.txAssets = null;
    }

    async connect() {
      queries.push({ sql: 'CONNECT', params: [] });
    }

    async end() {
      queries.push({ sql: 'END', params: [] });
    }

    get assets() {
      return this.inTransaction ? this.txAssets : state.assets;
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').trim().replace(/\s+/g, ' ');
      queries.push({ sql: normalized, params });

      if (normalized === 'BEGIN') {
        this.inTransaction = true;
        this.txAssets = cloneRows(state.assets);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') state.assets = cloneRows(this.txAssets);
        this.inTransaction = false;
        this.txAssets = null;
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.inTransaction = false;
        this.txAssets = null;
        return { rows: [] };
      }

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: state.shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_products') && normalized.includes('WHERE shop_id = $1 AND id = $2')) {
        const [shopId, productId] = params;
        return { rows: state.products.filter(row => row.shop_id === shopId && row.id === productId).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_assets a') && normalized.includes('WHERE a.shop_id = $1 AND a.id = $2')) {
        const [shopId, assetId] = params;
        return {
          rows: this.assets
            .filter(row => row.shop_id === shopId && row.id === assetId)
            .filter(row => ['menu_image', 'product_image'].includes(row.asset_type))
            .map(row => ({
              ...row,
              product_code: state.products.find(product => product.id === row.product_id && product.shop_id === row.shop_id)?.code || ''
            }))
            .slice(0, 1)
        };
      }
      if (/^INSERT INTO shop_assets/i.test(normalized)) {
        const row = {
          id: params[0],
          shop_id: params[1],
          product_id: params[2] || null,
          asset_type: params[3],
          storage_provider: 'public_url',
          storage_key: '',
          public_url: params[4],
          content_type: params[5],
          size_bytes: null,
          status: params[6],
          sort_order: params[7],
          updated_at: '2026-05-12T01:00:00.000Z'
        };
        this.txAssets.push(row);
        return { rows: [row] };
      }
      if (/^UPDATE shop_assets SET product_id/i.test(normalized)) {
        const [shopId, assetId, productId, assetType, publicUrl, contentType, status, sortOrder] = params;
        const row = this.txAssets.find(item => item.shop_id === shopId && item.id === assetId);
        if (!row) return { rows: [] };
        Object.assign(row, {
          product_id: productId || null,
          asset_type: assetType,
          storage_provider: 'public_url',
          storage_key: '',
          public_url: publicUrl,
          content_type: contentType,
          status,
          sort_order: sortOrder,
          updated_at: '2026-05-12T02:00:00.000Z'
        });
        return { rows: [row] };
      }
      if (/^UPDATE shop_assets SET status = 'archived'/i.test(normalized)) {
        const [shopId, assetId] = params;
        const row = this.txAssets.find(item => item.shop_id === shopId && item.id === assetId);
        if (!row) return { rows: [] };
        row.status = 'archived';
        row.storage_provider = 'public_url';
        row.storage_key = '';
        row.updated_at = '2026-05-12T03:00:00.000Z';
        return { rows: [row] };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAuditCode) {
          const err = new Error(`raw PostgreSQL ${failAuditCode} at postgres://secret`);
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

describe('asset write persistence', () => {
  it('creates, updates, toggles, and archives URL-only assets', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresAssetWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    const created = await service.createAsset({
      principal,
      shopId: 'adult-shop',
      body: {
        asset_type: 'product_image',
        product_id: 'prod-1',
        public_url: 'https://cdn.example.test/new.jpg?signature=secret',
        content_type: 'image/jpeg',
        sort_order: '4'
      }
    });
    const menuWithProduct = await service.createAsset({
      principal,
      shopId: 'adult-shop',
      body: {
        asset_type: 'menu_image',
        product_id: 'prod-1',
        public_url: 'https://cdn.example.test/menu-linked.jpg'
      }
    });
    const updated = await service.updateAsset({
      principal,
      shopId: 'adult-shop',
      assetId: created.asset.id,
      body: {
        public_url: 'https://cdn.example.test/newer.jpg',
        status: 'hidden'
      }
    });
    const enabled = await service.setAssetEnabled({
      principal,
      shopId: 'adult-shop',
      assetId: created.asset.id,
      enabled: true
    });
    const archived = await service.archiveAsset({
      principal,
      shopId: 'adult-shop',
      assetId: created.asset.id
    });

    expect(created.asset.storage_provider).toBe('public_url');
    expect(menuWithProduct.asset.product_id).toBe('prod-1');
    expect(updated.asset.public_url).toBe('https://cdn.example.test/newer.jpg');
    expect(enabled.asset.status).toBe('active');
    expect(archived.asset.status).toBe('archived');
    expect(state.assets.find(asset => asset.id === created.asset.id).storage_key).toBe('');
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
  });

  it('rejects invalid public URLs and asset types before opening a transaction', async () => {
    for (const body of [
      { asset_type: 'menu_image', public_url: 'javascript:alert(1)' },
      { asset_type: 'menu_image', public_url: 'file:///tmp/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://localhost/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://10.0.0.4/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://172.16.0.4/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://192.168.1.4/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://169.254.1.4/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://[fd00::1]/a.jpg' },
      { asset_type: 'menu_image', public_url: 'http://[fe80::1]/a.jpg' },
      { asset_type: 'shop_image', public_url: 'https://cdn.example.test/shop.jpg' },
      { asset_type: 'menu_image', status: 'deleted', public_url: 'https://cdn.example.test/menu.jpg' },
      { asset_type: 'menu_image', public_url: `https://cdn.example.test/${'a'.repeat(2100)}.jpg` }
    ]) {
      const state = createState();
      const queries = [];
      const service = createPostgresAssetWriteService({
        databaseUrl: 'postgres://example.test/db',
        Client: makeClientClass({ state, queries })
      });
      let err = null;
      try {
        await service.createAsset({ principal, shopId: 'adult-shop', body });
      } catch (caught) {
        err = caught;
      }

      expect(Boolean(err)).toBeTrue();
      expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
      expect(state.assets.length).toBe(1);
    }
  });

  it('fails closed when commit does not complete', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresAssetWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, commitCommand: 'ROLLBACK' })
    });

    let err = null;
    try {
      await service.createAsset({
        principal,
        shopId: 'adult-shop',
        body: {
          asset_type: 'menu_image',
          public_url: 'https://cdn.example.test/menu.jpg'
        }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('asset_commit_failed');
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(state.assets.length).toBe(1);
  });

  it('rejects product_image without product_id and cross-shop product_id before INSERT', async () => {
    for (const body of [
      { asset_type: 'product_image', public_url: 'https://cdn.example.test/db1.jpg' },
      { asset_type: 'product_image', product_id: 'prod-other', public_url: 'https://cdn.example.test/db1.jpg' },
      { asset_type: 'menu_image', product_id: 'prod-other', public_url: 'https://cdn.example.test/menu.jpg' }
    ]) {
      const state = createState();
      const queries = [];
      const service = createPostgresAssetWriteService({
        databaseUrl: 'postgres://example.test/db',
        Client: makeClientClass({ state, queries })
      });
      let err = null;
      try {
        await service.createAsset({ principal, shopId: 'adult-shop', body });
      } catch (caught) {
        err = caught;
      }

      expect(Boolean(err)).toBeTrue();
      expect(queries.some(item => /^INSERT INTO shop_assets/i.test(item.sql))).toBeFalse();
      if (body.product_id) expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    }
  });

  it('rolls back asset insert when audit insert fails and omits full URL query from audit metadata', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresAssetWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, failAuditCode: '42P01' })
    });

    let err = null;
    try {
      await service.createAsset({
        principal,
        shopId: 'adult-shop',
        body: {
          asset_type: 'menu_image',
          public_url: 'https://cdn.example.test/menu.jpg?token=do-not-audit'
        }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('42P01');
    expect(queries.some(item => /^INSERT INTO shop_assets/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
    expect(state.assets.length).toBe(1);

    const state2 = createState();
    const queries2 = [];
    const service2 = createPostgresAssetWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state: state2, queries: queries2 })
    });
    await service2.createAsset({
      principal,
      shopId: 'adult-shop',
      body: {
        asset_type: 'menu_image',
        public_url: 'https://cdn.example.test/menu.jpg?token=do-not-audit'
      }
    });
    const auditInsert = queries2.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);
    const metadataText = JSON.stringify(metadata);
    expect(metadata.url_has_query).toBeTrue();
    expect(metadataText.includes('do-not-audit')).toBeFalse();
    expect(metadataText.includes('menu.jpg?')).toBeFalse();
  });

  it('denies roles without product write permission before opening a transaction', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresAssetWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    let err = null;
    try {
      await service.createAsset({
        principal: { ...principal, roles: ['viewer'] },
        shopId: 'adult-shop',
        body: { asset_type: 'menu_image', public_url: 'https://cdn.example.test/menu.jpg' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('permission_denied');
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
  });

  it('URL-only active assets remain compatible with runtime grouping', async () => {
    const client = {
      async query(sql, values = []) {
        const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              shop_slug: 'adult-shop',
              shop_name: 'Adult Shop',
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: 'map-1',
              page_id: values[0],
              page_name: 'Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: false,
              handoff_message: '',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: 'prod-1',
              shop_id: 'adult-shop',
              code: 'DB1',
              name: 'DB Product',
              description: '',
              price: 150000,
              currency: '',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) {
          return {
            rows: [{
              id: 'asset-url-only',
              shop_id: 'adult-shop',
              product_id: 'prod-1',
              asset_type: 'product_image',
              storage_provider: 'public_url',
              storage_key: '',
              public_url: 'https://cdn.example.test/db1-url-only.jpg',
              content_type: 'image/jpeg',
              status: 'active',
              sort_order: 1
            }]
          };
        }
        return { rows: [] };
      }
    };

    const result = await resolveShopConfigForPage({
      pageId: 'page_1',
      tenantId: 'tenant_test',
      client
    });

    expect(result.config.__assets.productImagesByCode.DB1[0].url).toBe('https://cdn.example.test/db1-url-only.jpg');
    expect(result.config.__assets.productImagesByCode.DB1[0].storageKey).toBe('');
  });
});

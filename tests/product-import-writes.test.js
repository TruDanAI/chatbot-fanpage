const { describe, it, expect } = require('./harness');
const { presentShopDetailApi } = require('../core/admin/api-presenter');
const {
  createPostgresProductImportService,
  safePreviewProductName
} = require('../core/admin/product-import-writes');

const principal = Object.freeze({
  id: 'maintainer-1',
  roles: ['maintainer'],
  tenantId: 'default',
  pageId: 'page',
  authMethod: 'static_bearer'
});

function cloneProducts(rows = []) {
  return rows.map(row => ({
    ...row,
    metadata_json: { ...(row.metadata_json || {}) }
  }));
}

function cloneAssets(rows = []) {
  return rows.map(row => ({ ...row }));
}

function createState() {
  return {
    shops: [{
      id: 'onboarding-shop',
      slug: 'onboarding-shop',
      name: 'Onboarding Shop',
      status: 'active',
      default_locale: 'vi-VN',
      timezone: 'Asia/Bangkok',
      created_at: '2026-05-17T00:00:00.000Z',
      updated_at: '2026-05-17T00:00:00.000Z'
    }],
    pages: [{
      id: 'page-map-1',
      shop_id: 'onboarding-shop',
      page_id: 'page_1',
      page_name: 'Page',
      status: 'active'
    }],
    settings: [{
      shop_id: 'onboarding-shop',
      bot_mode: 'menu_code_handoff',
      handoff_enabled: true,
      handoff_message: '',
      menu_intro_text: '',
      fallback_text: '',
      settings_json: {},
      updated_at: '2026-05-17T00:00:00.000Z'
    }],
    credentials: [{
      id: 'credential-1',
      shop_id: 'onboarding-shop',
      page_mapping_id: 'page-map-1',
      credential_type: 'fb_page_token',
      status: 'active'
    }],
    products: [{
      id: 'prod-existing',
      shop_id: 'onboarding-shop',
      code: 'M7',
      name: 'Old M7',
      description: 'old',
      price: null,
      currency: '',
      status: 'active',
      sort_order: 7,
      metadata_json: { priceText: 'old', keep: 'yes' },
      updated_at: '2026-05-17T00:00:00.000Z'
    }],
    assets: [{
      id: 'asset-menu',
      shop_id: 'onboarding-shop',
      product_id: null,
      asset_type: 'menu_image',
      storage_provider: 'public_url',
      storage_key: '',
      public_url: 'https://cdn.example.test/menu.jpg',
      content_type: '',
      size_bytes: null,
      status: 'active',
      sort_order: 1,
      updated_at: '2026-05-17T00:00:00.000Z'
    }, {
      id: 'asset-existing-product',
      shop_id: 'onboarding-shop',
      product_id: 'prod-existing',
      asset_type: 'product_image',
      storage_provider: 'public_url',
      storage_key: '',
      public_url: 'https://cdn.example.test/old-m7.jpg',
      content_type: '',
      size_bytes: null,
      status: 'active',
      sort_order: 7,
      updated_at: '2026-05-17T00:00:00.000Z'
    }],
    audits: []
  };
}

function createAssetsSummary(assets = []) {
  const summary = {
    total: 0,
    active: 0,
    product_image: 0,
    product_image_active: 0,
    menu_image: 0,
    menu_image_active: 0
  };
  for (const asset of assets) {
    if (!['menu_image', 'product_image'].includes(asset.asset_type)) continue;
    summary.total += 1;
    if (asset.status === 'active') summary.active += 1;
    summary[asset.asset_type] += 1;
    if (asset.status === 'active') summary[`${asset.asset_type}_active`] += 1;
  }
  return summary;
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
      this.txProducts = null;
      this.txAssets = null;
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

    get assets() {
      return this.inTransaction ? this.txAssets : state.assets;
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').trim().replace(/\s+/g, ' ');
      queries.push({ sql: normalized, params });

      if (normalized === 'BEGIN') {
        this.inTransaction = true;
        this.txProducts = cloneProducts(state.products);
        this.txAssets = cloneAssets(state.assets);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') {
          state.products = cloneProducts(this.txProducts);
          state.assets = cloneAssets(this.txAssets);
        }
        this.inTransaction = false;
        this.txProducts = null;
        this.txAssets = null;
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.inTransaction = false;
        this.txProducts = null;
        this.txAssets = null;
        return { rows: [] };
      }

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const shopId = params[0];
        return { rows: state.shops.filter(shop => shop.id === shopId || shop.slug === shopId).slice(0, 1) };
      }

      if (normalized.includes('FROM shop_products') && normalized.includes('lower(code) = ANY')) {
        const [shopId, codes] = params;
        const wanted = new Set((codes || []).map(code => String(code || '').toLowerCase()));
        return {
          rows: this.products
            .filter(row => row.shop_id === shopId && wanted.has(String(row.code || '').toLowerCase()))
            .map(row => ({ ...row, metadata_json: { ...(row.metadata_json || {}) } }))
        };
      }

      if (/^INSERT INTO shop_products/i.test(normalized)) {
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
          updated_at: '2026-05-17T01:00:00.000Z'
        };
        this.txProducts.push(row);
        return { rows: [row] };
      }

      if (/^UPDATE shop_products SET code =/i.test(normalized)) {
        const [shopId, productId, code, name, description, status, sortOrder, metadataText] = params;
        const row = this.txProducts.find(product => product.shop_id === shopId && product.id === productId);
        if (!row) return { rows: [] };
        Object.assign(row, {
          code,
          name,
          description,
          status,
          sort_order: sortOrder,
          metadata_json: JSON.parse(metadataText),
          updated_at: '2026-05-17T02:00:00.000Z'
        });
        return { rows: [row] };
      }

      if (normalized.includes('FROM shop_assets') && normalized.includes('product_id = ANY')) {
        const [shopId, productIds] = params;
        const wanted = new Set(productIds || []);
        return {
          rows: this.assets
            .filter(row => row.shop_id === shopId && wanted.has(row.product_id) && row.asset_type === 'product_image')
            .map(row => ({ ...row }))
        };
      }

      if (/^INSERT INTO shop_assets/i.test(normalized)) {
        const row = {
          id: params[0],
          shop_id: params[1],
          product_id: params[2] || null,
          asset_type: 'product_image',
          storage_provider: 'public_url',
          storage_key: '',
          public_url: params[3],
          content_type: '',
          size_bytes: null,
          status: params[4],
          sort_order: params[5],
          updated_at: '2026-05-17T03:00:00.000Z'
        };
        this.txAssets.push(row);
        return { rows: [row] };
      }

      if (/^UPDATE shop_assets SET product_id/i.test(normalized)) {
        const [shopId, assetId, productId, publicUrl, status, sortOrder] = params;
        const row = this.txAssets.find(asset => asset.shop_id === shopId && asset.id === assetId);
        if (!row) return { rows: [] };
        Object.assign(row, {
          product_id: productId,
          asset_type: 'product_image',
          storage_provider: 'public_url',
          storage_key: '',
          public_url: publicUrl,
          content_type: '',
          status,
          sort_order: sortOrder,
          updated_at: '2026-05-17T04:00:00.000Z'
        });
        return { rows: [row] };
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

function createService(state, queries = [], options = {}) {
  return createPostgresProductImportService({
    databaseUrl: 'postgres://example.test/db',
    Client: makeClientClass({ state, queries, ...options })
  });
}

describe('product bulk import persistence', () => {
  it('valid import creates products, updates existing code, upserts image assets, and writes counts-only audit', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        csv: [
          'code,name,price_text,description,image_url,category,tags,metadata_json,status,sort_order,extra_col',
          'M7,Demo Product M7,150k,Updated,https://cdn.example.test/m7.png,demo,"hot,bestseller","{""size"":""medium"",""note"":""shop-specific""}",active,1,ignored',
          'M8,Demo Product M8,200k,Created,https://cdn.example.test/m8.png,demo,"new","{""size"":""large""}",active,2,ignored'
        ].join('\n')
      }
    });

    const existing = state.products.find(product => product.id === 'prod-existing');
    const created = state.products.find(product => product.code === 'M8');
    const updatedAsset = state.assets.find(asset => asset.id === 'asset-existing-product');
    const createdAsset = state.assets.find(asset => asset.product_id === created.id);
    const auditMetadata = JSON.parse(state.audits[0].params[12]);
    const auditText = JSON.stringify(auditMetadata);

    expect(result.rows_received).toBe(2);
    expect(result.products_created).toBe(1);
    expect(result.products_updated).toBe(1);
    expect(result.product_images_created).toBe(1);
    expect(result.product_images_updated).toBe(1);
    expect(result.product_images_skipped).toBe(0);
    expect(result.ignored_columns).toEqual(['extra_col']);
    expect(existing.name).toBe('Demo Product M7');
    expect(existing.metadata_json.priceText).toBe('150k');
    expect(existing.metadata_json.category).toBe('demo');
    expect(existing.metadata_json.tags).toEqual(['hot', 'bestseller']);
    expect(existing.metadata_json.size).toBe('medium');
    expect(existing.metadata_json.keep).toBe('yes');
    expect(created.name).toBe('Demo Product M8');
    expect(updatedAsset.public_url).toBe('https://cdn.example.test/m7.png');
    expect(createdAsset.public_url).toBe('https://cdn.example.test/m8.png');
    expect(auditMetadata.rows_received).toBe(2);
    expect(auditMetadata.products_created).toBe(1);
    expect(auditMetadata.products_updated).toBe(1);
    expect(auditMetadata.image_assets_touched).toBe(2);
    expect(auditMetadata.error_count).toBe(0);
    expect(auditMetadata.ignored_columns_count).toBe(1);
    expect(Object.keys(auditMetadata).sort()).toEqual([
      'error_count',
      'ignored_columns_count',
      'image_assets_touched',
      'products_created',
      'products_updated',
      'rows_received'
    ]);
    expect(auditText.includes('Demo Product')).toBeFalse();
    expect(auditText.includes('cdn.example')).toBeFalse();
    expect(auditText.includes('shop-specific')).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
  });

  it('supports headerless minimum CSV and reports skipped image rows', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        csv: 'M9,Demo Product M9,250k,No image,,active,9'
      }
    });

    expect(result.rows_received).toBe(1);
    expect(result.products_created).toBe(1);
    expect(result.product_images_created).toBe(0);
    expect(result.product_images_skipped).toBe(1);
    expect(state.products.some(product => product.code === 'M9')).toBeTrue();
  });

  it('validation failures return row-level errors and do not write anything', async () => {
    for (const csv of [
      'code,name,price_text\nBAD CODE,Name,100k',
      'code,name,status\nM10,Demo,deleted',
      'code,name,sort_order\nM10,Demo,abc',
      'code,name,metadata_json\nM10,Demo,"[]"',
      'code,name,image_url\nM10,Demo,http://localhost/m10.png',
      'code,name,image_url\nM10,Demo,http://10.0.0.1/m10.png',
      'code,name,image_url\nM10,Demo,http://internal/image.png',
      'code,name,image_url\nM10,Demo,http://metadata.google.internal/a'
    ]) {
      const state = createState();
      const queries = [];
      const service = createService(state, queries);
      let err = null;

      try {
        await service.importProducts({
          principal,
          shopId: 'onboarding-shop',
          body: { csv }
        });
      } catch (caught) {
        err = caught;
      }

      expect(err && err.code).toBe('product_import_validation_failed');
      expect(Array.isArray(err.errors)).toBeTrue();
      expect(err.errors.length > 0).toBeTrue();
      expect(state.products.length).toBe(1);
      expect(state.assets.length).toBe(2);
      expect(state.audits.length).toBe(0);
      expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
      expect(JSON.stringify(err).includes('localhost')).toBeFalse();
      expect(JSON.stringify(err).includes('10.0.0.1')).toBeFalse();
    }
  });

  it('duplicate codes inside one CSV fail before opening a transaction', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);
    let err = null;

    try {
      await service.importProducts({
        principal,
        shopId: 'onboarding-shop',
        body: {
          csv: [
            'code,name,price_text',
            'M10,First,100k',
            'm10,Second,200k'
          ].join('\n')
        }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('product_import_validation_failed');
    expect(err.errors[0].code).toBe('duplicate_product_code_in_csv');
    expect(err.errors[0].row).toBe(3);
    expect(err.errors[0].related_rows).toEqual([2, 3]);
    expect(err.errors[0].value).toBe('m10');
    expect(err.errors[0].message).toContain('row 2');
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
    expect(state.products.length).toBe(1);
  });

  it('fails safely when a CSV code is reserved by an archived product and writes nothing', async () => {
    const state = createState();
    state.products.push({
      id: 'prod-archived',
      shop_id: 'onboarding-shop',
      code: 'M20',
      name: 'Archived M20',
      description: 'archived',
      price: null,
      currency: '',
      status: 'archived',
      sort_order: 20,
      metadata_json: {},
      updated_at: '2026-05-17T00:00:00.000Z'
    });
    const queries = [];
    const service = createService(state, queries);
    let err = null;

    try {
      await service.importProducts({
        principal,
        shopId: 'onboarding-shop',
        body: {
          csv: [
            'code,name,price_text',
            'M21,New Product,100k',
            'm20,Try To Resurrect Archived,200k'
          ].join('\n')
        }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('product_import_validation_failed');
    expect(Array.isArray(err.errors)).toBeTrue();
    const archivedError = (err.errors || []).find(error => error.code === 'archived_product_code');
    expect(Boolean(archivedError)).toBeTrue();
    expect(archivedError.field).toBe('code');
    expect(archivedError.row).toBe(3);
    expect(archivedError.suggested_fix).toContain('archived product');
    // Nothing was created or updated; the archived product stays archived.
    expect(state.products.some(product => product.code === 'M21')).toBeFalse();
    expect(state.products.find(product => product.id === 'prod-archived').status).toBe('archived');
    expect(state.audits.length).toBe(0);
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('redacts unsafe short identifiers from duplicate code errors', async () => {
    for (const item of [{
      csv: 'code,name\npage_1,First\npage_1,Second',
      leaked: 'page_1'
    }, {
      csv: 'code,name\ncustomer_abc,First\ncustomer_abc,Second',
      leaked: 'customer_abc'
    }]) {
      const state = createState();
      const queries = [];
      const service = createService(state, queries);
      let err = null;

      try {
        await service.importProducts({
          principal,
          shopId: 'onboarding-shop',
          body: { csv: item.csv }
        });
      } catch (caught) {
        err = caught;
      }

      const bodyText = JSON.stringify(err);
      const error = err?.errors?.[0] || {};

      expect(err && err.code).toBe('product_import_validation_failed');
      expect(error.code).toBe('duplicate_product_code_in_csv');
      expect(error.field).toBe('code');
      expect(error.row).toBe(3);
      expect(error.related_rows).toEqual([2, 3]);
      expect(error.value).toBe(undefined);
      expect(error.suggested_fix).toContain('one row');
      expect(bodyText.includes(item.leaked)).toBeFalse();
      expect(queries.some(query => query.sql === 'BEGIN')).toBeFalse();
      expect(state.audits.length).toBe(0);
    }
  });

  it('redacts message-like invalid status values while keeping row guidance', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);
    let err = null;

    try {
      await service.importProducts({
        principal,
        shopId: 'onboarding-shop',
        body: { csv: 'code,name,status\nM10,Demo,hello customer message' }
      });
    } catch (caught) {
      err = caught;
    }

    const error = err?.errors?.[0] || {};
    const bodyText = JSON.stringify(err);

    expect(err && err.code).toBe('product_import_validation_failed');
    expect(error.row).toBe(2);
    expect(error.field).toBe('status');
    expect(error.code).toBe('invalid_product_status');
    expect(error.message).toContain('status');
    expect(error.suggested_fix).toContain('active');
    expect(error.value).toBe(undefined);
    expect(bodyText.includes('hello customer message')).toBeFalse();
    expect(queries.some(query => query.sql === 'BEGIN')).toBeFalse();
    expect(state.audits.length).toBe(0);
  });

  it('keeps invalid product code errors useful without echoing unsafe code text', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);
    let err = null;

    try {
      await service.importProducts({
        principal,
        shopId: 'onboarding-shop',
        body: { csv: 'code,name\nBAD CODE,Name' }
      });
    } catch (caught) {
      err = caught;
    }

    const error = err?.errors?.[0] || {};
    const bodyText = JSON.stringify(err);

    expect(err && err.code).toBe('product_import_validation_failed');
    expect(error.row).toBe(2);
    expect(error.field).toBe('code');
    expect(error.code).toBe('invalid_product_code');
    expect(error.message).toContain('Product code');
    expect(error.suggested_fix).toContain('short code');
    expect(error.value).toBe(undefined);
    expect(bodyText.includes('BAD CODE')).toBeFalse();
    expect(queries.some(query => query.sql === 'BEGIN')).toBeFalse();
    expect(state.audits.length).toBe(0);
  });

  it('reports private image URLs and invalid metadata_json by row and column without unsafe values', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);
    let err = null;

    try {
      await service.importProducts({
        principal,
        shopId: 'onboarding-shop',
        body: {
          csv: [
            'code,name,image_url,metadata_json',
            'M10,Demo,http://localhost/m10.png?token=do-not-echo,"{""secret"":}"'
          ].join('\n')
        }
      });
    } catch (caught) {
      err = caught;
    }

    const bodyText = JSON.stringify(err);
    const fields = Object.fromEntries((err.errors || []).map(error => [error.field, error]));

    expect(err && err.code).toBe('product_import_validation_failed');
    expect(fields.image_url.row).toBe(2);
    expect(fields.image_url.code).toBe('invalid_image_url');
    expect(fields.image_url.value).toBe(undefined);
    expect(fields.image_url.suggested_fix).toContain('public https image URL');
    expect(fields.metadata_json.row).toBe(2);
    expect(fields.metadata_json.code).toBe('invalid_metadata_json');
    expect(fields.metadata_json.value).toBe(undefined);
    expect(bodyText.includes('localhost')).toBeFalse();
    expect(bodyText.includes('do-not-echo')).toBeFalse();
    expect(bodyText.includes('secret')).toBeFalse();
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
    expect(state.audits.length).toBe(0);
  });

  it('validate_only previews create and update classifications without database writes or audit', async () => {
    const state = createState();
    state.products.push({
      id: 'prod-hidden',
      shop_id: 'onboarding-shop',
      code: 'M15',
      name: 'Hidden M15',
      description: 'hidden',
      price: null,
      currency: '',
      status: 'hidden',
      sort_order: 15,
      metadata_json: {},
      updated_at: '2026-05-17T00:00:00.000Z'
    });
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        validate_only: 'true',
        csv: [
          'code,name,price_text,description,image_url,category,tags,metadata_json,status,sort_order',
          'M14,Preview Product,300k,Preview,https://cdn.example.test/m14.png,demo,"new","{""size"":""small""}",active,14',
          'M7,Active Update,310k,Preview,,,,,hidden,7',
          'M15,Hidden Update,320k,Preview,,,,,active,15'
        ].join('\n')
      }
    });

    expect(result.validate_only).toBeTrue();
    expect(result.rows_received).toBe(3);
    expect(result.create_count).toBe(1);
    expect(result.update_count).toBe(2);
    expect(result.archived_conflict_count).toBe(0);
    expect(result.duplicate_count).toBe(0);
    expect(result.error_count).toBe(0);
    expect(result.blocking).toBeFalse();
    expect(result.products_created).toBe(0);
    expect(result.products_updated).toBe(0);
    expect(result.image_assets_touched).toBe(0);
    expect(result.preview_rows.length).toBe(3);
    expect(result.preview_rows[0]).toEqual({
      row: 2,
      status: 'create',
      status_label: 'Tạo mới',
      blocking: false,
      code: 'M14',
      name: 'Preview Product',
      product_status: 'active',
      sort_order: 14,
      has_image_url: true,
      metadata_keys: ['category', 'priceText', 'size', 'tags'],
      message: 'Sẽ tạo sản phẩm mới.',
      errors: []
    });
    expect(result.preview_rows[1].status).toBe('update');
    expect(result.preview_rows[1].code).toBe('M7');
    expect(result.preview_rows[1].product_status).toBe('hidden');
    expect(result.preview_rows[2].status).toBe('update');
    expect(result.preview_rows[2].code).toBe('M15');
    expect(result.preview_rows[2].product_status).toBe('active');
    expect(state.products.some(product => product.code === 'M14')).toBeFalse();
    expect(state.assets.some(asset => asset.public_url === 'https://cdn.example.test/m14.png')).toBeFalse();
    expect(state.audits.length).toBe(0);
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
    expect(queries.some(item => /^INSERT\b/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^UPDATE\b/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^DELETE\b/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql.includes('FROM shop_products'))).toBeTrue();
  });

  it('validate_only classifies archived codes as blocking conflicts without opening a transaction', async () => {
    const state = createState();
    state.products.push({
      id: 'prod-archived',
      shop_id: 'onboarding-shop',
      code: 'M20',
      name: 'Archived M20',
      description: 'archived',
      price: null,
      currency: '',
      status: 'archived',
      sort_order: 20,
      metadata_json: {},
      updated_at: '2026-05-17T00:00:00.000Z'
    });
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        validate_only: true,
        csv: 'code,name\nm20,Try Archived'
      }
    });

    expect(result.validate_only).toBeTrue();
    expect(result.archived_conflict_count).toBe(1);
    expect(result.blocking).toBeTrue();
    expect(result.preview_rows[0].status).toBe('archived_conflict');
    expect(result.preview_rows[0].blocking).toBeTrue();
    expect(result.preview_rows[0].message).toBe('Mã này thuộc một sản phẩm đã lưu trữ và đang được giữ chỗ. Hãy khôi phục sản phẩm đó từ danh mục, hoặc dùng mã khác.');
    expect(result.errors[0].code).toBe('archived_product_code');
    expect(state.products.find(product => product.id === 'prod-archived').status).toBe('archived');
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
    expect(queries.some(item => /^INSERT\b|^UPDATE\b|^DELETE\b/i.test(item.sql))).toBeFalse();
  });

  it('validate_only classifies duplicate codes inside the CSV as blocking preview rows', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        validate_only: 'true',
        csv: [
          'code,name',
          'M30,First',
          'm30,Second'
        ].join('\n')
      }
    });

    expect(result.duplicate_count).toBe(2);
    expect(result.blocking).toBeTrue();
    expect(result.preview_rows.map(row => row.status)).toEqual(['duplicate_in_csv', 'duplicate_in_csv']);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0].code).toBe('duplicate_product_code_in_csv');
    expect(result.errors[0].related_rows).toEqual([2, 3]);
    expect(state.products.length).toBe(1);
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
    expect(queries.some(item => /^INSERT\b|^UPDATE\b|^DELETE\b/i.test(item.sql))).toBeFalse();
  });

  it('validate_only reports invalid product code, name, and status as error preview rows', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        validate_only: 'true',
        csv: [
          'code,name,status',
          'BAD CODE,Name,active',
          'M31,,active',
          'M32,Name,deleted'
        ].join('\n')
      }
    });

    expect(result.error_count).toBe(3);
    expect(result.blocking).toBeTrue();
    expect(result.preview_rows.map(row => row.status)).toEqual(['error', 'error', 'error']);
    expect(result.errors.map(error => error.code)).toEqual([
      'invalid_product_code',
      'invalid_product_name',
      'invalid_product_status'
    ]);
    expect(JSON.stringify(result).includes('BAD CODE')).toBeFalse();
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
    expect(queries.some(item => /^INSERT\b|^UPDATE\b|^DELETE\b/i.test(item.sql))).toBeFalse();
  });

  it('validate_only reports ignored columns as warnings without blocking import', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        validate_only: 'true',
        csv: 'code,name,extra_col\nM33,Extra Column,ignored'
      }
    });

    expect(result.ignored_columns).toEqual(['extra_col']);
    expect(result.ignored_columns_count).toBe(1);
    expect(result.create_count).toBe(1);
    expect(result.error_count).toBe(0);
    expect(result.blocking).toBeFalse();
    expect(result.preview_rows[0].status).toBe('create');
  });

  it('preview product name sanitizer escapes HTML and hides sensitive-looking values', () => {
    expect(safePreviewProductName('<b>Demo</b>')).toBe('&lt;b&gt;Demo&lt;/b&gt;');
    expect(safePreviewProductName('token abc123')).toBe('[not shown]');
    expect(safePreviewProductName('postgres://user:pass@example.test/db')).toBe('[not shown]');
  });

  it('rejects principals without product write permission before opening a transaction', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);
    let err = null;

    try {
      await service.importProducts({
        principal: { ...principal, roles: ['viewer'] },
        shopId: 'onboarding-shop',
        body: { csv: 'code,name\nM11,Viewer Product' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('permission_denied');
    expect(queries.some(item => item.sql === 'BEGIN')).toBeFalse();
  });

  it('rolls back products and assets when audit insert fails', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries, { failAuditCode: '42P01' });
    let err = null;

    try {
      await service.importProducts({
        principal,
        shopId: 'onboarding-shop',
        body: { csv: 'code,name,image_url\nM12,Audit Rollback,https://cdn.example.test/m12.png' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('42P01');
    expect(state.products.some(product => product.code === 'M12')).toBeFalse();
    expect(state.assets.some(asset => asset.public_url === 'https://cdn.example.test/m12.png')).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
  });

  it('imported active products and product images can satisfy onboarding readiness counts', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    await service.importProducts({
      principal,
      shopId: 'onboarding-shop',
      body: {
        csv: 'code,name,image_url,status,sort_order\nM13,Ready Product,https://cdn.example.test/m13.png,active,13'
      }
    });

    const body = presentShopDetailApi({
      schemaReady: true,
      shop: state.shops[0],
      pages: state.pages,
      settings: state.settings[0],
      products: state.products,
      assets: {
        summary: createAssetsSummary(state.assets),
        rows: state.assets
      },
      credentials: {
        available: true,
        active_fb_page_token_count: state.credentials.length
      }
    });
    const checklist = Object.fromEntries(body.onboarding.checklist.map(item => [item.key, item]));

    expect(checklist.product_ready.passed).toBeTrue();
    expect(checklist.product_assets_ready.passed).toBeTrue();
    expect(body.onboarding.counts.active_product_count > 0).toBeTrue();
    expect(body.onboarding.counts.active_product_image_count > 0).toBeTrue();
  });
});

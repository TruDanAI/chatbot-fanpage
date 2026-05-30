const { describe, it, expect } = require('./harness');
const { resolveShopConfigForPage } = require('../core/shops/db-shop-config');
const { createPostgresAssetUploadService } = require('../core/admin/asset-uploads');

const principal = Object.freeze({
  id: 'maintainer-1',
  roles: ['maintainer'],
  tenantId: 'default',
  pageId: 'page',
  authMethod: 'static_bearer'
});

const validEnv = Object.freeze({
  CLOUDINARY_URL: 'cloudinary://key:secret@example-cloud',
  CLOUDINARY_FOLDER: 'admin_uploads'
});

function jpegBuffer() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function pngBuffer() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

function webpBuffer() {
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x04, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from('VP8 ', 'ascii')
  ]);
}

function imageFile(overrides = {}) {
  const buffer = overrides.buffer || jpegBuffer();
  return {
    originalname: overrides.originalname || 'operator-image.jpg',
    mimetype: overrides.mimetype || 'image/jpeg',
    buffer,
    size: overrides.size == null ? buffer.length : overrides.size
  };
}

function cloneRows(rows = []) {
  return rows.map(row => ({ ...row }));
}

function createState() {
  return {
    shops: [{
      id: 'basic-shop',
      slug: 'basic-shop',
      name: 'Basic Shop',
      status: 'active',
      default_locale: 'vi-VN',
      timezone: 'Asia/Bangkok',
      updated_at: '2026-05-20T00:00:00.000Z'
    }, {
      id: 'other-shop',
      slug: 'other-shop',
      name: 'Other Shop',
      status: 'active',
      updated_at: '2026-05-20T00:00:00.000Z'
    }],
    products: [{
      id: 'prod-active',
      shop_id: 'basic-shop',
      code: 'SAFE1',
      name: 'Safe Product',
      description: '',
      price: 120000,
      currency: 'VND',
      status: 'active',
      sort_order: 1,
      metadata_json: {}
    }, {
      id: 'prod-hidden',
      shop_id: 'basic-shop',
      code: 'HIDDEN1',
      name: 'Hidden Product',
      description: '',
      price: 130000,
      currency: 'VND',
      status: 'hidden',
      sort_order: 2,
      metadata_json: {}
    }, {
      id: 'prod-other',
      shop_id: 'other-shop',
      code: 'OTHER1',
      name: 'Other Product',
      description: '',
      price: 140000,
      currency: 'VND',
      status: 'active',
      sort_order: 1,
      metadata_json: {}
    }],
    assets: [],
    audits: []
  };
}

function createUploader({ destroyFails = false, uploadError = null, uploadResult = null } = {}) {
  const uploadCalls = [];
  const destroyCalls = [];
  return {
    uploadCalls,
    destroyCalls,
    async uploadBuffer(buffer, options = {}) {
      uploadCalls.push({ size: buffer.length, options });
      if (uploadError) throw uploadError;
      if (typeof uploadResult === 'function') return uploadResult({ buffer, options });
      if (uploadResult) return uploadResult;
      return {
        public_id: `${options.folder}/${options.public_id}`,
        secure_url: `https://res.cloudinary.com/example/image/upload/v1/${options.folder}/${options.public_id}.jpg`
      };
    },
    async destroy(publicId, options = {}) {
      destroyCalls.push({ publicId, options });
      if (destroyFails) {
        throw new Error('provider cleanup failed cloudinary://key:secret@example-cloud');
      }
      return { result: 'ok' };
    }
  };
}

function makeClientClass({ state, queries, failAudit = false, failAssetPersist = false, commitCommand = 'COMMIT' } = {}) {
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
      if (normalized.includes('FROM shop_products') && normalized.includes('AND id = $2') && normalized.includes("status = 'active'")) {
        const [shopId, productId] = params;
        return {
          rows: state.products
            .filter(product => product.shop_id === shopId && product.id === productId && product.status === 'active')
            .slice(0, 1)
        };
      }
      if (/^INSERT INTO shop_assets/i.test(normalized)) {
        if (failAssetPersist) {
          return { rows: [] };
        }
        const row = {
          id: params[0],
          shop_id: params[1],
          product_id: params[2] || null,
          asset_type: params[3],
          storage_provider: 'object_storage',
          storage_key: params[4],
          public_url: params[5],
          content_type: params[6],
          size_bytes: params[7],
          status: params[8],
          sort_order: params[9],
          updated_at: '2026-05-20T01:00:00.000Z'
        };
        this.txAssets.push(row);
        return { rows: [row] };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAudit) {
          const err = new Error('audit failed at postgres://secret');
          err.code = '42P01';
          throw err;
        }
        state.audits.push({ params });
        return { rows: [] };
      }

      throw new Error(`unexpected query: ${normalized}`);
    }
  };
}

async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe('admin image upload service', () => {
  it('fails safe when disabled or Cloudinary configuration is missing without touching DB or provider', async () => {
    let constructed = false;
    class NeverClient {
      constructor() {
        constructed = true;
      }
    }
    const uploader = createUploader();
    const disabled = createPostgresAssetUploadService({
      enabled: false,
      databaseUrl: 'postgres://example.test/db',
      Client: NeverClient,
      cloudinaryUploader: uploader,
      env: validEnv
    });

    const disabledErr = await captureError(() => disabled.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));

    expect(disabledErr && disabledErr.code).toBe('feature_disabled');
    expect(constructed).toBeFalse();
    expect(uploader.uploadCalls.length).toBe(0);

    const missingConfig = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: NeverClient,
      cloudinaryUploader: uploader,
      env: {}
    });
    const configErr = await captureError(() => missingConfig.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));

    expect(configErr && configErr.code).toBe('feature_not_configured');
    expect(constructed).toBeFalse();
    expect(uploader.uploadCalls.length).toBe(0);
  });

  it('rejects missing, too-large, MIME, extension, magic-byte, and SVG inputs before DB or provider', async () => {
    let constructed = false;
    class NeverClient {
      constructor() {
        constructed = true;
      }
    }
    const uploader = createUploader();
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: NeverClient,
      cloudinaryUploader: uploader,
      env: {
        ...validEnv,
        IMAGE_UPLOAD_MAX_BYTES: '64'
      }
    });

    const cases = [
      {
        file: null,
        code: 'missing_file'
      },
      {
        file: imageFile({ size: 65 }),
        code: 'file_too_large'
      },
      {
        file: imageFile({ originalname: 'image.jpg', mimetype: 'image/gif' }),
        code: 'invalid_file_type'
      },
      {
        file: imageFile({ originalname: 'image.gif', mimetype: 'image/jpeg' }),
        code: 'invalid_file_extension'
      },
      {
        file: imageFile({ originalname: 'image.jpg', mimetype: 'image/jpeg', buffer: pngBuffer() }),
        code: 'file_type_mismatch'
      },
      {
        file: imageFile({ originalname: 'image.svg', mimetype: 'image/svg+xml', buffer: Buffer.from('<svg></svg>') }),
        code: 'svg_not_allowed'
      },
      {
        file: imageFile({ originalname: 'image.png', mimetype: 'image/png', buffer: Buffer.from('<?xml version="1.0"?><svg></svg>') }),
        code: 'svg_not_allowed'
      },
      {
        file: imageFile({ originalname: 'image.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('GIF89a') }),
        code: 'invalid_file_signature'
      }
    ];

    for (const item of cases) {
      const err = await captureError(() => service.createUploadedAsset({
        principal,
        shopId: 'basic-shop',
        body: { asset_type: 'menu_image' },
        file: item.file
      }));
      expect(err && err.code).toBe(item.code);
    }

    expect(constructed).toBeFalse();
    expect(uploader.uploadCalls.length).toBe(0);
  });

  it('requires an active same-shop product for product images and ignores product_id for menu images', async () => {
    const invalidBodies = [
      { asset_type: 'product_image' },
      { asset_type: 'product_image', product_id: 'prod-hidden' },
      { asset_type: 'product_image', product_id: 'prod-other' },
      { asset_type: 'product_image', product_code: 'SAFE1' }
    ];

    for (const body of invalidBodies) {
      const state = createState();
      const queries = [];
      const uploader = createUploader();
      const service = createPostgresAssetUploadService({
        enabled: true,
        databaseUrl: 'postgres://example.test/db',
        Client: makeClientClass({ state, queries }),
        cloudinaryUploader: uploader,
        env: validEnv
      });
      const err = await captureError(() => service.createUploadedAsset({
        principal,
        shopId: 'basic-shop',
        body,
        file: imageFile()
      }));

      expect(Boolean(err)).toBeTrue();
      expect(uploader.uploadCalls.length).toBe(0);
      expect(queries.some(item => /^INSERT INTO shop_assets/i.test(item.sql))).toBeFalse();
    }

    const state = createState();
    const queries = [];
    const uploader = createUploader();
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      cloudinaryUploader: uploader,
      env: validEnv
    });
    const result = await service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image', product_id: 'prod-other' },
      file: imageFile()
    });

    expect(result.asset.asset_type).toBe('menu_image');
    expect(state.assets[0].product_id).toBe(null);
    expect(queries.some(item => item.sql.includes('FROM shop_products'))).toBeFalse();
  });

  it('preserves product_not_found before upload and does not attempt cleanup without a public id', async () => {
    const state = createState();
    const queries = [];
    const uploader = createUploader();
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      cloudinaryUploader: uploader,
      env: validEnv
    });

    const err = await captureError(() => service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'product_image', product_id: 'prod-other' },
      file: imageFile()
    }));

    expect(err && err.code).toBe('product_not_found');
    expect(uploader.uploadCalls.length).toBe(0);
    expect(uploader.destroyCalls.length).toBe(0);
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('preserves Cloudinary provider failures and does not cleanup a null upload', async () => {
    const state = createState();
    const queries = [];
    const uploadError = new Error('provider upload failed');
    uploadError.code = 'cloudinary_upload_failed';
    const uploader = createUploader({ uploadError });
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      cloudinaryUploader: uploader,
      env: validEnv
    });

    const err = await captureError(() => service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));

    expect(err && err.code).toBe('cloudinary_upload_failed');
    expect(uploader.uploadCalls.length).toBe(1);
    expect(uploader.destroyCalls.length).toBe(0);
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(state.assets.length).toBe(0);
  });

  it('destroys the returned Cloudinary public id when secure_url is not https', async () => {
    const state = createState();
    const queries = [];
    const uploader = createUploader({
      uploadResult: ({ options }) => ({
        public_id: `${options.folder}/${options.public_id}`,
        secure_url: 'http://res.cloudinary.com/example/image/upload/v1/not-https.jpg'
      })
    });
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      cloudinaryUploader: uploader,
      env: validEnv
    });

    const err = await captureError(() => service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));

    expect(err && err.code).toBe('insecure_upload_url');
    expect(uploader.uploadCalls.length).toBe(1);
    expect(uploader.destroyCalls.length).toBe(1);
    expect(uploader.destroyCalls[0].publicId).toBe(`${uploader.uploadCalls[0].options.folder}/${uploader.uploadCalls[0].options.public_id}`);
    expect(uploader.destroyCalls[0].options.resource_type).toBe('image');
    expect(uploader.destroyCalls[0].options.invalidate).toBeTrue();
    expect(queries.some(item => /^INSERT INTO shop_assets/i.test(item.sql))).toBeFalse();
    expect(state.assets.length).toBe(0);
  });

  it('does not mask invalid secure_url when cleanup fails', async () => {
    const state = createState();
    const queries = [];
    const logs = [];
    const uploader = createUploader({
      destroyFails: true,
      uploadResult: ({ options }) => ({
        public_id: `${options.folder}/${options.public_id}`,
        secure_url: 'not-a-valid-url'
      })
    });
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      cloudinaryUploader: uploader,
      env: validEnv,
      logger: { warn: message => logs.push(message) }
    });

    const err = await captureError(() => service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));
    const logText = logs.join('\n');

    expect(err && err.code).toBe('insecure_upload_url');
    expect(uploader.destroyCalls.length).toBe(1);
    expect(logText.includes('cleanup_failed')).toBeTrue();
    expect(logText.includes('shop_ref=s:')).toBeTrue();
    expect(logText.includes('asset_ref=a:')).toBeTrue();
    expect(logText.includes('cloudinary://')).toBeFalse();
    expect(logText.includes('secret')).toBeFalse();
    expect(logText.includes(uploader.destroyCalls[0].publicId)).toBeFalse();
  });

  it('destroys Cloudinary upload when asset persistence fails after upload', async () => {
    const state = createState();
    const queries = [];
    const uploader = createUploader();
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, failAssetPersist: true }),
      cloudinaryUploader: uploader,
      env: validEnv
    });

    const err = await captureError(() => service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));

    expect(err && err.code).toBe('asset_persist_failed');
    expect(uploader.uploadCalls.length).toBe(1);
    expect(uploader.destroyCalls.length).toBe(1);
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(state.assets.length).toBe(0);
  });

  it('uploads through Cloudinary and inserts an object_storage shop_assets row with safe audit metadata', async () => {
    const state = createState();
    const queries = [];
    const uploader = createUploader();
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      cloudinaryUploader: uploader,
      env: validEnv
    });

    const result = await service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: {
        asset_type: 'product_image',
        product_id: 'prod-active',
        sort_order: '7',
        status: 'hidden'
      },
      file: imageFile()
    });
    const row = state.assets[0];
    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);
    const metadataText = JSON.stringify(metadata);

    expect(result.asset.storage_provider).toBe('object_storage');
    expect(row.storage_provider).toBe('object_storage');
    expect(row.storage_key.includes('operator-image')).toBeFalse();
    expect(row.storage_key.includes('basic-shop')).toBeTrue();
    expect(row.public_url.startsWith('https://res.cloudinary.com/')).toBeTrue();
    expect(row.content_type).toBe('image/jpeg');
    expect(row.size_bytes).toBe(jpegBuffer().length);
    expect(row.asset_type).toBe('product_image');
    expect(row.product_id).toBe('prod-active');
    expect(row.status).toBe('hidden');
    expect(row.sort_order).toBe(7);
    expect(uploader.uploadCalls[0].options.resource_type).toBe('image');
    expect(uploader.uploadCalls[0].options.overwrite).toBeFalse();
    expect(uploader.uploadCalls[0].options.folder).toBe('admin_uploads/basic-shop/product_image');
    expect(auditInsert.params[5]).toBe('admin.shop_asset.upload');
    expect(metadata.shop_ref.startsWith('s:')).toBeTrue();
    expect(metadata.asset_ref.startsWith('a:')).toBeTrue();
    expect(metadata.product_ref.startsWith('pr:')).toBeTrue();
    expect(metadata.product_code).toBe('SAFE1');
    expect(metadata.provider).toBe('cloudinary');
    expect(metadata.mime).toBe('image/jpeg');
    expect(metadata.size_bytes).toBe(jpegBuffer().length);
    expect(metadata.url_host).toBe('res.cloudinary.com');
    expect(metadata.shop_id).toBe(undefined);
    expect(metadata.asset_id).toBe(undefined);
    expect(metadata.storage_key).toBe(undefined);
    expect(metadata.public_url).toBe(undefined);
    expect(metadataText.includes('postgres://')).toBeFalse();
    expect(metadataText.includes('cloudinary://')).toBeFalse();
    expect(metadataText.includes('secret')).toBeFalse();
    expect(metadataText.includes('example/image/upload')).toBeFalse();
  });

  it('best-effort destroys Cloudinary upload when DB or audit transaction fails and logs only safe refs', async () => {
    const state = createState();
    const queries = [];
    const uploader = createUploader({ destroyFails: true });
    const logs = [];
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, failAudit: true }),
      cloudinaryUploader: uploader,
      env: validEnv,
      logger: { warn: message => logs.push(message) }
    });

    const err = await captureError(() => service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image' },
      file: imageFile()
    }));
    const logText = logs.join('\n');

    expect(err && err.code).toBe('42P01');
    expect(uploader.uploadCalls.length).toBe(1);
    expect(uploader.destroyCalls.length).toBe(1);
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(state.assets.length).toBe(0);
    expect(logText.includes('cleanup_failed')).toBeTrue();
    expect(logText.includes('shop_ref=s:')).toBeTrue();
    expect(logText.includes('asset_ref=a:')).toBeTrue();
    expect(logText.includes('basic-shop')).toBeFalse();
    expect(logText.includes('secret')).toBeFalse();
    expect(logText.includes('cloudinary://')).toBeFalse();
    expect(logText.includes(uploader.destroyCalls[0].publicId)).toBeFalse();
  });

  it('uploaded public_url remains compatible with runtime menu and product image resolution', async () => {
    const state = createState();
    const uploader = createUploader();
    const service = createPostgresAssetUploadService({
      enabled: true,
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries: [] }),
      cloudinaryUploader: uploader,
      env: validEnv
    });

    await service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'menu_image', sort_order: '1' },
      file: imageFile({ originalname: 'menu.webp', mimetype: 'image/webp', buffer: webpBuffer() })
    });
    await service.createUploadedAsset({
      principal,
      shopId: 'basic-shop',
      body: { asset_type: 'product_image', product_id: 'prod-active', sort_order: '2' },
      file: imageFile({ originalname: 'product.png', mimetype: 'image/png', buffer: pngBuffer() })
    });

    const client = {
      async query(sql, values = []) {
        const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          return {
            rows: [{
              shop_id: 'basic-shop',
              shop_slug: 'basic-shop',
              shop_name: 'Basic Shop',
              shop_status: 'active',
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
          return { rows: state.products.filter(row => row.shop_id === 'basic-shop' && row.status === 'active') };
        }
        if (normalized.includes('FROM shop_assets')) {
          return { rows: state.assets.filter(row => row.shop_id === 'basic-shop' && row.status === 'active') };
        }
        return { rows: [] };
      }
    };

    const result = await resolveShopConfigForPage({
      pageId: 'page_1',
      tenantId: 'tenant_test',
      client
    });

    expect(result.config.__assets.menuImages.length).toBe(1);
    expect(result.config.__assets.menuImages[0].url.startsWith('https://res.cloudinary.com/')).toBeTrue();
    expect(result.config.__assets.productImagesByCode.SAFE1.length).toBe(1);
    expect(result.config.__assets.productImagesByCode.SAFE1[0].url.startsWith('https://res.cloudinary.com/')).toBeTrue();
  });
});

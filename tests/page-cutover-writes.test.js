const { describe, it, expect } = require('./harness');
const { decryptCredential } = require('../core/credentials/page-credentials');
const {
  PAGE_CUTOVER_CONFIRMATION,
  createPostgresPageCutoverWriteService
} = require('../core/admin/page-cutover-writes');
const { pageRef } = require('../core/utils/log-refs');

const masterKey = 'local-cutover-master-key-32-plus-characters';
const token = 'EAAB-local-cutover-page-token-value';
const principal = Object.freeze({
  id: 'maintainer-1',
  roles: ['maintainer'],
  tenantId: 'default',
  pageId: 'admin-page',
  authMethod: 'static_bearer'
});

function cloneRows(rows = []) {
  return rows.map(row => ({ ...row }));
}

function createState() {
  return {
    shops: [{
      id: 'staging-shop',
      slug: 'staging-shop',
      status: 'paused',
      package: 'basic',
      lifecycle: 'configuring',
      dry_run: true,
      live_enabled: false,
      last_readiness_status: 'passed',
      last_readiness_checked_at: '2026-05-12T00:00:00.000Z',
      last_ready_by: 'admin-1'
    }, {
      id: 'other-shop',
      slug: 'other-shop',
      status: 'paused',
      package: 'basic',
      lifecycle: 'configuring',
      dry_run: true,
      live_enabled: false,
      last_readiness_status: 'passed',
      last_readiness_checked_at: '2026-05-12T00:00:00.000Z',
      last_ready_by: 'admin-1'
    }, {
      id: 'adult-shop',
      slug: 'adult-shop',
      status: 'active',
      package: 'basic',
      lifecycle: 'live',
      dry_run: false,
      live_enabled: true,
      last_readiness_status: 'passed',
      last_readiness_checked_at: '2026-05-12T00:00:00.000Z',
      last_ready_by: 'admin-1'
    }],
    pages: [{
      id: 'page-old',
      shop_id: 'staging-shop',
      page_id: 'page_old',
      page_name: 'Old Page',
      status: 'active',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    credentials: [{
      id: 'credential-old',
      shop_id: 'staging-shop',
      page_mapping_id: 'page-old',
      credential_type: 'fb_page_token',
      encrypted_value: 'v1:old',
      status: 'active',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    products: [{ id: 'prod-1', shop_id: 'staging-shop', status: 'active' }],
    assets: [{ id: 'asset-1', shop_id: 'staging-shop', status: 'active' }],
    audits: []
  };
}

function makeClientClass({ state, queries, commitCommand = 'COMMIT' } = {}) {
  return class FakeClient {
    async connect() {
      queries.push({ sql: 'CONNECT', params: [] });
    }

    async end() {
      queries.push({ sql: 'END', params: [] });
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').trim().replace(/\s+/g, ' ');
      queries.push({ sql: normalized, params });

      if (normalized === 'BEGIN') {
        this.txShops = cloneRows(state.shops);
        this.txPages = cloneRows(state.pages);
        this.txCredentials = cloneRows(state.credentials);
        this.txProducts = cloneRows(state.products);
        this.txAssets = cloneRows(state.assets);
        this.txAudits = cloneRows(state.audits);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') {
          state.shops = cloneRows(this.txShops);
          state.pages = cloneRows(this.txPages);
          state.credentials = cloneRows(this.txCredentials);
          state.products = cloneRows(this.txProducts);
          state.assets = cloneRows(this.txAssets);
          state.audits = cloneRows(this.txAudits);
        }
        this.txShops = null;
        this.txPages = null;
        this.txCredentials = null;
        this.txProducts = null;
        this.txAssets = null;
        this.txAudits = null;
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.txShops = null;
        this.txPages = null;
        this.txCredentials = null;
        this.txProducts = null;
        this.txAssets = null;
        this.txAudits = null;
        return { rows: [] };
      }

      const shops = this.txShops || state.shops;
      const pages = this.txPages || state.pages;
      const credentials = this.txCredentials || state.credentials;
      const audits = this.txAudits || state.audits;

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
      }
      if (normalized.includes('COUNT(*)::int AS count') && normalized.includes('FROM shop_pages')) {
        return {
          rows: [{
            count: pages.filter(row => row.shop_id === params[0] && row.status === 'active').length
          }]
        };
      }
      if (normalized.includes('COUNT(*)::int AS count') && normalized.includes('FROM shop_page_credentials')) {
        return {
          rows: [{
            count: credentials.filter(row => (
              row.shop_id === params[0]
              && row.page_mapping_id === params[1]
              && row.credential_type === params[2]
              && row.status === 'active'
            )).length
          }]
        };
      }
      if (normalized.includes('FROM shop_pages') && normalized.includes('WHERE shop_id = $1') && normalized.includes("status = 'active'") && normalized.includes('FOR UPDATE')) {
        return {
          rows: pages
            .filter(row => row.shop_id === params[0] && row.status === 'active')
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        };
      }
      if (normalized.includes('FROM shop_page_credentials') && normalized.includes('page_mapping_id = $2') && normalized.includes("status = 'active'") && normalized.includes('FOR UPDATE')) {
        return {
          rows: credentials
            .filter(row => (
              row.shop_id === params[0]
              && row.page_mapping_id === params[1]
              && row.credential_type === params[2]
              && row.status === 'active'
            ))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        };
      }
      if (normalized.includes('FROM shop_pages') && normalized.includes('WHERE page_id = $1') && normalized.includes("status = 'active'")) {
        return { rows: pages.filter(row => row.page_id === params[0] && row.status === 'active').slice(0, 1) };
      }
      if (/^INSERT INTO shop_pages/i.test(normalized)) {
        const row = {
          id: params[0],
          shop_id: params[1],
          page_id: params[2],
          page_name: params[3],
          status: 'active',
          created_at: '2026-05-16T00:00:00.000Z',
          updated_at: '2026-05-16T00:00:00.000Z'
        };
        pages.push(row);
        return { rows: [row] };
      }
      if (/^INSERT INTO shop_page_credentials/i.test(normalized)) {
        const row = {
          id: params[0],
          shop_id: params[1],
          page_mapping_id: params[2],
          credential_type: params[3],
          encrypted_value: params[4],
          status: 'active',
          metadata_json: JSON.parse(params[5]),
          created_at: '2026-05-16T00:01:00.000Z',
          updated_at: '2026-05-16T00:01:00.000Z'
        };
        credentials.push(row);
        return { rows: [row] };
      }
      if (/^UPDATE shop_page_credentials/i.test(normalized)) {
        const row = credentials.find(item => item.shop_id === params[0] && item.id === params[1] && item.status === 'active');
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'archived';
        row.updated_at = '2026-05-16T00:02:00.000Z';
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^UPDATE shop_pages/i.test(normalized)) {
        const row = pages.find(item => item.shop_id === params[0] && item.id === params[1] && item.status === 'active');
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'archived';
        row.updated_at = '2026-05-16T00:03:00.000Z';
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^UPDATE shops/i.test(normalized)) {
        const shop = shops.find(row => row.id === params[0]);
        if (!shop) return { rows: [], rowCount: 0 };
        shop.last_readiness_status = 'unknown';
        shop.last_readiness_checked_at = null;
        shop.last_ready_by = '';
        shop.updated_at = '2026-05-16T00:04:00.000Z';
        return {
          rows: [{
            id: shop.id,
            last_readiness_status: shop.last_readiness_status,
            last_readiness_checked_at: shop.last_readiness_checked_at,
            last_ready_by: shop.last_ready_by
          }],
          rowCount: 1
        };
      }
      if (normalized.includes('SELECT id, status FROM shop_pages') && normalized.includes('WHERE shop_id = $1')) {
        return { rows: pages.filter(row => row.shop_id === params[0] && row.id === params[1]).slice(0, 1) };
      }
      if (normalized.includes('SELECT id, status FROM shop_page_credentials') && normalized.includes('WHERE shop_id = $1')) {
        return { rows: credentials.filter(row => row.shop_id === params[0] && row.id === params[1]).slice(0, 1) };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        audits.push({ params });
        return { rows: [] };
      }

      throw new Error(`unexpected query: ${normalized}`);
    }
  };
}

function createService(state, queries, options = {}) {
  return createPostgresPageCutoverWriteService({
    databaseUrl: 'postgres://example.test/db',
    Client: makeClientClass({ state, queries, ...options }),
    getCredentialMasterKey: () => options.masterKey == null ? masterKey : options.masterKey,
    encryptCredentialValue: options.encryptCredentialValue,
    env: options.env || { NODE_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'staging' }
  });
}

async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

function validBody(overrides = {}) {
  return {
    new_page_id: 'page_new',
    new_page_name: 'New Page',
    new_page_token: token,
    confirmation_text: PAGE_CUTOVER_CONFIRMATION,
    shop_slug_confirmation: 'staging-shop',
    expected_current_page_mapping_id: 'page-old',
    expected_current_page_ref: pageRef('page_old'),
    ...overrides
  };
}

describe('page cutover admin writes', () => {
  it('atomically creates a new active mapping and credential, archives old rows, stales readiness, and audits safely', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody(),
      requestContext: { requestId: 'req-1', ip: '127.0.0.1', userAgent: 'test' }
    });

    const shop = state.shops.find(row => row.id === 'staging-shop');
    const oldMapping = state.pages.find(row => row.id === 'page-old');
    const newMapping = state.pages.find(row => row.page_id === 'page_new');
    const oldCredential = state.credentials.find(row => row.id === 'credential-old');
    const newCredential = state.credentials.find(row => row.page_mapping_id === newMapping.id && row.status === 'active');
    const activeMappings = state.pages.filter(row => row.shop_id === 'staging-shop' && row.status === 'active');
    const activeCredentials = state.credentials.filter(row => row.shop_id === 'staging-shop' && row.page_mapping_id === newMapping.id && row.status === 'active');
    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);
    const responseText = JSON.stringify(result);
    const metadataText = JSON.stringify(metadata);

    expect(result.shopId).toBe('staging-shop');
    expect(result.old_page_ref).toBe(pageRef('page_old'));
    expect(result.new_page_ref).toBe(pageRef('page_new'));
    expect(result.active_mapping_count).toBe(1);
    expect(result.active_credential_count).toBe(1);
    expect(result.readiness_stale).toBeTrue();
    expect(oldMapping.status).toBe('archived');
    expect(newMapping.status).toBe('active');
    expect(oldCredential.status).toBe('archived');
    expect(newCredential.credential_type).toBe('fb_page_token');
    expect(newCredential.encrypted_value).toMatch(/^v1:/);
    expect(newCredential.encrypted_value.includes(token)).toBeFalse();
    expect(decryptCredential(newCredential.encrypted_value, masterKey)).toBe(token);
    expect(activeMappings.length).toBe(1);
    expect(activeCredentials.length).toBe(1);
    expect(shop.status).toBe('paused');
    expect(shop.lifecycle).toBe('configuring');
    expect(shop.dry_run).toBeTrue();
    expect(shop.live_enabled).toBeFalse();
    expect(shop.last_readiness_status).toBe('unknown');
    expect(shop.last_readiness_checked_at).toBe(null);
    expect(shop.last_ready_by).toBe('');
    expect(state.products).toEqual([{ id: 'prod-1', shop_id: 'staging-shop', status: 'active' }]);
    expect(state.assets).toEqual([{ id: 'asset-1', shop_id: 'staging-shop', status: 'active' }]);
    expect(auditInsert.params[5]).toBe('admin.shop_page.cutover');
    expect(auditInsert.params[6]).toBe('shop_page_cutover');
    expect(auditInsert.params[7]).toBe(pageRef('page_new'));
    expect(metadata.shop_ref.startsWith('s:')).toBeTrue();
    expect(metadata.old_page_ref).toBe(pageRef('page_old'));
    expect(metadata.new_page_ref).toBe(pageRef('page_new'));
    expect(metadata.old_credential_ref.startsWith('c:')).toBeTrue();
    expect(metadata.new_credential_ref.startsWith('c:')).toBeTrue();
    expect(metadata.active_mapping_count).toBe(1);
    expect(metadata.active_credential_count).toBe(1);
    expect(metadata.readiness_stale).toBeTrue();
    expect(metadata.health_check).toBeFalse();
    expect(metadata.messenger_send).toBeFalse();
    expect(metadata.page_id).toBe(undefined);
    expect(metadata.encrypted_value).toBe(undefined);
    expect(metadata.token).toBe(undefined);
    expect(responseText.includes('page_old')).toBeFalse();
    expect(responseText.includes('page_new')).toBeFalse();
    expect(responseText.includes(token)).toBeFalse();
    expect(responseText.includes('encrypted_value')).toBeFalse();
    expect(metadataText.includes('page_old')).toBeFalse();
    expect(metadataText.includes('page_new')).toBeFalse();
    expect(metadataText.includes(token)).toBeFalse();
    expect(metadataText.includes(newCredential.encrypted_value)).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
    expect(queries.some(item => /shop_products/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /shop_assets/i.test(item.sql))).toBeFalse();
  });

  it('blocks production before opening a transaction', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageCutoverWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient,
      getCredentialMasterKey: () => masterKey,
      env: { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'production' }
    });

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody()
    }));

    expect(err && err.code).toBe('page_cutover_not_allowed_in_production');
    expect(constructed).toBeFalse();
  });

  it('blocks missing confirmation before opening a transaction', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageCutoverWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient,
      getCredentialMasterKey: () => masterKey,
      env: { NODE_ENV: 'staging' }
    });

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody({ confirmation_text: '' })
    }));

    expect(err && err.code).toBe('page_cutover_confirmation_required');
    expect(constructed).toBeFalse();
  });

  it('blocks non-exact confirmation casing before opening a transaction', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageCutoverWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient,
      getCredentialMasterKey: () => masterKey,
      env: { NODE_ENV: 'staging' }
    });

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody({ confirmation_text: 'cutover page' })
    }));

    expect(err && err.code).toBe('page_cutover_confirmation_required');
    expect(constructed).toBeFalse();
  });

  it('blocks wrong slug confirmation before inserting rows', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody({ shop_slug_confirmation: 'wrong-shop' })
    }));

    expect(err && err.code).toBe('shop_slug_confirmation_mismatch');
    expect(state.pages.length).toBe(1);
    expect(state.credentials.length).toBe(1);
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('blocks no active mapping', async () => {
    const state = createState();
    state.pages[0].status = 'archived';
    const queries = [];
    const service = createService(state, queries);

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody({ expected_current_page_mapping_id: '', expected_current_page_ref: '' })
    }));

    expect(err && err.code).toBe('active_page_mapping_required');
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('blocks multiple active mappings', async () => {
    const state = createState();
    state.pages.push({
      id: 'page-second',
      shop_id: 'staging-shop',
      page_id: 'page_second',
      page_name: 'Second Page',
      status: 'active'
    });
    const queries = [];
    const service = createService(state, queries);

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody({ expected_current_page_mapping_id: '', expected_current_page_ref: '' })
    }));

    expect(err && err.code).toBe('active_page_mapping_ambiguous');
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('blocks new page id already active for another shop', async () => {
    const state = createState();
    state.pages.push({
      id: 'page-other-active',
      shop_id: 'other-shop',
      page_id: 'page_new',
      page_name: 'Other Page',
      status: 'active'
    });
    const queries = [];
    const service = createService(state, queries);

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody()
    }));

    expect(err && err.code).toBe('duplicate_active_page_id');
    expect(state.pages.find(row => row.id === 'page-other-active').status).toBe('active');
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('blocks same page id', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody({ new_page_id: 'page_old' })
    }));

    expect(err && err.code).toBe('same_page_id');
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('rolls back to old mapping and credential when encryption fails after inserting the new mapping', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries, {
      encryptCredentialValue: () => {
        throw new Error('synthetic encryption failure with token redacted');
      }
    });

    const err = await captureError(() => service.cutoverPage({
      principal,
      shopId: 'staging-shop',
      body: validBody()
    }));

    expect(err && err.code).toBe('page_cutover_encryption_failed');
    expect(state.pages.length).toBe(1);
    expect(state.pages[0].id).toBe('page-old');
    expect(state.pages[0].status).toBe('active');
    expect(state.credentials.length).toBe(1);
    expect(state.credentials[0].id).toBe('credential-old');
    expect(state.credentials[0].status).toBe('active');
    expect(state.audits.length).toBe(0);
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
  });
});

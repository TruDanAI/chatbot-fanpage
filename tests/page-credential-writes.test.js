const { describe, it, expect } = require('./harness');
const { decryptCredential } = require('../core/credentials/page-credentials');
const {
  createPostgresPageCredentialWriteService
} = require('../core/admin/page-credential-writes');

const masterKey = 'local-test-master-key-32-plus-characters';
const token = 'EAAB-local-admin-page-token-value';
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
      id: 'adult-shop',
      slug: 'adult-shop'
    }],
    pages: [{
      id: 'page-map-1',
      shop_id: 'adult-shop',
      page_id: 'raw_page_1',
      page_name: 'Adult Page',
      status: 'active'
    }],
    credentials: [],
    audits: [],
    products: [],
    assets: []
  };
}

function makeClientClass({ state, queries, failAudit = false, commitCommand = 'COMMIT' } = {}) {
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
        this.txCredentials = cloneRows(state.credentials);
        this.txAudits = cloneRows(state.audits);
        this.txPages = cloneRows(state.pages);
        this.txProducts = cloneRows(state.products);
        this.txAssets = cloneRows(state.assets);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') {
          state.credentials = cloneRows(this.txCredentials);
          state.audits = cloneRows(this.txAudits);
          state.pages = cloneRows(this.txPages);
          state.products = cloneRows(this.txProducts);
          state.assets = cloneRows(this.txAssets);
        }
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.txCredentials = null;
        this.txAudits = null;
        this.txPages = null;
        this.txProducts = null;
        this.txAssets = null;
        return { rows: [] };
      }

      const credentials = this.txCredentials || state.credentials;
      const pages = this.txPages || state.pages;
      const audits = this.txAudits || state.audits;

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: state.shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_pages') && normalized.includes('WHERE id = $1') && normalized.includes('shop_id = $2')) {
        return { rows: pages.filter(row => row.id === params[0] && row.shop_id === params[1]).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_page_credentials') && normalized.includes("status = 'active'") && normalized.includes('FOR UPDATE')) {
        return {
          rows: credentials.filter(row => (
            row.shop_id === params[0]
            && row.page_mapping_id === params[1]
            && row.credential_type === params[2]
            && row.status === 'active'
          ))
        };
      }
      if (/^UPDATE shop_page_credentials/i.test(normalized)) {
        let rowCount = 0;
        for (const row of credentials) {
          if (
            row.shop_id === params[0]
            && row.page_mapping_id === params[1]
            && row.credential_type === params[2]
            && row.status === 'active'
          ) {
            row.status = 'archived';
            row.updated_at = '2026-05-16T00:01:00.000Z';
            rowCount += 1;
          }
        }
        return { rows: [], rowCount };
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
          created_at: '2026-05-16T00:02:00.000Z',
          updated_at: '2026-05-16T00:02:00.000Z'
        };
        credentials.push(row);
        return { rows: [row] };
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
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAudit) {
          const err = new Error('audit insert failed with raw token EAAB-should-not-return');
          err.code = 'audit_failed';
          throw err;
        }
        audits.push({ params });
        return { rows: [] };
      }

      throw new Error(`unexpected query: ${normalized}`);
    }
  };
}

function createService(state, queries, options = {}) {
  return createPostgresPageCredentialWriteService({
    databaseUrl: 'postgres://example.test/db',
    Client: makeClientClass({ state, queries, ...options }),
    getCredentialMasterKey: () => options.masterKey == null ? masterKey : options.masterKey
  });
}

describe('page credential admin writes', () => {
  it('rejects missing master key before opening a transaction', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageCredentialWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient,
      getCredentialMasterKey: () => ''
    });

    let err = null;
    try {
      await service.createPageCredential({
        principal,
        shopId: 'adult-shop',
        pageMappingId: 'page-map-1',
        body: { token }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('credential_master_key_missing');
    expect(constructed).toBeFalse();
  });

  it('rejects missing token before opening a transaction', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageCredentialWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient,
      getCredentialMasterKey: () => masterKey
    });

    let err = null;
    try {
      await service.createPageCredential({
        principal,
        shopId: 'adult-shop',
        pageMappingId: 'page-map-1',
        body: { token: '' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('credential_token_missing');
    expect(constructed).toBeFalse();
  });

  it('rejects an invalid page mapping without inserting credential or audit rows', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    let err = null;
    try {
      await service.createPageCredential({
        principal,
        shopId: 'adult-shop',
        pageMappingId: 'missing-page-map',
        body: { token }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('page_mapping_not_found');
    expect(state.credentials.length).toBe(0);
    expect(state.audits.length).toBe(0);
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('creates an encrypted credential and safe audit in one transaction', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.createPageCredential({
      principal,
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      body: { token }
    });

    const inserted = state.credentials[0];
    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const auditMetadata = JSON.parse(auditInsert.params[12]);
    const responseText = JSON.stringify(result);
    const metadataText = JSON.stringify(auditMetadata);

    expect(result.shopId).toBe('adult-shop');
    expect(result.pageMappingId).toBe('page-map-1');
    expect(result.page_ref.startsWith('p:')).toBeTrue();
    expect(result.credential.credential_type).toBe('fb_page_token');
    expect(result.credential.status).toBe('active');
    expect(result.active_credential_count).toBe(1);
    expect(result.archived_count).toBe(0);
    expect(result.rotated).toBeFalse();
    expect(inserted.encrypted_value).toMatch(/^v1:/);
    expect(inserted.encrypted_value.includes(token)).toBeFalse();
    expect(decryptCredential(inserted.encrypted_value, masterKey)).toBe(token);
    expect(auditInsert.params[5]).toBe('admin.shop_page_credential.create');
    expect(auditInsert.params[6]).toBe('shop_page_credential');
    expect(Object.keys(auditMetadata).sort()).toEqual([
      'active_count',
      'archived_count',
      'credential_type',
      'page_ref',
      'previous_active_count',
      'rotated'
    ].sort());
    expect(auditMetadata.shop_id).toBe(undefined);
    expect(auditMetadata.page_mapping_id).toBe(undefined);
    expect(auditMetadata.page_ref.startsWith('p:')).toBeTrue();
    expect(auditMetadata.credential_type).toBe('fb_page_token');
    expect(auditMetadata.rotated).toBeFalse();
    expect(auditMetadata.previous_active_count).toBe(0);
    expect(auditMetadata.archived_count).toBe(0);
    expect(auditMetadata.active_count).toBe(1);
    expect(responseText.includes(token)).toBeFalse();
    expect(responseText.includes('encrypted_value')).toBeFalse();
    expect(responseText.includes('raw_page_1')).toBeFalse();
    expect(metadataText.includes('adult-shop')).toBeFalse();
    expect(metadataText.includes('page-map-1')).toBeFalse();
    expect(metadataText.includes('shop_id')).toBeFalse();
    expect(metadataText.includes('page_mapping_id')).toBeFalse();
    expect(metadataText.includes(token)).toBeFalse();
    expect(metadataText.includes('encrypted_value')).toBeFalse();
    expect(metadataText.includes('raw_page_1')).toBeFalse();
    expect(state.pages.length).toBe(1);
    expect(state.products.length).toBe(0);
    expect(state.assets.length).toBe(0);
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_products/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_assets/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
  });

  it('rejects duplicate active credential without rotate mode', async () => {
    const state = createState();
    state.credentials.push({
      id: 'credential-old',
      shop_id: 'adult-shop',
      page_mapping_id: 'page-map-1',
      credential_type: 'fb_page_token',
      encrypted_value: 'v1:old',
      status: 'active'
    });
    const queries = [];
    const service = createService(state, queries);

    let err = null;
    try {
      await service.createPageCredential({
        principal,
        shopId: 'adult-shop',
        pageMappingId: 'page-map-1',
        body: { token }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('active_credential_exists');
    expect(state.credentials.length).toBe(1);
    expect(state.credentials[0].status).toBe('active');
    expect(queries.some(item => /^UPDATE shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('rotates by archiving existing active credentials and inserting one replacement atomically', async () => {
    const state = createState();
    state.credentials.push({
      id: 'credential-old',
      shop_id: 'adult-shop',
      page_mapping_id: 'page-map-1',
      credential_type: 'fb_page_token',
      encrypted_value: 'v1:old',
      status: 'active'
    });
    const queries = [];
    const service = createService(state, queries);

    const result = await service.createPageCredential({
      principal,
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      body: { token, rotate: 'true' }
    });

    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);
    const active = state.credentials.filter(row => row.status === 'active');
    const archived = state.credentials.filter(row => row.status === 'archived');

    expect(result.rotated).toBeTrue();
    expect(result.active_credential_count).toBe(1);
    expect(result.archived_count).toBe(1);
    expect(active.length).toBe(1);
    expect(archived.length).toBe(1);
    expect(archived[0].id).toBe('credential-old');
    expect(Object.keys(metadata).sort()).toEqual([
      'active_count',
      'archived_count',
      'credential_type',
      'page_ref',
      'previous_active_count',
      'rotated'
    ].sort());
    expect(metadata.rotated).toBeTrue();
    expect(metadata.previous_active_count).toBe(1);
    expect(metadata.archived_count).toBe(1);
    expect(metadata.active_count).toBe(1);
    expect(metadata.shop_id).toBe(undefined);
    expect(metadata.page_mapping_id).toBe(undefined);
    expect(queries.some(item => /^UPDATE shop_page_credentials/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
  });

  it('rolls back credential changes when audit insert fails', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries, { failAudit: true });

    let err = null;
    try {
      await service.createPageCredential({
        principal,
        shopId: 'adult-shop',
        pageMappingId: 'page-map-1',
        body: { token }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('audit_failed');
    expect(state.credentials.length).toBe(0);
    expect(state.audits.length).toBe(0);
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
  });
});

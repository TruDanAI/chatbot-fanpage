const { describe, it, expect } = require('./harness');
const {
  createPostgresPageSetupPreviewService,
  isCredentialTokenFieldName
} = require('../core/admin/page-setup-preview');

const principal = Object.freeze({
  id: 'maintainer-1',
  roles: ['maintainer'],
  tenantId: 'default',
  pageId: 'admin-page',
  authMethod: 'static_bearer'
});

function createState() {
  return {
    shops: [{
      id: 'demo-shop',
      slug: 'demo-shop',
      lifecycle: 'configuring',
      live_enabled: false
    }],
    pages: [{
      id: 'page-existing',
      shop_id: 'other-shop',
      page_id: '12345678901',
      page_name: 'Existing Page',
      status: 'active'
    }],
    credentials: []
  };
}

function makeClientClass({ state, queries } = {}) {
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

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: state.shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_pages') && normalized.includes('WHERE page_id = $1') && normalized.includes("status = 'active'")) {
        const pageId = params[0];
        return { rows: state.pages.filter(row => row.page_id === pageId && row.status === 'active').slice(0, 1) };
      }

      throw new Error(`unexpected query: ${normalized}`);
    }
  };
}

function createService(state, queries, options = {}) {
  return createPostgresPageSetupPreviewService({
    databaseUrl: 'postgres://example.test/db',
    Client: makeClientClass({ state, queries }),
    getCredentialMasterKey: () => options.masterKey == null ? 'local-test-master-key' : options.masterKey
  });
}

describe('page setup preview service', () => {
  it('page mapping preview is SELECT-only and returns a page_ref without raw Page ID', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.previewPageMapping({
      principal,
      shopId: 'demo-shop',
      body: { page_id: ' 98765432109 ', page_name: ' Demo Page ' }
    });
    const resultText = JSON.stringify(result);

    expect(result.validate_only).toBeTrue();
    expect(result.shop_ref.startsWith('s:')).toBeTrue();
    expect(result.page_ref.startsWith('p:')).toBeTrue();
    expect(result.page_format_valid).toBeTrue();
    expect(result.duplicate_active_mapping).toBeFalse();
    expect(result.conflict).toBeFalse();
    expect(result.page_name.length).toBe('Demo Page'.length);
    expect(result.page_name.status).toBe('ok');
    expect(result.readiness_impact.changes_readiness).toBeFalse();
    expect(result.readiness_impact.blockers_remaining).toEqual(['page_mapping_ready', 'credential_ready']);
    expect(result.readiness_impact.live_enabled_after_preview).toBeFalse();
    expect(resultText.includes('98765432109')).toBeFalse();
    expect(resultText.includes('page_id')).toBeFalse();
    expect(queries.some(item => /^(INSERT|UPDATE|DELETE)\b/i.test(item.sql))).toBeFalse();
    expect(state.pages.length).toBe(1);
    expect(state.credentials.length).toBe(0);
  });

  it('duplicate mapping preview uses SELECT-only duplicate check and sanitizes the conflict', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.previewPageMapping({
      principal,
      shopId: 'demo-shop',
      body: { page_id: '12345678901' }
    });
    const duplicateQuery = queries.find(item => item.sql.includes('FROM shop_pages'));
    const resultText = JSON.stringify(result);

    expect(result.duplicate_active_mapping).toBeTrue();
    expect(result.conflict).toBeTrue();
    expect(result.page_ref.startsWith('p:')).toBeTrue();
    expect(duplicateQuery.sql).toMatch(/^SELECT\b/i);
    expect(resultText.includes('12345678901')).toBeFalse();
    expect(resultText.includes('page-existing')).toBeFalse();
    expect(queries.some(item => /^(INSERT|UPDATE|DELETE)\b/i.test(item.sql))).toBeFalse();
  });

  it('page mapping preview reports invalid numeric Meta-like format without duplicate write work', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries);

    const result = await service.previewPageMapping({
      principal,
      shopId: 'demo-shop',
      body: { page_id: 'page_not_numeric' }
    });

    expect(result.page_format_valid).toBeFalse();
    expect(result.duplicate_active_mapping).toBeFalse();
    expect(queries.some(item => item.sql.includes('FROM shop_pages'))).toBeFalse();
    expect(queries.some(item => /^(INSERT|UPDATE|DELETE)\b/i.test(item.sql))).toBeFalse();
  });

  it('credential preview rejects submitted token-like fields before connecting or encrypting', async () => {
    const state = createState();
    const queries = [];
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageSetupPreviewService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient,
      getCredentialMasterKey: () => 'local-test-master-key'
    });

    let err = null;
    try {
      await service.previewCredentialPrerequisites({
        principal,
        shopId: 'demo-shop',
        body: { credential_type: 'fb_page_token', fb_page_token: 'submitted-preview-token-value' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('credential_token_not_accepted_in_preview');
    expect(constructed).toBeFalse();
    expect(queries.length).toBe(0);
    expect(state.credentials.length).toBe(0);
  });

  it('credential token field detection rejects token aliases without blocking safe preview fields', () => {
    expect(isCredentialTokenFieldName('credential_type')).toBeFalse();
    expect(isCredentialTokenFieldName('validate_only')).toBeFalse();
    expect(isCredentialTokenFieldName('page_id')).toBeFalse();
    expect(isCredentialTokenFieldName('fb_page_token')).toBeTrue();
    expect(isCredentialTokenFieldName('pageAccessToken')).toBeTrue();
    expect(isCredentialTokenFieldName('nested.secret')).toBeTrue();
  });

  it('credential preview reports prerequisites without encryption, health checks, messenger sends, or writes', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries, { masterKey: 'configured-master-key' });

    const result = await service.previewCredentialPrerequisites({
      principal,
      shopId: 'demo-shop',
      body: { credential_type: 'fb_page_token' }
    });
    const resultText = JSON.stringify(result);

    expect(result.validate_only).toBeTrue();
    expect(result.credential_type).toBe('fb_page_token');
    expect(result.credential_type_allowed).toBeTrue();
    expect(result.credential_master_key_configured).toBeTrue();
    expect(result.token_accepted).toBeFalse();
    expect(result.health_check).toBeFalse();
    expect(result.messenger_send).toBeFalse();
    expect(result.readiness_impact.blockers_remaining).toEqual(['page_mapping_ready', 'credential_ready']);
    expect(resultText.includes('configured-master-key')).toBeFalse();
    expect(resultText.includes('encrypted_value')).toBeFalse();
    expect(queries.some(item => /^(INSERT|UPDATE|DELETE)\b/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql.includes('shop_page_credentials'))).toBeFalse();
  });

  it('credential preview returns unsupported type as a boolean prerequisite failure', async () => {
    const state = createState();
    const queries = [];
    const service = createService(state, queries, { masterKey: '' });

    const result = await service.previewCredentialPrerequisites({
      principal,
      shopId: 'demo-shop',
      body: { credential_type: 'system_user_token' }
    });

    expect(result.credential_type).toBe('system_user_token');
    expect(result.credential_type_allowed).toBeFalse();
    expect(result.credential_master_key_configured).toBeFalse();
    expect(queries.some(item => /^(INSERT|UPDATE|DELETE)\b/i.test(item.sql))).toBeFalse();
  });
});

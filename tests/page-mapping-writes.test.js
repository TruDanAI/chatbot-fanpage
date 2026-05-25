const { describe, it, expect } = require('./harness');
const { createPostgresPageMappingWriteService } = require('../core/admin/page-mapping-writes');

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
    }, {
      id: 'staging-shop',
      slug: 'staging-shop',
      lifecycle: 'configuring',
      live_enabled: false
    }, {
      id: 'other-shop',
      slug: 'other-shop',
      lifecycle: 'configuring',
      live_enabled: false
    }],
    pages: [{
      id: 'page-existing',
      shop_id: 'adult-shop',
      page_id: 'page_existing',
      page_name: 'Existing Page',
      status: 'active',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T00:00:00.000Z'
    }],
    audits: [],
    credentials: []
  };
}

function addPage(state, overrides = {}) {
  state.pages.push({
    id: overrides.id || 'page-staging',
    shop_id: overrides.shop_id || 'staging-shop',
    page_id: overrides.page_id || 'page_staging',
    page_name: overrides.page_name || 'Staging Page',
    status: overrides.status || 'active',
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z'
  });
}

function addCredential(state, overrides = {}) {
  state.credentials.push({
    id: overrides.id || 'credential-1',
    shop_id: overrides.shop_id || 'staging-shop',
    page_mapping_id: overrides.page_mapping_id || 'page-staging',
    credential_type: overrides.credential_type || 'fb_page_token',
    encrypted_value: overrides.encrypted_value || 'encrypted-do-not-return',
    status: overrides.status || 'active',
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z'
  });
}

function makeClientClass({ state, queries, commitCommand = 'COMMIT', failAudit = false } = {}) {
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
        this.txPages = cloneRows(state.pages);
        this.txAudits = cloneRows(state.audits);
        this.txCredentials = cloneRows(state.credentials);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') {
          state.pages = cloneRows(this.txPages);
          state.audits = cloneRows(this.txAudits);
          state.credentials = cloneRows(this.txCredentials);
        }
        this.txPages = null;
        this.txAudits = null;
        this.txCredentials = null;
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.txPages = null;
        this.txAudits = null;
        this.txCredentials = null;
        return { rows: [] };
      }

      const pages = this.txPages || state.pages;
      const audits = this.txAudits || state.audits;
      const credentials = this.txCredentials || state.credentials;

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: state.shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_pages') && normalized.includes('WHERE id = $1') && normalized.includes('shop_id = $2')) {
        const [pageMappingId, shopId] = params;
        return { rows: pages.filter(row => row.id === pageMappingId && row.shop_id === shopId).slice(0, 1) };
      }
      if (normalized.includes('FROM shop_pages') && normalized.includes('WHERE page_id = $1') && normalized.includes("status = 'active'")) {
        const pageId = params[0];
        return { rows: pages.filter(row => row.page_id === pageId && row.status === 'active').slice(0, 1) };
      }
      if (/^INSERT INTO shop_pages/i.test(normalized)) {
        const row = {
          id: params[0],
          shop_id: params[1],
          page_id: params[2],
          page_name: params[3],
          status: params[4],
          created_at: '2026-05-16T00:00:00.000Z',
          updated_at: '2026-05-16T00:00:00.000Z'
        };
        pages.push(row);
        return { rows: [row] };
      }
      if (/^UPDATE shop_pages/i.test(normalized)) {
        const [shopId, pageMappingId] = params;
        const row = pages.find(item => item.shop_id === shopId && item.id === pageMappingId && item.status === 'active');
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'archived';
        row.updated_at = '2026-05-16T00:00:00.000Z';
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^UPDATE shop_page_credentials/i.test(normalized)) {
        const [shopId, pageMappingId] = params;
        let rowCount = 0;
        for (const row of credentials) {
          if (row.shop_id === shopId && row.page_mapping_id === pageMappingId && row.status === 'active') {
            row.status = 'archived';
            row.updated_at = '2026-05-16T00:00:00.000Z';
            rowCount += 1;
          }
        }
        return { rows: [], rowCount };
      }
      if (normalized.includes('COUNT(*)::int AS count') && normalized.includes('FROM shop_page_credentials')) {
        const [shopId, pageMappingId] = params;
        return {
          rows: [{
            count: credentials.filter(row => (
              row.shop_id === shopId
              && row.page_mapping_id === pageMappingId
              && row.status === 'active'
            )).length
          }]
        };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAudit) {
          const err = new Error('audit insert failed with redacted context');
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

describe('page mapping write persistence', () => {
  it('valid create inserts shop_pages and audit in one transaction without credentials', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    const result = await service.createPageMapping({
      principal,
      shopId: 'adult-shop',
      body: { page_id: 'page_new', page_name: 'New Page' }
    });

    const inserted = state.pages.find(row => row.page_id === 'page_new');
    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);
    const metadataText = JSON.stringify(metadata);

    expect(result.shopId).toBe('adult-shop');
    expect(result.page.page_id).toBe('page_new');
    expect(result.page.page_ref.startsWith('p:')).toBeTrue();
    expect(inserted.shop_id).toBe('adult-shop');
    expect(inserted.page_name).toBe('New Page');
    expect(inserted.status).toBe('active');
    expect(state.audits.length).toBe(1);
    expect(auditInsert.params[5]).toBe('admin.shop_page.create');
    expect(auditInsert.params[6]).toBe('shop_page');
    expect(metadata.shop_id).toBe('adult-shop');
    expect(metadata.page_mapping_id).toBe(inserted.id);
    expect(metadata.page_id).toBe(undefined);
    expect(metadata.page_ref.startsWith('p:')).toBeTrue();
    expect(metadata.page_name_length).toBe('New Page'.length);
    expect(metadataText.includes('page_new')).toBeFalse();
    expect(metadataText.toLowerCase().includes('token')).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_page_credentials/i.test(item.sql))).toBeFalse();
    expect(state.credentials.length).toBe(0);
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
  });

  it('duplicate active page_id is rejected before insert', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    let err = null;
    try {
      await service.createPageMapping({
        principal,
        shopId: 'adult-shop',
        body: { page_id: 'page_existing', page_name: 'Duplicate Page' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('duplicate_active_page_id');
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('invalid page_id is rejected before opening a transaction', async () => {
    let constructed = false;
    class FakeClient {
      constructor() {
        constructed = true;
      }
    }
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: FakeClient
    });

    let err = null;
    try {
      await service.createPageMapping({
        principal,
        shopId: 'adult-shop',
        body: { page_id: 'bad page!', page_name: 'Bad Page' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('invalid_page_id');
    expect(constructed).toBeFalse();
  });

  it('missing shop is rejected without inserting a page mapping', async () => {
    const state = createState();
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    let err = null;
    try {
      await service.createPageMapping({
        principal,
        shopId: 'missing-shop',
        body: { page_id: 'page_new', page_name: 'New Page' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('shop_not_found');
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('demo-shop configuring/non-live rejects direct page mapping writes in preview-only mode', async () => {
    const state = createState();
    state.shops.push({
      id: 'demo-shop',
      slug: 'demo-shop',
      lifecycle: 'configuring',
      live_enabled: false
    });
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries })
    });

    let err = null;
    try {
      await service.createPageMapping({
        principal,
        shopId: 'demo-shop',
        body: { page_id: '12345678901', page_name: 'Demo Page' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('page_setup_preview_only');
    expect(state.pages.some(row => row.shop_id === 'demo-shop')).toBeFalse();
    expect(queries.some(item => /^INSERT INTO shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('archives one active mapping, cascades only scoped active credentials, and writes safe audit', async () => {
    const state = createState();
    addPage(state, { id: 'page-staging-active', page_id: 'page_conflict' });
    addPage(state, { id: 'page-other-active', shop_id: 'other-shop', page_id: 'page_other' });
    addCredential(state, { id: 'credential-scoped-active', page_mapping_id: 'page-staging-active' });
    addCredential(state, { id: 'credential-scoped-archived', page_mapping_id: 'page-staging-active', status: 'archived' });
    addCredential(state, { id: 'credential-other-mapping', page_mapping_id: 'page-other-active', shop_id: 'other-shop' });
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      env: { NODE_ENV: 'staging' }
    });

    const result = await service.archivePageMapping({
      principal,
      shopId: 'staging-shop',
      pageMappingId: 'page-staging-active',
      body: { confirmation_text: 'please ARCHIVE MAPPING now' }
    });

    const mapping = state.pages.find(row => row.id === 'page-staging-active');
    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);
    const metadataText = JSON.stringify(metadata);

    expect(result.shopId).toBe('staging-shop');
    expect(result.page.status).toBe('archived');
    expect(result.page.page_id).toBe(undefined);
    expect(result.archivedCredentialCount).toBe(1);
    expect(result.activeCredentialCountAfter).toBe(0);
    expect(mapping.status).toBe('archived');
    expect(state.credentials.find(row => row.id === 'credential-scoped-active').status).toBe('archived');
    expect(state.credentials.find(row => row.id === 'credential-scoped-archived').status).toBe('archived');
    expect(state.credentials.find(row => row.id === 'credential-other-mapping').status).toBe('active');
    expect(state.audits.length).toBe(1);
    expect(auditInsert.params[5]).toBe('admin.shop_page.archive');
    expect(auditInsert.params[6]).toBe('shop_page');
    expect(metadata.changedFields).toEqual(['shop_pages.status', 'shop_page_credentials.status']);
    expect(metadata.oldStatus).toBe('active');
    expect(metadata.newStatus).toBe('archived');
    expect(metadata.page_ref.startsWith('p:')).toBeTrue();
    expect(metadata.shop_ref.startsWith('s:')).toBeTrue();
    expect(metadata.archivedCredentialCount).toBe(1);
    expect(metadata.activeCredentialCountAfter).toBe(0);
    expect(metadata.adultShopOverride).toBeFalse();
    expect(metadata.source).toBe('admin_ui');
    expect(metadata.page_id).toBe(undefined);
    expect(metadata.shop_id).toBe(undefined);
    expect(metadata.page_mapping_id).toBe(undefined);
    expect(metadataText.includes('page_conflict')).toBeFalse();
    expect(metadataText.includes('staging-shop')).toBeFalse();
    expect(metadataText.includes('encrypted-do-not-return')).toBeFalse();
    expect(metadataText.toLowerCase().includes('token')).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
  });

  it('rolls back mapping and credential archive when audit insert fails', async () => {
    const state = createState();
    addPage(state, { id: 'page-staging-active', page_id: 'page_rollback' });
    addCredential(state, { id: 'credential-scoped-active', page_mapping_id: 'page-staging-active' });
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries, failAudit: true }),
      env: { NODE_ENV: 'staging' }
    });

    let err = null;
    try {
      await service.archivePageMapping({
        principal,
        shopId: 'staging-shop',
        pageMappingId: 'page-staging-active',
        body: { confirmation_text: 'ARCHIVE MAPPING' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('audit_failed');
    expect(state.pages.find(row => row.id === 'page-staging-active').status).toBe('active');
    expect(state.credentials.find(row => row.id === 'credential-scoped-active').status).toBe('active');
    expect(state.audits.length).toBe(0);
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeFalse();
  });

  it('rejects archiving a mapping through another shop route', async () => {
    const state = createState();
    addPage(state, { id: 'page-staging-active', page_id: 'page_wrong_shop' });
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      env: { NODE_ENV: 'staging' }
    });

    let err = null;
    try {
      await service.archivePageMapping({
        principal,
        shopId: 'other-shop',
        pageMappingId: 'page-staging-active',
        body: { confirmation_text: 'ARCHIVE MAPPING' }
      });
    } catch (caught) {
      err = caught;
    }

    expect(err && err.code).toBe('page_mapping_not_found');
    expect(state.pages.find(row => row.id === 'page-staging-active').status).toBe('active');
    expect(queries.some(item => /^UPDATE shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeTrue();
  });

  it('returns an already-archived result and still clears scoped active credentials', async () => {
    const state = createState();
    addPage(state, { id: 'page-staging-archived', page_id: 'page_already', status: 'archived' });
    addCredential(state, { id: 'credential-leftover-active', page_mapping_id: 'page-staging-archived' });
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      env: { NODE_ENV: 'staging' }
    });

    const result = await service.archivePageMapping({
      principal,
      shopId: 'staging-shop',
      pageMappingId: 'page-staging-archived',
      body: { confirmation_text: 'ARCHIVE MAPPING' }
    });
    const auditInsert = queries.find(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const metadata = JSON.parse(auditInsert.params[12]);

    expect(result.already_archived).toBeTrue();
    expect(result.oldStatus).toBe('archived');
    expect(result.archivedCredentialCount).toBe(1);
    expect(state.pages.find(row => row.id === 'page-staging-archived').status).toBe('archived');
    expect(state.credentials.find(row => row.id === 'credential-leftover-active').status).toBe('archived');
    expect(metadata.changedFields).toEqual(['shop_page_credentials.status']);
    expect(queries.some(item => /^UPDATE shop_pages/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
  });

  it('rejects adult-shop and non-staging archive requests before updates or audit', async () => {
    const cases = [
      {
        shopId: 'adult-shop',
        pageMappingId: 'page-existing',
        env: { NODE_ENV: 'staging' },
        code: 'adult_shop_protected'
      },
      {
        shopId: 'staging-shop',
        pageMappingId: 'page-staging-active',
        env: { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'production' },
        code: 'staging_only',
        addStagingPage: true
      }
    ];

    for (const item of cases) {
      const state = createState();
      if (item.addStagingPage) addPage(state, { id: 'page-staging-active', page_id: 'page_non_staging' });
      const queries = [];
      const service = createPostgresPageMappingWriteService({
        databaseUrl: 'postgres://example.test/db',
        Client: makeClientClass({ state, queries }),
        env: item.env
      });

      let err = null;
      try {
        await service.archivePageMapping({
          principal,
          shopId: item.shopId,
          pageMappingId: item.pageMappingId,
          body: { confirmation_text: 'ARCHIVE MAPPING' }
        });
      } catch (caught) {
        err = caught;
      }

      expect(err && err.code).toBe(item.code);
      expect(queries.some(query => /^UPDATE shop_pages/i.test(query.sql))).toBeFalse();
      expect(queries.some(query => /^UPDATE shop_page_credentials/i.test(query.sql))).toBeFalse();
      expect(queries.some(query => /^INSERT INTO admin_audit_log/i.test(query.sql))).toBeFalse();
      expect(queries.some(query => query.sql === 'ROLLBACK')).toBeTrue();
    }
  });

  it('requires confirmation and rejects raw page_id in archive body', async () => {
    for (const item of [
      { body: {}, code: 'archive_confirmation_required' },
      { body: { confirmation_text: 'ARCHIVE MAPPING', page_id: 'do-not-accept' }, code: 'page_id_not_accepted' }
    ]) {
      const state = createState();
      addPage(state, { id: 'page-staging-active', page_id: 'page_confirm' });
      const queries = [];
      const service = createPostgresPageMappingWriteService({
        databaseUrl: 'postgres://example.test/db',
        Client: makeClientClass({ state, queries }),
        env: { NODE_ENV: 'staging' }
      });

      let err = null;
      try {
        await service.archivePageMapping({
          principal,
          shopId: 'staging-shop',
          pageMappingId: 'page-staging-active',
          body: item.body
        });
      } catch (caught) {
        err = caught;
      }

      expect(err && err.code).toBe(item.code);
      expect(state.pages.find(row => row.id === 'page-staging-active').status).toBe('active');
      expect(queries.some(query => /^UPDATE shop_pages/i.test(query.sql))).toBeFalse();
      expect(queries.some(query => /^INSERT INTO admin_audit_log/i.test(query.sql))).toBeFalse();
    }
  });

  it('duplicate active page conflict clears after the old mapping is archived', async () => {
    const state = createState();
    addPage(state, { id: 'page-staging-active', page_id: 'page_conflict_clear' });
    const queries = [];
    const service = createPostgresPageMappingWriteService({
      databaseUrl: 'postgres://example.test/db',
      Client: makeClientClass({ state, queries }),
      env: { NODE_ENV: 'staging' }
    });

    await service.archivePageMapping({
      principal,
      shopId: 'staging-shop',
      pageMappingId: 'page-staging-active',
      body: { confirmation_text: 'ARCHIVE MAPPING' }
    });
    const result = await service.createPageMapping({
      principal,
      shopId: 'other-shop',
      body: { page_id: 'page_conflict_clear', page_name: 'Replacement Page' }
    });

    expect(result.shopId).toBe('other-shop');
    expect(result.page.status).toBe('active');
    expect(state.pages.find(row => row.id === 'page-staging-active').status).toBe('archived');
    expect(state.pages.filter(row => row.page_id === 'page_conflict_clear' && row.status === 'active').length).toBe(1);
  });
});

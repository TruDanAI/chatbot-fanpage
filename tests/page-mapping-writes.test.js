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
        this.txPages = cloneRows(state.pages);
        this.txAudits = cloneRows(state.audits);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        if (commitCommand === 'COMMIT') {
          state.pages = cloneRows(this.txPages);
          state.audits = cloneRows(this.txAudits);
        }
        this.txPages = null;
        this.txAudits = null;
        return { rows: [], command: commitCommand };
      }
      if (normalized === 'ROLLBACK') {
        this.txPages = null;
        this.txAudits = null;
        return { rows: [] };
      }

      const pages = this.txPages || state.pages;
      const audits = this.txAudits || state.audits;

      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: state.shops.filter(shop => shop.id === id || shop.slug === id).slice(0, 1) };
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
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
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
});

const { describe, it, expect } = require('./harness');
const {
  createPostgresShopControlWriteService,
  normalizeControlPlaneInput,
  summarizeReadiness,
  validateControlPlaneInput
} = require('../core/admin/shop-control-writes');

function createPrincipal() {
  return {
    id: 'admin-1',
    roles: ['maintainer'],
    permissions: ['admin.product.write'],
    tenantId: 'default',
    pageId: 'page-safe',
    authMethod: 'test'
  };
}

function createFakeClientClass({
  shop = {},
  settings = {},
  counts = {},
  queries = [],
  auditEntries = []
} = {}) {
  const state = {
    shop: {
      id: 'new-shop',
      slug: 'new-shop',
      name: 'New Shop',
      status: 'active',
      package: 'basic',
      lifecycle: 'configuring',
      live_enabled: false,
      last_readiness_status: 'unknown',
      last_readiness_checked_at: '',
      last_manual_test_status: 'unknown',
      last_manual_test_at: '',
      last_ready_by: '',
      updated_at: '2026-05-17T00:00:00.000Z',
      ...shop
    },
    settings: {
      bot_mode: 'menu_code_handoff',
      ...settings
    },
    counts: {
      active_page_mapping_count: 1,
      active_credential_count: 1,
      active_product_count: 1,
      active_menu_image_count: 1,
      active_product_image_count: 0,
      ...counts
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
      queries.push({ sql: normalized, params });
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { command: normalized, rows: [] };
      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        return { rows: [state.shop] };
      }
      if (normalized.includes('FROM shop_settings') && normalized.includes('SELECT bot_mode')) {
        return { rows: [state.settings] };
      }
      if (normalized.includes('active_page_mapping_count')) {
        return { rows: [state.counts] };
      }
      if (/^UPDATE shops/i.test(normalized)) {
        state.shop = {
          ...state.shop,
          package: params[1],
          lifecycle: params[2],
          live_enabled: params[3],
          last_readiness_status: params[4],
          last_readiness_checked_at: '2026-05-17T00:01:00.000Z',
          last_manual_test_status: params[5],
          last_manual_test_at: state.shop.last_manual_test_status === params[5]
            ? state.shop.last_manual_test_at
            : '2026-05-17T00:01:00.000Z',
          last_ready_by: params[4] === 'passed' ? params[6] : state.shop.last_ready_by,
          updated_at: '2026-05-17T00:01:00.000Z'
        };
        return { rows: [state.shop] };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        auditEntries.push(JSON.parse(params[12]));
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

describe('shop control writes', () => {
  it('normalizes and validates control-plane input', () => {
    const input = normalizeControlPlaneInput({
      status: 'active',
      package: 'basic',
      lifecycle: 'configuring',
      live_enabled: false,
      last_manual_test_status: 'unknown'
    }, {
      package: ' sales_flow ',
      lifecycle: ' live ',
      live_enabled: 'true',
      manual_test_status: 'passed'
    });

    expect(input).toEqual({
      package: 'sales_flow',
      lifecycle: 'live',
      live_enabled: true,
      last_manual_test_status: 'passed'
    });
    validateControlPlaneInput(input);
  });

  it('summarizes readiness with manual test as a hard blocker', () => {
    const readiness = summarizeReadiness({
      shop: { status: 'active' },
      settings: { bot_mode: 'menu_code_handoff' },
      counts: {
        active_page_mapping_count: 1,
        active_credential_count: 1,
        active_product_count: 1,
        active_menu_image_count: 1,
        active_product_image_count: 0
      },
      manualTestStatus: 'unknown'
    });

    expect(readiness.status).toBe('failed');
    expect(readiness.hardBlockers.map(item => item.key)).toContain('manual_test_ready');
    expect(readiness.warnings.map(item => item.key)).toContain('product_assets_ready');
  });

  it('updates control plane and writes one safe audit event', async () => {
    const queries = [];
    const auditEntries = [];
    const service = createPostgresShopControlWriteService({
      databaseUrl: 'postgres://test-url',
      Client: createFakeClientClass({ queries, auditEntries }),
      shopLiveGateEnabled: true
    });

    const result = await service.updateControlPlane({
      principal: createPrincipal(),
      shopId: 'new-shop',
      body: {
        package: 'sales_flow',
        lifecycle: 'live',
        live_enabled: 'true',
        manual_test_status: 'passed',
        confirm_live: 'true'
      },
      requestContext: {
        requestId: 'req-1',
        ip: '127.0.0.1',
        userAgent: 'test-agent'
      }
    });

    expect(result.shop.package).toBe('sales_flow');
    expect(result.shop.lifecycle).toBe('live');
    expect(result.shop.live_enabled).toBeTrue();
    expect(result.shop.last_readiness_status).toBe('passed');
    expect(result.shop.last_ready_by).toBe('admin-1');
    expect(result.readiness.warnings.map(item => item.key)).toContain('product_assets_ready');
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].changedFields).toEqual(['package', 'lifecycle', 'live_enabled', 'last_manual_test_status']);
    expect(auditEntries[0].readinessStatus).toBe('passed');
    expect(auditEntries[0].warnings).toContain('product_assets_ready');
    expect(auditEntries[0].gateEnabled).toBeTrue();
    expect(auditEntries[0].liveImpact).toBeTrue();
    expect(auditEntries[0].shop).toBe(undefined);
    expect(auditEntries[0].operator).toBe(undefined);
    expect(JSON.stringify(auditEntries[0]).includes('postgres://')).toBeFalse();
    expect(JSON.stringify(auditEntries[0]).includes('token')).toBeFalse();
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeTrue();
  });

  it('preserves archived lifecycle fallback when legacy rows contain null control fields', () => {
    const input = normalizeControlPlaneInput({
      status: 'archived',
      package: null,
      lifecycle: null,
      live_enabled: null,
      last_manual_test_status: null
    }, {
      package: 'basic'
    });

    expect(input).toEqual({
      package: 'basic',
      lifecycle: 'archived',
      live_enabled: false,
      last_manual_test_status: 'unknown'
    });
  });

  it('requires readiness override before live when hard blockers exist', async () => {
    const service = createPostgresShopControlWriteService({
      databaseUrl: 'postgres://test-url',
      Client: createFakeClientClass({
        counts: {
          active_page_mapping_count: 0,
          active_credential_count: 0,
          active_product_count: 0,
          active_menu_image_count: 0
        }
      })
    });

    let error;
    try {
      await service.updateControlPlane({
        principal: createPrincipal(),
        shopId: 'new-shop',
        body: {
          lifecycle: 'live',
          live_enabled: 'true',
          manual_test_status: 'passed',
          confirm_live: 'true'
        }
      });
    } catch (err) {
      error = err;
    }

    expect(error.code).toBe('readiness_blockers_present');
    expect(error.details.blockers).toContain('page_mapping_ready');
  });
});

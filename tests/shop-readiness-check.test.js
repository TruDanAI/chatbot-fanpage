const { describe, it, expect } = require('./harness');
const {
  createPostgresShopReadinessCheckService
} = require('../core/admin/shop-readiness-check');

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
  dryRunColumnMissing = false,
  queries = [],
  auditEntries = []
} = {}) {
  const state = {
    shop: shop === null ? null : {
      id: 'ready-shop',
      slug: 'ready-shop',
      name: 'Ready Shop',
      status: 'active',
      package: 'basic',
      lifecycle: 'configuring',
      live_enabled: false,
      dry_run: true,
      last_readiness_status: 'unknown',
      last_readiness_checked_at: '',
      last_manual_test_status: 'passed',
      last_manual_test_at: '2026-05-17T00:00:00.000Z',
      last_ready_by: '',
      page_id: 'raw-page-id',
      page_access_token: 'raw-token',
      encrypted_value: 'encrypted-secret',
      ...shop
    },
    settings: settings === null ? null : {
      bot_mode: 'menu_code_handoff',
      ...settings
    },
    counts: {
      active_page_mapping_count: 1,
      active_product_count: 1,
      active_menu_image_count: 1,
      active_product_image_count: 1,
      active_credential_count: 1,
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
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { command: normalized, rows: [] };
      }
      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        return { rows: state.shop ? [state.shop] : [] };
      }
      if (normalized.includes('FROM shop_settings') && normalized.includes('SELECT bot_mode')) {
        return { rows: state.settings ? [state.settings] : [] };
      }
      if (normalized.includes('active_page_mapping_count')) {
        return { rows: [state.counts] };
      }
      if (normalized.includes('FROM shop_page_credentials')) {
        return { rows: [{ active_credential_count: state.counts.active_credential_count }] };
      }
      if (normalized.includes('SELECT dry_run') && normalized.includes('FROM shops')) {
        if (dryRunColumnMissing) {
          const err = new Error('column dry_run does not exist');
          err.code = '42703';
          throw err;
        }
        return { rows: state.shop ? [{ dry_run: state.shop.dry_run }] : [] };
      }
      if (/^UPDATE shops/i.test(normalized)) {
        state.shop = {
          ...state.shop,
          last_readiness_status: params[1],
          last_readiness_checked_at: '2026-05-17T00:01:00.000Z'
        };
        return {
          rows: [{
            id: state.shop.id,
            last_readiness_status: state.shop.last_readiness_status,
            last_readiness_checked_at: state.shop.last_readiness_checked_at
          }]
        };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        auditEntries.push(JSON.parse(params[12]));
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

function createService(options = {}) {
  return createPostgresShopReadinessCheckService({
    databaseUrl: 'postgres://test-url',
    Client: createFakeClientClass(options),
    env: options.env || { MESSENGER_DRY_RUN: 'true' }
  });
}

async function runReadiness(options = {}) {
  const service = createService(options);
  return service.checkReadiness({
    principal: createPrincipal(),
    shopId: 'ready-shop',
    requestContext: {
      requestId: 'req-ready-1',
      ip: '127.0.0.1',
      userAgent: 'test-agent'
    }
  });
}

describe('shop readiness check service', () => {
  it('passes a fully configured shop and updates only readiness fields', async () => {
    const queries = [];
    const auditEntries = [];
    const result = await runReadiness({ queries, auditEntries });

    expect(result.readiness.readiness_status).toBe('passed');
    expect(result.readiness.hard_blockers).toEqual([]);
    expect(result.readiness.warnings).toEqual([]);
    expect(result.readiness.safe_counts).toEqual({
      products: 1,
      menu_images: 1,
      product_images: 1,
      active_page_mappings: 1,
      active_credentials: 1
    });
    const updateQuery = queries.find(item => /^UPDATE shops/i.test(item.sql));
    expect(Boolean(updateQuery)).toBeTrue();
    expect(updateQuery.params).toEqual(['ready-shop', 'passed']);
    expect(updateQuery.sql.includes('last_readiness_status')).toBeTrue();
    expect(updateQuery.sql.includes('last_readiness_checked_at')).toBeTrue();
    expect(updateQuery.sql.includes('lifecycle =')).toBeFalse();
    expect(updateQuery.sql.includes('live_enabled =')).toBeFalse();
    expect(updateQuery.sql.includes('last_manual_test_status =')).toBeFalse();
    expect(updateQuery.sql.includes('updated_at =')).toBeFalse();
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].readiness_status).toBe('passed');
    expect(JSON.stringify(auditEntries[0]).includes('raw-token')).toBeFalse();
    expect(JSON.stringify(auditEntries[0]).includes('encrypted-secret')).toBeFalse();
    expect(JSON.stringify(auditEntries[0]).includes('raw-page-id')).toBeFalse();
  });

  it('fails the expected hard readiness checks', async () => {
    for (const item of [
      { counts: { active_product_count: 0 }, key: 'product_ready' },
      { counts: { active_menu_image_count: 0 }, key: 'menu_assets_ready' },
      { counts: { active_page_mapping_count: 0 }, key: 'page_mapping_ready' },
      { counts: { active_credential_count: 0 }, key: 'credential_ready' },
      { shop: { last_manual_test_status: 'unknown' }, key: 'manual_test_ready' }
    ]) {
      const result = await runReadiness(item);
      expect(result.readiness.readiness_status).toBe('failed');
      expect(result.readiness.hard_blockers.map(row => row.key)).toContain(item.key);
    }
  });

  it('passes Basic shops with product image gaps while keeping the warning visible', async () => {
    const queries = [];
    const auditEntries = [];
    const warningResult = await runReadiness({
      queries,
      auditEntries,
      counts: {
        active_product_count: 2,
        active_menu_image_count: 1,
        active_product_image_count: 1
      }
    });
    expect(warningResult.readiness.readiness_status).toBe('passed');
    expect(warningResult.readiness.hard_blockers).toEqual([]);
    expect(warningResult.readiness.warnings.map(row => row.key)).toContain('product_assets_ready');
    expect(warningResult.readiness.checks.find(row => row.key === 'product_assets_ready').status).toBe('warning');
    expect(queries.find(item => /^UPDATE shops/i.test(item.sql)).params).toEqual(['ready-shop', 'passed']);
    expect(auditEntries[0].readiness_status).toBe('passed');
    expect(auditEntries[0].warning_keys).toContain('product_assets_ready');

    const missingMenuResult = await runReadiness({
      counts: {
        active_product_count: 2,
        active_menu_image_count: 0,
        active_product_image_count: 0
      }
    });
    expect(missingMenuResult.readiness.readiness_status).toBe('failed');
    expect(missingMenuResult.readiness.hard_blockers.map(row => row.key)).toContain('menu_assets_ready');
    expect(missingMenuResult.readiness.warnings.map(row => row.key).includes('product_assets_ready')).toBeFalse();
  });

  it('handles paused and archived shops safely', async () => {
    const paused = await runReadiness({ shop: { status: 'paused' } });
    expect(paused.readiness.readiness_status).toBe('failed');
    expect(paused.readiness.hard_blockers.map(row => row.key)).toContain('shop_active');

    const queries = [];
    let error;
    try {
      await runReadiness({ queries, shop: { status: 'archived', lifecycle: 'archived' } });
    } catch (err) {
      error = err;
    }
    expect(error.code).toBe('shop_archived');
    expect(queries.some(item => /^UPDATE shops/i.test(item.sql))).toBeFalse();
    expect(queries.some(item => /^INSERT INTO admin_audit_log/i.test(item.sql))).toBeFalse();
  });

  it('returns safe JSON without raw page, token, encrypted, or customer values', async () => {
    const result = await runReadiness({
      shop: {
        customer_phone: '0987654321',
        sender_id: 'sender-secret'
      },
      settings: {
        bot_mode: 'menu_code_handoff',
        access_token: 'settings-token'
      }
    });
    const bodyText = JSON.stringify(result.readiness);

    expect(bodyText.includes('raw-page-id')).toBeFalse();
    expect(bodyText.includes('raw-token')).toBeFalse();
    expect(bodyText.includes('encrypted-secret')).toBeFalse();
    expect(bodyText.includes('settings-token')).toBeFalse();
    expect(bodyText.includes('0987654321')).toBeFalse();
    expect(bodyText.includes('sender-secret')).toBeFalse();
  });

  it('warns when shop dry_run is false and global dry-run state is unknown', async () => {
    const result = await runReadiness({
      env: {},
      shop: { dry_run: false }
    });

    expect(result.readiness.readiness_status).toBe('passed');
    expect(result.readiness.warnings.map(row => row.key)).toContain('dry_run_global_unknown');
  });
});

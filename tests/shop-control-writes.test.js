const { describe, it, expect } = require('./harness');
const {
  PAUSE_CONFIRMATION,
  RESUME_CONFIRMATION,
  SHOP_PAUSE_ACTION,
  SHOP_RESUME_ACTION,
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
      dry_run: true,
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

function createEmergencyState(shop = {}) {
  return {
    shop: {
      id: 'emergency-shop',
      slug: 'emergency-shop',
      name: 'Emergency Shop',
      status: 'active',
      package: 'basic',
      lifecycle: 'live',
      dry_run: false,
      live_enabled: true,
      last_readiness_status: 'passed',
      last_readiness_checked_at: '2026-05-17T00:00:00.000Z',
      last_manual_test_status: 'passed',
      last_manual_test_at: '2026-05-17T00:00:00.000Z',
      last_ready_by: 'admin-1',
      updated_at: '2026-05-17T00:00:00.000Z',
      page_id: 'raw-page-id',
      page_access_token: 'raw-token',
      encrypted_value: 'encrypted-secret',
      ...shop
    },
    audits: []
  };
}

function cloneRow(row = {}) {
  return { ...row };
}

function createEmergencyClientClass({ state, queries = [], failAudit = false } = {}) {
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

      if (normalized === 'BEGIN') {
        this.txShop = cloneRow(state.shop);
        this.txAudits = state.audits.map(cloneRow);
        return { rows: [] };
      }
      if (normalized === 'COMMIT') {
        state.shop = cloneRow(this.txShop);
        state.audits = this.txAudits.map(cloneRow);
        this.txShop = null;
        this.txAudits = null;
        return { rows: [], command: 'COMMIT' };
      }
      if (normalized === 'ROLLBACK') {
        this.txShop = null;
        this.txAudits = null;
        return { rows: [] };
      }

      const shop = this.txShop || state.shop;
      const audits = this.txAudits || state.audits;
      if (normalized.includes('FROM shops') && normalized.includes('WHERE id = $1 OR slug = $1')) {
        const id = params[0];
        return { rows: shop.id === id || shop.slug === id ? [cloneRow(shop)] : [] };
      }
      if (/^UPDATE shops/i.test(normalized) && normalized.includes('SET status = $2')) {
        if (shop.id !== params[0]) return { rows: [] };
        shop.status = params[1];
        shop.lifecycle = params[2];
        shop.dry_run = params[3];
        shop.live_enabled = params[4];
        if (params[5]) {
          shop.last_readiness_status = 'unknown';
          shop.last_readiness_checked_at = null;
        }
        shop.updated_at = '2026-05-17T00:02:00.000Z';
        return { rows: [cloneRow(shop)] };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAudit) {
          const err = new Error('audit insert failed at postgres://secret');
          err.code = 'audit_failed';
          throw err;
        }
        audits.push({
          action: params[5],
          resourceType: params[6],
          resourceId: params[7],
          metadata: JSON.parse(params[12])
        });
        return { rows: [] };
      }

      throw new Error(`unexpected query: ${normalized}`);
    }
  };
}

function createEmergencyService({ state, queries = [], failAudit = false, env = { NODE_ENV: 'staging' } } = {}) {
  return createPostgresShopControlWriteService({
    databaseUrl: 'postgres://test-url',
    Client: createEmergencyClientClass({ state, queries, failAudit }),
    env
  });
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

  it('pauses an active shop with dry-run forced and a safe audit event', async () => {
    const state = createEmergencyState();
    const queries = [];
    const service = createEmergencyService({ state, queries });

    const result = await service.pauseShop({
      principal: createPrincipal(),
      shopId: 'emergency-shop',
      body: { confirmation_text: PAUSE_CONFIRMATION },
      requestContext: {
        requestId: 'req-pause-1',
        ip: '127.0.0.1',
        userAgent: 'test-agent'
      }
    });

    expect(result.shop.status).toBe('paused');
    expect(result.shop.lifecycle).toBe('paused');
    expect(result.shop.dry_run).toBeTrue();
    expect(result.shop.live_enabled).toBeFalse();
    expect(state.shop.status).toBe('paused');
    expect(state.shop.lifecycle).toBe('paused');
    expect(state.shop.dry_run).toBeTrue();
    expect(state.shop.live_enabled).toBeFalse();
    expect(state.audits.length).toBe(1);
    expect(state.audits[0].action).toBe(SHOP_PAUSE_ACTION);
    expect(state.audits[0].metadata.changedFields).toEqual(['status', 'lifecycle', 'dry_run', 'live_enabled']);
    expect(state.audits[0].metadata.oldStatus).toBe('active');
    expect(state.audits[0].metadata.newStatus).toBe('paused');
    expect(state.audits[0].metadata.oldLifecycle).toBe('live');
    expect(state.audits[0].metadata.newLifecycle).toBe('paused');
    expect(state.audits[0].metadata.dryRunAfter).toBeTrue();
    expect(state.audits[0].metadata.liveEnabledAfter).toBeFalse();
    expect(state.audits[0].metadata.shop_ref.startsWith('s:')).toBeTrue();
    expect(state.audits[0].metadata.auth_method).toBe(undefined);
    const metadataText = JSON.stringify(state.audits[0].metadata);
    expect(metadataText.includes('emergency-shop')).toBeFalse();
    expect(metadataText.includes('raw-page-id')).toBeFalse();
    expect(metadataText.includes('raw-token')).toBeFalse();
    expect(metadataText.includes('encrypted-secret')).toBeFalse();
    expect(queries.some(item => item.sql === 'COMMIT')).toBeTrue();
    expect(queries.some(item => item.sql === 'ROLLBACK')).toBeFalse();
  });

  it('resumes a paused shop as active dry-run without enabling live sends', async () => {
    const state = createEmergencyState({
      status: 'paused',
      lifecycle: 'paused',
      dry_run: false,
      live_enabled: true,
      last_readiness_status: 'passed',
      last_readiness_checked_at: '2026-05-17T00:01:00.000Z'
    });
    const service = createEmergencyService({ state });

    const result = await service.resumeShop({
      principal: createPrincipal(),
      shopId: 'emergency-shop',
      body: { confirm_resume: 'true', live_enabled: 'true', lifecycle: 'live' }
    });

    expect(result.shop.status).toBe('active');
    expect(result.shop.lifecycle).toBe('configuring');
    expect(result.shop.dry_run).toBeTrue();
    expect(result.shop.live_enabled).toBeFalse();
    expect(result.shop.last_readiness_status).toBe('unknown');
    expect(result.shop.last_readiness_checked_at).toBe('');
    expect(state.shop.status).toBe('active');
    expect(state.shop.lifecycle).toBe('configuring');
    expect(state.shop.dry_run).toBeTrue();
    expect(state.shop.live_enabled).toBeFalse();
    expect(state.shop.last_readiness_status).toBe('unknown');
    expect(state.shop.last_readiness_checked_at).toBe(null);
    expect(state.audits[0].action).toBe(SHOP_RESUME_ACTION);
    expect(state.audits[0].metadata.newStatus).toBe('active');
    expect(state.audits[0].metadata.newLifecycle).toBe('configuring');
    expect(state.audits[0].metadata.dryRunAfter).toBeTrue();
    expect(state.audits[0].metadata.liveEnabledAfter).toBeFalse();
    expect(state.audits[0].metadata.changedFields).toEqual([
      'status',
      'lifecycle',
      'dry_run',
      'live_enabled',
      'last_readiness_status',
      'last_readiness_checked_at'
    ]);
  });

  it('rejects adult-shop emergency controls and missing confirmations', async () => {
    for (const item of [
      {
        state: createEmergencyState({ id: 'adult-shop', slug: 'adult-shop' }),
        method: 'pauseShop',
        body: { confirm: true },
        code: 'adult_shop_protected'
      },
      {
        state: createEmergencyState(),
        method: 'pauseShop',
        body: {},
        code: 'pause_confirmation_required'
      },
      {
        state: createEmergencyState({ status: 'paused', lifecycle: 'paused' }),
        method: 'resumeShop',
        body: {},
        code: 'resume_confirmation_required'
      }
    ]) {
      const queries = [];
      const service = createEmergencyService({ state: item.state, queries });
      let error;
      try {
        await service[item.method]({
          principal: createPrincipal(),
          shopId: item.state.shop.id,
          body: item.body
        });
      } catch (err) {
        error = err;
      }

      expect(error.code).toBe(item.code);
      expect(item.state.audits.length).toBe(0);
      expect(queries.some(query => /^UPDATE shops/i.test(query.sql))).toBeFalse();
      expect(queries.some(query => /^INSERT INTO admin_audit_log/i.test(query.sql))).toBeFalse();
      expect(queries.some(query => query.sql === 'ROLLBACK')).toBeTrue();
    }
  });

  it('rejects emergency controls outside staging before updates or audit', async () => {
    const state = createEmergencyState();
    const queries = [];
    const service = createEmergencyService({
      state,
      queries,
      env: { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'production' }
    });

    let error;
    try {
      await service.pauseShop({
        principal: createPrincipal(),
        shopId: 'emergency-shop',
        body: { confirmation_text: PAUSE_CONFIRMATION }
      });
    } catch (err) {
      error = err;
    }

    expect(error.code).toBe('staging_only');
    expect(state.shop.status).toBe('active');
    expect(state.shop.dry_run).toBeFalse();
    expect(state.audits.length).toBe(0);
    expect(queries.some(query => /^UPDATE shops/i.test(query.sql))).toBeFalse();
    expect(queries.some(query => /^INSERT INTO admin_audit_log/i.test(query.sql))).toBeFalse();
    expect(queries.some(query => query.sql === 'ROLLBACK')).toBeTrue();
  });

  it('rolls back emergency shop updates when audit insert fails', async () => {
    const state = createEmergencyState();
    const queries = [];
    const service = createEmergencyService({ state, queries, failAudit: true });

    let error;
    try {
      await service.pauseShop({
        principal: createPrincipal(),
        shopId: 'emergency-shop',
        body: { confirmation_text: PAUSE_CONFIRMATION }
      });
    } catch (err) {
      error = err;
    }

    expect(error.code).toBe('audit_failed');
    expect(state.shop.status).toBe('active');
    expect(state.shop.lifecycle).toBe('live');
    expect(state.shop.dry_run).toBeFalse();
    expect(state.shop.live_enabled).toBeTrue();
    expect(state.audits.length).toBe(0);
    expect(queries.some(query => /^UPDATE shops/i.test(query.sql))).toBeTrue();
    expect(queries.some(query => /^INSERT INTO admin_audit_log/i.test(query.sql))).toBeTrue();
    expect(queries.some(query => query.sql === 'ROLLBACK')).toBeTrue();
    expect(queries.some(query => query.sql === 'COMMIT')).toBeFalse();
  });
});

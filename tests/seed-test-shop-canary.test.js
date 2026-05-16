const { describe, it, expect } = require('./harness');
const {
  PRODUCTION_CONFIRMATION,
  chooseDatabaseUrl,
  getSeedInput,
  parseArgs,
  seedTestShopCanary,
  validateSeedInput
} = require('../scripts/seed-test-shop-canary');

function createState(overrides = {}) {
  return {
    shops: [
      { id: 'adult-shop', slug: 'adult-shop', status: 'active' }
    ],
    shop_pages: [
      { id: 'adult-page-map', shop_id: 'adult-shop', page_id: 'adult-page-secret', page_name: 'Adult', status: 'active' }
    ],
    shop_settings: [
      { shop_id: 'adult-shop', bot_mode: 'menu_code_handoff' }
    ],
    shop_products: Array.from({ length: 14 }, (_, index) => ({
      id: `adult-product-${index + 1}`,
      shop_id: 'adult-shop',
      code: `A${index + 1}`,
      status: 'active'
    })),
    shop_assets: Array.from({ length: 16 }, (_, index) => ({
      id: `adult-asset-${index + 1}`,
      shop_id: 'adult-shop',
      status: 'active'
    })),
    shop_page_credentials: [
      {
        id: 'adult-credential',
        shop_id: 'adult-shop',
        page_mapping_id: 'adult-page-map',
        credential_type: 'fb_page_token',
        status: 'active'
      }
    ],
    ...overrides
  };
}

function createFakeClient(state = createState()) {
  const calls = [];

  function countTable(name) {
    return (state[name] || []).length;
  }

  function adultCounts() {
    return {
      shops: state.shops.filter(row => row.id === 'adult-shop').length,
      shop_pages: state.shop_pages.filter(row => row.shop_id === 'adult-shop').length,
      shop_settings: state.shop_settings.filter(row => row.shop_id === 'adult-shop').length,
      shop_products: state.shop_products.filter(row => row.shop_id === 'adult-shop').length,
      shop_assets: state.shop_assets.filter(row => row.shop_id === 'adult-shop').length,
      active_credentials: state.shop_page_credentials.filter(row => (
        row.shop_id === 'adult-shop'
        && row.credential_type === 'fb_page_token'
        && row.status === 'active'
      )).length
    };
  }

  return {
    calls,
    async query(sql, values = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: String(sql), values });

      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };

      const tableCount = normalized.match(/^SELECT COUNT\(\*\)::int AS count FROM ([a-z_]+)$/i);
      if (tableCount) {
        return { rows: [{ count: countTable(tableCount[1]) }] };
      }

      if (normalized.includes("SELECT COUNT(*)::int FROM shops WHERE id = 'adult-shop'")) {
        return { rows: [adultCounts()] };
      }

      if (normalized.includes('FROM shop_pages sp') && normalized.includes('WHERE sp.page_id = $1')) {
        return {
          rows: state.shop_pages
            .filter(row => row.page_id === values[0])
            .map(row => ({
              id: row.id,
              shop_id: row.shop_id,
              status: row.status,
              shop_status: state.shops.find(shop => shop.id === row.shop_id)?.status || ''
            }))
        };
      }

      if (normalized.includes('FROM shops') && normalized.includes('WHERE slug = $1')) {
        return {
          rows: state.shops.filter(row => (
            row.slug === values[0]
            && row.id !== values[1]
            && row.status === 'active'
          ))
        };
      }

      if (normalized.includes('FROM shop_products') && normalized.includes('WHERE id = ANY($1)')) {
        const ids = new Set(values[0] || []);
        return { rows: state.shop_products.filter(row => ids.has(row.id)) };
      }

      if (normalized.includes('SELECT id, lower(code) AS code FROM shop_products')) {
        const codes = new Set(values[1] || []);
        return {
          rows: state.shop_products
            .filter(row => row.shop_id === values[0] && row.status === 'active' && codes.has(String(row.code).toLowerCase()))
            .map(row => ({ id: row.id, code: String(row.code).toLowerCase() }))
        };
      }

      if (normalized.includes('COUNT(*) FILTER') && normalized.includes('FROM shop_page_credentials')) {
        const [shopId, credentialType, pageMappingId] = values;
        return {
          rows: [{
            shop_active_count: state.shop_page_credentials.filter(row => (
              row.shop_id === shopId
              && row.credential_type === credentialType
              && row.status === 'active'
            )).length,
            mapping_active_count: state.shop_page_credentials.filter(row => (
              row.shop_id === shopId
              && row.page_mapping_id === pageMappingId
              && row.credential_type === credentialType
              && row.status === 'active'
            )).length
          }]
        };
      }

      if (normalized.startsWith('INSERT INTO shops')) {
        const [id, slug, name] = values;
        const existing = state.shops.find(row => row.id === id);
        if (existing) {
          Object.assign(existing, { slug, name, status: 'active' });
        } else {
          state.shops.push({ id, slug, name, status: 'active' });
        }
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith('UPDATE shop_pages')) {
        const [id, shopId, pageName] = values;
        const existing = state.shop_pages.find(row => row.id === id && row.shop_id === shopId);
        if (existing) Object.assign(existing, { page_name: pageName, status: 'active' });
        return { rows: [], rowCount: existing ? 1 : 0 };
      }

      if (normalized.startsWith('INSERT INTO shop_pages')) {
        const [id, shopId, pageId, pageName] = values;
        state.shop_pages.push({ id, shop_id: shopId, page_id: pageId, page_name: pageName, status: 'active' });
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith('INSERT INTO shop_settings')) {
        const [shopId] = values;
        const existing = state.shop_settings.find(row => row.shop_id === shopId);
        if (existing) {
          existing.bot_mode = 'menu_code_handoff';
        } else {
          state.shop_settings.push({ shop_id: shopId, bot_mode: 'menu_code_handoff' });
        }
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith('INSERT INTO shop_products')) {
        const [id, shopId, code] = values;
        const existing = state.shop_products.find(row => row.id === id);
        if (existing) {
          Object.assign(existing, { code, status: 'active' });
        } else {
          state.shop_products.push({ id, shop_id: shopId, code, status: 'active' });
        }
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith('INSERT INTO shop_page_credentials')) {
        const [id, shopId, pageMappingId, credentialType, encryptedValue] = values;
        state.shop_page_credentials.push({
          id,
          shop_id: shopId,
          page_mapping_id: pageMappingId,
          credential_type: credentialType,
          encrypted_value: encryptedValue,
          status: 'active'
        });
        return { rows: [], rowCount: 1 };
      }

      if (normalized.includes('(SELECT COUNT(*)::int FROM shops WHERE id = $1')) {
        const [shopId, shopSlug, pageId, credentialType] = values;
        return {
          rows: [{
            shop_exists: state.shops.filter(row => row.id === shopId && row.slug === shopSlug && row.status === 'active').length,
            page_mapping_exists: state.shop_pages.filter(row => row.shop_id === shopId && row.page_id === pageId && row.status === 'active').length,
            settings_exists: state.shop_settings.filter(row => row.shop_id === shopId && row.bot_mode === 'menu_code_handoff').length,
            active_products: state.shop_products.filter(row => row.shop_id === shopId && row.status === 'active').length,
            active_assets: state.shop_assets.filter(row => row.shop_id === shopId && row.status === 'active').length,
            active_credentials: state.shop_page_credentials.filter(row => (
              row.shop_id === shopId
              && row.credential_type === credentialType
              && row.status === 'active'
            )).length
          }]
        };
      }

      throw new Error(`unexpected_query:${normalized}`);
    }
  };
}

function baseEnv(overrides = {}) {
  return {
    DATABASE_URL: 'postgres://prod-user:prod-pass@example.test/proddb',
    DATABASE_PUBLIC_URL: 'postgres://public-user:public-pass@example.test/proddb',
    CHATBOT_TEST_DATABASE_URL: 'postgres://test-user:test-pass@example.test/testdb',
    CREDENTIAL_MASTER_KEY: 'local-test-master-key-32-plus-characters',
    TEST_SHOP_PAGE_ID: 'test-page-secret',
    TEST_SHOP_PAGE_TOKEN: 'EAAB-test-page-token',
    TEST_SHOP_FB_APP_SECRET: 'test-app-secret',
    ...overrides
  };
}

describe('test-shop canary seed script', () => {
  it('applies the seed without logging raw secrets, page id, or encrypted value', async () => {
    const env = baseEnv({ CONFIRM_PRODUCTION_WRITE: PRODUCTION_CONFIRMATION });
    const state = createState();
    const client = createFakeClient(state);
    const lines = [];

    await seedTestShopCanary({
      client,
      env,
      options: { apply: true, production: true },
      stdout: line => lines.push(line)
    });

    const credentialInsert = client.calls.find(call => /INSERT INTO shop_page_credentials/i.test(call.sql));
    const encryptedValue = credentialInsert.values[4];
    const output = lines.join('\n');

    expect(output.includes(env.TEST_SHOP_PAGE_TOKEN)).toBeFalse();
    expect(output.includes(env.TEST_SHOP_FB_APP_SECRET)).toBeFalse();
    expect(output.includes(env.TEST_SHOP_PAGE_ID)).toBeFalse();
    expect(output.includes(encryptedValue)).toBeFalse();
    expect(output).toContain('test_shop_exists=true');
    expect(output).toContain('test_shop_active_fb_page_token_credentials=1');
    expect(output).toContain('adult_shop_unchanged=true');
  });

  it('fails closed when the test page already belongs to another shop', async () => {
    const env = baseEnv({ CONFIRM_PRODUCTION_WRITE: PRODUCTION_CONFIRMATION });
    const state = createState({
      shop_pages: [
        { id: 'adult-page-map', shop_id: 'adult-shop', page_id: env.TEST_SHOP_PAGE_ID, page_name: 'Adult', status: 'active' }
      ]
    });
    const client = createFakeClient(state);
    let errorMessage = '';

    try {
      await seedTestShopCanary({
        client,
        env,
        options: { apply: true, production: true },
        stdout: () => {}
      });
    } catch (err) {
      errorMessage = err.message;
    }

    expect(errorMessage).toBe('test_page_belongs_to_other_shop');
    expect(client.calls.some(call => /INSERT INTO shops/i.test(call.sql))).toBeFalse();
    expect(client.calls.some(call => /INSERT INTO shop_page_credentials/i.test(call.sql))).toBeFalse();
  });

  it('direct production apply requires explicit confirmation before querying', async () => {
    const client = createFakeClient();
    let errorMessage = '';

    try {
      await seedTestShopCanary({
        client,
        env: baseEnv({ CONFIRM_PRODUCTION_WRITE: '' }),
        options: { apply: true, production: true },
        stdout: () => {}
      });
    } catch (err) {
      errorMessage = err.message;
    }

    expect(errorMessage).toBe('missing_production_confirmation');
    expect(client.calls.length).toBe(0);
  });

  it('production apply requires explicit confirmation before selecting a URL', () => {
    const missing = chooseDatabaseUrl({
      env: baseEnv({ CONFIRM_PRODUCTION_WRITE: '' }),
      options: { production: true, apply: true }
    });
    const confirmed = chooseDatabaseUrl({
      env: baseEnv({ CONFIRM_PRODUCTION_WRITE: PRODUCTION_CONFIRMATION }),
      options: { production: true, apply: true }
    });

    expect(missing.ok).toBeFalse();
    expect(missing.reason).toBe('missing_production_confirmation');
    expect(confirmed.ok).toBeTrue();
    expect(confirmed.envName).toBe('DATABASE_PUBLIC_URL');
  });

  it('requires TEST_SHOP_PAGE_ID from env and rejects the page id CLI arg', () => {
    let errorMessage = '';
    try {
      parseArgs(['--page-id', 'legacy-page-id']);
    } catch (err) {
      errorMessage = err.message;
    }

    const input = getSeedInput({
      env: baseEnv({
        TEST_SHOP_PAGE_ID: '',
        PAGE_CREDENTIAL_PAGE_ID: 'legacy-page-id'
      })
    });
    let validationError = '';

    try {
      validateSeedInput(input, { requireCredential: false });
    } catch (err) {
      validationError = err.message;
    }

    expect(errorMessage).toBe('unknown_arg:--page-id');
    expect(validationError).toBe('test_page_id_missing');
  });

  it('uses FB_PAGE_TOKEN when TEST_SHOP_PAGE_TOKEN is missing', () => {
    const input = getSeedInput({
      env: baseEnv({
        TEST_SHOP_PAGE_TOKEN: '',
        FB_PAGE_TOKEN: 'EAAB-live-token'
      })
    });

    expect(input.token).toBe('EAAB-live-token');
  });

  it('requires TEST_SHOP_PAGE_TOKEN or FB_PAGE_TOKEN from env without legacy token fallback', () => {
    const input = getSeedInput({
      env: baseEnv({
        TEST_SHOP_PAGE_TOKEN: '',
        FB_PAGE_TOKEN: '',
        PAGE_CREDENTIAL_TOKEN: 'EAAB-legacy-page-credential-token',
      })
    });
    let errorMessage = '';

    try {
      validateSeedInput(input, { requireCredential: true });
    } catch (err) {
      errorMessage = err.message;
    }

    expect(errorMessage).toBe('test_page_token_missing');
  });
});

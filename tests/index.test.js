const { describe, it, expect } = require('./harness');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), 'chatbot-fanpage-tests', String(process.pid));
process.env.FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'test-verify-token';
process.env.FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || 'test-page-token';
process.env.FB_APP_SECRET = process.env.FB_APP_SECRET || 'test-app-secret';
process.env.USE_GEMINI = 'false';

const {
  buildAbandonedCartReminderText,
  buildDbShopRuntime,
  createRuntimeAllowlist,
  evaluateDbShopRuntimeAdmission,
  evaluateDbShopRuntimeLiveGate,
  buildGeminiRequestHistory,
  buildGeminiRuntimeContext,
  buildHealthPayload,
  buildLeadDetails,
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  getAdminRequestToken,
  getFacebookProfileDisplayName,
  isAllowedResolvedRuntime,
  maybeResetTimedOutSession,
  redactSensitiveText,
  resolveDbShopRuntimeForPage,
  resolveEffectiveMessengerDryRun,
  recordConversationTurn,
  shouldEnableReminderWorkersForShop,
  validateRuntimeAllowlistOnStartup
} = require('../index');
const storage = require('../core/storage');
const { pageRef } = require('../core/utils/log-refs');

describe('index: buildLeadDetails parser hồi quy', () => {
  it('"đổi sang mã 10" đổi sản phẩm, không ghi address = "ma 10"', () => {
    const userId = 'idx_change_product';
    storage.clearOrderDraft(userId);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      name: 'An',
      phone: '0987654321',
      address: '12 Old Street'
    });

    const details = buildLeadDetails('đổi sang mã 10 giúp em', userId);

    expect(details.productCode).toBe('MÃ10');
    expect(details.address).toBe('');
    expect(details.cartItems.length).toBe(1);
    expect(details.cartItems[0].code).toBe('MÃ10');
  });

  it('đổi mẫu vẫn giữ phụ kiện gel trong cart', () => {
    const userId = 'idx_change_product_keep_gel';
    storage.clearOrderDraft(userId);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [
        { code: 'MÃ8', name: 'MÃ8', qty: 1 },
        { code: 'GEL', name: 'gel', qty: 1, variant: 'đào' }
      ],
      name: 'An',
      phone: '0987654321',
      address: '12 Old Street'
    });

    const details = buildLeadDetails('đổi qua mã 10 nha', userId);

    expect(details.cartItems.length).toBe(2);
    expect(details.cartItems[0].code).toBe('MÃ10');
    expect(details.cartItems[1].code).toBe('GEL');
  });

  it('parse format phone trước tên và địa chỉ', () => {
    const details = buildLeadDetails('0987654321 Nguyen Van A 12 Tran Phu', 'idx_phone_first');

    expect(details.phone).toBe('0987654321');
    expect(details.name).toBe('Nguyen Van A');
    expect(details.address).toBe('12 Tran Phu');
  });

  it('parse format có nhãn sdt/ten/dia chi theo thứ tự bất kỳ trong câu', () => {
    const details = buildLeadDetails('sdt 0987654321 ten Nguyễn Văn A dia chi 12 Trần Phú', 'idx_labeled');

    expect(details.phone).toBe('0987654321');
    expect(details.name).toBe('Nguyễn Văn A');
    expect(details.address).toBe('12 Trần Phú');
  });

  it('parse câu "mình tên ..." khi khách đã gửi SĐT và địa chỉ trước đó', () => {
    const userId = 'idx_name_after_phone_address';
    storage.clearOrderDraft(userId);
    storage.mergeOrderDraft(userId, {
      phone: '0987654321',
      address: '12 Trần Phú'
    });

    const details = buildLeadDetails('mình tên An Nguyen', userId);

    expect(details.name).toBe('An Nguyen');
    expect(details.address).toBe('');
  });

  it('đổi địa chỉ không có chữ "địa chỉ" vẫn chỉ nhận khi phần sau giống địa chỉ', () => {
    const details = buildLeadDetails('đổi giúp em sang phường 5 quận 3', 'idx_address_change');

    expect(details.address).toBe('phường 5 quận 3');
  });
});

describe('index: Gemini context smoothing', () => {
  it('ghi cả lượt rule-based vào history để Gemini fallback không mất ngữ cảnh', () => {
    const userId = 'idx_gemini_history';
    storage.setHistory(userId, []);

    recordConversationTurn(userId, 'mã 8', 'Dạ mã 8 bên em đang 680k nha mình');
    const history = storage.getHistory(userId);

    expect(history.length).toBe(2);
    expect(history[0].role).toBe('user');
    expect(history[0].parts[0].text).toBe('mã 8');
    expect(history[1].role).toBe('model');
    expect(history[1].parts[0].text).toContain('680k');
  });

  it('Gemini runtime context có lastProduct + order draft để trả lời câu ngoài rule', () => {
    const userId = 'idx_gemini_context';
    storage.clearOrderDraft(userId);
    storage.setLastProductCode(userId, 'MÃ8');
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      phone: '0987654321'
    });

    const context = buildGeminiRuntimeContext(userId);

    expect(context).toContain('MÃ8 giá 680k');
    expect(context).toContain('Đơn/giỏ nháp: 1 x MÃ8');
    expect(context).toContain('SĐT: 0987654321');
  });

  it('Gemini request history kèm context vào tin nhắn hiện tại nhưng vẫn giữ history cũ', () => {
    const userId = 'idx_gemini_request_history';
    storage.setHistory(userId, []);
    storage.setLastProductCode(userId, 'MÃ10');
    recordConversationTurn(userId, 'mã 10', 'Dạ mã 10 bên em đang 150k nha mình');

    const history = buildGeminiRequestHistory(userId, 'mẫu đó dùng sao shop');

    expect(history.length).toBe(3);
    expect(history[1].parts[0].text).toContain('150k');
    expect(history[2].parts[0].text).toContain('MÃ10 giá 150k');
    expect(history[2].parts[0].text).toContain('Tin nhắn khách cần trả lời');
    expect(history[2].parts[0].text).toContain('mẫu đó dùng sao shop');
  });
});

function makeNoopMessenger() {
  return {
    sendCarousel: async () => {},
    sendImage: async () => {},
    sendMessage: async () => {},
    sendQuickReplies: async () => {},
    showTyping: () => {}
  };
}

function makeDbImageRuntime({ products, assets }) {
  return buildDbShopRuntime({
    products,
    config: {
      shopName: 'DB Image Shop',
      botMode: {
        name: 'menu_code_handoff',
        aiFallbackEnabled: false,
        productCodeLookupEnabled: true,
        menuSendingEnabled: false,
        postProductHandoffEnabled: true
      },
      __assets: assets
    }
  }, {
    storage,
    messenger: makeNoopMessenger()
  });
}

describe('index: DB asset image runtime', () => {
  it('prefers product-id image assets before product-code and numeric fallback assets', () => {
    const runtime = makeDbImageRuntime({
      products: [{
        id: 'prod-smoke-1',
        code: 'smoke-1',
        name: 'Smoke One',
        price: '120k',
        description: 'Custom code product'
      }],
      assets: {
        productImagesByProductId: {
          'prod-smoke-1': [{ id: 'asset-by-id', url: 'https://cdn.example.test/smoke-by-id.png' }]
        },
        productImagesByCode: {
          'SMOKE-1': [{ id: 'asset-by-code', url: 'https://cdn.example.test/smoke-by-code.png' }],
          'MÃ1': [{ id: 'asset-ma1', url: 'https://cdn.example.test/ma1.png' }]
        }
      }
    });

    const images = runtime.buildRequestedImageUrls('smoke-1');

    expect(images.map(image => image.url)).toEqual(['https://cdn.example.test/smoke-by-id.png']);
  });

  it('uses normalized product-code image assets when no product-id asset exists', () => {
    const runtime = makeDbImageRuntime({
      products: [{
        id: 'prod-smoke-1',
        code: 'smoke-1',
        name: 'Smoke One',
        price: '120k',
        description: 'Custom code product'
      }],
      assets: {
        productImagesByProductId: {},
        productImagesByCode: {
          'SMOKE-1': [{ id: 'asset-by-code', url: 'https://cdn.example.test/smoke-by-code.png' }]
        }
      }
    });

    const images = runtime.buildRequestedImageUrls('smoke-1');

    expect(images.map(image => image.url)).toEqual(['https://cdn.example.test/smoke-by-code.png']);
  });

  it('keeps numeric-style product-code fallback for legacy code-keyed assets', () => {
    const runtime = makeDbImageRuntime({
      products: [{
        id: 'prod-10',
        code: '10',
        name: 'Numeric Ten',
        price: '150k',
        description: 'Numeric code product'
      }],
      assets: {
        productImagesByProductId: {},
        productImagesByCode: {
          'MÃ10': [{ id: 'asset-ma10', url: 'https://cdn.example.test/ma10.png' }]
        }
      }
    });

    const images = runtime.buildRequestedImageUrls('10');

    expect(images.map(image => image.url)).toEqual(['https://cdn.example.test/ma10.png']);
  });
});

describe('index: security hardening helpers', () => {
  it('health payload exposes safe runtime metadata only', () => {
    const health = buildHealthPayload();

    expect(health.ok).toBeTrue();
    expect(health.shop).toBe('adult-shop');
    expect(health.products).toBe(13);
    expect(health.storage.adapter).toBe('file');
    expect(health.storage.ready).toBeTrue();
    expect(health.messenger.dryRun).toBeFalse();
    const serialized = JSON.stringify(health);
    expect(serialized.includes(process.env.FB_PAGE_TOKEN)).toBeFalse();
    expect(serialized.includes(process.env.FB_APP_SECRET)).toBeFalse();
  });

  it('redactSensitiveText che SĐT, email và trường địa chỉ trong log/event', () => {
    const redacted = redactSensitiveText('Tên Nguyễn A, sdt 0987654321, email a@test.com, địa chỉ 12 Trần Phú');

    expect(redacted.includes('0987654321')).toBeFalse();
    expect(redacted.includes('a@test.com')).toBeFalse();
    expect(redacted.includes('12 Trần Phú')).toBeFalse();
    expect(redacted).toContain('[redacted-email]');
    expect(redacted).toContain('[redacted-address]');
  });

  it('getAdminRequestToken chỉ nhận header, không nhận query token', () => {
    const req = {
      query: { token: 'from-query' },
      get(name) {
        return name === 'x-admin-token' ? 'from-header' : '';
      }
    };

    expect(getAdminRequestToken(req)).toBe('from-header');
  });

  it('getAdminRequestToken nhận Authorization Bearer khi không có x-admin-token', () => {
    const req = {
      query: { token: 'from-query' },
      get(name) {
        return name === 'authorization' ? 'Bearer bearer-token' : '';
      }
    };

    expect(getAdminRequestToken(req)).toBe('bearer-token');
  });

  it('pageRef creates a stable grep-friendly page reference', () => {
    const first = pageRef('123456789');

    expect(first).toMatch(/^p:[a-f0-9]{10}$/);
    expect(pageRef('123456789')).toBe(first);
    expect(pageRef('')).toBe('unknown');
  });

  it('global Messenger dry-run forces dry-run even when a shop is live-send eligible', () => {
    const decision = resolveEffectiveMessengerDryRun({
      globalDryRun: true,
      shopDryRun: false,
      shopDryRunColumnAvailable: true
    });

    expect(decision.dryRun).toBeTrue();
    expect(decision.source).toBe('global');
  });

  it('shop dry_run keeps one DB shop in dry-run when global dry-run is off', () => {
    const decision = resolveEffectiveMessengerDryRun({
      globalDryRun: false,
      shopDryRun: true,
      shopDryRunColumnAvailable: true
    });

    expect(decision.dryRun).toBeTrue();
    expect(decision.source).toBe('shop');
  });

  it('shop dry_run=false allows the DB send path when global dry-run is off', () => {
    const decision = resolveEffectiveMessengerDryRun({
      globalDryRun: false,
      shopDryRun: false,
      shopDryRunColumnAvailable: true
    });

    expect(decision.dryRun).toBeFalse();
    expect(decision.source).toBe('shop');
  });

  it('missing shop dry_run preserves legacy global-only Messenger behavior', () => {
    const decision = resolveEffectiveMessengerDryRun({
      globalDryRun: false,
      shopDryRun: null,
      shopDryRunColumnAvailable: false
    });

    expect(decision.dryRun).toBeFalse();
    expect(decision.source).toBe('legacy_missing_shop_dry_run');
  });

  it('runtime admission allows all resolved shops when allowlist is empty', () => {
    const allowlist = createRuntimeAllowlist({});
    const admission = evaluateDbShopRuntimeAdmission({
      result: {
        found: true,
        shop: { id: 'shop-any' },
        page: { page_id: 'page-any' }
      },
      allowlist
    });

    expect(admission).toBe(null);
    expect(isAllowedResolvedRuntime({ shopId: 'shop-any', pageId: 'page-any' }, allowlist)).toBeTrue();
  });

  it('runtime admission allows a resolved shop_id in RUNTIME_ALLOWED_SHOP_IDS', () => {
    const allowlist = createRuntimeAllowlist({ RUNTIME_ALLOWED_SHOP_IDS: 'adult-shop' });
    const admission = evaluateDbShopRuntimeAdmission({
      result: {
        found: true,
        shop: { id: 'adult-shop' },
        page: { page_id: 'page-adult' }
      },
      allowlist
    });

    expect(admission).toBe(null);
  });

  it('runtime admission fails closed when neither resolved shop_id nor page_id is allowed', () => {
    const logs = [];
    const allowlist = createRuntimeAllowlist({
      RUNTIME_ALLOWED_SHOP_IDS: 'adult-shop',
      RUNTIME_ALLOWED_PAGE_IDS: 'page-adult'
    });
    const admission = evaluateDbShopRuntimeAdmission({
      result: {
        found: true,
        shop: { id: 'new-shop' },
        page: { page_id: 'page-secret-raw' }
      },
      allowlist,
      logger: { warn: message => logs.push(String(message)) }
    });

    expect(admission).toEqual({ failClosed: true, reason: 'shop_not_allowed' });
    expect(logs.join('\n')).toContain('shop_id=new-shop');
    expect(logs.join('\n')).toContain('page_ref=p:');
    expect(logs.join('\n').includes('page-secret-raw')).toBeFalse();
  });

  it('runtime admission allows page_id transition override after DB resolution', () => {
    const allowlist = createRuntimeAllowlist({
      RUNTIME_ALLOWED_SHOP_IDS: 'adult-shop',
      RUNTIME_ALLOWED_PAGE_IDS: 'page-transition'
    });
    const admission = evaluateDbShopRuntimeAdmission({
      result: {
        found: true,
        shop: { id: 'new-shop' },
        page: { page_id: 'page-transition' }
      },
      allowlist
    });

    expect(admission).toBe(null);
  });

  it('runtime admission rejects disallowed page_id when shop_id is also disallowed', () => {
    const allowlist = createRuntimeAllowlist({ RUNTIME_ALLOWED_PAGE_IDS: 'page-transition' });
    const admission = evaluateDbShopRuntimeAdmission({
      result: {
        found: true,
        shop: { id: 'new-shop' },
        page: { page_id: 'page-other' }
      },
      allowlist,
      logger: { warn() {} }
    });

    expect(admission).toEqual({ failClosed: true, reason: 'shop_not_allowed' });
  });

  it('runtime admission fails closed for paused shops even when live gate is disabled', () => {
    const admission = evaluateDbShopRuntimeAdmission({
      result: {
        found: true,
        shop: { id: 'paused-shop', status: 'paused' },
        page: { page_id: 'page-paused' }
      },
      allowlist: createRuntimeAllowlist({})
    });

    expect(admission).toEqual({ failClosed: true, reason: 'shop_status_not_active' });
  });

  it('runtime live gate is a no-op when disabled', () => {
    const gate = evaluateDbShopRuntimeLiveGate({
      enabled: false,
      result: {
        found: true,
        shop: { status: 'active', lifecycle: 'paused', live_enabled: false }
      }
    });

    expect(gate).toBe(null);
  });

  it('runtime live gate allows active live enabled shops', () => {
    const gate = evaluateDbShopRuntimeLiveGate({
      enabled: true,
      result: {
        found: true,
        shop: { status: 'active', lifecycle: 'live', live_enabled: true }
      }
    });

    expect(gate).toBe(null);
  });

  it('runtime live gate fails closed for non-live lifecycle values', () => {
    for (const lifecycle of ['draft', 'configuring', 'ready', 'paused', 'archived']) {
      const gate = evaluateDbShopRuntimeLiveGate({
        enabled: true,
        result: {
          found: true,
          shop: { status: 'active', lifecycle, live_enabled: true }
        }
      });

      expect(gate).toEqual({ failClosed: true, reason: 'lifecycle_not_live' });
    }
  });

  it('runtime live gate fails closed when live switch is disabled', () => {
    const gate = evaluateDbShopRuntimeLiveGate({
      enabled: true,
      result: {
        found: true,
        shop: { status: 'active', lifecycle: 'live', live_enabled: false }
      }
    });

    expect(gate).toEqual({ failClosed: true, reason: 'live_disabled' });
  });

  it('runtime live gate fails closed when control columns are missing and gate is enabled', () => {
    const gate = evaluateDbShopRuntimeLiveGate({
      enabled: true,
      result: {
        found: true,
        shop: { status: 'active', lifecycle: 'live', live_enabled: true, controlPlaneColumnsAvailable: false }
      }
    });

    expect(gate).toEqual({ failClosed: true, reason: 'shop_live_gate_schema_missing' });
  });

  it('runtime admission fails closed for unresolved pages when allowlist is active', () => {
    const logs = [];
    const allowlist = createRuntimeAllowlist({
      RUNTIME_ALLOWED_SHOP_IDS: 'adult-shop',
      RUNTIME_ALLOWED_PAGE_IDS: 'page-file'
    });
    const admission = evaluateDbShopRuntimeAdmission({
      result: { found: false, reason: 'page_not_found' },
      normalizedPageId: 'page-file',
      knownFileConfigPage: true,
      allowlist,
      logger: { warn: message => logs.push(String(message)) }
    });

    expect(admission).toEqual({ failClosed: true, reason: 'page_not_found' });
    expect(logs.length).toBe(0);
  });

  it('startup allowlist validation reports active shop ids missing from DB without throwing', async () => {
    const errors = [];
    const allowlist = createRuntimeAllowlist({
      RUNTIME_ALLOWED_SHOP_IDS: 'adult-shop,missing-shop'
    });
    const result = await validateRuntimeAllowlistOnStartup({
      allowlist,
      db: {
        query: async (_sql, values) => {
          expect(values).toEqual([['adult-shop', 'missing-shop']]);
          return { rows: [{ id: 'adult-shop' }] };
        }
      },
      logger: { error: message => errors.push(String(message)) }
    });

    expect(result.checked).toBeTrue();
    expect(result.missing).toEqual(['missing-shop']);
    expect(errors.join('\n')).toContain('missing-shop');
    expect(errors.join('\n')).toContain('fail-closed');
  });

  function createDryRunRuntimeDb(shopsByPage = {}) {
    return {
      query: async (sql, values) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          const page = shopsByPage[values[0]];
          if (!page) return { rows: [] };
          return {
            rows: [{
              shop_id: page.shopId,
              shop_slug: page.shopId,
              shop_name: page.shopId,
              shop_status: 'active',
              shop_package: 'basic',
              shop_lifecycle: 'live',
              live_enabled: true,
              shop_dry_run: page.dryRun,
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: `${page.shopId}-page-map`,
              page_id: values[0],
              page_name: 'DB Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: '',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: `${values[0]}-prod`,
              shop_id: values[0],
              code: 'DB1',
              name: 'DB Product',
              description: 'DB only',
              price: 100000,
              currency: 'VND',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) return { rows: [] };
        return { rows: [] };
      }
    };
  }

  it('DB-backed runtime passes global dry-run kill switch into the send path', async () => {
    const dryPath = [];
    const runtime = await resolveDbShopRuntimeForPage({
      pageId: 'page_live_candidate',
      db: createDryRunRuntimeDb({
        page_live_candidate: { shopId: 'shop-live-candidate', dryRun: false }
      }),
      globalMessengerDryRun: true,
      credentialResolver: async () => ({ found: true, secret: 'shop-live-candidate' }),
      messengerFactory: (_credential, options = {}) => ({
        sendCarousel: async () => {},
        sendImage: async () => {},
        sendMessage: async () => dryPath.push(options.dryRun ? 'dry' : 'real'),
        sendQuickReplies: async () => {},
        showTyping: () => {}
      }),
      logger: { log() {} }
    });

    expect(runtime.failClosed).toBe(undefined);
    expect(runtime.messengerDryRun).toBeTrue();
    await runtime.sendMessage('sender_db', 'hello');
    expect(dryPath).toEqual(['dry']);
  });

  it('DB-backed runtime applies per-shop dry_run independently for two shops', async () => {
    const realPath = [];
    const dryPath = [];
    const db = createDryRunRuntimeDb({
      page_shop_a: { shopId: 'shop-a', dryRun: false },
      page_shop_b: { shopId: 'shop-b', dryRun: true }
    });
    const credentialResolver = async args => ({
      found: true,
      secret: args.shopId
    });
    const messengerFactory = (credential, options = {}) => ({
      sendCarousel: async () => {},
      sendImage: async () => {},
      sendMessage: async () => {
        if (options.dryRun) dryPath.push(credential);
        else realPath.push(credential);
      },
      sendQuickReplies: async () => {},
      showTyping: () => {}
    });

    const runtimeA = await resolveDbShopRuntimeForPage({
      pageId: 'page_shop_a',
      db,
      globalMessengerDryRun: false,
      credentialResolver,
      messengerFactory,
      logger: { log() {} }
    });
    const runtimeB = await resolveDbShopRuntimeForPage({
      pageId: 'page_shop_b',
      db,
      globalMessengerDryRun: false,
      credentialResolver,
      messengerFactory,
      logger: { log() {} }
    });

    expect(runtimeA.messengerDryRun).toBeFalse();
    expect(runtimeB.messengerDryRun).toBeTrue();
    await runtimeA.sendMessage('sender_a', 'hello');
    await runtimeB.sendMessage('sender_b', 'hello');
    expect(realPath).toEqual(['shop-a']);
    expect(dryPath).toEqual(['shop-b']);
  });

  it('DB-backed runtime resolves and uses the page credential for Messenger sends', async () => {
    const sent = [];
    const credentialCalls = [];
    let factoryToken = '';
    const db = {
      query: async (sql, values) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          expect(values).toEqual(['page_db']);
          return {
            rows: [{
              shop_id: 'adult-shop',
              shop_slug: 'adult-shop',
              shop_name: 'Adult Shop',
              shop_dry_run: false,
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: 'page-map-db',
              page_id: 'page_db',
              page_name: 'DB Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: 'DB handoff',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: 'prod-db',
              shop_id: 'adult-shop',
              code: 'MÃ99',
              name: 'DB Product',
              description: 'DB only',
              price: 999000,
              currency: 'VND',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) return { rows: [] };
        return { rows: [] };
      }
    };

    const runtime = await resolveDbShopRuntimeForPage({
      pageId: 'page_db',
      db,
      credentialMasterKey: 'unused-in-stub',
      credentialResolver: async args => {
        credentialCalls.push(args);
        return { found: true, secret: 'db-page-token' };
      },
      messengerFactory: (token, options = {}) => {
        factoryToken = token;
        expect(options.dryRun).toBeFalse();
        return {
          sendCarousel: async () => {},
          sendImage: async (senderId, url) => sent.push({ type: 'image', senderId, url, token }),
          sendMessage: async (senderId, text) => sent.push({ type: 'text', senderId, text, token }),
          sendQuickReplies: async (senderId, text) => sent.push({ type: 'quick_replies', senderId, text, token }),
          showTyping: () => {}
        };
      }
    });

    expect(runtime.failClosed).toBe(undefined);
    expect(runtime.messengerDryRun).toBeFalse();
    expect(factoryToken).toBe('db-page-token');
    expect(credentialCalls.length).toBe(1);
    expect(credentialCalls[0].shopId).toBe('adult-shop');
    expect(credentialCalls[0].pageMappingId).toBe('page-map-db');

    await runtime.sendMessage('sender_db', 'hello');
    expect(sent).toEqual([{ type: 'text', senderId: 'sender_db', text: 'hello', token: 'db-page-token' }]);
  });

  it('DB-backed runtime fails closed when page credential is missing', async () => {
    let messengerFactoryCalled = false;
    const db = {
      query: async (sql, values) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              shop_slug: 'adult-shop',
              shop_name: 'Adult Shop',
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: 'page-map-db',
              page_id: values[0],
              page_name: 'DB Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: '',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: 'prod-db',
              shop_id: 'adult-shop',
              code: 'MÃ99',
              name: 'DB Product',
              description: 'DB only',
              price: 999000,
              currency: 'VND',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) return { rows: [] };
        return { rows: [] };
      }
    };

    const runtime = await resolveDbShopRuntimeForPage({
      pageId: 'page_db',
      db,
      credentialResolver: async () => ({ found: false, reason: 'credential_not_found' }),
      messengerFactory: () => {
        messengerFactoryCalled = true;
        return {};
      }
    });

    expect(runtime).toEqual({ failClosed: true, reason: 'credential_not_found' });
    expect(messengerFactoryCalled).toBeFalse();
  });

  it('DB-backed runtime live gate blocks non-live DB shops before credentials are used', async () => {
    let credentialResolverCalled = false;
    const db = {
      query: async (sql, values) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          return {
            rows: [{
              shop_id: 'demo-shop',
              shop_slug: 'demo-shop',
              shop_name: 'Demo Shop',
              shop_status: 'active',
              shop_package: 'basic',
              shop_lifecycle: 'ready',
              live_enabled: true,
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: 'page-map-db',
              page_id: values[0],
              page_name: 'DB Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: '',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: 'prod-db',
              shop_id: 'demo-shop',
              code: 'MÃ99',
              name: 'DB Product',
              description: 'DB only',
              price: 999000,
              currency: 'VND',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) return { rows: [] };
        return { rows: [] };
      }
    };

    const runtime = await resolveDbShopRuntimeForPage({
      pageId: 'page_db',
      db,
      shopLiveGateEnabled: true,
      credentialResolver: async () => {
        credentialResolverCalled = true;
        return { found: true, secret: 'db-page-token' };
      }
    });

    expect(runtime).toEqual({ failClosed: true, reason: 'lifecycle_not_live' });
    expect(credentialResolverCalled).toBeFalse();
  });

  it('DB-backed runtime preserves old behavior when live gate is disabled', async () => {
    let credentialResolverCalled = false;
    const db = {
      query: async (sql, values) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          return {
            rows: [{
              shop_id: 'demo-shop',
              shop_slug: 'demo-shop',
              shop_name: 'Demo Shop',
              shop_status: 'active',
              shop_package: 'basic',
              shop_lifecycle: 'paused',
              live_enabled: false,
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: 'page-map-db',
              page_id: values[0],
              page_name: 'DB Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: '',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: 'prod-db',
              shop_id: 'demo-shop',
              code: 'MÃ99',
              name: 'DB Product',
              description: 'DB only',
              price: 999000,
              currency: 'VND',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) return { rows: [] };
        return { rows: [] };
      }
    };

    const runtime = await resolveDbShopRuntimeForPage({
      pageId: 'page_db',
      db,
      shopLiveGateEnabled: false,
      credentialResolver: async () => {
        credentialResolverCalled = true;
        return { found: true, secret: 'db-page-token' };
      },
      messengerFactory: () => ({
        sendCarousel: async () => {},
        sendImage: async () => {},
        sendMessage: async () => {},
        sendQuickReplies: async () => {},
        showTyping: () => {}
      })
    });

    expect(runtime.failClosed).toBe(undefined);
    expect(credentialResolverCalled).toBeTrue();
  });

  it('DB-backed runtime fails closed when credential lookup throws', async () => {
    let messengerFactoryCalled = false;
    const db = {
      query: async (sql, values) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.includes('FROM shop_pages sp')) {
          return {
            rows: [{
              shop_id: 'adult-shop',
              shop_slug: 'adult-shop',
              shop_name: 'Adult Shop',
              default_locale: 'vi-VN',
              timezone: 'Asia/Bangkok',
              page_mapping_id: 'page-map-db',
              page_id: values[0],
              page_name: 'DB Page',
              bot_mode: 'menu_code_handoff',
              handoff_enabled: true,
              handoff_message: '',
              menu_intro_text: '',
              fallback_text: '',
              settings_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_products')) {
          return {
            rows: [{
              id: 'prod-db',
              shop_id: 'adult-shop',
              code: 'MÃ99',
              name: 'DB Product',
              description: 'DB only',
              price: 999000,
              currency: 'VND',
              status: 'active',
              sort_order: 1,
              metadata_json: {}
            }]
          };
        }
        if (normalized.includes('FROM shop_assets')) return { rows: [] };
        return { rows: [] };
      }
    };

    const runtime = await resolveDbShopRuntimeForPage({
      pageId: 'page_db',
      db,
      credentialResolver: async () => {
        throw new Error('relation shop_page_credentials token=EAAB-raw-page-token');
      },
      messengerFactory: () => {
        messengerFactoryCalled = true;
        return {};
      }
    });

    expect(runtime).toEqual({ failClosed: true, reason: 'credential_lookup_failed' });
    expect(messengerFactoryCalled).toBeFalse();
  });
});

describe('index/storage: nhắc giỏ bỏ dở', () => {
  const now = Date.parse('2026-05-08T00:00:00.000Z');
  const oldEnough = new Date(now - 21 * 60 * 1000).toISOString();

  it('render lời nhắc theo thông tin còn thiếu', () => {
    const text = buildAbandonedCartReminderText({
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      phone: '0987654321'
    });

    expect(text).toContain('1 x MÃ8');
    expect(text).toContain('tên người nhận + địa chỉ giao hàng');
    expect(text).notToBe('');
  });

  it('lọc draft checkout thiếu thông tin sau thời gian idle', () => {
    const userId = 'idx_abandoned_candidate';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
      phone: '0987654321'
    });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeTrue();
    expect(candidate.missingFields).toEqual(['name', 'address']);
  });

  it('không nhắc khách chỉ hỏi/xem mã sản phẩm, chưa có cartItems checkout', () => {
    const userId = 'idx_product_view_not_abandoned';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, { productCode: 'MÃ8' });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeFalse();
  });

  it('đã gửi nhắc thì không đưa lại vào candidate', () => {
    const userId = 'idx_abandoned_sent_once';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
    });
    storage.markAbandonedCartReminderSent(userId, {
      at: new Date(now).toISOString(),
      idleMs: 21 * 60 * 1000,
      missingFields: ['name', 'phone', 'address']
    });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeFalse();
  });

  it('lỗi gửi 4xx đã đánh dấu thì không retry liên tục', () => {
    const userId = 'idx_abandoned_failed_once';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, oldEnough);
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
    });
    storage.markAbandonedCartReminderFailed(userId, {
      at: new Date(now).toISOString(),
      status: 400,
      error: 'recipient unavailable'
    });

    const candidate = storage.listAbandonedCartReminderCandidates({
      now,
      idleMs: 20 * 60 * 1000,
      maxAgeMs: 23 * 60 * 60 * 1000
    }).find(item => item.userId === userId);

    expect(Boolean(candidate)).toBeFalse();
  });

  it('khách trả lời sau lời nhắc gần đây không bị timeout xóa draft', () => {
    const userId = 'idx_reminder_extends_timeout';
    storage.clearOrderDraft(userId);
    storage.setLastUserAt(userId, new Date(Date.now() - 31 * 60 * 1000).toISOString());
    storage.mergeOrderDraft(userId, {
      productCode: 'MÃ8',
      cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
    });
    storage.markAbandonedCartReminderSent(userId, {
      at: new Date().toISOString(),
      idleMs: 20 * 60 * 1000,
      missingFields: ['name', 'phone', 'address']
    });

    const reset = maybeResetTimedOutSession(userId, '0987654321 An 12 Tran Phu');

    expect(reset).toBeFalse();
    expect(storage.getOrderDraft(userId).cartItems.length).toBe(1);
  });
});

describe('index: Messenger reminder worker policy gate', () => {
  it('keeps automated reminder workers disabled for Basic/minimal sales modes', () => {
    expect(shouldEnableReminderWorkersForShop({
      botMode: {
        name: 'menu_code_handoff',
        followUpEnabled: true
      }
    })).toBeFalse();

    expect(shouldEnableReminderWorkersForShop({
      botMode: {
        name: 'menu_code_handoff',
        followUpEnabled: true
      },
      settings_json: {
        basicSalesV2: { enabled: true }
      }
    })).toBeFalse();
  });

  it('keeps existing non-minimal follow-up worker eligibility', () => {
    expect(shouldEnableReminderWorkersForShop({
      botMode: { name: 'full_sales' }
    })).toBeTrue();
  });
});

describe('index/storage: nhắc mời chào engaged', () => {
  it('lọc candidate engaged sau 2 giờ và chặn sau khi đã gửi', () => {
    const now = Date.parse('2026-05-08T12:00:00.000Z');
    const userId = 'idx_engaged_followup_candidate';
    storage.setSessionState(userId, 'PRODUCT_SELECTED');
    storage.setEngagedFollowUp(userId, {
      at: new Date(now - (2 * 60 * 60 * 1000 + 3 * 60 * 1000)).toISOString(),
      note: 'đang xem mã 8'
    });

    const candidate = storage.listEngagedFollowUpCandidates({
      now,
      idleMs: 2 * 60 * 60 * 1000,
      maxAgeMs: 3 * 24 * 60 * 60 * 1000
    }).find(item => item.userId === userId);
    expect(Boolean(candidate)).toBeTrue();
    expect(candidate.note).toContain('mã 8');

    storage.markEngagedFollowUpReminderSent(userId, {
      at: '2026-05-08T12:01:00.000Z',
      idleMs: candidate.idleMs
    });
    const afterSent = storage.listEngagedFollowUpCandidates({
      now,
      idleMs: 1,
      maxAgeMs: 3 * 24 * 60 * 60 * 1000
    }).find(item => item.userId === userId);
    expect(Boolean(afterSent)).toBeFalse();
  });
});

describe('index: Telegram hiển thị tên Facebook', () => {
  it('format User bằng tên Facebook và vẫn giữ ID để tra soát', () => {
    const lines = buildTelegramUserLines('123456789', {
      firstName: 'Nguyễn',
      lastName: 'An'
    });

    expect(lines).toEqual(['User: Nguyễn An', 'Facebook ID: 123456789']);
  });

  it('fallback về senderId khi chưa lấy được profile Facebook', () => {
    expect(buildTelegramUserLines('123456789', {})).toEqual(['User: 123456789']);
  });

  it('alert đơn hàng tách tên Facebook và tên nhận hàng', () => {
    const text = buildTelegramLeadAlertText({
      senderId: '123456789',
      text: 'ĐƠN ĐỦ THÔNG TIN - CHỜ KHÁCH OK',
      name: 'Tran Van B',
      phone: '0987654321',
      address: '12 Tran Phu',
      productCode: 'MÃ8'
    }, {
      name: 'Nguyễn An'
    });

    expect(text).toContain('User: Nguyễn An');
    expect(text).toContain('Facebook ID: 123456789');
    expect(text).toContain('Tên nhận hàng: Tran Van B');
    expect(text).toContain('Sản phẩm: MÃ8');
  });

  it('ưu tiên profile.name khi có sẵn', () => {
    expect(getFacebookProfileDisplayName({
      name: 'Le Minh',
      firstName: 'Ignored',
      lastName: 'Name'
    })).toBe('Le Minh');
  });
});

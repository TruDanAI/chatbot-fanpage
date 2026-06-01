const { describe, it, expect } = require('./harness');
const axios = require('axios');
const { createWebhook } = require('../core/webhook');
const { createMessengerClient } = require('../core/messenger-client');
const { createRuleEngine, STATES } = require('../core/rules');
const { buildQuickReplies, resolveQuickReplyPayload } = require('../core/quick-replies');
const { applyBotModeConfig } = require('../core/bot-mode');
const { resolveShopConfigForPage } = require('../core/shops/db-shop-config');

const TENANT_ID = 'tenant-isolation-test';
const SHOP_A = 'demo-shop';
const SHOP_B = 'mock-shop-2';
const PAGE_A = 'page-isolation-a';
const PAGE_B = 'page-isolation-b';
const PAGE_UNMAPPED = 'page-isolation-unmapped';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, message = 'condition was not met') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error(message);
}

function makeEvent(text, senderId, mid) {
  return {
    sender: { id: senderId },
    message: { mid, text }
  };
}

function makeStorage(name) {
  const context = new Map();
  const handoff = new Map();
  const mids = new Set();
  const midMarks = [];
  const customers = [];
  const events = [];
  const conversationTurns = [];
  const messages = [];

  function entry(userId) {
    const key = String(userId || '');
    const value = context.get(key) || {};
    context.set(key, value);
    return value;
  }

  return {
    _name: name,
    _customers: customers,
    _events: events,
    _handoff: handoff,
    _midMarks: midMarks,
    _conversationTurns: conversationTurns,
    _messages: messages,
    getHistory: userId => entry(userId).history || [],
    setHistory: (userId, history) => {
      entry(userId).history = history;
    },
    setHandoff: (userId, until) => {
      handoff.set(userId, until);
    },
    inHandoff: userId => {
      const until = handoff.get(userId);
      return Boolean(until && Date.now() <= until);
    },
    getLastProductCode: userId => entry(userId).lastProductCode || '',
    setLastProductCode: (userId, code) => {
      entry(userId).lastProductCode = code;
    },
    getLastUserAt: userId => entry(userId).lastUserAt || '',
    setLastUserAt: (userId, at = new Date().toISOString()) => {
      entry(userId).lastUserAt = at;
    },
    getOrderDraft: userId => ({ ...(entry(userId).orderDraft || {}) }),
    mergeOrderDraft: (userId, details) => {
      const value = entry(userId);
      value.orderDraft = { ...(value.orderDraft || {}), ...details };
      return { ...value.orderDraft };
    },
    getSessionState: userId => entry(userId).sessionState || '',
    setSessionState: (userId, state) => {
      if (state) entry(userId).sessionState = state;
      else delete entry(userId).sessionState;
    },
    clearOrderDraft: userId => {
      delete entry(userId).orderDraft;
      delete entry(userId).sessionState;
    },
    tryMarkMid: (mid, details = {}) => {
      const normalized = String(mid || '').trim();
      if (!normalized) return false;
      if (mids.has(normalized)) return false;
      mids.add(normalized);
      midMarks.push({ mid: normalized, ...details });
      return true;
    },
    appendCustomer: customer => customers.push(customer),
    appendEvent: event => events.push(event)
  };
}

function sideEffectCounts(storage) {
  return {
    mids: storage._midMarks.length,
    customers: storage._customers.length,
    events: storage._events.length,
    handoff: storage._handoff.size,
    conversationTurns: storage._conversationTurns.length,
    messages: storage._messages.length
  };
}

function makeShopRow({ shopId, pageId, dryRun, code, price, imageUrl }) {
  return {
    shop: {
      id: shopId,
      slug: shopId,
      name: shopId,
      status: 'active',
      package: 'basic',
      lifecycle: 'live',
      live_enabled: true,
      dry_run: dryRun,
      default_locale: 'vi-VN',
      timezone: 'Asia/Bangkok'
    },
    page: {
      id: `${shopId}-page-map`,
      shop_id: shopId,
      page_id: pageId,
      page_name: `${shopId} page`,
      status: 'active'
    },
    settings: {
      shop_id: shopId,
      bot_mode: 'menu_code_handoff',
      handoff_enabled: true,
      handoff_message: `${shopId} handoff`,
      menu_intro_text: `${shopId} menu`,
      fallback_text: '',
      settings_json: {
        botMode: {
          aiFallbackEnabled: false,
          orderFlowEnabled: false,
          leadCaptureEnabled: false,
          followUpEnabled: false,
          productCodeLookupEnabled: true,
          menuSendingEnabled: false,
          postProductHandoffEnabled: true,
          fallbackEnabled: false
        },
        ruleToggles: {
          productCodeLookupEnabled: true,
          menuSendingEnabled: false,
          postProductHandoffEnabled: true,
          fallbackEnabled: false,
          leadCaptureEnabled: false
        },
        policies: {
          privacy: 'test privacy',
          payment: 'test payment'
        }
      }
    },
    product: {
      id: `${shopId}-product`,
      shop_id: shopId,
      code,
      name: `${shopId} product`,
      description: `${shopId} scoped product`,
      price,
      currency: 'VND',
      status: 'active',
      sort_order: 1,
      metadata_json: {}
    },
    asset: {
      id: `${shopId}-product-image`,
      shop_id: shopId,
      product_id: `${shopId}-product`,
      asset_type: 'product_image',
      storage_provider: 'public_url',
      storage_key: '',
      public_url: imageUrl,
      content_type: 'image/png',
      status: 'active',
      sort_order: 1
    }
  };
}

function makeSeed() {
  return [
    makeShopRow({
      shopId: SHOP_A,
      pageId: PAGE_A,
      dryRun: false,
      code: 'M1',
      price: 100000,
      imageUrl: 'https://cdn.example.test/a.png'
    }),
    makeShopRow({
      shopId: SHOP_B,
      pageId: PAGE_B,
      dryRun: true,
      code: 'M2',
      price: 200000,
      imageUrl: 'https://cdn.example.test/b.png'
    })
  ];
}

class FakeShopDb {
  constructor(seed) {
    this.seed = seed;
    this.calls = [];
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    if (normalized.includes('FROM shop_pages sp')) {
      const pageId = values[0];
      const rows = this.seed
        .filter(row => row.page.page_id === pageId)
        .map(row => ({
          shop_id: row.shop.id,
          shop_slug: row.shop.slug,
          shop_name: row.shop.name,
          shop_status: row.shop.status,
          shop_package: row.shop.package,
          shop_lifecycle: row.shop.lifecycle,
          live_enabled: row.shop.live_enabled,
          shop_dry_run: row.shop.dry_run,
          default_locale: row.shop.default_locale,
          timezone: row.shop.timezone,
          page_mapping_id: row.page.id,
          page_id: row.page.page_id,
          page_name: row.page.page_name,
          bot_mode: row.settings.bot_mode,
          handoff_enabled: row.settings.handoff_enabled,
          handoff_message: row.settings.handoff_message,
          menu_intro_text: row.settings.menu_intro_text,
          fallback_text: row.settings.fallback_text,
          settings_json: row.settings.settings_json
        }));
      return { rows };
    }

    if (normalized.includes('FROM shop_products')) {
      return {
        rows: this.seed
          .filter(row => row.shop.id === values[0] && row.product.status === 'active')
          .map(row => row.product)
      };
    }

    if (normalized.includes('FROM shop_assets')) {
      return {
        rows: this.seed
          .filter(row => row.shop.id === values[0] && row.asset.status === 'active')
          .map(row => row.asset)
      };
    }

    return { rows: [] };
  }
}

function makeImageRuntime(config, rules) {
  const assets = config.__assets || {};
  const productImagesByCode = assets.productImagesByCode || {};
  const menuImages = Array.isArray(assets.menuImages) ? assets.menuImages : [];
  const imageItem = asset => ({
    file: asset.id || asset.storageKey || asset.publicUrl,
    url: asset.url
  });

  return {
    getMenuImageUrls: () => menuImages.map(imageItem),
    buildRequestedImageUrls: text => rules.extractRequestedProductCodes(text)
      .flatMap(code => productImagesByCode[String(code || '').toUpperCase()] || [])
      .map(imageItem),
    isGreetingText: text => /^(?:hi|hello|shop)$/i.test(String(text || '').trim()),
    isHotProductsText: () => false,
    sendHotCarousel: async () => false
  };
}

function buildRuntime({ resolved, storage, messenger }) {
  const config = applyBotModeConfig(resolved.config);
  const rules = createRuleEngine({
    products: resolved.products,
    config,
    contextStore: storage
  });
  const images = makeImageRuntime(config, rules);

  return {
    storage,
    shopConfig: config,
    products: resolved.products,
    useGemini: false,
    buildDeterministicReply: rules.buildDeterministicReply,
    buildFallbackReply: rules.buildFallbackReply,
    buildLeadDetails: () => ({}),
    buildConfirmedSheetLead: () => ({}),
    extractRequestedProductCodes: rules.extractRequestedProductCodes,
    captureHandoffOrderUpdate: () => false,
    notifyStaffForReadyOrder: async () => false,
    looksLikePhone: rules.looksLikePhone,
    shouldSilenceAfterCompleteOrder: rules.shouldSilenceAfterCompleteOrder,
    wantsHuman: rules.wantsHuman,
    normalizeText: rules.normalizeText,
    render: rules.render,
    deriveSessionState: rules.deriveSessionState,
    STATES,
    callGemini: async () => '',
    getGeminiErrorInfo: err => ({ message: err.message }),
    shouldUseFallbackReply: () => false,
    isProbablyIncompleteReply: () => false,
    sendMessage: async (...args) => {
      storage._messages.push({ type: 'text' });
      return messenger.sendMessage(...args);
    },
    sendQuickReplies: async (...args) => {
      storage._messages.push({ type: 'quick_replies' });
      return messenger.sendQuickReplies(...args);
    },
    sendImage: async (...args) => {
      storage._messages.push({ type: 'image' });
      return messenger.sendImage(...args);
    },
    showTyping: messenger.showTyping,
    sendHotCarousel: images.sendHotCarousel,
    isGreetingText: images.isGreetingText,
    isHotProductsText: images.isHotProductsText,
    getMenuImageUrls: images.getMenuImageUrls,
    buildRequestedImageUrls: images.buildRequestedImageUrls,
    pushLeadToSheet: () => {},
    sendTelegramAlert: () => {},
    sendTelegramOperationalAlert: () => {},
    resetFallbackAttention: () => {},
    trackFallbackAttention: async () => {},
    recordConversationTurn: (...args) => storage._conversationTurns.push(args),
    trackEvent: (...args) => storage._events.push(args),
    maybeResetTimedOutSession: () => {},
    redactSensitiveText: text => text
  };
}

function makeMessengerFactory({ globalDryRun, attempts }) {
  const client = createMessengerClient({
    fbPageToken: 'base-page-token',
    dryRun: globalDryRun
  });

  return ({ shopId, credential, dryRun }) => {
    const effectiveDryRun = Boolean(globalDryRun || dryRun);
    const scoped = client.withPageToken(credential, { dryRun });
    const track = type => attempts.push({ shopId, type, dryRun: effectiveDryRun });

    return {
      sendCarousel: async (...args) => {
        track('carousel');
        return scoped.sendCarousel(...args);
      },
      sendImage: async (...args) => {
        track('image');
        return scoped.sendImage(...args);
      },
      sendMessage: async (...args) => {
        track('message');
        return scoped.sendMessage(...args);
      },
      sendQuickReplies: async (...args) => {
        track('quick_replies');
        return scoped.sendQuickReplies(...args);
      },
      showTyping: (...args) => {
        track('typing');
        return scoped.showTyping(...args);
      }
    };
  };
}

function createIsolationHarness({ globalDryRun = false } = {}) {
  const db = new FakeShopDb(makeSeed());
  const storageByShop = {
    [SHOP_A]: makeStorage(SHOP_A),
    [SHOP_B]: makeStorage(SHOP_B)
  };
  const fallbackStorage = makeStorage('fallback');
  const attempts = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  const messengerFactory = makeMessengerFactory({ globalDryRun, attempts });
  const credentialByShop = {
    [SHOP_A]: 'credential-a',
    [SHOP_B]: 'credential-b'
  };
  const fallbackConfig = applyBotModeConfig({
    shopName: 'fallback',
    botMode: {
      name: 'menu_code_handoff',
      aiFallbackEnabled: false,
      orderFlowEnabled: false,
      leadCaptureEnabled: false,
      productCodeLookupEnabled: true,
      menuSendingEnabled: false,
      postProductHandoffEnabled: true,
      fallbackEnabled: false
    }
  });
  const fallbackRules = createRuleEngine({
    products: [{
      code: 'M9',
      price: '900k',
      description: 'fallback product'
    }],
    config: fallbackConfig,
    contextStore: fallbackStorage
  });
  const fallbackMessenger = messengerFactory({
    shopId: 'fallback',
    credential: 'fallback-credential',
    dryRun: false
  });

  const webhook = createWebhook({
    storage: fallbackStorage,
    shopConfig: fallbackConfig,
    fbVerifyToken: 'verify',
    fbAppSecret: '',
    webhookRateLimiter: (_req, _res, next) => next(),
    handoffMs: 30 * 60 * 1000,
    useGemini: false,
    botMessageMetadata: 'bot-test',
    resolveQuickReplyPayload,
    buildQuickReplies,
    buildDeterministicReply: fallbackRules.buildDeterministicReply,
    buildFallbackReply: fallbackRules.buildFallbackReply,
    buildLeadDetails: () => ({}),
    buildConfirmedSheetLead: () => ({}),
    extractRequestedProductCodes: fallbackRules.extractRequestedProductCodes,
    captureHandoffOrderUpdate: () => false,
    notifyStaffForReadyOrder: async () => false,
    looksLikePhone: fallbackRules.looksLikePhone,
    shouldSilenceAfterCompleteOrder: fallbackRules.shouldSilenceAfterCompleteOrder,
    wantsHuman: fallbackRules.wantsHuman,
    normalizeText: fallbackRules.normalizeText,
    render: fallbackRules.render,
    deriveSessionState: fallbackRules.deriveSessionState,
    STATES,
    callGemini: async () => '',
    getGeminiErrorInfo: err => ({ message: err.message }),
    shouldUseFallbackReply: () => false,
    isProbablyIncompleteReply: () => false,
    sendMessage: fallbackMessenger.sendMessage,
    sendQuickReplies: fallbackMessenger.sendQuickReplies,
    sendImage: fallbackMessenger.sendImage,
    showTyping: fallbackMessenger.showTyping,
    sendHotCarousel: async () => false,
    isGreetingText: () => false,
    isHotProductsText: () => false,
    getMenuImageUrls: () => [],
    buildRequestedImageUrls: () => [],
    pushLeadToSheet: () => {},
    sendTelegramAlert: () => {},
    sendTelegramOperationalAlert: () => {},
    resetFallbackAttention: () => {},
    trackFallbackAttention: async () => {},
    recordConversationTurn: (...args) => fallbackStorage._conversationTurns.push(args),
    trackEvent: (...args) => fallbackStorage._events.push(args),
    maybeResetTimedOutSession: () => {},
    redactSensitiveText: text => text,
    resolveRuntimeForPage: async ({ pageId }) => {
      const resolved = await resolveShopConfigForPage({
        pageId,
        tenantId: TENANT_ID,
        client: db
      });
      if (!resolved.found) return { failClosed: true, reason: resolved.reason };

      const storage = storageByShop[resolved.shop.id];
      if (!storage) return { failClosed: true, reason: 'shop_storage_missing' };

      const dryRun = resolved.shop.dry_run === true;
      const messenger = messengerFactory({
        shopId: resolved.shop.id,
        credential: credentialByShop[resolved.shop.id],
        dryRun
      });
      return buildRuntime({ resolved, storage, messenger });
    }
  });

  let postHandler = null;
  webhook.registerWebhookRoutes({
    get() {},
    post(_path, limiter, handler) {
      postHandler = (req, res) => limiter(req, res, () => handler(req, res));
    }
  });

  return {
    attempts,
    db,
    fallbackStorage,
    storageByShop,
    warnings,
    restoreWarnings() {
      console.warn = originalWarn;
    },
    async postPageEvent(pageId, event) {
      let responseStatus = 0;
      await postHandler({
        body: {
          object: 'page',
          entry: [{
            id: pageId,
            messaging: [event]
          }]
        },
        protocol: 'https',
        get(name) {
          const headers = {
            host: 'example.test',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'example.test'
          };
          return headers[String(name || '').toLowerCase()] || '';
        }
      }, {
        sendStatus(code) {
          responseStatus = code;
        }
      });
      return responseStatus;
    }
  };
}

async function withMockedMessengerPost(fn) {
  const graphCalls = [];
  const originalPost = axios.post;
  axios.post = async (_url, payload, options) => {
    graphCalls.push({ payload, options });
    return { data: { ok: true } };
  };

  try {
    await fn(graphCalls);
  } finally {
    axios.post = originalPost;
  }
}

describe('multi-shop isolation integration', () => {
  it('keeps two mapped shops isolated and fails closed for an unmapped page', async () => {
    await withMockedMessengerPost(async graphCalls => {
      const h = createIsolationHarness({ globalDryRun: false });
      try {
        const statusA = await h.postPageEvent(PAGE_A, makeEvent('m1', 'sender-a', 'mid-a'));
        expect(statusA).toBe(200);
        await waitFor(
          () => h.storageByShop[SHOP_A]._messages.length === 3,
          'shop A event did not finish'
        );

        const statusB = await h.postPageEvent(PAGE_B, makeEvent('m2', 'sender-b', 'mid-b'));
        expect(statusB).toBe(200);
        await waitFor(
          () => h.storageByShop[SHOP_B]._messages.length === 3,
          'shop B event did not finish'
        );

        expect(h.storageByShop[SHOP_A].getLastProductCode('sender-a')).toBe('M1');
        expect(h.storageByShop[SHOP_A].getLastProductCode('sender-b')).toBe('');
        expect(h.storageByShop[SHOP_B].getLastProductCode('sender-b')).toBe('M2');
        expect(h.storageByShop[SHOP_B].getLastProductCode('sender-a')).toBe('');
        expect(h.storageByShop[SHOP_A].inHandoff('sender-a')).toBeTrue();
        expect(h.storageByShop[SHOP_B].inHandoff('sender-b')).toBeTrue();
        expect(h.fallbackStorage._midMarks.length).toBe(0);

        const shopAAttempts = h.attempts.filter(call => call.shopId === SHOP_A);
        const shopBAttempts = h.attempts.filter(call => call.shopId === SHOP_B);
        expect(shopAAttempts.map(call => `${call.type}:${call.dryRun}`).sort()).toEqual([
          'image:false',
          'message:false',
          'message:false',
          'typing:false'
        ]);
        expect(shopBAttempts.map(call => `${call.type}:${call.dryRun}`).sort()).toEqual([
          'image:true',
          'message:true',
          'message:true',
          'typing:true'
        ]);
        expect(graphCalls.some(call => call.payload.sender_action === 'typing_on')).toBeTrue();
        expect(graphCalls.filter(call => call.payload.sender_action === 'typing_on').length).toBe(1);
        expect(graphCalls.length).toBe(4);

        const beforeUnmapped = {
          shopA: sideEffectCounts(h.storageByShop[SHOP_A]),
          shopB: sideEffectCounts(h.storageByShop[SHOP_B]),
          fallback: sideEffectCounts(h.fallbackStorage),
          attempts: h.attempts.length,
          graphCalls: graphCalls.length
        };

        const statusUnmapped = await h.postPageEvent(
          PAGE_UNMAPPED,
          makeEvent('m9', 'sender-unmapped', 'mid-unmapped')
        );
        expect(statusUnmapped).toBe(200);
        await waitFor(() => h.warnings.length > 0, 'unmapped page did not fail closed');

        expect(sideEffectCounts(h.storageByShop[SHOP_A])).toEqual(beforeUnmapped.shopA);
        expect(sideEffectCounts(h.storageByShop[SHOP_B])).toEqual(beforeUnmapped.shopB);
        expect(sideEffectCounts(h.fallbackStorage)).toEqual(beforeUnmapped.fallback);
        expect(h.attempts.length).toBe(beforeUnmapped.attempts);
        expect(graphCalls.length).toBe(beforeUnmapped.graphCalls);
        expect(h.warnings.join('\n')).toContain('page_ref=p:');
        expect(h.warnings.join('\n').includes(PAGE_UNMAPPED)).toBeFalse();
      } finally {
        h.restoreWarnings();
      }
    });
  });

  it('global dry-run forces both mapped shops through the dry-run path', async () => {
    await withMockedMessengerPost(async graphCalls => {
      const h = createIsolationHarness({ globalDryRun: true });
      try {
        const statusA = await h.postPageEvent(PAGE_A, makeEvent('m1', 'sender-a-global', 'mid-a-global'));
        const statusB = await h.postPageEvent(PAGE_B, makeEvent('m2', 'sender-b-global', 'mid-b-global'));
        expect(statusA).toBe(200);
        expect(statusB).toBe(200);
        await waitFor(
          () => h.storageByShop[SHOP_A]._messages.length === 3
            && h.storageByShop[SHOP_B]._messages.length === 3,
          'global dry-run events did not finish'
        );

        expect(h.attempts.filter(call => call.shopId === SHOP_A).every(call => call.dryRun)).toBeTrue();
        expect(h.attempts.filter(call => call.shopId === SHOP_B).every(call => call.dryRun)).toBeTrue();
        expect(h.attempts.filter(call => call.type === 'typing').length).toBe(2);
        expect(graphCalls.length).toBe(0);
        expect(h.fallbackStorage._midMarks.length).toBe(0);
      } finally {
        h.restoreWarnings();
      }
    });
  });
});

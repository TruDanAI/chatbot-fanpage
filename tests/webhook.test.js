const { describe, it, expect } = require('./harness');
const path = require('path');
const { createWebhook } = require('../core/webhook');
const { createRuleEngine, STATES } = require('../core/rules');
const { loadProducts } = require('../core/products');
const { buildQuickReplies, resolveQuickReplyPayload } = require('../core/quick-replies');
const shopConfig = require('../shops/adult-shop/config');
const adultCustomIntents = require('../shops/adult-shop/custom-intents');
const {
  MENU_CODE_HANDOFF_MESSAGE,
  MENU_CODE_MENU_PRICE_REPLY,
  applyBotModeConfig
} = require('../core/bot-mode');

const products = loadProducts(path.join(__dirname, '..', 'shops', 'adult-shop', 'products.csv'));

function makeStorage() {
  const context = new Map();
  const handoff = new Map();
  const mids = new Set();
  const midMarks = [];
  const customers = [];
  const events = [];

  function entry(userId) {
    const value = context.get(userId) || {};
    context.set(userId, value);
    return value;
  }

  return {
    _customers: customers,
    _events: events,
    _handoff: handoff,
    _mids: mids,
    _midMarks: midMarks,
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

function buildAdultRuntimeConfig() {
  return applyBotModeConfig({
    ...shopConfig,
    intents: {
      ...(shopConfig.intents || {}),
      disabled: [...(shopConfig.intents?.disabled || [])],
      prepend: [
        ...(adultCustomIntents.prepend || []),
        ...(shopConfig.intents?.prepend || [])
      ],
      append: [
        ...(shopConfig.intents?.append || []),
        ...(adultCustomIntents.append || [])
      ]
    }
  });
}

function makeEvent(text, senderId = 'sender_1', mid = `mid_${Math.random()}`, pageId = '') {
  return {
    sender: { id: senderId },
    ...(pageId ? { recipient: { id: pageId } } : {}),
    message: { mid, text }
  };
}

function makeReferralEvent(senderId = 'sender_1', source = 'ADS', pageId = '') {
  return {
    sender: { id: senderId },
    ...(pageId ? { recipient: { id: pageId } } : {}),
    referral: { source, ad_id: 'ad_test', ref: 'ref_test' }
  };
}

function makeMessageWithReferral(text, senderId = 'sender_1', source = 'ADS', mid = `mid_${Math.random()}`, pageId = '') {
  return {
    sender: { id: senderId },
    ...(pageId ? { recipient: { id: pageId } } : {}),
    message: {
      mid,
      text,
      referral: { source, ad_id: 'ad_test', ref: 'ref_test' }
    }
  };
}

function markReturningCustomer(storage, senderId, daysAgo = 1) {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  storage.setLastUserAt(senderId, at);
}

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

function createWebhookHarness(config = buildAdultRuntimeConfig(), options = {}) {
  const storage = options.storage || makeStorage();
  const rules = createRuleEngine({ products, config, contextStore: storage });
  const sent = [];
  let geminiCalls = 0;
  let leadParserCalls = 0;
  let handoffCaptureCalls = 0;
  let notifyReadyOrderCalls = 0;
  let pushedLeadCalls = 0;
  let telegramAlertCalls = 0;
  let telegramOperationalAlertCalls = 0;
  let fallbackAttentionCalls = 0;
  let conversationTurnCalls = 0;
  let eventCalls = 0;

  const webhook = createWebhook({
    storage,
    shopConfig: config,
    fbVerifyToken: 'verify',
    fbAppSecret: options.fbAppSecret || '',
    webhookRateLimiter: (_req, _res, next) => next(),
    handoffMs: 30 * 60 * 1000,
    useGemini: options.useGemini !== false,
    botMessageMetadata: 'bot-test',
    resolveQuickReplyPayload,
    buildQuickReplies,
    buildDeterministicReply: options.buildDeterministicReply || rules.buildDeterministicReply,
    buildFallbackReply: options.buildFallbackReply || rules.buildFallbackReply,
    buildLeadDetails: (...args) => {
      leadParserCalls += 1;
      if (options.throwOnLeadParse) throw new Error('lead parser should not run');
      return options.buildLeadDetails ? options.buildLeadDetails(...args) : {};
    },
    buildConfirmedSheetLead: () => ({}),
    extractRequestedProductCodes: rules.extractRequestedProductCodes,
    captureHandoffOrderUpdate: (...args) => {
      handoffCaptureCalls += 1;
      if (options.throwOnHandoffCapture) throw new Error('handoff capture should not run');
      return options.captureHandoffOrderUpdate ? options.captureHandoffOrderUpdate(...args) : false;
    },
    notifyStaffForReadyOrder: async () => {
      notifyReadyOrderCalls += 1;
      return false;
    },
    looksLikePhone: rules.looksLikePhone,
    shouldSilenceAfterCompleteOrder: rules.shouldSilenceAfterCompleteOrder,
    wantsHuman: rules.wantsHuman,
    normalizeText: rules.normalizeText,
    render: rules.render,
    deriveSessionState: rules.deriveSessionState,
    STATES,
    callGemini: async () => {
      geminiCalls += 1;
      return options.geminiReply || 'Gemini answer';
    },
    getGeminiErrorInfo: err => ({ message: err.message }),
    shouldUseFallbackReply: () => false,
    isProbablyIncompleteReply: () => false,
    sendMessage: async (senderId, text) => sent.push({ type: 'text', senderId, text }),
    sendQuickReplies: async (senderId, text, quickReplies) => sent.push({ type: 'quick_replies', senderId, text, quickReplies }),
    sendImage: async (senderId, url) => sent.push({ type: 'image', senderId, url }),
    showTyping: () => {},
    sendHotCarousel: async () => false,
    isGreetingText: text => /^(?:chào|chao|hi|hello|alo|shop)/i.test(String(text || '').trim()),
    isHotProductsText: () => false,
    getMenuImageUrls: options.getMenuImageUrls || (base => [
      { file: 'menu1.png', url: `${base}/media/menu1.png` },
      { file: 'menu2.png', url: `${base}/media/menu2.png` }
    ]),
    buildRequestedImageUrls: options.buildRequestedImageUrls || ((text, _senderId, base) => {
      const codes = rules.extractRequestedProductCodes(text);
      return codes.length ? [{ file: 'ma8.png', url: `${base}/media/ma8.png` }] : [];
    }),
    pushLeadToSheet: () => {
      pushedLeadCalls += 1;
    },
    sendTelegramAlert: () => {
      telegramAlertCalls += 1;
    },
    sendTelegramOperationalAlert: () => {
      telegramOperationalAlertCalls += 1;
    },
    resetFallbackAttention: () => {},
    trackFallbackAttention: async () => {
      fallbackAttentionCalls += 1;
    },
    recordConversationTurn: () => {
      conversationTurnCalls += 1;
    },
    trackEvent: () => {
      eventCalls += 1;
    },
    maybeResetTimedOutSession: () => {},
    redactSensitiveText: text => text,
    resolveRuntimeForPage: options.resolveRuntimeForPage,
    webhookQueue: options.webhookQueue,
    webhookQueueEnabled: options.webhookQueueEnabled
  });

  return {
    handleText: (text, senderId = 'sender_1', mid, pageId = '') => webhook.handleEvent(makeEvent(text, senderId, mid, pageId), 'https://example.test'),
    handleReferral: (senderId = 'sender_1', source = 'ADS', pageId = '') => webhook.handleEvent(makeReferralEvent(senderId, source, pageId), 'https://example.test'),
    handleTextWithReferral: (text, senderId = 'sender_1', source = 'ADS', mid) =>
      webhook.handleEvent(makeMessageWithReferral(text, senderId, source, mid), 'https://example.test'),
    handleRawEvent: (event, options = {}) => webhook.handleEvent(event, 'https://example.test', options),
    registerWebhookRoutes: webhook.registerWebhookRoutes,
    sent,
    storage,
    getGeminiCalls: () => geminiCalls,
    getLeadParserCalls: () => leadParserCalls,
    getHandoffCaptureCalls: () => handoffCaptureCalls,
    getNotifyReadyOrderCalls: () => notifyReadyOrderCalls,
    getPushedLeadCalls: () => pushedLeadCalls,
    getTelegramAlertCalls: () => telegramAlertCalls,
    getTelegramOperationalAlertCalls: () => telegramOperationalAlertCalls,
    getFallbackAttentionCalls: () => fallbackAttentionCalls,
    getConversationTurnCalls: () => conversationTurnCalls,
    getEventCalls: () => eventCalls
  };
}

function buildDbRuntimeForWebhook(fallbackRuntime, overrides = {}) {
  const dbProducts = overrides.products || [{
    code: 'MÃ99',
    price: '999k',
    description: 'DB only product',
    size: '',
    weight: '',
    gift: '',
    preorder: false,
    imageFile: ''
  }];
  const dbConfig = applyBotModeConfig({
    ...shopConfig,
    shopName: 'DB Shop',
    botMode: {
      ...(shopConfig.botMode || {}),
      name: 'menu_code_handoff',
      aiFallbackEnabled: false,
      orderFlowEnabled: false,
      leadCaptureEnabled: false,
      productCodeLookupEnabled: true,
      handoffMessage: 'DB handoff message'
    },
    ...(overrides.config || {})
  });
  const dbRules = createRuleEngine({
    products: dbProducts,
    config: dbConfig,
    contextStore: fallbackRuntime.storage
  });

  return {
    shopConfig: dbConfig,
    useGemini: false,
    buildDeterministicReply: dbRules.buildDeterministicReply,
    buildFallbackReply: dbRules.buildFallbackReply,
    extractRequestedProductCodes: dbRules.extractRequestedProductCodes,
    looksLikePhone: dbRules.looksLikePhone,
    shouldSilenceAfterCompleteOrder: dbRules.shouldSilenceAfterCompleteOrder,
    wantsHuman: dbRules.wantsHuman,
    normalizeText: dbRules.normalizeText,
    render: dbRules.render,
    deriveSessionState: dbRules.deriveSessionState,
    STATES: dbRules.STATES,
    getMenuImageUrls: () => [{ file: 'db-menu.png', url: 'https://cdn.example.test/db-menu.png' }],
    buildRequestedImageUrls: () => [{ file: 'db-product.png', url: 'https://cdn.example.test/db-product.png' }],
    isGreetingText: fallbackRuntime.isGreetingText,
    isHotProductsText: fallbackRuntime.isHotProductsText,
    sendHotCarousel: async () => false
  };
}

describe('webhook: menu_code_handoff mode', () => {
  it('uses file config path unchanged when no runtime resolver is provided', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('chào shop', 'flag_off_file_path', 'm_flag_off', 'page_file');

    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].url).toContain('menu2.png');
  });

  it('marks a new message id before processing and skips duplicates', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'atomic_mid_user';

    await h.handleText('chào shop', senderId, 'm_atomic_mid', 'page_atomic');

    expect(h.sent.length).toBe(3);
    expect(h.storage._midMarks).toEqual([{
      mid: 'm_atomic_mid',
      senderId,
      pageId: 'page_atomic'
    }]);

    await h.handleText('cho xem MÃ8', senderId, 'm_atomic_mid', 'page_atomic');

    expect(h.sent.length).toBe(3);
    expect(h.storage.inHandoff(senderId)).toBeFalse();
  });

  it('fails closed without sending when message id storage fails', async () => {
    const storage = makeStorage();
    storage.tryMarkMid = () => {
      throw new Error('mid store down');
    };
    const errors = [];
    const originalError = console.error;
    console.error = message => errors.push(String(message));
    try {
      const h = createWebhookHarness(undefined, {
        storage,
        throwOnLeadParse: true
      });

      await h.handleText('chào shop', 'mid_storage_error', 'm_storage_error', 'page_error');

      expect(h.sent.length).toBe(0);
      const errorText = errors.join('\n');
      expect(errorText).toContain('MID idempotency fail-closed');
      expect(errorText).toContain('page_ref=');
      expect(errorText.includes('page_error')).toBeFalse();
    } finally {
      console.error = originalError;
    }
  });

  it('uses DB runtime config when resolver returns a page config', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async ({ pageId, fallbackRuntime }) => {
        expect(pageId).toBe('page_db');
        return buildDbRuntimeForWebhook(fallbackRuntime);
      }
    });

    await h.handleText('cho xem MÃ99', 'db_runtime_user', 'm_db_runtime', 'page_db');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('db-product.png'))).toBeTrue();
    expect(textMessages[0]).toContain('999k');
    expect(textMessages[1]).toBe('DB handoff message');
    expect(JSON.stringify(h.sent).includes('680k')).toBeFalse();
  });

  it('fails closed on unresolved DB page without sending file shop content', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async () => ({ failClosed: true, reason: 'page_not_found' })
    });

    await h.handleText('chào shop', 'db_missing_page', 'm_db_missing', 'unknown_page');

    expect(h.sent.length).toBe(0);
  });

  it('fail-closed runtime logs use page_ref instead of raw page_id', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        resolveRuntimeForPage: async () => ({ failClosed: true, reason: 'shop_not_allowed' })
      });

      await h.handleText('chào shop', 'db_denied_page', 'm_db_denied', 'page-secret-raw');

      const joined = warnings.join('\n');
      expect(joined).toContain('shop_not_allowed');
      expect(joined).toContain('page_ref=p:');
      expect(joined.includes('page_id=')).toBeFalse();
      expect(joined.includes('page-secret-raw')).toBeFalse();
      expect(h.sent.length).toBe(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('credential fail-closed logs do not include raw token or raw page_id', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        resolveRuntimeForPage: async () => ({
          failClosed: true,
          reason: 'credential_not_found',
          debugToken: 'EAAB-raw-page-token'
        })
      });

      await h.handleText('chào shop', 'db_missing_credential', 'm_missing_credential', 'page-secret-raw');

      const joined = warnings.join('\n');
      expect(joined).toContain('credential_not_found');
      expect(joined).toContain('page_ref=p:');
      expect(joined.includes('EAAB-raw-page-token')).toBeFalse();
      expect(joined.includes('page-secret-raw')).toBeFalse();
      expect(h.sent.length).toBe(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('falls back safely on DB resolver errors without logging secrets', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        resolveRuntimeForPage: async () => {
          throw new Error('postgres://user:secret@example.test/db');
        }
      });

      await h.handleText('chào shop', 'db_error_fallback', 'm_db_error', 'page_file');

      expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
      expect(warnings.join('\n').includes('secret')).toBeFalse();
      expect(warnings.join('\n')).toContain('resolver_error');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('greeting sends price/menu reply and menu images without handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('chào shop', 'minimal_greeting', 'm_greeting');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.storage.inHandoff('minimal_greeting')).toBeFalse();
  });

  it('"Giá Sản Phẩm Từ Bao Nhiêu" sends price/menu reply and menu images without handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('Giá Sản Phẩm Từ Bao Nhiêu', 'minimal_price_long', 'm_price_long');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.storage.inHandoff('minimal_price_long')).toBeFalse();
  });

  it('"Bao nhiêu vậy" sends price/menu reply and menu images without handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('Bao nhiêu vậy', 'minimal_price_short_question', 'm_price_short_question');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.storage.inHandoff('minimal_price_short_question')).toBeFalse();
  });

  it('menu/product-list questions send price/menu reply and menu images without handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('xem sản phẩm', 'minimal_product_list', 'm_product_list');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.storage.inHandoff('minimal_product_list')).toBeFalse();
  });

  it('"Giá" sends price/menu reply and menu images without handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('Giá', 'minimal_price_short', 'm_price_short');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.storage.inHandoff('minimal_price_short')).toBeFalse();
  });

  it('product code lookup sends product info, fixed handoff message, and enables handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('cho xem MÃ8', 'minimal_code', 'm_code');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(textMessages[0]).toContain('680k');
    expect(textMessages[0].includes('Tên người nhận')).toBeFalse();
    expect(textMessages[1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('minimal_code')).toBeTrue();
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.getHandoffCaptureCalls()).toBe(0);
    expect(h.getNotifyReadyOrderCalls()).toBe(0);
    expect(h.getPushedLeadCalls()).toBe(0);
    expect(h.getTelegramAlertCalls()).toBe(0);
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
    expect(h.getFallbackAttentionCalls()).toBe(0);
    expect(h.getConversationTurnCalls()).toBe(0);
  });

  it('product-code message with sibling ads referral does not also send menu or fallback', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      buildFallbackReply: () => {
        throw new Error('fallback should not run');
      }
    });
    const senderId = 'minimal_code_with_referral';
    const requestOptions = {
      requestMessageSenders: new Set([senderId]),
      requestImageDedupe: new Set()
    };

    await h.handleRawEvent(makeReferralEvent(senderId, 'ADS'), requestOptions);
    await h.handleRawEvent(makeMessageWithReferral('cho xem MÃ8', senderId, 'ADS', 'm_code_referral'), requestOptions);

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(textMessages[0]).toContain('680k');
    expect(textMessages[1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(textMessages.includes(MENU_CODE_MENU_PRICE_REPLY)).toBeFalse();
    expect(h.storage.inHandoff(senderId)).toBeTrue();
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getFallbackAttentionCalls()).toBe(0);
  });

  it('uses facade defaults when menu_code_handoff rule toggles are missing', async () => {
    const config = applyBotModeConfig({
      ...shopConfig,
      botMode: {
        name: 'menu_code_handoff',
        aiFallbackEnabled: false,
        orderFlowEnabled: false,
        handoffMessage: MENU_CODE_HANDOFF_MESSAGE
      }
    });
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    await h.handleText('cho xem MÃ8', 'toggle_defaults_code', 'm_toggle_defaults_code');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(textMessages[0]).toContain('680k');
    expect(textMessages[1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('toggle_defaults_code')).toBeTrue();
  });

  it('ruleToggles false override disables product-code lookup through the facade', async () => {
    const config = buildAdultRuntimeConfig();
    config.ruleToggles = {
      productCodeLookupEnabled: false
    };
    const h = createWebhookHarness(config, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'toggle_rule_false_code_lookup', 1);

    await h.handleText('cho xem MÃ8', 'toggle_rule_false_code_lookup', 'm_toggle_rule_false_code_lookup');

    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('toggle_rule_false_code_lookup')).toBeFalse();
    expect(h.getGeminiCalls()).toBe(0);
  });

  it('ruleToggles true override beats legacy botMode false through the facade', async () => {
    const config = buildAdultRuntimeConfig();
    config.botMode = {
      ...(config.botMode || {}),
      productCodeLookupEnabled: false
    };
    config.ruleToggles = {
      productCodeLookupEnabled: true
    };
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    await h.handleText('cho xem MÃ8', 'toggle_rule_true_code_lookup', 'm_toggle_rule_true_code_lookup');

    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(h.sent.filter(item => item.type === 'text').map(item => item.text).join('\n')).toContain('680k');
    expect(h.storage.inHandoff('toggle_rule_true_code_lookup')).toBeTrue();
  });

  it('productCodeLookupEnabled=false skips product-code lookup', async () => {
    const config = buildAdultRuntimeConfig();
    config.botMode = {
      ...(config.botMode || {}),
      productCodeLookupEnabled: false
    };
    const h = createWebhookHarness(config, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'toggle_no_code_lookup', 1);

    await h.handleText('cho xem MÃ8', 'toggle_no_code_lookup', 'm_toggle_no_code_lookup');

    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('toggle_no_code_lookup')).toBeFalse();
    expect(h.getGeminiCalls()).toBe(0);
  });

  it('menuSendingEnabled=false skips menu replies', async () => {
    const config = buildAdultRuntimeConfig();
    config.botMode = {
      ...(config.botMode || {}),
      menuSendingEnabled: false
    };
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    await h.handleText('chào shop', 'toggle_no_menu', 'm_toggle_no_menu');

    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('toggle_no_menu')).toBeFalse();
    expect(h.storage.getLastUserAt('toggle_no_menu')).toBeTruthy();
  });

  it('postProductHandoffEnabled=false sends product info without handoff', async () => {
    const config = buildAdultRuntimeConfig();
    config.botMode = {
      ...(config.botMode || {}),
      postProductHandoffEnabled: false
    };
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    await h.handleText('cho xem MÃ8', 'toggle_no_post_code_handoff', 'm_toggle_no_post_code_handoff');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(textMessages[0]).toContain('680k');
    expect(textMessages.includes(MENU_CODE_HANDOFF_MESSAGE)).toBeFalse();
    expect(h.storage.inHandoff('toggle_no_post_code_handoff')).toBeFalse();
  });

  it('out-of-scope text from returning customer sends no reply and has no side effects', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'minimal_no_ai', 1);

    await h.handleText('dùng sao', 'minimal_no_ai', 'm_no_ai');

    expect(h.getGeminiCalls()).toBe(0);
    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('minimal_no_ai')).toBeFalse();
    expect(h.storage._customers.length).toBe(0);
    expect(h.storage._events.length).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.getHandoffCaptureCalls()).toBe(0);
    expect(h.getNotifyReadyOrderCalls()).toBe(0);
    expect(h.getPushedLeadCalls()).toBe(0);
    expect(h.getTelegramAlertCalls()).toBe(0);
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
    expect(h.getFallbackAttentionCalls()).toBe(0);
    expect(h.getConversationTurnCalls()).toBe(0);
    expect(h.getEventCalls()).toBe(0);
  });

  it('does not answer again after product-code handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('MÃ8', 'minimal_after_handoff', 'm_first');
    const countAfterHandoff = h.sent.length;
    await h.handleText('alo shop', 'minimal_after_handoff', 'm_second');

    expect(h.storage.inHandoff('minimal_after_handoff')).toBeTrue();
    expect(h.sent.length).toBe(countAfterHandoff);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getHandoffCaptureCalls()).toBe(0);
  });

  it('first message from new customer (off-topic) sends price/menu reply regardless of regex', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('bên kia rẻ hơn shop', 'first_touch_offtopic', 'm_first_offtopic');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.storage.getLastUserAt('first_touch_offtopic')).toBeTruthy();
  });

  it('sends each duplicate menu image asset only once per request', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      getMenuImageUrls: base => [
        { file: 'menu1.png', url: `${base}/media/menu1.png` },
        { file: 'menu1.png', url: `${base}/media/menu1.png` },
        { file: 'menu2.png', url: `${base}/media/menu2.png` },
        { file: 'menu2.png', url: `${base}/media/menu2.png` }
      ]
    });

    await h.handleText('chào shop', 'minimal_duplicate_menu_assets', 'm_duplicate_menu_assets');

    const imageUrls = h.sent.filter(item => item.type === 'image').map(item => item.url);
    expect(imageUrls).toEqual([
      'https://example.test/media/menu1.png',
      'https://example.test/media/menu2.png'
    ]);
    expect(h.sent.length).toBe(3);
  });

  it('returning customer (within 30 days) off-topic stays silent', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'returning_recent', 5);

    await h.handleText('có ship Cần Thơ không', 'returning_recent', 'm_returning_recent');

    expect(h.sent.length).toBe(0);
  });

  it('returning customer after 30+ days off-topic gets menu+caption again', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'returning_lapsed', 45);

    await h.handleText('bên kia rẻ hơn shop', 'returning_lapsed', 'm_returning_lapsed');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
  });

  it('pure ads referral event without message text logs only and sends no reply', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleReferral('ads_referral_only', 'ADS');

    expect(h.sent.length).toBe(0);
  });

  it('SHORTLINK referral (m.me link) logs only and sends no reply', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'shortlink_returning', 5);

    await h.handleReferral('shortlink_returning', 'SHORTLINK');

    expect(h.sent.length).toBe(0);
  });

  it('ads referral followed by a real message sends one menu reply', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'ads_then_real_message';

    await h.handleReferral(senderId, 'ADS', 'page_ads');
    await h.handleText('chào shop', senderId, 'm_ads_then_real', 'page_ads');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
  });

  it('dedupes same sender and normalized text across webhook calls within TTL', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('Chào   shop', 'ttl_same_sender_text', 'm_ttl_1', 'page_ttl');
    await h.handleText('chào shop', 'ttl_same_sender_text', 'm_ttl_2', 'page_ttl');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('allows same sender and same menu text again after duplicate TTL and menu cooldown', async () => {
    const originalNow = Date.now;
    let nowMs = 1000000;
    Date.now = () => nowMs;
    try {
      const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

      await h.handleText('chào shop', 'ttl_expired_sender', 'm_ttl_expired_1', 'page_ttl');
      nowMs += 15100;
      await h.handleText('chào shop', 'ttl_expired_sender', 'm_ttl_expired_2', 'page_ttl');

      expect(h.sent.length).toBe(6);
      expect(h.sent.filter(item => item.type === 'text').length).toBe(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it('suppresses different menu-trigger text from the same sender within menu cooldown', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = message => logs.push(String(message));
    try {
      const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

      await h.handleText('Cho tôi xem danh sách sản phẩm', 'menu_cooldown_text', 'm_menu_cooldown_1', 'page_ttl');
      await h.handleText('Giá Sản Phẩm Từ Bao Nhiêu', 'menu_cooldown_text', 'm_menu_cooldown_2', 'page_ttl');

      expect(h.sent.length).toBe(3);
      expect(h.sent.filter(item => item.type === 'text').length).toBe(1);
      expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
      expect(logs.join('\n')).toContain('skipped duplicate menu within cooldown');
    } finally {
      console.log = originalLog;
    }
  });

  it('allows same sender to receive menu again after menu cooldown', async () => {
    const originalNow = Date.now;
    let nowMs = 2000000;
    Date.now = () => nowMs;
    try {
      const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

      await h.handleText('Cho tôi xem danh sách sản phẩm', 'menu_cooldown_expired', 'm_menu_cooldown_expired_1', 'page_ttl');
      nowMs += 15100;
      await h.handleText('Giá Sản Phẩm Từ Bao Nhiêu', 'menu_cooldown_expired', 'm_menu_cooldown_expired_2', 'page_ttl');

      expect(h.sent.length).toBe(6);
      expect(h.sent.filter(item => item.type === 'text').length).toBe(2);
      expect(h.sent.filter(item => item.type === 'image').length).toBe(4);
    } finally {
      Date.now = originalNow;
    }
  });

  it('allows different sender with the same text within duplicate TTL', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('chào shop', 'ttl_sender_1', 'm_ttl_sender_1', 'page_ttl');
    await h.handleText('chào shop', 'ttl_sender_2', 'm_ttl_sender_2', 'page_ttl');

    expect(h.sent.length).toBe(6);
    expect(h.sent.filter(item => item.type === 'text').length).toBe(2);
  });

  it('allows product-code reply within menu cooldown', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'code_during_menu_cooldown';

    await h.handleText('chào shop', senderId, 'm_code_cooldown_1', 'page_ttl');
    await h.handleText('cho xem MÃ8', senderId, 'm_code_cooldown_2', 'page_ttl');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.length).toBe(6);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(textMessages.filter(text => text === MENU_CODE_MENU_PRICE_REPLY).length).toBe(1);
    expect(textMessages.some(text => text.includes('680k'))).toBeTrue();
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff(senderId)).toBeTrue();
  });

  it('ads referral with off-topic message overrides returning-customer silence', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'ads_returning', 5);

    await h.handleTextWithReferral('bên kia rẻ hơn shop', 'ads_returning', 'ADS', 'm_ads_returning');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('sibling ads referral in same request still makes the message send one menu', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'ads_sibling_returning';
    markReturningCustomer(h.storage, senderId, 5);
    const requestOptions = {
      requestMessageSenders: new Set([senderId]),
      requestAdsReferralSenders: new Set([senderId]),
      requestImageDedupe: new Set()
    };

    await h.handleRawEvent(makeReferralEvent(senderId, 'ADS'), requestOptions);
    await h.handleRawEvent(makeEvent('bên kia rẻ hơn shop', senderId, 'm_ads_sibling'), requestOptions);

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
  });

  it('registered webhook route processes referral and message sequentially for one sender', async () => {
    let activeResolvers = 0;
    let maxActiveResolvers = 0;
    const resolverOrder = [];
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async ({ event }) => {
        const label = event.message?.text || 'referral';
        activeResolvers += 1;
        maxActiveResolvers = Math.max(maxActiveResolvers, activeResolvers);
        resolverOrder.push(`start:${label}`);
        await delay(10);
        resolverOrder.push(`end:${label}`);
        activeResolvers -= 1;
        return null;
      }
    });
    const senderId = 'route_ads_sibling_returning';
    markReturningCustomer(h.storage, senderId, 5);

    let postHandler = null;
    const app = {
      get() {},
      post(_path, limiter, handler) {
        postHandler = (req, res) => limiter(req, res, () => handler(req, res));
      }
    };
    h.registerWebhookRoutes(app);

    let responseStatus = 0;
    postHandler({
      body: {
        object: 'page',
        entry: [{
          id: 'page_route',
          messaging: [
            makeReferralEvent(senderId, 'ADS'),
            makeEvent('bên kia rẻ hơn shop', senderId, 'm_route_ads_sibling')
          ]
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

    expect(responseStatus).toBe(200);
    await waitFor(() => h.sent.length === 3, 'webhook route did not finish background event handling');

    expect(maxActiveResolvers).toBe(1);
    expect(resolverOrder).toEqual([
      'start:referral',
      'end:referral',
      'start:bên kia rẻ hơn shop',
      'end:bên kia rẻ hơn shop'
    ]);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent.filter(item => item.type === 'text').length).toBe(1);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
  });

  it('queue disabled keeps current webhook path', async () => {
    let enqueueCalls = 0;
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      webhookQueueEnabled: false,
      webhookQueue: {
        enqueueEvent: async () => {
          enqueueCalls += 1;
          throw new Error('queue should stay disabled');
        }
      }
    });

    let postHandler = null;
    const app = {
      get() {},
      post(_path, limiter, handler) {
        postHandler = (req, res) => limiter(req, res, () => handler(req, res));
      }
    };
    h.registerWebhookRoutes(app);

    let responseStatus = 0;
    await postHandler({
      body: {
        object: 'page',
        entry: [{
          id: 'page_route',
          messaging: [makeEvent('chào shop', 'queue_disabled_sender', 'm_queue_disabled')]
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

    expect(responseStatus).toBe(200);
    await waitFor(() => h.sent.length === 3, 'queue-disabled route did not use inline processing');
    expect(enqueueCalls).toBe(0);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('queue enabled enqueues request events instead of inline processing', async () => {
    const enqueued = [];
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      webhookQueueEnabled: true,
      webhookQueue: {
        enqueueEvent: async job => {
          enqueued.push(job);
          return { id: enqueued.length, status: 'queued' };
        }
      }
    });

    let postHandler = null;
    const app = {
      get() {},
      post(_path, limiter, handler) {
        postHandler = (req, res) => limiter(req, res, () => handler(req, res));
      }
    };
    h.registerWebhookRoutes(app);

    let responseStatus = 0;
    await postHandler({
      body: {
        object: 'page',
        entry: [{
          id: 'page_queue',
          messaging: [makeEvent('chào shop', 'queue_enabled_sender', 'm_queue_enabled')]
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

    expect(responseStatus).toBe(200);
    expect(h.sent.length).toBe(0);
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].pageId).toBe('page_queue');
    expect(enqueued[0].event.message.mid).toBe('m_queue_enabled');
    expect(enqueued[0].payload.baseUrl).toBe('https://example.test');
    expect(enqueued[0].payload.requestMessageSenderIds).toEqual(['queue_enabled_sender']);
  });

  it('queue enabled returns 500 when enqueue fails so Meta can retry', async () => {
    let enqueueCalls = 0;
    const errors = [];
    const originalError = console.error;
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      webhookQueueEnabled: true,
      webhookQueue: {
        enqueueEvent: async () => {
          enqueueCalls += 1;
          throw new Error('raw customer body EAAB-secret chào shop');
        }
      }
    });

    let postHandler = null;
    const app = {
      get() {},
      post(_path, limiter, handler) {
        postHandler = (req, res) => limiter(req, res, () => handler(req, res));
      }
    };
    h.registerWebhookRoutes(app);

    let responseStatus = 0;
    console.error = message => errors.push(String(message));
    try {
      await postHandler({
        body: {
          object: 'page',
          entry: [{
            id: 'page_queue_failure',
            messaging: [makeEvent('chào shop', 'queue_failure_sender', 'm_queue_failure')]
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
    } finally {
      console.error = originalError;
    }

    const errorText = errors.join('\n');
    expect(responseStatus).toBe(500);
    expect(enqueueCalls).toBe(1);
    expect(h.sent.length).toBe(0);
    expect(errorText).toContain('[webhook-queue] enqueue failed');
    expect(errorText.includes('page_queue_failure')).toBeFalse();
    expect(errorText.includes('chào shop')).toBeFalse();
    expect(errorText.includes('EAAB-secret')).toBeFalse();
  });

  it('queue path does not enqueue before signature validation', async () => {
    let enqueueCalls = 0;
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      fbAppSecret: 'app-secret',
      webhookQueueEnabled: true,
      webhookQueue: {
        enqueueEvent: async () => {
          enqueueCalls += 1;
        }
      }
    });

    let postHandler = null;
    const app = {
      get() {},
      post(_path, limiter, handler) {
        postHandler = (req, res) => limiter(req, res, () => handler(req, res));
      }
    };
    h.registerWebhookRoutes(app);

    const body = {
      object: 'page',
      entry: [{
        id: 'page_queue',
        messaging: [makeEvent('chào shop', 'queue_signature_sender', 'm_queue_signature')]
      }]
    };
    let responseStatus = 0;
    await postHandler({
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
      protocol: 'https',
      get(name) {
        const headers = {
          host: 'example.test',
          'x-hub-signature-256': 'sha256=bad'
        };
        return headers[String(name || '').toLowerCase()] || '';
      }
    }, {
      sendStatus(code) {
        responseStatus = code;
      }
    });

    expect(responseStatus).toBe(403);
    expect(enqueueCalls).toBe(0);
    expect(h.sent.length).toBe(0);
  });

  it('ads referral during handoff does not break handoff silence', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    h.storage.setHandoff('ads_in_handoff', Date.now() + 30 * 60 * 1000);

    await h.handleReferral('ads_in_handoff', 'ADS');

    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('ads_in_handoff')).toBeTrue();
  });

  it('non-ads referral source (e.g. CUSTOMER_CHAT_PLUGIN) is ignored', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'chat_plugin_returning', 5);

    await h.handleReferral('chat_plugin_returning', 'CUSTOMER_CHAT_PLUGIN');

    expect(h.sent.length).toBe(0);
  });

  it('"bao nhiêu tiền" from returning customer matches expanded regex and sends menu+caption', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'returning_price_tien', 5);

    await h.handleText('bao nhiêu tiền', 'returning_price_tien', 'm_returning_price_tien');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('"giá thế nào" from returning customer matches expanded regex and sends menu+caption', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'returning_price_tn', 5);

    await h.handleText('giá thế nào ạ', 'returning_price_tn', 'm_returning_price_tn');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('"yo" greeting variant from returning customer triggers menu+caption', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'returning_yo', 5);

    await h.handleText('yo', 'returning_yo', 'm_returning_yo');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('first message with product code still goes through product-code branch, not menu', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('cho xem MÃ8', 'first_with_code', 'm_first_with_code');

    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma8.png'))).toBeTrue();
    expect(h.storage.inHandoff('first_with_code')).toBeTrue();
    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(textMessages.includes(MENU_CODE_MENU_PRICE_REPLY)).toBeFalse();
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
  });

  it('does not run Gemini, Telegram, order, export, follow-up, or alert side effects in this mode', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      throwOnHandoffCapture: true
    });
    markReturningCustomer(h.storage, 'minimal_side_effects', 1);

    await h.handleText('sdt 0912345678', 'minimal_side_effects', 'm_side_effects');

    expect(h.sent.length).toBe(0);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.storage._customers.length).toBe(0);
    expect(h.storage._events.length).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
    expect(h.getHandoffCaptureCalls()).toBe(0);
    expect(h.getNotifyReadyOrderCalls()).toBe(0);
    expect(h.getPushedLeadCalls()).toBe(0);
    expect(h.getTelegramAlertCalls()).toBe(0);
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
    expect(h.getFallbackAttentionCalls()).toBe(0);
    expect(h.getConversationTurnCalls()).toBe(0);
    expect(h.getEventCalls()).toBe(0);
  });

  it('keeps human-handoff requests out of minimal mode before product code', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'minimal_human_request', 1);

    await h.handleText('gặp nhân viên tư vấn', 'minimal_human_request', 'm_minimal_human');

    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('minimal_human_request')).toBeFalse();
    expect(h.storage._customers.length).toBe(0);
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
    expect(h.getGeminiCalls()).toBe(0);
  });
});

describe('webhook: default full mode', () => {
  it('still calls Gemini when no deterministic rule matches and Gemini is enabled', async () => {
    const fullConfig = {
      shopName: 'shop',
      policies: shopConfig.policies,
      intents: {},
      templates: {},
      recommendations: {}
    };
    const h = createWebhookHarness(fullConfig, {
      buildDeterministicReply: () => null,
      buildFallbackReply: () => 'Fallback answer',
      buildLeadDetails: () => ({})
    });

    await h.handleText('unhandled message', 'full_mode', 'm_full');

    expect(h.getGeminiCalls()).toBe(1);
    expect(h.sent.filter(item => item.type === 'text')[0].text).toBe('Gemini answer');
    expect(h.storage.inHandoff('full_mode')).toBeFalse();
  });

  it('still sends fallback for unmatched full-mode messages when Gemini is disabled', async () => {
    const fullConfig = {
      shopName: 'shop',
      policies: shopConfig.policies,
      intents: {},
      templates: {},
      recommendations: {}
    };
    const h = createWebhookHarness(fullConfig, {
      useGemini: false,
      buildDeterministicReply: () => null,
      buildFallbackReply: () => 'Fallback answer',
      buildLeadDetails: () => ({})
    });

    await h.handleText('unhandled message', 'full_mode_fallback', 'm_full_fallback');

    expect(h.sent[0].text).toBe('Fallback answer');
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getFallbackAttentionCalls()).toBe(1);
  });

  it('does not enforce fallbackEnabled=false in full mode yet', async () => {
    const fullConfig = {
      shopName: 'shop',
      policies: shopConfig.policies,
      intents: {},
      templates: {},
      recommendations: {},
      ruleToggles: {
        fallbackEnabled: false
      }
    };
    const h = createWebhookHarness(fullConfig, {
      useGemini: false,
      buildDeterministicReply: () => null,
      buildFallbackReply: () => 'Fallback answer',
      buildLeadDetails: () => ({})
    });

    await h.handleText('unhandled message', 'fallback_disabled', 'm_fallback_disabled');

    expect(h.sent[0].text).toBe('Fallback answer');
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getFallbackAttentionCalls()).toBe(1);
  });

  it('still captures handoff order updates when order flow is enabled', async () => {
    const fullConfig = {
      shopName: 'shop',
      policies: shopConfig.policies,
      intents: {},
      templates: {},
      recommendations: {}
    };
    const h = createWebhookHarness(fullConfig, {
      captureHandoffOrderUpdate: () => true
    });

    h.storage.setHandoff('full_handoff_capture', Date.now() + 30 * 60 * 1000);
    await h.handleText('sdt 0912345678', 'full_handoff_capture', 'm_full_handoff');

    expect(h.getHandoffCaptureCalls()).toBe(1);
    expect(h.sent.length).toBe(0);
  });

  it('still handles human-handoff requests in full mode', async () => {
    const fullConfig = {
      shopName: 'shop',
      policies: shopConfig.policies,
      intents: {},
      templates: {},
      recommendations: {}
    };
    const h = createWebhookHarness(fullConfig, {
      buildLeadDetails: () => ({})
    });

    await h.handleText('gặp nhân viên tư vấn', 'full_human_request', 'm_full_human');

    expect(h.storage.inHandoff('full_human_request')).toBeTrue();
    expect(h.sent.length).toBe(1);
    expect(h.sent[0].text).toContain('nhân viên');
    expect(h.storage._customers[0].type).toBe('handoff_request');
    expect(h.getTelegramOperationalAlertCalls()).toBe(1);
    expect(h.getGeminiCalls()).toBe(0);
  });
});

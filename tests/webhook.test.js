const { describe, it, expect } = require('./harness');
const path = require('path');
const { createWebhook } = require('../core/webhook');
const { createRuleEngine, STATES } = require('../core/rules');
const { loadProducts } = require('../core/products');
const { buildQuickReplies, resolveQuickReplyPayload } = require('../core/quick-replies');
const shopConfig = require('../shops/adult-shop/config');
const adultCustomIntents = require('../shops/adult-shop/custom-intents');
const {
  BASIC_SALES_V2,
  MENU_CODE_HANDOFF_MESSAGE,
  MENU_CODE_MENU_PRICE_REPLY,
  applyBotModeConfig,
  isBasicSalesV2Mode
} = require('../core/bot-mode');
const { BASIC_SALES_V2_MENU_REPLY } = require('../core/flows/basic-sales-flow-v2');
const { HOT_PRODUCTS_EMPTY_REPLY } = require('../core/hot-products');

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

function buildHotProductsRuntimeConfig(hotProducts, overrides = {}) {
  const base = buildAdultRuntimeConfig();
  const { botMode, ...restOverrides } = overrides;
  return {
    ...base,
    ...restOverrides,
    botMode: {
      ...(base.botMode || {}),
      ...(botMode || {})
    },
    hotProducts
  };
}

function buildBasicSalesV2RuntimeConfig(overrides = {}) {
  const {
    basicSalesV2,
    botMode,
    hotProducts,
    ...restOverrides
  } = overrides;
  return applyBotModeConfig({
    shopName: 'Pilot Test Shop',
    shopId: 'pilot-test-shop',
    policies: {
      ...(shopConfig.policies || {})
    },
    recommendations: {},
    intents: {},
    templates: {
      productDetail: '{{productCode}} is {{price}}. {{pitch}}'
    },
    ...restOverrides,
    botMode: {
      name: BASIC_SALES_V2,
      aiFallbackEnabled: false,
      orderFlowEnabled: false,
      leadCaptureEnabled: false,
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      handoffMessage: 'Pilot handoff after product detail.',
      ...(botMode || {})
    },
    basicSalesV2: {
      enabled: true,
      ...(basicSalesV2 || {})
    },
    ...(hotProducts ? { hotProducts } : {})
  });
}

function makeEvent(text, senderId = 'sender_1', mid = `mid_${Math.random()}`, pageId = '') {
  return {
    sender: { id: senderId },
    ...(pageId ? { recipient: { id: pageId } } : {}),
    message: { mid, text }
  };
}

function makeTimestampedEvent(text, timestamp, senderId = 'sender_1', mid = `mid_${Math.random()}`, pageId = '') {
  return {
    ...makeEvent(text, senderId, mid, pageId),
    timestamp
  };
}

function makeFacebookSendError(code, subcode, message) {
  const err = new Error(message || 'Facebook send failed');
  err.response = {
    status: 400,
    data: {
      error: {
        message,
        type: 'OAuthException',
        code,
        error_subcode: subcode,
        fbtrace_id: 'trace-test'
      }
    }
  };
  return err;
}

function failSendOnce(err) {
  let failed = false;
  return () => {
    if (failed) return null;
    failed = true;
    return err;
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
  const runtimeProducts = options.products || products;
  const rules = createRuleEngine({ products: runtimeProducts, config, contextStore: storage });
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
  let showTypingCalls = 0;

  const webhook = createWebhook({
    storage,
    shopConfig: config,
    products: runtimeProducts,
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
    sendMessage: async (senderId, text) => {
      const sendError = typeof options.sendMessageError === 'function'
        ? options.sendMessageError({ senderId, text })
        : options.sendMessageError;
      if (sendError) throw sendError;
      sent.push({ type: 'text', senderId, text });
    },
    sendQuickReplies: async (senderId, text, quickReplies) => {
      if (options.sendQuickRepliesError) throw options.sendQuickRepliesError;
      sent.push({ type: 'quick_replies', senderId, text, quickReplies });
    },
    sendImage: async (senderId, url) => {
      if (options.sendImageError) throw options.sendImageError;
      sent.push({ type: 'image', senderId, url });
    },
    showTyping: () => {
      showTypingCalls += 1;
    },
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
    fileConfigPageIds: options.fileConfigPageIds,
    webhookQueue: options.webhookQueue,
    webhookQueueEnabled: options.webhookQueueEnabled
  });

  return {
    handleText: (text, senderId = 'sender_1', mid, pageId = '') => webhook.handleEvent(makeEvent(text, senderId, mid, pageId), 'https://example.test'),
    handleReferral: (senderId = 'sender_1', source = 'ADS', pageId = '') => webhook.handleEvent(makeReferralEvent(senderId, source, pageId), 'https://example.test'),
    handleTextWithReferral: (text, senderId = 'sender_1', source = 'ADS', mid, pageId = '') =>
      webhook.handleEvent(makeMessageWithReferral(text, senderId, source, mid, pageId), 'https://example.test'),
    handleRawEvent: (event, options = {}) => webhook.handleEvent(event, 'https://example.test', options),
    processQueuedWebhookJob: webhook.processQueuedWebhookJob,
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
    getEventCalls: () => eventCalls,
    getShowTypingCalls: () => showTypingCalls
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
    contextStore: overrides.storage || fallbackRuntime.storage
  });

  return {
    storage: overrides.storage || fallbackRuntime.storage,
    shopConfig: dbConfig,
    products: dbProducts,
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

function expectNoRuntimeFallback(h, senderId) {
  expect(h.sent.length).toBe(0);
  expect(h.storage.inHandoff(senderId)).toBeFalse();
  expect(h.storage._handoff.size).toBe(0);
  expect(h.storage._midMarks.length).toBe(0);
  expect(h.storage._customers.length).toBe(0);
  expect(h.storage._events.length).toBe(0);
  expect(h.getGeminiCalls()).toBe(0);
  expect(h.getLeadParserCalls()).toBe(0);
  expect(h.getHandoffCaptureCalls()).toBe(0);
  expect(h.getNotifyReadyOrderCalls()).toBe(0);
  expect(h.getPushedLeadCalls()).toBe(0);
  expect(h.getTelegramAlertCalls()).toBe(0);
  expect(h.getTelegramOperationalAlertCalls()).toBe(0);
  expect(h.getFallbackAttentionCalls()).toBe(0);
  expect(h.getConversationTurnCalls()).toBe(0);
  expect(h.getEventCalls()).toBe(0);
  expect(h.getShowTypingCalls()).toBe(0);
}

describe('webhook: menu_code_handoff mode', () => {
  it('static mode uses file config path unchanged when no runtime resolver is provided', async () => {
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

  it('skips stale webhook events before sending automated replies', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const staleTimestamp = Date.now() - (24 * 60 * 60 * 1000);

    await h.handleRawEvent(makeTimestampedEvent(
      'chào shop',
      staleTimestamp,
      'stale_event_user',
      'm_stale_event',
      'page_stale'
    ));

    expect(h.sent.length).toBe(0);
    expect(h.storage._midMarks.length).toBe(1);
    expect(h.storage._midMarks[0].mid).toBe('m_stale_event');
  });

  it('does not skip fresh timestamped customer messages', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleRawEvent(makeTimestampedEvent(
      'chào shop',
      Date.now(),
      'fresh_event_user',
      'm_fresh_event',
      'page_fresh'
    ));

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.storage._midMarks.length).toBe(1);
    expect(h.storage._midMarks[0].mid).toBe('m_fresh_event');
  });

  it('does not retry or escalate non-retryable Messenger send blocks', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      sendMessageError: makeFacebookSendError(
        10,
        2018278,
        '(#10) This message is sent outside of allowed window.'
      )
    });

    await h.handleText('chào shop', 'outside_window_user', 'm_outside_window', 'page_window');

    expect(h.sent.length).toBe(0);
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
  });

  it('logs non-retryable send blocks without raw identifiers or customer text', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      sendMessageError: makeFacebookSendError(
        10,
        2018278,
        '(#10) This message is sent outside of allowed window.'
      )
    });

    console.warn = message => warnings.push(String(message));
    try {
      await h.handleText('private customer body', 'sender_private_block', 'm_private_block', 'page_private_block');
    } finally {
      console.warn = originalWarn;
    }

    const warningText = warnings.join('\n');
    expect(warningText).toContain('[messenger-send] blocked');
    expect(warningText).toContain('reason=outside_allowed_window');
    expect(warningText.includes('page_private_block')).toBeFalse();
    expect(warningText.includes('sender_private_block')).toBeFalse();
    expect(warningText.includes('private customer body')).toBeFalse();
  });

  it('blocked menu text send #551 does not leave active menu cooldown', async () => {
    const logs = [];
    const warnings = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const senderId = 'blocked_menu_551_sender';
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      sendMessageError: failSendOnce(makeFacebookSendError(
        551,
        1545041,
        '(#551) This person is not available right now.'
      ))
    });

    console.log = message => logs.push(String(message));
    console.warn = message => warnings.push(String(message));
    try {
      await h.handleText('chào shop', senderId, 'm_blocked_menu_551_1', 'page_blocked_menu_551');
      await h.handleText('Giá Sản Phẩm Từ Bao Nhiêu', senderId, 'm_blocked_menu_551_2', 'page_blocked_menu_551');
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }

    const logText = logs.join('\n');
    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(logText.includes('skipped duplicate menu within cooldown')).toBeFalse();
    expect(warnings.join('\n')).toContain('reason=recipient_unavailable');
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
  });

  it('blocked menu text send #10 does not leave active menu cooldown', async () => {
    const logs = [];
    const warnings = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const senderId = 'blocked_menu_10_sender';
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      sendMessageError: failSendOnce(makeFacebookSendError(
        10,
        2018278,
        '(#10) This message is sent outside of allowed window.'
      ))
    });

    console.log = message => logs.push(String(message));
    console.warn = message => warnings.push(String(message));
    try {
      await h.handleText('chào shop', senderId, 'm_blocked_menu_10_1', 'page_blocked_menu_10');
      await h.handleText('Cho tôi xem danh sách sản phẩm', senderId, 'm_blocked_menu_10_2', 'page_blocked_menu_10');
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }

    const logText = logs.join('\n');
    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(logText.includes('skipped duplicate menu within cooldown')).toBeFalse();
    expect(warnings.join('\n')).toContain('reason=outside_allowed_window');
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
  });

  it('handles queued recipient-unavailable send blocks without retrying or alerting', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      sendMessageError: makeFacebookSendError(
        551,
        1545041,
        '(#551) This person is not available right now.'
      )
    });

    await h.processQueuedWebhookJob({
      payloadJson: {
        pageId: 'page_queue_blocked',
        baseUrl: 'https://example.test'
      },
      eventJson: makeEvent('chào shop', 'queue_blocked_user', 'm_queue_blocked', 'page_queue_blocked')
    });

    expect(h.sent.length).toBe(0);
    expect(h.getTelegramOperationalAlertCalls()).toBe(0);
  });

  it('still surfaces retryable queued send errors', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      sendMessageError: makeFacebookSendError(2, null, 'Temporary send failure')
    });
    let thrown = null;

    try {
      await h.processQueuedWebhookJob({
        payloadJson: {
          pageId: 'page_queue_retryable',
          baseUrl: 'https://example.test'
        },
        eventJson: makeEvent('chào shop', 'queue_retryable_user', 'm_queue_retryable', 'page_queue_retryable')
      });
    } catch (err) {
      thrown = err;
    }

    expect(Boolean(thrown)).toBeTrue();
    expect(thrown.message).toBe('Temporary send failure');
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

  it('DB runtime numeric product codes use exact code for product image lookup', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async ({ fallbackRuntime }) => {
        const runtime = buildDbRuntimeForWebhook(fallbackRuntime, {
          products: [{
            code: '11',
            price: '100k',
            description: 'Numeric DB product',
            size: '',
            weight: '',
            gift: '',
            preorder: false,
            imageFile: ''
          }]
        });
        runtime.buildRequestedImageUrls = text => {
          const codes = runtime.extractRequestedProductCodes(text);
          return codes.includes('11')
            ? [{ file: 'db-11.png', url: 'https://cdn.example.test/db-11.png' }]
            : [];
        };
        return runtime;
      }
    });

    await h.handleText('11', 'db_numeric_code_user', 'm_db_numeric_code', 'page_db_numeric');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('db-11.png'))).toBeTrue();
    expect(textMessages[0]).toContain('100k');
    expect(textMessages[1]).toBe('DB handoff message');
    expect(h.storage.getLastProductCode('db_numeric_code_user')).toBe('11');
    expect(h.storage.inHandoff('db_numeric_code_user')).toBeTrue();
  });

  it('uses resolved runtime storage instead of the singleton storage', async () => {
    const senderId = 'same_sender_db_runtime';
    const pageStorage = {
      page_a: makeStorage(),
      page_b: makeStorage()
    };
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async ({ pageId, fallbackRuntime }) =>
        buildDbRuntimeForWebhook(fallbackRuntime, { storage: pageStorage[pageId] })
    });

    await h.handleText('cho xem MÃ99', senderId, 'm_db_runtime_a', 'page_a');

    expect(pageStorage.page_a.inHandoff(senderId)).toBeTrue();
    expect(pageStorage.page_a.getLastProductCode(senderId)).toBe('MÃ99');
    expect(pageStorage.page_b.inHandoff(senderId)).toBeFalse();
    expect(pageStorage.page_b.getLastProductCode(senderId)).toBe('');
    expect(h.storage.inHandoff(senderId)).toBeFalse();

    await h.handleText('cho xem MÃ99', senderId, 'm_db_runtime_b', 'page_b');

    expect(pageStorage.page_b.inHandoff(senderId)).toBeTrue();
    expect(pageStorage.page_b.getLastProductCode(senderId)).toBe('MÃ99');
  });

  it('DB multi-shop mode fails closed on unknown page without adult-shop fallback', async () => {
    const senderId = 'db_unknown_page';
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async () => ({ reason: 'page_not_found' })
    });

    await h.handleText('cho xem MÃ8', senderId, 'm_db_unknown', 'unknown_page');

    expectNoRuntimeFallback(h, senderId);
  });

  it('DB multi-shop mode fails closed for paused shops before webhook side effects', async () => {
    const senderId = 'db_paused_shop';
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async () => ({ failClosed: true, reason: 'shop_status_not_active' })
    });

    await h.handleText('chào shop', senderId, 'm_db_paused', 'page_db_paused');

    expectNoRuntimeFallback(h, senderId);
  });

  it('registered webhook route returns 200 for unmapped DB pages without processing', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const senderId = 'route_unmapped_db_page';
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        resolveRuntimeForPage: async () => ({ failClosed: true, reason: 'page_not_found' })
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
            id: 'page-secret-raw',
            messaging: [makeEvent('chào shop', senderId, 'm_route_unmapped_db')]
          }]
        },
        protocol: 'https',
        get(name) {
          const headers = { host: 'example.test' };
          return headers[String(name || '').toLowerCase()] || '';
        }
      }, {
        sendStatus(code) {
          responseStatus = code;
        }
      });

      expect(responseStatus).toBe(200);
      await waitFor(() => warnings.length > 0, 'unmapped page warning was not logged');
      expectNoRuntimeFallback(h, senderId);
      expect(warnings.join('\n')).toContain('page_ref=p:');
      expect(warnings.join('\n').includes('page-secret-raw')).toBeFalse();
    } finally {
      console.warn = originalWarn;
    }
  });

  it('file-config runtime accepts an intentionally configured page id', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      fileConfigPageIds: ['page_file_config']
    });

    await h.handleText('chào shop', 'file_config_mapped', 'm_file_config_mapped', 'page_file_config');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.storage._midMarks.length).toBe(1);
    expect(h.storage._midMarks[0].pageId).toBe('page_file_config');
  });

  it('file-config runtime fails closed for unconfigured pages without PAGE_ID fallback', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const senderId = 'file_config_unmapped';
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        fileConfigPageIds: ['page_file_config']
      });

      await h.handleText('chào shop', senderId, 'm_file_config_unmapped', 'page-secret-raw');

      expectNoRuntimeFallback(h, senderId);
      const joined = warnings.join('\n');
      expect(joined).toContain('page_not_configured');
      expect(joined).toContain('page_ref=p:');
      expect(joined.includes('page-secret-raw')).toBeFalse();
    } finally {
      console.warn = originalWarn;
    }
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

  it('DB multi-shop mode fails closed on missing credential without adult-shop fallback', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const senderId = 'db_missing_credential';
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        resolveRuntimeForPage: async () => ({
          failClosed: true,
          reason: 'credential_not_found',
          debugToken: 'EAAB-raw-page-token'
        })
      });

      await h.handleText('cho xem MÃ8', senderId, 'm_missing_credential', 'page-secret-raw');

      const joined = warnings.join('\n');
      expect(joined).toContain('credential_not_found');
      expect(joined).toContain('page_ref=p:');
      expect(joined.includes('EAAB-raw-page-token')).toBeFalse();
      expect(joined.includes('page-secret-raw')).toBeFalse();
      expectNoRuntimeFallback(h, senderId);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('DB multi-shop mode fails closed on ambiguous mapping without adult-shop fallback', async () => {
    const senderId = 'db_ambiguous_mapping';
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      resolveRuntimeForPage: async () => ({ failClosed: true, reason: 'ambiguous_page_mapping' })
    });

    await h.handleText('cho xem MÃ8', senderId, 'm_db_ambiguous', 'ambiguous_page');

    expectNoRuntimeFallback(h, senderId);
  });

  it('DB multi-shop mode fails closed on resolver errors without adult-shop fallback or secret logs', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
      const senderId = 'db_error_fail_closed';
      const h = createWebhookHarness(undefined, {
        throwOnLeadParse: true,
        resolveRuntimeForPage: async () => {
          throw new Error('postgres://user:secret@example.test/db');
        }
      });

      await h.handleText('cho xem MÃ8', senderId, 'm_db_error', 'page-secret-raw');

      const joined = warnings.join('\n');
      expect(joined).toContain('fail-closed');
      expect(joined).toContain('resolver_error');
      expect(joined).toContain('page_ref=p:');
      expect(joined.includes('secret')).toBeFalse();
      expect(joined.includes('page-secret-raw')).toBeFalse();
      expectNoRuntimeFallback(h, senderId);
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

  it('explicit menu request from returning customer still sends menu images', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'minimal_menu_still_works', 1);

    await h.handleText('menu', 'minimal_menu_still_works', 'm_menu_still_works');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.storage.inHandoff('minimal_menu_still_works')).toBeFalse();
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

  it('custom product code lookup uses exact code for product image lookup', async () => {
    const lookups = [];
    const h = createWebhookHarness(undefined, {
      products: [{
        id: 'prod-smoke-1',
        code: 'smoke-1',
        name: 'Smoke One',
        price: '120k',
        description: 'Custom smoke product',
        size: '',
        weight: '',
        gift: '',
        preorder: false,
        status: 'active'
      }],
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => {
        lookups.push(String(text || ''));
        if (String(text || '').toLowerCase() === 'smoke-1') {
          return [{ file: 'smoke-1.png', url: `${base}/media/smoke-1.png` }];
        }
        if (String(text || '').toLowerCase() === 'ma 1') {
          return [{ file: 'wrong-ma1.png', url: `${base}/media/wrong-ma1.png` }];
        }
        return [];
      }
    });

    await h.handleText('smoke-1', 'custom_code_image_user', 'm_custom_code_image');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('smoke-1.png'))).toBeTrue();
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('wrong-ma1.png'))).toBeFalse();
    expect(lookups).toEqual(['SMOKE-1']);
    expect(textMessages[0]).toContain('120k');
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('custom_code_image_user')).toBeTrue();
  });

  it('custom product code without image does not fall back to numeric product image', async () => {
    const lookups = [];
    const h = createWebhookHarness(undefined, {
      products: [{
        id: 'prod-noimg-1',
        code: 'noimg-1',
        name: 'No Image One',
        price: '130k',
        description: 'Custom product without image',
        size: '',
        weight: '',
        gift: '',
        preorder: false,
        status: 'active'
      }],
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => {
        lookups.push(String(text || ''));
        return String(text || '').toLowerCase() === 'ma 1'
          ? [{ file: 'wrong-ma1.png', url: `${base}/media/wrong-ma1.png` }]
          : [];
      }
    });

    await h.handleText('noimg-1', 'custom_code_no_image_user', 'm_custom_code_no_image');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image')).toBeFalse();
    expect(lookups).toEqual(['NOIMG-1']);
    expect(textMessages[0]).toContain('130k');
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('custom_code_no_image_user')).toBeTrue();
  });

  it('numeric-style product code keeps ma-number image fallback', async () => {
    const lookups = [];
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => {
        lookups.push(String(text || ''));
        return String(text || '').toLowerCase() === 'ma 10'
          ? [{ file: 'ma10.jpg', url: `${base}/media/ma10.jpg` }]
          : [];
      }
    });

    await h.handleText('cho xem MÃ10', 'numeric_code_fallback_user', 'm_numeric_code_fallback');

    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma10.jpg'))).toBeTrue();
    expect(lookups).toEqual(['MÃ10', 'ma 10']);
    expect(h.storage.getLastProductCode('numeric_code_fallback_user')).toBe('MÃ10');
    expect(h.storage.inHandoff('numeric_code_fallback_user')).toBeTrue();
  });

  it('product-code wording for product 11 sends the product image', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => (
        String(text || '').includes('11')
          ? [{ file: 'ma11.jpg', url: `${base}/media/ma11.jpg` }]
          : []
      )
    });

    await h.handleText('mã số 11', 'minimal_code_11_wording', 'm_code_11_wording');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma11.jpg'))).toBeTrue();
    expect(h.storage.getLastProductCode('minimal_code_11_wording')).toBe('MÃ11');
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('minimal_code_11_wording')).toBeTrue();
  });

  it('bare product 11 code sends the product image', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => (
        String(text || '').includes('11')
          ? [{ file: 'ma11.jpg', url: `${base}/media/ma11.jpg` }]
          : []
      )
    });

    await h.handleText('11', 'minimal_code_11_bare', 'm_code_11_bare');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(h.sent.some(item => item.type === 'image' && item.url.includes('ma11.jpg'))).toBeTrue();
    expect(h.storage.getLastProductCode('minimal_code_11_bare')).toBe('MÃ11');
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('minimal_code_11_bare')).toBeTrue();
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

  it('pure ads referral event without message text sends price/menu reply and menu images', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleReferral('ads_referral_only', 'ADS');

    expect(h.sent[0].type).toBe('text');
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu1.png');
    expect(h.sent[2].type).toBe('image');
    expect(h.sent[2].url).toContain('menu2.png');
    expect(h.sent.length).toBe(3);
    expect(h.storage.inHandoff('ads_referral_only')).toBeFalse();
  });

  it('SHORTLINK referral (m.me link) does not auto-send menu without a message', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'shortlink_returning', 5);

    await h.handleReferral('shortlink_returning', 'SHORTLINK');

    expect(h.sent.length).toBe(0);
  });

  it('ads referral-only followed by a real menu message sends one menu reply', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'ads_then_real_message';

    await h.handleReferral(senderId, 'ADS', 'page_ads');
    await h.handleText('chào shop', senderId, 'm_ads_then_real', 'page_ads');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
  });

  it('referral-only skips menu when one was recently sent to the same page and sender', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'ads_referral_recent_menu';

    await h.handleText('chào shop', senderId, 'm_recent_menu_first', 'page_recent_menu');
    await h.handleReferral(senderId, 'ADS', 'page_recent_menu');

    expect(h.sent.length).toBe(3);
    expect(h.sent.filter(item => item.type === 'text').length).toBe(1);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
  });

  it('dedupes same sender and normalized text across webhook calls within TTL', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('Chào   shop', 'ttl_same_sender_text', 'm_ttl_1', 'page_ttl');
    await h.handleText('chào shop', 'ttl_same_sender_text', 'm_ttl_2', 'page_ttl');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
  });

  it('duplicate customer message events in one request do not duplicate menu images', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'duplicate_message_event_sender';
    const requestOptions = {
      requestMessageSenders: new Set([senderId]),
      requestImageDedupe: new Set()
    };

    await h.handleRawEvent(makeEvent('chào shop', senderId, 'm_duplicate_event_1', 'page_duplicate_event'), requestOptions);
    await h.handleRawEvent(makeEvent('chào shop', senderId, 'm_duplicate_event_2', 'page_duplicate_event'), requestOptions);

    expect(h.sent.length).toBe(3);
    expect(h.sent.filter(item => item.type === 'text').length).toBe(1);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
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

  it('successful menu send sets cooldown and duplicate attempt is skipped', async () => {
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
      expect(logs.join('\n')).toContain('[menu] text sent');
      expect(logs.join('\n')).toContain('skipped duplicate menu within cooldown');
    } finally {
      console.log = originalLog;
    }
  });

  it('successful menu logs include hashed sender_ref and exclude raw message text', async () => {
    const logs = [];
    const originalLog = console.log;
    const rawSenderId = 'raw_sender_success_log';
    const rawPageId = 'raw_page_success_log';
    const rawText = 'chào shop private customer body';
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    console.log = message => logs.push(String(message));
    try {
      await h.handleText(rawText, rawSenderId, 'm_success_safe_log', rawPageId);
    } finally {
      console.log = originalLog;
    }

    const logText = logs.join('\n');
    expect(logText).toContain('[menu] text sent');
    expect(logText).toContain('[menu] image sent');
    expect(logText).toMatch(/sender_ref=p:[a-f0-9]{10}/);
    expect(logText.includes(rawSenderId)).toBeFalse();
    expect(logText.includes(rawPageId)).toBeFalse();
    expect(logText.includes(rawText)).toBeFalse();
    expect(logText.includes(MENU_CODE_MENU_PRICE_REPLY)).toBeFalse();
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
      resolveRuntimeForPage: async ({ event, fallbackRuntime }) => {
        const label = event.message?.text || 'referral';
        activeResolvers += 1;
        maxActiveResolvers = Math.max(maxActiveResolvers, activeResolvers);
        resolverOrder.push(`start:${label}`);
        await delay(10);
        resolverOrder.push(`end:${label}`);
        activeResolvers -= 1;
        return fallbackRuntime;
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

  it('queued referral plus customer message from one request does not double-send menu', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const senderId = 'queue_referral_message_sender';
    const payloadJson = {
      pageId: 'page_queue_referral_message',
      baseUrl: 'https://example.test',
      requestMessageSenderIds: [senderId],
      requestAdsReferralSenderIds: [senderId]
    };

    await h.processQueuedWebhookJob({
      payloadJson,
      eventJson: makeReferralEvent(senderId, 'ADS', 'page_queue_referral_message')
    });
    await h.processQueuedWebhookJob({
      payloadJson,
      eventJson: makeEvent('bên kia rẻ hơn shop', senderId, 'm_queue_referral_message', 'page_queue_referral_message')
    });

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent.filter(item => item.type === 'text').length).toBe(1);
    expect(h.sent.filter(item => item.type === 'image').length).toBe(2);
  });

  it('uses queued entryTime to skip stale auto-replies', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });
    const staleEntryTimeSeconds = Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000);

    await h.processQueuedWebhookJob({
      payloadJson: {
        pageId: 'page_queue_stale',
        baseUrl: 'https://example.test',
        entryTime: staleEntryTimeSeconds
      },
      eventJson: makeEvent('chào shop', 'queue_stale_user', 'm_queue_stale', 'page_queue_stale')
    });

    expect(h.sent.length).toBe(0);
    expect(h.storage._midMarks.length).toBe(1);
    expect(h.storage._midMarks[0].mid).toBe('m_queue_stale');
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
    const entryTime = Math.floor(Date.now() / 1000);
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
          time: entryTime,
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
    expect(enqueued[0].payload.entryTime).toBe(entryTime);
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

  it('hotProducts disabled leaves keyword text on the existing Basic path', async () => {
    const config = buildHotProductsRuntimeConfig({
      enabled: false,
      trigger: 'keyword',
      maxItems: 3,
      cooldownMs: 60000,
      productCodes: ['MÃ10', 'MÃ8']
    });
    const h = createWebhookHarness(config, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'hot_disabled_user', 1);

    await h.handleText('hàng hot', 'hot_disabled_user', 'm_hot_disabled');

    expect(h.sent.length).toBe(0);
    expect(h.storage.inHandoff('hot_disabled_user')).toBeFalse();
  });

  it('hotProducts enabled keyword sends configured list and images without handoff', async () => {
    const config = buildHotProductsRuntimeConfig({
      enabled: true,
      trigger: 'keyword',
      maxItems: 2,
      cooldownMs: 60000,
      productCodes: ['MÃ10', 'MÃ8', 'MÃ2']
    });
    const h = createWebhookHarness(config, {
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => {
        const value = String(text || '').toUpperCase();
        if (value.includes('MÃ10')) return [{ file: 'ma10.jpg', url: `${base}/media/ma10.jpg` }];
        if (value.includes('MÃ8')) return [{ file: 'ma8.png', url: `${base}/media/ma8.png` }];
        return [];
      }
    });
    markReturningCustomer(h.storage, 'hot_enabled_user', 1);

    await h.handleText('sản phẩm nổi bật', 'hot_enabled_user', 'm_hot_enabled', 'page_hot_enabled');

    const text = h.sent.find(item => item.type === 'text').text;
    expect(text).toContain('🔥 Hàng hot hôm nay');
    expect(text.indexOf('MÃ10') < text.indexOf('MÃ8')).toBeTrue();
    expect(text).toContain('MÃ10 - 150k');
    expect(text).toContain('MÃ8 - 680k');
    expect(text).toContain('Nhắn mã sản phẩm, ví dụ MÃ10, để xem chi tiết.');
    expect(h.sent.filter(item => item.type === 'image').map(item => item.url)).toEqual([
      'https://example.test/media/ma10.jpg',
      'https://example.test/media/ma8.png'
    ]);
    expect(h.storage.inHandoff('hot_enabled_user')).toBeFalse();
    expect(h.storage.getLastProductCode('hot_enabled_user')).toBe('');
  });

  it('product code still wins over hotProducts keyword ambiguity and activates handoff', async () => {
    const config = buildHotProductsRuntimeConfig({
      enabled: true,
      trigger: 'keyword',
      maxItems: 3,
      cooldownMs: 60000,
      productCodes: ['MÃ10', 'MÃ8']
    });
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    await h.handleText('sản phẩm hot MÃ8', 'hot_code_user', 'm_hot_code', 'page_hot_code');

    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(textMessages.some(text => text.includes('🔥 Hàng hot hôm nay'))).toBeFalse();
    expect(textMessages[textMessages.length - 1]).toBe(MENU_CODE_HANDOFF_MESSAGE);
    expect(h.storage.inHandoff('hot_code_user')).toBeTrue();
    expect(h.storage.getLastProductCode('hot_code_user')).toBe('MÃ8');
  });

  it('hotProducts preserves configured order, skips inactive/missing products, and respects maxItems', async () => {
    const customProducts = [
      { code: 'HIDE1', name: 'Hidden Product', price: '100k', status: 'hidden' },
      { code: 'ACT2', name: 'Active Two', price: '200k', status: 'active' },
      { code: 'ARCH1', name: 'Archived Product', price: '300k', status: 'archived' },
      { code: 'ACT1', name: 'Active One', price: '150k', status: 'active' },
      { code: 'ACT3', name: 'Active Three', price: '350k', status: 'active' }
    ];
    const config = buildHotProductsRuntimeConfig({
      enabled: true,
      trigger: 'keyword',
      maxItems: 2,
      cooldownMs: 60000,
      productCodes: ['HIDE1', 'ACT2', 'MISSING', 'ARCH1', 'ACT1', 'ACT3']
    });
    const h = createWebhookHarness(config, {
      products: customProducts,
      throwOnLeadParse: true,
      buildRequestedImageUrls: () => []
    });
    markReturningCustomer(h.storage, 'hot_order_user', 1);

    await h.handleText('goi y san pham', 'hot_order_user', 'm_hot_order', 'page_hot_order');

    const text = h.sent.find(item => item.type === 'text').text;
    expect(text.indexOf('ACT2 - Active Two - 200k') < text.indexOf('ACT1 - Active One - 150k')).toBeTrue();
    expect(text.includes('HIDE1')).toBeFalse();
    expect(text.includes('ARCH1')).toBeFalse();
    expect(text.includes('MISSING')).toBeFalse();
    expect(text.includes('ACT3')).toBeFalse();
    expect(h.storage.inHandoff('hot_order_user')).toBeFalse();
  });

  it('hotProducts keyword sends safe fallback when no configured active products are valid and ignores legacy carousel codes', async () => {
    const config = buildHotProductsRuntimeConfig({
      enabled: true,
      trigger: 'keyword',
      maxItems: 3,
      cooldownMs: 60000,
      productCodes: []
    }, {
      hotCarouselProductCodes: ['MÃ8']
    });
    const h = createWebhookHarness(config, { throwOnLeadParse: true });
    markReturningCustomer(h.storage, 'hot_empty_user', 1);

    await h.handleText('hang hot', 'hot_empty_user', 'm_hot_empty', 'page_hot_empty');

    expect(h.sent).toEqual([{ type: 'text', senderId: 'hot_empty_user', text: HOT_PRODUCTS_EMPTY_REPLY }]);
    expect(h.sent[0].text.includes('MÃ8')).toBeFalse();
    expect(h.storage.inHandoff('hot_empty_user')).toBeFalse();
  });

  it('hotProducts cooldown is per page sender shop and logs safe refs only', async () => {
    const logs = [];
    const originalLog = console.log;
    const config = buildHotProductsRuntimeConfig({
      enabled: true,
      trigger: 'keyword',
      maxItems: 1,
      cooldownMs: 60000,
      productCodes: ['MÃ10']
    });
    const h = createWebhookHarness(config, {
      throwOnLeadParse: true,
      buildRequestedImageUrls: () => []
    });
    const senderId = 'hot_cooldown_sender';
    markReturningCustomer(h.storage, senderId, 1);

    console.log = message => logs.push(String(message));
    try {
      await h.handleText('hang hot', senderId, 'm_hot_cd_1', 'page_hot_cd_a');
      await h.handleText('goi y san pham', senderId, 'm_hot_cd_2', 'page_hot_cd_a');
      await h.handleText('san pham noi bat', senderId, 'm_hot_cd_3', 'page_hot_cd_b');
    } finally {
      console.log = originalLog;
    }

    expect(h.sent.filter(item => item.type === 'text').length).toBe(2);
    expect(h.sent[0].text).toContain('MÃ10');
    expect(h.sent[1].text).toContain('MÃ10');
    const logText = logs.join('\n');
    expect(logText).toContain('[hot_products] skipped cooldown');
    expect(logText).toContain('page_ref=');
    expect(logText).toContain('sender_ref=');
    expect(logText.includes('page_hot_cd_a')).toBeFalse();
    expect(logText.includes(senderId)).toBeFalse();
    expect(logText.includes('postgres://')).toBeFalse();
    expect(logText.includes('EAAB')).toBeFalse();
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

describe('webhook: basic_sales_v2 mode', () => {
  it('adult-shop config remains classic menu_code_handoff, not v2', async () => {
    const config = buildAdultRuntimeConfig();
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    expect(isBasicSalesV2Mode(config)).toBeFalse();

    await h.handleText('chào shop', 'adult_classic_boundary', 'm_adult_classic_boundary');

    expect(h.sent.length).toBe(3);
    expect(h.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(h.sent.some(item => item.type === 'text' && item.text === BASIC_SALES_V2_MENU_REPLY)).toBeFalse();
  });

  it('explicit pilot config selects v2 before classic menu mode', async () => {
    const config = buildBasicSalesV2RuntimeConfig({
      botMode: { name: 'menu_code_handoff' },
      basicSalesV2: { enabled: true }
    });
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    expect(isBasicSalesV2Mode(config)).toBeTrue();

    await h.handleText('chào shop', 'v2_selected_user', 'm_v2_selected', 'page_v2_selected');

    expect(h.sent).toEqual([{
      type: 'text',
      senderId: 'v2_selected_user',
      text: BASIC_SALES_V2_MENU_REPLY
    }]);
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
  });

  it('v2 product-code path sends image, detail, and handoff', async () => {
    const config = buildBasicSalesV2RuntimeConfig();
    const h = createWebhookHarness(config, { throwOnLeadParse: true });

    await h.handleText('cho xem MÃ8', 'v2_code_user', 'm_v2_code', 'page_v2_code');

    expect(h.sent[0].type).toBe('image');
    expect(h.sent[0].url).toContain('ma8.png');
    const textMessages = h.sent.filter(item => item.type === 'text').map(item => item.text);
    expect(textMessages[0]).toContain('680k');
    expect(textMessages[1]).toBe('Pilot handoff after product detail.');
    expect(h.storage.getLastProductCode('v2_code_user')).toBe('MÃ8');
    expect(h.storage.inHandoff('v2_code_user')).toBeTrue();
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
  });

  it('v2 Hot Products keyword sends configured list and does not hand off', async () => {
    const config = buildBasicSalesV2RuntimeConfig({
      hotProducts: {
        enabled: true,
        trigger: 'keyword',
        maxItems: 2,
        cooldownMs: 60000,
        productCodes: ['MÃ10', 'MÃ8']
      }
    });
    const h = createWebhookHarness(config, {
      throwOnLeadParse: true,
      buildRequestedImageUrls: (text, _senderId, base) => {
        const value = String(text || '').toUpperCase();
        if (value.includes('MÃ10')) return [{ file: 'ma10.jpg', url: `${base}/media/ma10.jpg` }];
        if (value.includes('MÃ8')) return [{ file: 'ma8.png', url: `${base}/media/ma8.png` }];
        return [];
      }
    });

    await h.handleText('sản phẩm nổi bật', 'v2_hot_user', 'm_v2_hot', 'page_v2_hot');

    const text = h.sent.find(item => item.type === 'text').text;
    expect(text).toContain('🔥 Hàng hot hôm nay');
    expect(text.indexOf('MÃ10') < text.indexOf('MÃ8')).toBeTrue();
    expect(text).toContain('MÃ10 - 150k');
    expect(text).toContain('MÃ8 - 680k');
    expect(h.sent.filter(item => item.type === 'image').map(item => item.url)).toEqual([
      'https://example.test/media/ma10.jpg',
      'https://example.test/media/ma8.png'
    ]);
    expect(h.storage.inHandoff('v2_hot_user')).toBeFalse();
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
  });

  it('missing or disabled v2 config stays on classic behavior', async () => {
    const missing = createWebhookHarness(buildAdultRuntimeConfig(), { throwOnLeadParse: true });
    await missing.handleText('chào shop', 'v2_missing_user', 'm_v2_missing');

    expect(missing.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(missing.sent.length).toBe(3);

    const disabledConfig = buildAdultRuntimeConfig();
    disabledConfig.basicSalesV2 = { enabled: false };
    const disabled = createWebhookHarness(disabledConfig, { throwOnLeadParse: true });

    await disabled.handleText('chào shop', 'v2_disabled_user', 'm_v2_disabled');

    expect(isBasicSalesV2Mode(disabledConfig)).toBeFalse();
    expect(disabled.sent[0].text).toBe(MENU_CODE_MENU_PRICE_REPLY);
    expect(disabled.sent.length).toBe(3);
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

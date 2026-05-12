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
  applyBotModeConfig
} = require('../core/bot-mode');

const products = loadProducts(path.join(__dirname, '..', 'shops', 'adult-shop', 'products.csv'));

function makeStorage() {
  const context = new Map();
  const handoff = new Map();
  const mids = new Set();
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
    seenMid: mid => mids.has(mid),
    markMid: mid => mids.add(mid),
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

function makeEvent(text, senderId = 'sender_1', mid = `mid_${Math.random()}`) {
  return {
    sender: { id: senderId },
    message: { mid, text }
  };
}

function createWebhookHarness(config = buildAdultRuntimeConfig(), options = {}) {
  const storage = options.storage || makeStorage();
  const rules = createRuleEngine({ products, config, contextStore: storage });
  const sent = [];
  let geminiCalls = 0;
  let leadParserCalls = 0;
  let handoffCaptureCalls = 0;

  const webhook = createWebhook({
    storage,
    shopConfig: config,
    fbVerifyToken: 'verify',
    fbAppSecret: '',
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
    notifyStaffForReadyOrder: async () => false,
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
    getMenuImageUrls: base => [
      { file: 'menu1.png', url: `${base}/media/menu1.png` },
      { file: 'menu2.png', url: `${base}/media/menu2.png` }
    ],
    buildRequestedImageUrls: (text, _senderId, base) => {
      const codes = rules.extractRequestedProductCodes(text);
      return codes.length ? [{ file: 'ma8.png', url: `${base}/media/ma8.png` }] : [];
    },
    pushLeadToSheet: () => {},
    sendTelegramAlert: () => {},
    sendTelegramOperationalAlert: () => {},
    resetFallbackAttention: () => {},
    trackFallbackAttention: async () => {},
    recordConversationTurn: () => {},
    trackEvent: () => {},
    maybeResetTimedOutSession: () => {},
    redactSensitiveText: text => text
  });

  return {
    handleText: (text, senderId = 'sender_1', mid) => webhook.handleEvent(makeEvent(text, senderId, mid), 'https://example.test'),
    sent,
    storage,
    getGeminiCalls: () => geminiCalls,
    getLeadParserCalls: () => leadParserCalls,
    getHandoffCaptureCalls: () => handoffCaptureCalls
  };
}

describe('webhook: menu_code_handoff mode', () => {
  it('greeting sends menu images and menu text', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('chào shop', 'minimal_greeting', 'm_greeting');

    expect(h.sent[0].type).toBe('image');
    expect(h.sent[0].url).toContain('menu1.png');
    expect(h.sent[1].type).toBe('image');
    expect(h.sent[1].url).toContain('menu2.png');
    expect(h.sent[2].type).toBe('text');
    expect(h.sent[2].text).toContain('xem qua mẫu');
    expect(h.getGeminiCalls()).toBe(0);
    expect(h.getLeadParserCalls()).toBe(0);
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
  });

  it('does not continue into AI fallback in this mode', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('câu ngoài rule hoàn toàn', 'minimal_no_ai', 'm_no_ai');

    expect(h.getGeminiCalls()).toBe(0);
    expect(h.sent.filter(item => item.type === 'text').length).toBe(1);
  });

  it('does not answer again after product-code handoff', async () => {
    const h = createWebhookHarness(undefined, { throwOnLeadParse: true });

    await h.handleText('MÃ8', 'minimal_after_handoff', 'm_first');
    const countAfterHandoff = h.sent.length;
    await h.handleText('alo shop', 'minimal_after_handoff', 'm_second');

    expect(h.storage.inHandoff('minimal_after_handoff')).toBeTrue();
    expect(h.sent.length).toBe(countAfterHandoff);
  });

  it('does not capture handoff order updates after product-code handoff', async () => {
    const h = createWebhookHarness(undefined, {
      throwOnLeadParse: true,
      throwOnHandoffCapture: true
    });

    await h.handleText('MÃ8', 'minimal_handoff_capture', 'm_handoff_first');
    await h.handleText('sdt 0912345678', 'minimal_handoff_capture', 'm_handoff_second');

    expect(h.getHandoffCaptureCalls()).toBe(0);
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
});

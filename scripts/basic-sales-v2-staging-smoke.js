#!/usr/bin/env node

/*
 * Staging-only Basic Sales v2 smoke.
 *
 * Run only after explicit staging DB write approval:
 *   node scripts/basic-sales-v2-staging-smoke.js
 *
 * Requires:
 *   - RAILWAY_ENVIRONMENT_NAME or RAILWAY_ENVIRONMENT contains "staging"
 *   - MESSENGER_DRY_RUN=true
 *   - MULTI_SHOP_DB_CONFIG_ENABLED=true
 *   - CHATBOT_STAGING_DATABASE_URL is set
 *
 * This mutates wizard-smoke-shop shop_settings.settings_json and restores it
 * in finally. It intentionally refuses DATABASE_URL fallback.
 */

const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const { Client } = require('pg');
const { createWebhook } = require(path.join(ROOT, 'core', 'webhook'));
const { createRuleEngine, STATES } = require(path.join(ROOT, 'core', 'rules'));
const { resolveShopConfigForPage } = require(path.join(ROOT, 'core', 'shops', 'db-shop-config'));
const {
  applyBotModeConfig,
  isBasicSalesV2Mode,
  MENU_CODE_MENU_PRICE_REPLY
} = require(path.join(ROOT, 'core', 'bot-mode'));
const { getMenuCodeHandoffMessage } = require(path.join(ROOT, 'core', 'modes', 'menu-code-handoff'));
const { getBasicSalesV2MenuReply } = require(path.join(ROOT, 'core', 'flows', 'basic-sales-flow-v2'));

const SHOP_ID = 'wizard-smoke-shop';
const ADULT_SHOP_ID = 'adult-shop';
const PRODUCT_CODE = 'SMOKE-1';
const HOT_TEXT = 'h\u00e0ng hot';
const BASE_URL = 'https://chatbot-fanpage-staging-staging.up.railway.app';
const HANDOFF_MS = Number(process.env.HANDOFF_MS || 30 * 60 * 1000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function jsonObject(value) {
  return isPlainObject(value) ? value : {};
}

function patchSettings(base, { basicSalesV2Enabled, hotProducts } = {}) {
  const next = cloneJson(jsonObject(base));
  if (basicSalesV2Enabled !== undefined) {
    next.basicSalesV2 = {
      ...jsonObject(next.basicSalesV2),
      enabled: Boolean(basicSalesV2Enabled)
    };
  }
  if (hotProducts) {
    next.hotProducts = {
      ...jsonObject(next.hotProducts),
      ...hotProducts
    };
  }
  return next;
}

const HOT_PRODUCTS_ENABLED = Object.freeze({
  enabled: true,
  productCodes: [PRODUCT_CODE],
  trigger: 'keyword',
  maxItems: 3,
  cooldownMs: 60000
});

const HOT_PRODUCTS_DISABLED = Object.freeze({
  enabled: false,
  productCodes: [PRODUCT_CODE],
  trigger: 'keyword',
  maxItems: 3,
  cooldownMs: 60000
});

function makeStorage() {
  const context = new Map();
  const handoff = new Map();
  const mids = new Set();

  function entry(userId) {
    const key = String(userId || '');
    const current = context.get(key) || {};
    context.set(key, current);
    return current;
  }

  return {
    getHistory: userId => entry(userId).history || [],
    setHistory: (userId, history) => {
      entry(userId).history = history;
    },
    setHandoff: (userId, until) => {
      handoff.set(String(userId || ''), until);
    },
    inHandoff: userId => {
      const until = handoff.get(String(userId || ''));
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
    tryMarkMid: mid => {
      const key = String(mid || '').trim();
      if (!key) return false;
      if (mids.has(key)) return false;
      mids.add(key);
      return true;
    },
    appendCustomer: () => {
      throw new Error('lead/customer write path should not run in smoke');
    },
    appendEvent: () => {
      throw new Error('event write path should not run in smoke');
    }
  };
}

function productCodeKey(code = '') {
  return String(code || '').trim().toUpperCase();
}

function foldProductCode(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toUpperCase();
}

function numericProductCodeFallbackKeys(code = '') {
  const compact = foldProductCode(code).replace(/\s+/g, '');
  const match = compact.match(/^(?:MA|M)0*(\d{1,4})$/) || compact.match(/^0*(\d{1,4})$/);
  if (!match) return [];
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return [];
  return [`M\u00c3${number}`, `MA${number}`, `M${number}`, String(number)]
    .map(productCodeKey)
    .filter((value, index, list) => value && list.indexOf(value) === index);
}

function makeDbImageRuntime({ config, products, rules }) {
  const assets = config.__assets || {};
  const menuImages = Array.isArray(assets.menuImages) ? assets.menuImages : [];
  const productImagesByCode = assets.productImagesByCode || {};
  const productImagesByProductId = assets.productImagesByProductId || {};
  const productByCode = new Map((Array.isArray(products) ? products : [])
    .map(product => [productCodeKey(product.code), product])
    .filter(([key]) => key));

  function imageItem(asset) {
    return { file: asset.id || asset.storageKey || asset.publicUrl, url: asset.url };
  }

  function getAssetList(group, key) {
    const normalized = String(key || '').trim();
    const list = normalized ? group[normalized] : [];
    return Array.isArray(list) ? list : [];
  }

  function getProductImagesForCode(code) {
    const key = productCodeKey(code);
    const product = productByCode.get(key);
    const byProductId = product && product.id ? getAssetList(productImagesByProductId, product.id) : [];
    if (byProductId.length) return byProductId;

    const byExactCode = getAssetList(productImagesByCode, key);
    if (byExactCode.length) return byExactCode;

    for (const fallbackKey of numericProductCodeFallbackKeys(code)) {
      const byFallbackCode = getAssetList(productImagesByCode, fallbackKey);
      if (byFallbackCode.length) return byFallbackCode;
    }
    return [];
  }

  function buildRequestedImageUrls(userText) {
    const requestedCodes = rules.extractRequestedProductCodes(userText);
    const images = [];
    for (const code of requestedCodes) images.push(...getProductImagesForCode(code).map(imageItem));
    return images.filter(item => item.url).slice(0, 6);
  }

  function isGreetingText(text) {
    const t = rules.normalizeText(text).trim();
    return /^(?:(?:em|minh|toi)\s+)?(?:xin\s*)?(?:chao|hello|hi|alo|shop\s*oi|shop|em\s*oi|chi\s*oi|anh\s*oi)(?:\s+(?:shop|em|ban))?(?:\s+(?:a|nha|nhe|nhe\s*shop|nha\s*shop))?[.!?\s]*$/.test(t);
  }

  function isHotProductsText(text) {
    const t = rules.normalizeText(text);
    return /(?:ban\s*chay|\bhot\b|nhieu\s*nguoi\s*(?:hoi|mua)|duoc\s*hoi\s*nhieu|mau\s*nao\s*(?:duoc|ok|hot)|top|xu\s*huong)/.test(t);
  }

  return {
    getMenuImageUrls: () => menuImages.map(imageItem).filter(item => item.url),
    buildRequestedImageUrls,
    isGreetingText,
    isHotProductsText,
    sendHotCarousel: async () => false
  };
}

function noopRuntimeParts(rules, sent, typing) {
  return {
    useGemini: false,
    resolveQuickReplyPayload: () => null,
    buildQuickReplies: () => [],
    buildDeterministicReply: rules.buildDeterministicReply,
    buildFallbackReply: rules.buildFallbackReply,
    buildLeadDetails: () => {
      throw new Error('lead parser should not run in smoke');
    },
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
    STATES: rules.STATES || STATES,
    callGemini: async () => {
      throw new Error('Gemini should not run in smoke');
    },
    getGeminiErrorInfo: err => ({ message: err.message }),
    shouldUseFallbackReply: () => false,
    isProbablyIncompleteReply: () => false,
    sendMessage: async (senderId, text) => {
      sent.push({ type: 'text', senderId, text: String(text || '') });
    },
    sendQuickReplies: async (senderId, text, quickReplies) => {
      sent.push({ type: 'quick_replies', senderId, text: String(text || ''), quickReplies });
    },
    sendImage: async (senderId, url) => {
      sent.push({ type: 'image', senderId, url: String(url || '') });
    },
    showTyping: senderId => {
      typing.push({ senderId });
    },
    sendHotCarousel: async () => false,
    isGreetingText: () => false,
    isHotProductsText: () => false,
    getMenuImageUrls: () => [],
    buildRequestedImageUrls: () => [],
    pushLeadToSheet: () => {
      throw new Error('sheet push should not run in smoke');
    },
    sendTelegramAlert: () => false,
    sendTelegramOperationalAlert: () => false,
    resetFallbackAttention: () => {},
    trackFallbackAttention: async () => {},
    recordConversationTurn: () => {},
    trackEvent: () => {},
    maybeResetTimedOutSession: () => {},
    redactSensitiveText: text => text
  };
}

function createHarness(client, pageId) {
  const storage = makeStorage();
  const sent = [];
  const typing = [];
  const fallbackConfig = { botMode: { name: 'disabled' }, intents: {}, templates: {} };
  const fallbackRules = createRuleEngine({ products: [], config: fallbackConfig, contextStore: storage });
  const fallbackParts = noopRuntimeParts(fallbackRules, sent, typing);

  async function buildRuntimeForPage(resolvedPageId) {
    const result = await resolveShopConfigForPage({
      pageId: resolvedPageId,
      tenantId: process.env.TENANT_ID || 'default',
      db: client
    });
    if (!result.found) return { failClosed: true, reason: result.reason || 'not_found' };
    assert(result.shop && result.shop.id === SHOP_ID, `resolver returned unexpected shop ${result.shop && result.shop.id}`);
    const config = applyBotModeConfig(result.config);
    const rules = createRuleEngine({ products: result.products, config, contextStore: storage });
    const images = makeDbImageRuntime({ config, products: result.products, rules });
    return {
      storage,
      shopConfig: config,
      products: result.products,
      ...noopRuntimeParts(rules, sent, typing),
      getMenuImageUrls: images.getMenuImageUrls,
      buildRequestedImageUrls: images.buildRequestedImageUrls,
      isGreetingText: images.isGreetingText,
      isHotProductsText: images.isHotProductsText,
      sendHotCarousel: images.sendHotCarousel
    };
  }

  const webhook = createWebhook({
    storage,
    shopConfig: fallbackConfig,
    products: [],
    fbVerifyToken: 'smoke-verify-token',
    fbAppSecret: '',
    webhookRateLimiter: (_req, _res, next) => next(),
    handoffMs: HANDOFF_MS,
    ...fallbackParts,
    resolveRuntimeForPage: ({ pageId: runtimePageId }) => buildRuntimeForPage(runtimePageId),
    fileConfigPageIds: []
  });

  function event(text, senderId, mid) {
    return {
      sender: { id: senderId },
      recipient: { id: pageId },
      message: { mid, text }
    };
  }

  return {
    sent,
    typing,
    storage,
    handleText: (text, senderId, mid) => webhook.handleEvent(event(text, senderId, mid), BASE_URL, { pageId })
  };
}

function texts(h) {
  return h.sent.filter(item => item.type === 'text');
}

function images(h) {
  return h.sent.filter(item => item.type === 'image');
}

function hasHotList(h) {
  return texts(h).some(item => String(item.text || '').toUpperCase().includes(PRODUCT_CODE));
}

async function getShopSettings(client, shopId) {
  const result = await client.query(`
    SELECT s.id, s.slug, s.status, s.lifecycle, s.dry_run, s.live_enabled,
           ss.settings_json, ss.updated_at AS settings_updated_at
    FROM shops s
    LEFT JOIN shop_settings ss ON ss.shop_id = s.id
    WHERE s.id = $1 OR s.slug = $1
    ORDER BY CASE WHEN s.id = $1 THEN 0 ELSE 1 END, s.updated_at DESC, s.id ASC
    LIMIT 1
  `, [shopId]);
  return result.rows[0] || null;
}

async function getActivePageId(client, shopId) {
  const result = await client.query(`
    SELECT sp.page_id
    FROM shops s
    JOIN shop_pages sp ON sp.shop_id = s.id
    WHERE (s.id = $1 OR s.slug = $1)
      AND sp.status = 'active'
    ORDER BY sp.updated_at DESC, sp.id ASC
    LIMIT 1
  `, [shopId]);
  return String(result.rows[0] && result.rows[0].page_id || '').trim();
}

async function getSmokeProductSummary(client, shopId) {
  const result = await client.query(`
    SELECT p.id, p.code, p.status,
      (SELECT COUNT(*)::int
       FROM shop_assets a
       WHERE a.shop_id = p.shop_id
         AND a.product_id = p.id
         AND a.asset_type = 'product_image'
         AND a.status = 'active'
         AND (a.public_url <> '' OR a.storage_key <> '')) AS active_image_count
    FROM shop_products p
    JOIN shops s ON s.id = p.shop_id
    WHERE (s.id = $1 OR s.slug = $1)
      AND UPPER(p.code) = UPPER($2)
    ORDER BY p.updated_at DESC, p.id ASC
    LIMIT 1
  `, [shopId, PRODUCT_CODE]);
  return result.rows[0] || null;
}

async function updateSettingsJson(client, shopId, settingsJson) {
  const result = await client.query(`
    UPDATE shop_settings
    SET settings_json = $2::jsonb
    WHERE shop_id = (
      SELECT id FROM shops WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    )
    RETURNING settings_json
  `, [shopId, JSON.stringify(settingsJson || {})]);
  assert(result.rowCount === 1, `settings update affected ${result.rowCount} rows for ${shopId}`);
  return result.rows[0].settings_json || {};
}

async function loadRuntimeConfig(client, pageId) {
  const result = await resolveShopConfigForPage({
    pageId,
    tenantId: process.env.TENANT_ID || 'default',
    db: client
  });
  assert(result.found, `runtime config not found: ${result.reason || 'unknown'}`);
  return applyBotModeConfig(result.config);
}

async function main() {
  const envName = `${process.env.RAILWAY_ENVIRONMENT_NAME || ''} ${process.env.RAILWAY_ENVIRONMENT || ''}`;
  assert(/staging/i.test(envName), `refusing non-staging Railway environment: ${envName || 'unknown'}`);
  assert(String(process.env.MESSENGER_DRY_RUN || '').toLowerCase() === 'true', 'MESSENGER_DRY_RUN is not true');
  assert(String(process.env.MULTI_SHOP_DB_CONFIG_ENABLED || '').toLowerCase() === 'true', 'MULTI_SHOP_DB_CONFIG_ENABLED is not true');
  const databaseUrl = process.env.CHATBOT_STAGING_DATABASE_URL;
  assert(databaseUrl, 'CHATBOT_STAGING_DATABASE_URL is required; refusing DATABASE_URL fallback');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let originalSettings;
  let originalHash;
  let adultBeforeHash;
  const summary = {
    branchCommit: '8826561',
    deploymentId: '1fd44895-29f9-46d7-95e7-2bedb2109532',
    deploymentStatus: 'SUCCESS',
    classic: {},
    v2: {},
    cleanup: {},
    adultShop: {}
  };

  try {
    const shop = await getShopSettings(client, SHOP_ID);
    assert(shop && shop.id, `${SHOP_ID} not found`);
    assert(shop.dry_run === true, `${SHOP_ID} dry_run is not true`);
    originalSettings = cloneJson(jsonObject(shop.settings_json));
    originalHash = sha(originalSettings);

    const adultBefore = await getShopSettings(client, ADULT_SHOP_ID);
    assert(adultBefore && adultBefore.id, `${ADULT_SHOP_ID} not found`);
    adultBeforeHash = sha(jsonObject(adultBefore.settings_json));
    summary.adultShop.beforeHash = adultBeforeHash;

    const pageId = await getActivePageId(client, SHOP_ID);
    assert(pageId, `${SHOP_ID} has no active page mapping`);

    const product = await getSmokeProductSummary(client, SHOP_ID);
    assert(product && product.status === 'active', `${PRODUCT_CODE} is not active in ${SHOP_ID}`);
    assert(Number(product.active_image_count || 0) > 0, `${PRODUCT_CODE} has no active product image`);

    const classicDisabled = patchSettings(originalSettings, {
      basicSalesV2Enabled: false,
      hotProducts: HOT_PRODUCTS_DISABLED
    });
    await updateSettingsJson(client, SHOP_ID, classicDisabled);
    let config = await loadRuntimeConfig(client, pageId);
    assert(!isBasicSalesV2Mode(config), 'classic setup unexpectedly v2-enabled');

    let h = createHarness(client, pageId);
    await h.handleText('menu', 'classic_menu_sender', 'smoke_classic_menu_mid');
    assert(texts(h).length >= 1, 'classic menu did not send text');
    assert(texts(h)[0].text === MENU_CODE_MENU_PRICE_REPLY, 'classic menu text did not match menu_code_handoff reply');
    assert(!h.storage.inHandoff('classic_menu_sender'), 'classic menu unexpectedly entered handoff');
    summary.classic.menu = { text: true, images: images(h).length, handoff: false };

    h = createHarness(client, pageId);
    await h.handleText(PRODUCT_CODE, 'classic_product_sender', 'smoke_classic_product_mid');
    assert(images(h).length >= 1, 'classic product did not send image');
    const classicHandoffText = getMenuCodeHandoffMessage(config);
    assert(texts(h).some(item => item.text && item.text !== classicHandoffText), 'classic product did not send detail text');
    assert(texts(h).some(item => item.text === classicHandoffText), 'classic product did not send handoff text');
    assert(h.storage.inHandoff('classic_product_sender'), 'classic product did not activate handoff');
    summary.classic.product = { detailText: true, image: true, handoff: true };

    h = createHarness(client, pageId);
    await h.handleText(HOT_TEXT, 'classic_hot_disabled_sender', 'smoke_classic_hot_disabled_mid');
    assert(!hasHotList(h), 'classic hotProducts disabled still emitted hot list');
    assert(!h.storage.inHandoff('classic_hot_disabled_sender'), 'classic hotProducts disabled entered handoff');
    summary.classic.hotProductsDisabled = { hotList: false, handoff: false, sentCount: h.sent.length };

    const classicHotEnabled = patchSettings(originalSettings, {
      basicSalesV2Enabled: false,
      hotProducts: HOT_PRODUCTS_ENABLED
    });
    await updateSettingsJson(client, SHOP_ID, classicHotEnabled);
    config = await loadRuntimeConfig(client, pageId);
    assert(!isBasicSalesV2Mode(config), 'classic hotProducts setup unexpectedly v2-enabled');
    h = createHarness(client, pageId);
    await h.handleText(HOT_TEXT, 'classic_hot_enabled_sender', 'smoke_classic_hot_enabled_mid');
    assert(hasHotList(h), 'classic hotProducts enabled did not emit hot list');
    assert(!h.storage.inHandoff('classic_hot_enabled_sender'), 'classic hotProducts enabled entered handoff');
    summary.classic.hotProductsEnabled = { hotList: true, handoff: false, images: images(h).length };

    const v2Enabled = patchSettings(originalSettings, {
      basicSalesV2Enabled: true,
      hotProducts: HOT_PRODUCTS_ENABLED
    });
    await updateSettingsJson(client, SHOP_ID, v2Enabled);
    config = await loadRuntimeConfig(client, pageId);
    assert(isBasicSalesV2Mode(config), 'v2 setup did not enable basicSalesV2 runtime');

    h = createHarness(client, pageId);
    await h.handleText('menu', 'v2_menu_sender', 'smoke_v2_menu_mid');
    const expectedV2Menu = getBasicSalesV2MenuReply(config);
    assert(texts(h).length >= 1, 'v2 menu did not send text fallback');
    assert(texts(h)[0].text === expectedV2Menu, 'v2 menu text fallback mismatch');
    assert(images(h).length === 0, 'v2 menu fallback unexpectedly sent menu images');
    assert(!h.storage.inHandoff('v2_menu_sender'), 'v2 menu unexpectedly entered handoff');
    summary.v2.menuFallback = { text: true, images: 0, handoff: false };

    h = createHarness(client, pageId);
    await h.handleText(HOT_TEXT, 'v2_hot_sender', 'smoke_v2_hot_mid');
    assert(hasHotList(h), 'v2 hotProducts did not emit hot list');
    assert(!h.storage.inHandoff('v2_hot_sender'), 'v2 hotProducts entered handoff');
    summary.v2.hotProducts = { hotList: true, handoff: false, images: images(h).length };

    h = createHarness(client, pageId);
    await h.handleText(PRODUCT_CODE, 'v2_product_sender', 'smoke_v2_product_mid');
    assert(images(h).length >= 1, 'v2 product did not send image');
    const v2HandoffText = getMenuCodeHandoffMessage(config);
    assert(texts(h).some(item => item.text && item.text !== v2HandoffText), 'v2 product did not send detail text');
    assert(texts(h).some(item => item.text === v2HandoffText), 'v2 product did not send handoff text');
    assert(h.storage.inHandoff('v2_product_sender'), 'v2 product did not activate handoff');
    summary.v2.product = { detailText: true, image: true, handoff: true };

    const v2Disabled = patchSettings(v2Enabled, { basicSalesV2Enabled: false });
    await updateSettingsJson(client, SHOP_ID, v2Disabled);
    config = await loadRuntimeConfig(client, pageId);
    assert(!isBasicSalesV2Mode(config), 'v2 disable setup still enabled basicSalesV2 runtime');
    h = createHarness(client, pageId);
    await h.handleText('menu', 'v2_disabled_menu_sender', 'smoke_v2_disabled_menu_mid');
    assert(texts(h).length >= 1, 'post-disable classic menu did not send text');
    assert(texts(h)[0].text === MENU_CODE_MENU_PRICE_REPLY, 'post-disable menu did not return to classic reply');
    summary.v2.disabledCheck = { v2Runs: false, classicText: true, classicImages: images(h).length };
  } finally {
    if (originalSettings !== undefined) {
      await updateSettingsJson(client, SHOP_ID, originalSettings);
    }

    const finalShop = await getShopSettings(client, SHOP_ID);
    const finalHash = sha(jsonObject(finalShop && finalShop.settings_json));
    summary.cleanup.restored = finalHash === originalHash;
    summary.cleanup.originalHash = originalHash;
    summary.cleanup.finalHash = finalHash;

    const adultAfter = await getShopSettings(client, ADULT_SHOP_ID);
    const adultAfterHash = sha(jsonObject(adultAfter && adultAfter.settings_json));
    summary.adultShop.afterHash = adultAfterHash;
    summary.adultShop.untouched = adultBeforeHash === adultAfterHash;

    await client.end();
  }

  assert(summary.cleanup.restored, `${SHOP_ID} settings_json was not restored`);
  assert(summary.adultShop.untouched, `${ADULT_SHOP_ID} settings_json changed`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});

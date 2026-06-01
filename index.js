require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const storage = require('./core/storage');
const { assertMessengerDryRunAllowed } = require('./core/storage-config');
const { pushLeadToSheet, startSheetOutboxWorker } = require('./core/sheets-webhook');
const { loadProducts } = require('./core/products');
const { createRuleEngine } = require('./core/rules');
const { buildQuickReplies, resolveQuickReplyPayload } = require('./core/quick-replies');
const { resolveShopConfigForPage } = require('./core/shops/db-shop-config');
const { getAdminRequestToken, registerAdminRoutes } = require('./core/admin-routes');
const { registerWizardRoutes } = require('./core/admin/wizard-routes');
const { createAiClient } = require('./core/ai-client');
const {
  createEventTracker,
  createFixedWindowRateLimiter,
  getClientIp,
  normalizeIp,
  redactSensitiveText,
  truncateText
} = require('./core/event-tracker');
const { createLeadParser } = require('./core/lead-parser');
const { createImageService } = require('./core/image-service');
const { createMessengerClient } = require('./core/messenger-client');
const { resolvePageCredential } = require('./core/credentials/page-credentials');
const {
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  createNotificationService,
  getFacebookProfileDisplayName
} = require('./core/notification-service');
const { createReminderService } = require('./core/reminder-service');
const { createWebhook } = require('./core/webhook');
const {
  createWebhookQueueRepository,
  createWebhookQueueService
} = require('./core/webhook-queue');
const {
  applyBotModeConfig,
  isAiFallbackEnabled,
  isFollowUpEnabled
} = require('./core/bot-mode');
const { pageRef, shopRef } = require('./core/utils/log-refs');

const ROOT_DIR = __dirname;
let multiShopDbPool = null;

function normalizeShopId(raw) {
  const id = String(raw ?? 'adult-shop').trim();
  if (!id || /[\\/]/.test(id)) return 'adult-shop';
  return id;
}

/**
 * Nạp shops/<SHOP_ID>/config.js + products.csv + custom-intents.js (prepend/append).
 * SHOP_ID hoặc ACTIVE_SHOP trong .env; mặc định adult-shop.
 */
function loadShopRuntime(rootDir) {
  const shopId = normalizeShopId(process.env.SHOP_ID || process.env.ACTIVE_SHOP);
  const shopDir = path.join(rootDir, 'shops', shopId);
  if (!fs.existsSync(shopDir)) {
    throw new Error(`Shop không tồn tại: "${shopId}" (${shopDir})`);
  }
  const configPath = path.join(shopDir, 'config.js');
  const csvPath = path.join(shopDir, 'products.csv');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Thiếu shops/${shopId}/config.js`);
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Thiếu shops/${shopId}/products.csv`);
  }

  const shopConfig = require(configPath);
  const products = loadProducts(csvPath);

  const customPath = path.join(shopDir, 'custom-intents.js');
  const prepend = [];
  const append = [];
  if (fs.existsSync(customPath)) {
    const custom = require(customPath);
    if (Array.isArray(custom.prepend)) prepend.push(...custom.prepend);
    if (Array.isArray(custom.append)) append.push(...custom.append);
  }

  const mergedConfig = applyBotModeConfig({
    ...shopConfig,
    intents: {
      ...(shopConfig.intents || {}),
      disabled: [...(shopConfig.intents?.disabled || [])],
      prepend: [...prepend, ...(shopConfig.intents?.prepend || [])],
      append: [...(shopConfig.intents?.append || []), ...append]
    }
  });

  return { shopId, shopDir, config: mergedConfig, products };
}

function getDbAssetImageRuntime({ config, products, rules, sendCarousel }) {
  const assets = config.__assets || {};
  const menuImages = Array.isArray(assets.menuImages) ? assets.menuImages : [];
  const productImagesByCode = assets.productImagesByCode || {};

  function imageItem(asset) {
    return {
      file: asset.id || asset.storageKey || asset.publicUrl,
      url: asset.url
    };
  }

  function isGreetingText(text) {
    const t = rules.normalizeText(text).trim();
    return /^(?:(?:em|minh|toi)\s+)?(?:xin\s*)?(?:chao|hello|hi|alo|shop\s*oi|shop|em\s*oi|chi\s*oi|anh\s*oi)(?:\s+(?:shop|em|ban))?(?:\s+(?:a|nha|nhe|nhe\s*shop|nha\s*shop))?[.!?\s]*$/.test(t);
  }

  function isHotProductsText(text) {
    const t = rules.normalizeText(text);
    return /(?:ban\s*chay|\bhot\b|nhieu\s*nguoi\s*(?:hoi|mua)|duoc\s*hoi\s*nhieu|mau\s*nao\s*(?:duoc|ok|hot)|top|xu\s*huong)/.test(t);
  }

  function getMenuImageUrls() {
    return menuImages.map(imageItem).filter(item => item.url);
  }

  function buildRequestedImageUrls(userText) {
    const requestedCodes = rules.extractRequestedProductCodes(userText);
    const images = [];
    for (const code of requestedCodes) {
      const key = String(code || '').toUpperCase();
      const productImages = Array.isArray(productImagesByCode[key]) ? productImagesByCode[key] : [];
      images.push(...productImages.map(imageItem));
    }
    return images.filter(item => item.url).slice(0, 6);
  }

  async function sendHotCarousel(senderId) {
    const configuredCodes = Array.isArray(config.hotCarouselProductCodes) ? config.hotCarouselProductCodes : [];
    const wantedCodes = configuredCodes.length ? configuredCodes : products.map(product => product.code);
    const byCode = new Map(products.map(product => [String(product.code || '').toUpperCase(), product]));
    const elements = [];
    for (const code of wantedCodes) {
      const product = byCode.get(String(code || '').toUpperCase());
      if (!product) continue;
      const image = (productImagesByCode[String(product.code || '').toUpperCase()] || [])[0];
      if (!image?.url) continue;
      elements.push({
        title: `${product.code} - ${product.price}`.slice(0, 80),
        subtitle: String(product.description || product.name || 'Mẫu đang được hỏi nhiều bên shop').slice(0, 80),
        image_url: image.url,
        buttons: [{
          type: 'postback',
          title: 'Tư vấn mã này',
          payload: `Tư vấn ${product.code}`
        }]
      });
      if (elements.length >= 10) break;
    }
    if (!elements.length) return false;
    await sendCarousel(senderId, elements);
    return true;
  }

  return {
    buildRequestedImageUrls,
    getMenuImageUrls,
    isGreetingText,
    isHotProductsText,
    sendHotCarousel
  };
}

let shopRuntime;
try {
  shopRuntime = loadShopRuntime(ROOT_DIR);
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}

const { shopId: ACTIVE_SHOP_ID, shopDir: SHOP_DIR, config: shopConfig, products } = shopRuntime;

const rules = createRuleEngine({
  products,
  config: shopConfig,
  contextStore: {
    getLastProductCode: userId => storage.getLastProductCode(userId),
    setLastProductCode: (userId, code) => storage.setLastProductCode(userId, code),
    getOrderDraft: userId => storage.getOrderDraft(userId),
    mergeOrderDraft: (userId, details) => storage.mergeOrderDraft(userId, details),
    // State machine: rules.js suy ra IDLE/PRODUCT_SELECTED/COLLECTING_INFO/READY_TO_CONFIRM
    // từ orderDraft + lastProductCode, chỉ có CONFIRMED là cần lưu tường minh.
    getSessionState: userId => storage.getSessionState(userId),
    setSessionState: (userId, state) => storage.setSessionState(userId, state),
    clearOrderDraft: userId => storage.clearOrderDraft(userId)
  }
});
const {
  buildDeterministicReply,
  buildFallbackReply,
  extractPhone,
  extractRequestedProductCodes,
  looksLikePhone,
  normalizeText,
  shouldSilenceAfterCompleteOrder,
  isOrderIntent,
  wantsHuman,
  wantsKeywordImage,
  wantsMenuImages,
  wantsProductImage,
  render,
  deriveSessionState,
  STATES
} = rules;

// ========== ENV ==========
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_TOKEN   = process.env.FB_PAGE_TOKEN;
const FB_APP_SECRET   = process.env.FB_APP_SECRET;
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_PROVIDER = String(process.env.GEMINI_PROVIDER || 'vertex').trim().toLowerCase();
const GEMINI_MODEL    = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const USE_GEMINI      = String(process.env.USE_GEMINI || 'true').toLowerCase() !== 'false';
const EFFECTIVE_USE_GEMINI = USE_GEMINI && isAiFallbackEnabled(shopConfig);
const MESSENGER_DRY_RUN = assertMessengerDryRunAllowed(
  envBoolean('MESSENGER_DRY_RUN', false),
  process.env
);
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID || '';
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const PORT            = process.env.PORT || 3000;
const ADMIN_EXPORT_TOKEN = process.env.ADMIN_EXPORT_TOKEN || '';
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';

function envPositiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envNumber(name, fallback, opts = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  if (opts.min != null && value < opts.min) return fallback;
  if (opts.max != null && value > opts.max) return fallback;
  return value;
}

function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function envList(name) {
  return listFromValue(process.env[name]);
}

function listFromValue(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function safeLogValue(value, fallback = 'unknown') {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  return normalized.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120);
}

const REQUIRE_FB_APP_SECRET = IS_PRODUCTION || envBoolean('REQUIRE_FB_APP_SECRET', false);
const GEMINI_TEMPERATURE = envNumber('GEMINI_TEMPERATURE', 0.3, { min: 0, max: 1 });
const GEMINI_MAX_OUTPUT_TOKENS = Math.floor(envNumber('GEMINI_MAX_OUTPUT_TOKENS', 500, { min: 1, max: 2048 }));
const WEBHOOK_RATE_LIMIT_WINDOW_MS = envPositiveNumber('WEBHOOK_RATE_LIMIT_WINDOW_MS', 60 * 1000);
const WEBHOOK_RATE_LIMIT_MAX = Math.max(1, Math.floor(envPositiveNumber('WEBHOOK_RATE_LIMIT_MAX', 300)));
const WEBHOOK_QUEUE_ENABLED = envBoolean('WEBHOOK_QUEUE_ENABLED', false);
const WEBHOOK_QUEUE_BATCH_SIZE = Math.max(1, Math.floor(envPositiveNumber('WEBHOOK_QUEUE_BATCH_SIZE', 10)));
const WEBHOOK_QUEUE_WORKER_INTERVAL_MS = envPositiveNumber('WEBHOOK_QUEUE_WORKER_INTERVAL_MS', 1000);
const WEBHOOK_QUEUE_MAX_ATTEMPTS = Math.max(1, Math.floor(envPositiveNumber('WEBHOOK_QUEUE_MAX_ATTEMPTS', 5)));
const WEBHOOK_QUEUE_RETRY_DELAY_MS = envPositiveNumber('WEBHOOK_QUEUE_RETRY_DELAY_MS', 15 * 1000);
const ADMIN_RATE_LIMIT_WINDOW_MS = envPositiveNumber('ADMIN_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000);
const ADMIN_RATE_LIMIT_MAX = Math.max(1, Math.floor(envPositiveNumber('ADMIN_RATE_LIMIT_MAX', 60)));
const ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS = envPositiveNumber('ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000);
const ADMIN_LOGIN_RATE_LIMIT_MAX = Math.max(1, Math.floor(envPositiveNumber('ADMIN_LOGIN_RATE_LIMIT_MAX', 10)));
const ADMIN_IP_ALLOWLIST = envList('ADMIN_IP_ALLOWLIST').map(normalizeIp);
const TELEGRAM_ALERT_COOLDOWN_MS = Number(process.env.TELEGRAM_ALERT_COOLDOWN_MS || 10 * 60 * 1000);
const FALLBACK_ALERT_THRESHOLD = Number(process.env.FALLBACK_ALERT_THRESHOLD || 2);
const FALLBACK_HANDOFF_THRESHOLD = Number(process.env.FALLBACK_HANDOFF_THRESHOLD || 3);
const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS || 30 * 60 * 1000);
const HANDOFF_MS = Number(process.env.HANDOFF_MS || 30 * 60 * 1000); // 30 phút
const ABANDONED_CART_REMINDER_ENABLED = String(process.env.ABANDONED_CART_REMINDER_ENABLED || 'true').toLowerCase() !== 'false';
const ABANDONED_CART_REMINDER_MS = envPositiveNumber('ABANDONED_CART_REMINDER_MS', 20 * 60 * 1000);
const ABANDONED_CART_REMINDER_SCAN_MS = envPositiveNumber('ABANDONED_CART_REMINDER_SCAN_MS', 60 * 1000);
const ABANDONED_CART_REMINDER_MAX_AGE_MS = envPositiveNumber('ABANDONED_CART_REMINDER_MAX_AGE_MS', 23 * 60 * 60 * 1000);
const ENGAGED_FOLLOWUP_REMINDER_ENABLED = String(process.env.ENGAGED_FOLLOWUP_REMINDER_ENABLED || 'false').toLowerCase() === 'true';
const ENGAGED_FOLLOWUP_REMINDER_MS = envPositiveNumber('ENGAGED_FOLLOWUP_REMINDER_MS', 2 * 60 * 60 * 1000);
const ENGAGED_FOLLOWUP_REMINDER_SCAN_MS = envPositiveNumber('ENGAGED_FOLLOWUP_REMINDER_SCAN_MS', 60 * 1000);
const ENGAGED_FOLLOWUP_REMINDER_MAX_AGE_MS = envPositiveNumber('ENGAGED_FOLLOWUP_REMINDER_MAX_AGE_MS', 3 * 24 * 60 * 60 * 1000);
const FB_PROFILE_CACHE_TTL_MS = envPositiveNumber('FB_PROFILE_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000);
const GEMINI_HISTORY_LIMIT = 20;
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  process.env.RENDER_EXTERNAL_URL ||
  '';
const MULTI_SHOP_DB_CONFIG_ENABLED = envBoolean('MULTI_SHOP_DB_CONFIG_ENABLED', false);
const SHOP_LIVE_GATE_ENABLED = envBoolean('SHOP_LIVE_GATE_ENABLED', false);
const FILE_CONFIG_PAGE_IDS = envList('FB_PAGE_ID')
  .concat(envList('PAGE_ID'))
  .map(String)
  .filter(Boolean);
const RUNTIME_ALLOWLIST = createRuntimeAllowlist(process.env);

function createRuntimeAllowlist(env = process.env) {
  return {
    shopIds: new Set(listFromValue(env.RUNTIME_ALLOWED_SHOP_IDS)),
    pageIds: new Set(listFromValue(env.RUNTIME_ALLOWED_PAGE_IDS))
  };
}

function hasRuntimeAllowlist(allowlist = RUNTIME_ALLOWLIST) {
  return Boolean(allowlist?.shopIds?.size || allowlist?.pageIds?.size);
}

function isAllowedResolvedRuntime({ shopId, pageId } = {}, allowlist = RUNTIME_ALLOWLIST) {
  if (!hasRuntimeAllowlist(allowlist)) return true;
  const normalizedShopId = String(shopId || '').trim();
  const normalizedPageId = String(pageId || '').trim();
  return allowlist.shopIds.has(normalizedShopId) || allowlist.pageIds.has(normalizedPageId);
}

function evaluateDbShopRuntimeAdmission({
  result,
  normalizedPageId = '',
  knownFileConfigPage = false,
  allowlist = RUNTIME_ALLOWLIST,
  logger = console
} = {}) {
  if (!result?.found) {
    return { failClosed: true, reason: result?.reason || 'page_not_found' };
  }

  const shopId = String(result.shop?.id || '').trim();
  const resolvedPageId = String(result.page?.page_id || normalizedPageId || '').trim();
  const shopStatus = String(result.shop?.status || '').trim().toLowerCase();
  if (shopStatus && shopStatus !== 'active') {
    return { failClosed: true, reason: 'shop_status_not_active' };
  }
  if (!isAllowedResolvedRuntime({ shopId, pageId: resolvedPageId }, allowlist)) {
    logger.warn?.(
      `[multi-shop] runtime admission: resolved shop not in allowlist, fail-closed reason=shop_not_allowed shop_id=${safeLogValue(shopId)} page_ref=${pageRef(resolvedPageId)}`
    );
    return { failClosed: true, reason: 'shop_not_allowed' };
  }

  return null;
}

function evaluateDbShopRuntimeLiveGate({
  result,
  enabled = SHOP_LIVE_GATE_ENABLED
} = {}) {
  if (!enabled) return null;
  if (!result?.found) return null;
  const shop = result.shop || {};
  if (shop.controlPlaneColumnsAvailable === false) {
    return { failClosed: true, reason: 'shop_live_gate_schema_missing' };
  }
  const status = String(shop.status || '').trim().toLowerCase();
  if (status !== 'active') return { failClosed: true, reason: 'shop_status_not_active' };
  const lifecycle = String(shop.lifecycle || '').trim().toLowerCase();
  if (lifecycle !== 'live') return { failClosed: true, reason: 'lifecycle_not_live' };
  if (!shop.live_enabled) return { failClosed: true, reason: 'live_disabled' };
  return null;
}

function normalizeOptionalBoolean(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function resolveEffectiveMessengerDryRun({
  globalDryRun = MESSENGER_DRY_RUN,
  shopDryRun = null,
  shopDryRunColumnAvailable = true
} = {}) {
  const normalizedGlobal = Boolean(globalDryRun);
  const normalizedShop = normalizeOptionalBoolean(shopDryRun);
  if (normalizedGlobal) {
    return {
      dryRun: true,
      source: 'global',
      globalDryRun: true,
      shopDryRun: normalizedShop,
      shopDryRunColumnAvailable: shopDryRunColumnAvailable !== false
    };
  }
  if (normalizedShop === true) {
    return {
      dryRun: true,
      source: 'shop',
      globalDryRun: false,
      shopDryRun: true,
      shopDryRunColumnAvailable: shopDryRunColumnAvailable !== false
    };
  }
  return {
    dryRun: false,
    source: normalizedShop === false ? 'shop' : 'legacy_missing_shop_dry_run',
    globalDryRun: false,
    shopDryRun: normalizedShop,
    shopDryRunColumnAvailable: shopDryRunColumnAvailable !== false
  };
}

function logMessengerDryRunDecision({
  decision,
  shopId = '',
  pageId = '',
  logger = console
} = {}) {
  if (!decision || typeof logger?.log !== 'function') return;
  const shopDryRun = decision.shopDryRun == null
    ? 'missing'
    : (decision.shopDryRun ? 'true' : 'false');
  logger.log([
    '[messenger-dry-run]',
    `effective=${decision.dryRun ? 'dry_run' : 'send_allowed'}`,
    `source=${safeLogValue(decision.source)}`,
    `global=${decision.globalDryRun ? 'true' : 'false'}`,
    `shop=${shopDryRun}`,
    `shop_column=${decision.shopDryRunColumnAvailable ? 'available' : 'missing'}`,
    `shop_ref=${shopRef(shopId)}`,
    `page_ref=${pageRef(pageId)}`
  ].join(' '));
}

async function validateRuntimeAllowlistOnStartup({
  db,
  allowlist = RUNTIME_ALLOWLIST,
  logger = console
} = {}) {
  const ids = [...(allowlist?.shopIds || [])].filter(Boolean);
  if (!ids.length) return { checked: false, missing: [] };

  try {
    const queryable = db || getMultiShopDbPool();
    const found = await queryable.query(
      `
        SELECT id
        FROM shops
        WHERE id = ANY($1)
          AND status = 'active'
      `,
      [ids]
    );
    const foundSet = new Set((found.rows || []).map(row => String(row.id)));
    const missing = ids.filter(id => !foundSet.has(id));
    if (missing.length) {
      logger.error?.(
        `[multi-shop] RUNTIME_ALLOWED_SHOP_IDS contains IDs not found in DB; these shops will fail-closed: ${missing.map(id => safeLogValue(id)).join(', ')}`
      );
    }
    return { checked: true, missing };
  } catch (err) {
    logger.error?.(
      `[multi-shop] Could not validate RUNTIME_ALLOWED_SHOP_IDS at startup; runtime admission remains fail-closed as configured: ${String(err?.message || err)}`
    );
    return { checked: false, missing: [], error: err };
  }
}

function getMultiShopDbPool() {
  if (multiShopDbPool) return multiShopDbPool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const err = new Error('DATABASE_URL is required for DB shop config.');
    err.code = 'missing_database_url';
    throw err;
  }
  const { Pool } = require('pg');
  multiShopDbPool = new Pool({ connectionString: databaseUrl });
  return multiShopDbPool;
}

function isKnownFileConfigPage(pageId) {
  const normalized = String(pageId || '').trim();
  return Boolean(normalized && FILE_CONFIG_PAGE_IDS.includes(normalized));
}

const required = { FB_VERIFY_TOKEN, FB_PAGE_TOKEN };
if (REQUIRE_FB_APP_SECRET) {
  required.FB_APP_SECRET = FB_APP_SECRET;
}
if (EFFECTIVE_USE_GEMINI) {
  if (GEMINI_PROVIDER === 'api_key') {
    required.GEMINI_API_KEY = GEMINI_API_KEY;
  } else if (GEMINI_PROVIDER === 'vertex') {
    required.GOOGLE_CLOUD_PROJECT = GOOGLE_CLOUD_PROJECT;
  } else {
    required.GEMINI_PROVIDER = '';
  }
}
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error('❌ Thiếu biến môi trường bắt buộc:', missing.join(', '));
  console.error('   Hãy điền vào file .env (local) hoặc Variables trên Railway/Render.');
  if (missing.includes('GEMINI_PROVIDER')) {
    console.error('   GEMINI_PROVIDER chỉ hỗ trợ "vertex" hoặc "api_key".');
  }
  process.exit(1);
}
if (!FB_APP_SECRET) {
  console.warn('⚠️  Chưa set FB_APP_SECRET — webhook sẽ KHÔNG xác thực chữ ký.');
  console.warn('   Production luôn bắt buộc FB_APP_SECRET; non-prod có thể bật REQUIRE_FB_APP_SECRET=true để kiểm tra sớm.');
}

// ========== APP ==========
const app = express();
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
const webhookRateLimiter = createFixedWindowRateLimiter({
  keyPrefix: 'webhook',
  windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
  max: WEBHOOK_RATE_LIMIT_MAX
});
const adminRateLimiter = createFixedWindowRateLimiter({
  keyPrefix: 'admin',
  windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
  max: ADMIN_RATE_LIMIT_MAX
});
app.use('/admin', adminRateLimiter);

const { trackEvent, maybeResetTimedOutSession } = createEventTracker({
  storage,
  deriveSessionState,
  sessionTimeoutMs: SESSION_TIMEOUT_MS
});
const {
  buildAbandonedCartReminderText,
  buildGeminiRequestHistory,
  buildGeminiRuntimeContext,
  callGemini,
  getGeminiErrorInfo,
  isProbablyIncompleteReply,
  recordConversationTurn,
  shouldUseFallbackReply
} = createAiClient({
  storage,
  products,
  shopConfig,
  deriveSessionState,
  normalizeText,
  render,
  truncateText,
  config: {
    geminiApiKey: GEMINI_API_KEY,
    geminiProvider: GEMINI_PROVIDER,
    geminiModel: GEMINI_MODEL,
    geminiTemperature: GEMINI_TEMPERATURE,
    geminiMaxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    googleCloudProject: GOOGLE_CLOUD_PROJECT,
    googleCloudLocation: GOOGLE_CLOUD_LOCATION,
    geminiHistoryLimit: GEMINI_HISTORY_LIMIT
  }
});
const {
  BOT_MESSAGE_METADATA,
  checkPageToken,
  sendCarousel,
  sendImage,
  sendMessage,
  sendQuickReplies,
  showTyping,
  withPageToken
} = createMessengerClient({
  fbPageToken: FB_PAGE_TOKEN,
  dryRun: MESSENGER_DRY_RUN
});
const {
  resetFallbackAttention,
  sendTelegramAlert,
  sendTelegramOperationalAlert,
  trackFallbackAttention
} = createNotificationService({
  storage,
  fbPageToken: FB_PAGE_TOKEN,
  fbProfileCacheTtlMs: FB_PROFILE_CACHE_TTL_MS,
  telegramAlertCooldownMs: TELEGRAM_ALERT_COOLDOWN_MS,
  fallbackAlertThreshold: FALLBACK_ALERT_THRESHOLD,
  fallbackHandoffThreshold: FALLBACK_HANDOFF_THRESHOLD,
  handoffMs: HANDOFF_MS,
  trackEvent,
  truncateText
});
const {
  buildConfirmedSheetLead,
  buildLeadDetails,
  captureHandoffOrderUpdate,
  notifyStaffForReadyOrder
} = createLeadParser({
  storage,
  products,
  extractPhone,
  extractRequestedProductCodes,
  normalizeText,
  deriveSessionState,
  STATES,
  pushLeadToSheet,
  sendTelegramAlert,
  trackEvent
});

const {
  buildRequestedImageUrls,
  getMenuImageUrls,
  isGreetingText,
  isHotProductsText,
  registerMediaRoutes,
  sendHotCarousel,
  stopImageService
} = createImageService({
  rootDir: ROOT_DIR,
  shopDir: SHOP_DIR,
  shopConfig,
  products,
  storage,
  publicBaseUrl: PUBLIC_BASE_URL,
  normalizeText,
  extractRequestedProductCodes,
  isOrderIntent,
  wantsKeywordImage,
  wantsMenuImages,
  wantsProductImage,
  sendCarousel
});
registerMediaRoutes(app);

function buildDbShopRuntime(resolved, options = {}) {
  const runtimeStorage = options.storage || storage;
  const dbConfig = applyBotModeConfig(resolved.config);
  const dbProducts = resolved.products || [];
  const messengerDryRun = Boolean(options.messengerDryRun);
  const messenger = options.messenger
    || (typeof options.messengerFactory === 'function'
      ? options.messengerFactory(options.fbPageToken, { dryRun: messengerDryRun })
      : withPageToken(options.fbPageToken, { dryRun: messengerDryRun }));
  const dbRules = createRuleEngine({
    products: dbProducts,
    config: dbConfig,
    contextStore: runtimeStorage
  });
  const dbImages = getDbAssetImageRuntime({
    config: dbConfig,
    products: dbProducts,
    rules: dbRules,
    sendCarousel: messenger.sendCarousel
  });
  const dbEventTracker = createEventTracker({
    storage: runtimeStorage,
    deriveSessionState: dbRules.deriveSessionState,
    sessionTimeoutMs: SESSION_TIMEOUT_MS
  });
  const dbAiClient = createAiClient({
    storage: runtimeStorage,
    products: dbProducts,
    shopConfig: dbConfig,
    deriveSessionState: dbRules.deriveSessionState,
    normalizeText: dbRules.normalizeText,
    render: dbRules.render,
    truncateText,
    config: {
      geminiApiKey: GEMINI_API_KEY,
      geminiProvider: GEMINI_PROVIDER,
      geminiModel: GEMINI_MODEL,
      geminiTemperature: GEMINI_TEMPERATURE,
      geminiMaxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      googleCloudProject: GOOGLE_CLOUD_PROJECT,
      googleCloudLocation: GOOGLE_CLOUD_LOCATION,
      geminiHistoryLimit: GEMINI_HISTORY_LIMIT
    }
  });
  const dbNotifications = createNotificationService({
    storage: runtimeStorage,
    fbPageToken: options.fbPageToken || FB_PAGE_TOKEN,
    fbProfileCacheTtlMs: FB_PROFILE_CACHE_TTL_MS,
    telegramAlertCooldownMs: TELEGRAM_ALERT_COOLDOWN_MS,
    fallbackAlertThreshold: FALLBACK_ALERT_THRESHOLD,
    fallbackHandoffThreshold: FALLBACK_HANDOFF_THRESHOLD,
    handoffMs: HANDOFF_MS,
    trackEvent: dbEventTracker.trackEvent,
    truncateText
  });
  const dbLeadParser = createLeadParser({
    storage: runtimeStorage,
    products: dbProducts,
    extractPhone: dbRules.extractPhone,
    extractRequestedProductCodes: dbRules.extractRequestedProductCodes,
    normalizeText: dbRules.normalizeText,
    deriveSessionState: dbRules.deriveSessionState,
    STATES: dbRules.STATES,
    pushLeadToSheet: options.pushLeadToSheet || pushLeadToSheet,
    sendTelegramAlert: dbNotifications.sendTelegramAlert,
    trackEvent: dbEventTracker.trackEvent
  });

  return {
    storage: runtimeStorage,
    shopConfig: dbConfig,
    products: dbProducts,
    messengerDryRun,
    useGemini: USE_GEMINI && isAiFallbackEnabled(dbConfig),
    buildDeterministicReply: dbRules.buildDeterministicReply,
    buildFallbackReply: dbRules.buildFallbackReply,
    buildLeadDetails: dbLeadParser.buildLeadDetails,
    buildConfirmedSheetLead: dbLeadParser.buildConfirmedSheetLead,
    extractRequestedProductCodes: dbRules.extractRequestedProductCodes,
    captureHandoffOrderUpdate: dbLeadParser.captureHandoffOrderUpdate,
    notifyStaffForReadyOrder: dbLeadParser.notifyStaffForReadyOrder,
    looksLikePhone: dbRules.looksLikePhone,
    shouldSilenceAfterCompleteOrder: dbRules.shouldSilenceAfterCompleteOrder,
    wantsHuman: dbRules.wantsHuman,
    normalizeText: dbRules.normalizeText,
    render: dbRules.render,
    deriveSessionState: dbRules.deriveSessionState,
    STATES: dbRules.STATES,
    callGemini: dbAiClient.callGemini,
    getGeminiErrorInfo: dbAiClient.getGeminiErrorInfo,
    shouldUseFallbackReply: dbAiClient.shouldUseFallbackReply,
    isProbablyIncompleteReply: dbAiClient.isProbablyIncompleteReply,
    recordConversationTurn: dbAiClient.recordConversationTurn,
    getMenuImageUrls: dbImages.getMenuImageUrls,
    buildRequestedImageUrls: dbImages.buildRequestedImageUrls,
    isGreetingText: dbImages.isGreetingText,
    isHotProductsText: dbImages.isHotProductsText,
    sendHotCarousel: dbImages.sendHotCarousel,
    sendMessage: messenger.sendMessage,
    sendQuickReplies: messenger.sendQuickReplies,
    sendImage: messenger.sendImage,
    showTyping: messenger.showTyping,
    pushLeadToSheet: options.pushLeadToSheet || pushLeadToSheet,
    sendTelegramAlert: dbNotifications.sendTelegramAlert,
    sendTelegramOperationalAlert: dbNotifications.sendTelegramOperationalAlert,
    resetFallbackAttention: dbNotifications.resetFallbackAttention,
    trackFallbackAttention: dbNotifications.trackFallbackAttention,
    trackEvent: dbEventTracker.trackEvent,
    maybeResetTimedOutSession: dbEventTracker.maybeResetTimedOutSession,
    redactSensitiveText
  };
}

async function resolveStorageForDbRuntime(result) {
  if (!MULTI_SHOP_DB_CONFIG_ENABLED) return storage;
  if (typeof storage.forContext !== 'function') {
    const err = new Error('runtime_storage_context_unavailable');
    err.code = 'runtime_storage_context_unavailable';
    throw err;
  }

  const runtimeStorage = storage.forContext({
    tenantId: result.tenantId || process.env.TENANT_ID || 'default',
    pageId: result.page?.page_id,
    shopId: result.shop?.id
  });
  if (!runtimeStorage || typeof runtimeStorage !== 'object') {
    const err = new Error('runtime_storage_context_invalid');
    err.code = 'runtime_storage_context_invalid';
    throw err;
  }
  if (runtimeStorage.ready) await runtimeStorage.ready;
  return runtimeStorage;
}

async function resolveDbShopRuntimeForPage({
  pageId,
  db,
  credentialMasterKey = process.env.CREDENTIAL_MASTER_KEY,
  credentialResolver = resolvePageCredential,
  messengerFactory,
  shopLiveGateEnabled = SHOP_LIVE_GATE_ENABLED,
  globalMessengerDryRun = MESSENGER_DRY_RUN,
  logger = console
} = {}) {
  const normalizedPageId = String(pageId || '').trim();
  const queryable = db || getMultiShopDbPool();
  const result = await resolveShopConfigForPage({
    pageId: normalizedPageId,
    tenantId: process.env.TENANT_ID || 'default',
    db: queryable
  });

  const admission = evaluateDbShopRuntimeAdmission({
    result,
    normalizedPageId,
    knownFileConfigPage: isKnownFileConfigPage(normalizedPageId)
  });
  if (admission) return admission;

  const liveGate = evaluateDbShopRuntimeLiveGate({
    result,
    enabled: shopLiveGateEnabled
  });
  if (liveGate) return liveGate;

  if (!result.products.length) return { failClosed: true, reason: 'db_products_empty' };
  const modeName = String(result.config?.botMode?.name || '').trim();
  if (modeName === 'disabled') return { failClosed: true, reason: 'db_bot_mode_disabled' };
  if (modeName !== 'menu_code_handoff') return { failClosed: true, reason: 'db_bot_mode_unsupported' };
  let credential;
  try {
    credential = await credentialResolver({
      db: queryable,
      shopId: result.shop.id,
      pageMappingId: result.page.id,
      credentialType: 'fb_page_token',
      masterKey: credentialMasterKey
    });
  } catch {
    return { failClosed: true, reason: 'credential_lookup_failed' };
  }
  if (!credential?.found || !credential.secret) {
    return { failClosed: true, reason: credential?.reason || 'credential_not_found' };
  }
  let runtimeStorage;
  try {
    runtimeStorage = await resolveStorageForDbRuntime(result);
  } catch {
    return { failClosed: true, reason: 'runtime_storage_context_unavailable' };
  }
  const dryRunDecision = resolveEffectiveMessengerDryRun({
    globalDryRun: globalMessengerDryRun,
    shopDryRun: result.shop?.dry_run,
    shopDryRunColumnAvailable: result.shop?.dryRunColumnAvailable !== false
  });
  logMessengerDryRunDecision({
    decision: dryRunDecision,
    shopId: result.shop?.id,
    pageId: result.page?.page_id || normalizedPageId,
    logger
  });
  return buildDbShopRuntime(result, {
    storage: runtimeStorage,
    fbPageToken: credential.secret,
    messengerFactory,
    messengerDryRun: dryRunDecision.dryRun
  });
}

const {
  scanAbandonedCartReminders,
  scanEngagedFollowUpReminders,
  startAbandonedCartReminderWorker,
  stopAbandonedCartReminderWorker,
  startEngagedFollowUpReminderWorker,
  stopEngagedFollowUpReminderWorker
} = createReminderService({
  storage,
  shopConfig,
  buildAbandonedCartReminderText,
  buildQuickReplies,
  sendQuickReplies,
  deriveSessionState,
  STATES,
  trackEvent,
  config: {
    enabled: ABANDONED_CART_REMINDER_ENABLED && isFollowUpEnabled(shopConfig),
    reminderMs: ABANDONED_CART_REMINDER_MS,
    scanMs: ABANDONED_CART_REMINDER_SCAN_MS,
    maxAgeMs: ABANDONED_CART_REMINDER_MAX_AGE_MS,
    engagedFollowUpEnabled: ENGAGED_FOLLOWUP_REMINDER_ENABLED && isFollowUpEnabled(shopConfig),
    engagedFollowUpMs: ENGAGED_FOLLOWUP_REMINDER_MS,
    engagedFollowUpScanMs: ENGAGED_FOLLOWUP_REMINDER_SCAN_MS,
    engagedFollowUpMaxAgeMs: ENGAGED_FOLLOWUP_REMINDER_MAX_AGE_MS
  }
});

let webhookQueueRepository = null;
let webhookQueueService = null;
if (WEBHOOK_QUEUE_ENABLED) {
  webhookQueueRepository = createWebhookQueueRepository({
    db: getMultiShopDbPool(),
    tenantId: process.env.TENANT_ID || 'default',
    maxAttempts: WEBHOOK_QUEUE_MAX_ATTEMPTS,
    retryDelayMs: WEBHOOK_QUEUE_RETRY_DELAY_MS
  });
}

const webhook = createWebhook({
  storage,
  shopConfig,
  products,
  fbVerifyToken: FB_VERIFY_TOKEN,
  fbAppSecret: FB_APP_SECRET,
  webhookRateLimiter,
  handoffMs: HANDOFF_MS,
  useGemini: EFFECTIVE_USE_GEMINI,
  botMessageMetadata: BOT_MESSAGE_METADATA,
  resolveQuickReplyPayload,
  buildQuickReplies,
  buildDeterministicReply,
  buildFallbackReply,
  buildLeadDetails,
  buildConfirmedSheetLead,
  extractRequestedProductCodes,
  captureHandoffOrderUpdate,
  notifyStaffForReadyOrder,
  looksLikePhone,
  shouldSilenceAfterCompleteOrder,
  wantsHuman,
  normalizeText,
  render,
  deriveSessionState,
  STATES,
  callGemini,
  getGeminiErrorInfo,
  shouldUseFallbackReply,
  isProbablyIncompleteReply,
  sendMessage,
  sendQuickReplies,
  sendImage,
  showTyping,
  sendHotCarousel,
  isGreetingText,
  isHotProductsText,
  getMenuImageUrls,
  buildRequestedImageUrls,
  pushLeadToSheet,
  sendTelegramAlert,
  sendTelegramOperationalAlert,
  resetFallbackAttention,
  trackFallbackAttention,
  recordConversationTurn,
  trackEvent,
  maybeResetTimedOutSession,
  redactSensitiveText,
  resolveRuntimeForPage: MULTI_SHOP_DB_CONFIG_ENABLED ? resolveDbShopRuntimeForPage : undefined,
  fileConfigPageIds: FILE_CONFIG_PAGE_IDS,
  webhookQueue: webhookQueueRepository,
  webhookQueueEnabled: WEBHOOK_QUEUE_ENABLED
});
const { registerWebhookRoutes, processQueuedWebhookJob } = webhook;

if (WEBHOOK_QUEUE_ENABLED) {
  webhookQueueService = createWebhookQueueService({
    repository: webhookQueueRepository,
    workerId: safeLogValue(process.env.WEBHOOK_QUEUE_WORKER_ID || `webhook-${process.pid}`),
    batchSize: WEBHOOK_QUEUE_BATCH_SIZE,
    intervalMs: WEBHOOK_QUEUE_WORKER_INTERVAL_MS,
    retryDelayMs: WEBHOOK_QUEUE_RETRY_DELAY_MS,
    processJob: processQueuedWebhookJob
  });
}
registerWebhookRoutes(app);

function buildHealthPayload() {
  return {
    ok: true,
    shop: ACTIVE_SHOP_ID,
    products: products.length,
    uptime: Math.round(process.uptime()),
    storage: {
      adapter: typeof storage.getAdapterName === 'function'
        ? storage.getAdapterName()
        : 'unknown',
      ready: true
    },
    messenger: {
      dryRun: MESSENGER_DRY_RUN
    }
  };
}

// ========== HEALTH CHECK ==========
app.get('/', (_req, res) => res.send('🤖 Shop Bot đang chạy!'));
app.get('/healthz', (_req, res) => res.json(buildHealthPayload()));

registerAdminRoutes(app, {
  storage,
  adminExportToken: ADMIN_EXPORT_TOKEN,
  adminIpAllowlist: ADMIN_IP_ALLOWLIST,
  adminLoginRateLimitWindowMs: ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS,
  adminLoginRateLimitMax: ADMIN_LOGIN_RATE_LIMIT_MAX,
  getClientIp
});

registerWizardRoutes(app, {
  storage,
  adminExportToken: ADMIN_EXPORT_TOKEN,
  adminIpAllowlist: ADMIN_IP_ALLOWLIST,
  adminLoginRateLimitWindowMs: ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS,
  adminLoginRateLimitMax: ADMIN_LOGIN_RATE_LIMIT_MAX,
  getClientIp
});

let server = null;

function shutdown(signal) {
  console.log(`🛑 Nhận ${signal}, đang dừng server...`);
  stopAbandonedCartReminderWorker();
  stopEngagedFollowUpReminderWorker();
  webhookQueueService?.stop?.();
  stopImageService();
  if (!server) process.exit(0);

  server.close(() => {
    Promise.resolve(storage.close?.())
      .then(() => multiShopDbPool ? multiShopDbPool.end() : undefined)
      .catch(err => console.error('❌ Lỗi đóng storage:', err.message))
      .finally(() => {
        console.log('✅ Server đã dừng gọn.');
        process.exit(0);
      });
  });

  setTimeout(() => process.exit(0), 8000).unref();
}

async function startServer() {
  await storage.ready;
  if (MULTI_SHOP_DB_CONFIG_ENABLED) {
    await validateRuntimeAllowlistOnStartup();
  }
  server = app.listen(PORT, async () => {
    const geminiLabel = EFFECTIVE_USE_GEMINI ? `${GEMINI_PROVIDER}/${GEMINI_MODEL}` : 'off';
    console.log(`🚀 Bot shop="${ACTIVE_SHOP_ID}" port ${PORT} (sản phẩm: ${products.length}, Gemini: ${geminiLabel})`);
    await checkPageToken();
    startSheetOutboxWorker();
    startAbandonedCartReminderWorker();
    startEngagedFollowUpReminderWorker();
    if (WEBHOOK_QUEUE_ENABLED) {
      webhookQueueService.start({ intervalMs: WEBHOOK_QUEUE_WORKER_INTERVAL_MS });
    }
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('❌ Không khởi động được server:', err.message);
    process.exit(1);
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  buildDeterministicReply,
  buildFallbackReply,
  buildDbShopRuntime,
  buildLeadDetails,
  buildAbandonedCartReminderText,
  createRuntimeAllowlist,
  evaluateDbShopRuntimeAdmission,
  evaluateDbShopRuntimeLiveGate,
  buildGeminiRuntimeContext,
  buildGeminiRequestHistory,
  buildHealthPayload,
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  getAdminRequestToken,
  getFacebookProfileDisplayName,
  hasRuntimeAllowlist,
  isAllowedResolvedRuntime,
  recordConversationTurn,
  redactSensitiveText,
  resolveEffectiveMessengerDryRun,
  resolveDbShopRuntimeForPage,
  maybeResetTimedOutSession,
  scanAbandonedCartReminders,
  scanEngagedFollowUpReminders,
  startAbandonedCartReminderWorker,
  startEngagedFollowUpReminderWorker,
  validateRuntimeAllowlistOnStartup
};

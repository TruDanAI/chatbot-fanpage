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
const { getAdminRequestToken, registerAdminRoutes } = require('./core/admin-routes');
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
const {
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  createNotificationService,
  getFacebookProfileDisplayName
} = require('./core/notification-service');
const { createReminderService } = require('./core/reminder-service');
const { createWebhook } = require('./core/webhook');

const ROOT_DIR = __dirname;

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

  const mergedConfig = {
    ...shopConfig,
    intents: {
      ...(shopConfig.intents || {}),
      disabled: [...(shopConfig.intents?.disabled || [])],
      prepend: [...prepend, ...(shopConfig.intents?.prepend || [])],
      append: [...(shopConfig.intents?.append || []), ...append]
    }
  };

  return { shopId, shopDir, config: mergedConfig, products };
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
  return String(process.env[name] || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const REQUIRE_FB_APP_SECRET = IS_PRODUCTION || envBoolean('REQUIRE_FB_APP_SECRET', false);
const GEMINI_TEMPERATURE = envNumber('GEMINI_TEMPERATURE', 0.3, { min: 0, max: 1 });
const GEMINI_MAX_OUTPUT_TOKENS = Math.floor(envNumber('GEMINI_MAX_OUTPUT_TOKENS', 500, { min: 1, max: 2048 }));
const WEBHOOK_RATE_LIMIT_WINDOW_MS = envPositiveNumber('WEBHOOK_RATE_LIMIT_WINDOW_MS', 60 * 1000);
const WEBHOOK_RATE_LIMIT_MAX = Math.max(1, Math.floor(envPositiveNumber('WEBHOOK_RATE_LIMIT_MAX', 300)));
const ADMIN_RATE_LIMIT_WINDOW_MS = envPositiveNumber('ADMIN_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000);
const ADMIN_RATE_LIMIT_MAX = Math.max(1, Math.floor(envPositiveNumber('ADMIN_RATE_LIMIT_MAX', 60)));
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
const FB_PROFILE_CACHE_TTL_MS = envPositiveNumber('FB_PROFILE_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000);
const GEMINI_HISTORY_LIMIT = 20;
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  process.env.RENDER_EXTERNAL_URL ||
  '';

const required = { FB_VERIFY_TOKEN, FB_PAGE_TOKEN };
if (REQUIRE_FB_APP_SECRET) {
  required.FB_APP_SECRET = FB_APP_SECRET;
}
if (USE_GEMINI) {
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
  showTyping
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
  wantsKeywordImage,
  wantsMenuImages,
  wantsProductImage,
  sendCarousel
});
registerMediaRoutes(app);

const {
  scanAbandonedCartReminders,
  startAbandonedCartReminderWorker,
  stopAbandonedCartReminderWorker
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
    enabled: ABANDONED_CART_REMINDER_ENABLED,
    reminderMs: ABANDONED_CART_REMINDER_MS,
    scanMs: ABANDONED_CART_REMINDER_SCAN_MS,
    maxAgeMs: ABANDONED_CART_REMINDER_MAX_AGE_MS
  }
});

const { registerWebhookRoutes } = createWebhook({
  storage,
  shopConfig,
  fbVerifyToken: FB_VERIFY_TOKEN,
  fbAppSecret: FB_APP_SECRET,
  webhookRateLimiter,
  handoffMs: HANDOFF_MS,
  useGemini: USE_GEMINI,
  botMessageMetadata: BOT_MESSAGE_METADATA,
  resolveQuickReplyPayload,
  buildQuickReplies,
  buildDeterministicReply,
  buildFallbackReply,
  buildLeadDetails,
  buildConfirmedSheetLead,
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
  redactSensitiveText
});
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
  getClientIp
});

let server = null;

function shutdown(signal) {
  console.log(`🛑 Nhận ${signal}, đang dừng server...`);
  stopAbandonedCartReminderWorker();
  stopImageService();
  if (!server) process.exit(0);

  server.close(() => {
    Promise.resolve(storage.close?.())
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
  server = app.listen(PORT, async () => {
    const geminiLabel = USE_GEMINI ? `${GEMINI_PROVIDER}/${GEMINI_MODEL}` : 'off';
    console.log(`🚀 Bot shop="${ACTIVE_SHOP_ID}" port ${PORT} (sản phẩm: ${products.length}, Gemini: ${geminiLabel})`);
    await checkPageToken();
    startSheetOutboxWorker();
    startAbandonedCartReminderWorker();
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
  buildLeadDetails,
  buildAbandonedCartReminderText,
  buildGeminiRuntimeContext,
  buildGeminiRequestHistory,
  buildHealthPayload,
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  getAdminRequestToken,
  getFacebookProfileDisplayName,
  recordConversationTurn,
  redactSensitiveText,
  maybeResetTimedOutSession,
  scanAbandonedCartReminders,
  startAbandonedCartReminderWorker
};

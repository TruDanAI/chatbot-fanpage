require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const storage = require('./core/storage');
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
const { createMessengerClient } = require('./core/messenger-client');
const {
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  createNotificationService,
  getFacebookProfileDisplayName
} = require('./core/notification-service');
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
} = createMessengerClient({ fbPageToken: FB_PAGE_TOKEN });
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

// ========== IMAGE SERVING ==========
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_DIRS = [
  path.join(SHOP_DIR, 'images'),
  path.join(__dirname, 'images'),
  path.join(__dirname, 'assets'),
  path.join(__dirname, '..')
].filter(dir => fs.existsSync(dir));

function buildImageIndex() {
  const index = new Map();
  for (const dir of IMAGE_DIRS) {
    let files = [];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => e.name);
    } catch {
      continue;
    }

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!ALLOWED_IMAGE_EXT.has(ext)) continue;
      // Ưu tiên ảnh trong shop hiện tại, tránh bị thư mục global ghi đè.
      if (!index.has(file.toLowerCase())) {
        index.set(file.toLowerCase(), path.join(dir, file));
      }
    }
  }
  return index;
}

const IMAGE_INDEX = buildImageIndex();

function getImageFilename(baseName) {
  const clean = String(baseName || '').trim();
  if (!clean) return null;

  const hasExt = ALLOWED_IMAGE_EXT.has(path.extname(clean).toLowerCase());
  if (hasExt) {
    return IMAGE_INDEX.has(clean.toLowerCase()) ? clean : null;
  }

  for (const ext of ALLOWED_IMAGE_EXT) {
    const withExt = `${clean}${ext}`;
    if (IMAGE_INDEX.has(withExt.toLowerCase())) return withExt;
  }
  return null;
}

function getPublicImageUrl(filename, baseUrlOverride = '') {
  const baseRaw = baseUrlOverride || PUBLIC_BASE_URL;
  if (!baseRaw || !filename) return null;
  const base = baseRaw.replace(/\/+$/, '');
  return `${base}/media/${encodeURIComponent(filename)}`;
}

app.get('/media/:filename', (req, res) => {
  const filename = req.params.filename;
  const fullPath = IMAGE_INDEX.get(String(filename || '').toLowerCase());
  if (!fullPath) return res.sendStatus(404);
  res.sendFile(fullPath);
});

function getImageFilenameForProduct(product) {
  if (product?.imageFile) {
    const direct = getImageFilename(product.imageFile);
    if (direct) return direct;
  }

  const code = String(product?.code || '');
  const maMatch = code.match(/(\d{1,2})/);
  if (maMatch) {
    const n = Number(maMatch[1]);
    const candidates = [`ma${n}`, `mã${n}`, `MA${n}`, `MÃ${n}`];
    for (const name of candidates) {
      const f = getImageFilename(name);
      if (f) return f;
    }
  }

  const extras = typeof shopConfig.productImageExtraNames === 'function'
    ? shopConfig.productImageExtraNames(product)
    : [];
  for (const name of extras) {
    const f = getImageFilename(name);
    if (f) return f;
  }
  return null;
}

function isGreetingText(text) {
  const t = normalizeText(text).trim();
  return /^(?:(?:em|minh|toi)\s+)?(?:xin\s*)?(?:chao|hello|hi|alo|shop\s*oi|shop|em\s*oi|chi\s*oi|anh\s*oi)(?:\s+(?:shop|em|ban))?(?:\s+(?:a|nha|nhe|nhe\s*shop|nha\s*shop))?[.!?\s]*$/.test(t);
}

function isHotProductsText(text) {
  const t = normalizeText(text);
  return /(?:ban\s*chay|\bhot\b|nhieu\s*nguoi\s*(?:hoi|mua)|duoc\s*hoi\s*nhieu|mau\s*nao\s*(?:duoc|ok|hot)|top|xu\s*huong)/.test(t);
}

function getMenuImageUrls(baseUrlOverride = '') {
  return ['menu1', 'menu2']
    .map(name => getImageFilename(name))
    .filter(Boolean)
    .map(file => ({ file, url: getPublicImageUrl(file, baseUrlOverride) }))
    .filter(x => x.url);
}

function getHotCarouselProducts() {
  const configured = Array.isArray(shopConfig.hotCarouselProductCodes)
    ? shopConfig.hotCarouselProductCodes
    : Array.isArray(shopConfig.greetingCarouselProductCodes)
      ? shopConfig.greetingCarouselProductCodes
      : [];
  const fallback = [
    ...(shopConfig.recommendations?.premium || []),
    ...(shopConfig.recommendations?.budget || [])
  ];
  const wanted = configured.length ? configured : fallback;
  const byCode = new Map(products.map(p => [String(p.code || '').toUpperCase(), p]));
  const result = [];

  for (const code of wanted) {
    const product = byCode.get(String(code || '').toUpperCase());
    if (product && !result.some(p => p.code === product.code)) result.push(product);
    if (result.length >= 10) break;
  }
  return result;
}

function buildHotCarouselElements(baseUrlOverride = '') {
  return getHotCarouselProducts()
    .map(product => {
      const file = getImageFilenameForProduct(product);
      const imageUrl = getPublicImageUrl(file, baseUrlOverride);
      if (!imageUrl) return null;

      const title = `${product.code} - ${product.price}`.slice(0, 80);
      const subtitle = String(product.description || 'Mẫu đang được hỏi nhiều bên shop').slice(0, 80);
      return {
        title,
        subtitle,
        image_url: imageUrl,
        buttons: [
          {
            type: 'postback',
            title: 'Tư vấn mã này',
            payload: `Tư vấn ${product.code}`
          }
        ]
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

async function sendHotCarousel(senderId, baseUrlOverride = '') {
  const elements = buildHotCarouselElements(baseUrlOverride);
  if (!elements.length) return false;
  await sendCarousel(senderId, elements);
  return true;
}

// ========== ANTI-SPAM ẢNH ==========
const IMAGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút mỗi loại ảnh / mỗi user
const IMAGE_CACHE_SWEEP_MS = 60 * 1000; // dọn rác mỗi 1 phút
const recentlySentImages = new Map(); // key = `${userId}:${filename}` -> timestamp

function pruneRecentlySentImages(now = Date.now()) {
  const expireBefore = now - IMAGE_COOLDOWN_MS;
  for (const [key, at] of recentlySentImages.entries()) {
    if (at <= expireBefore) recentlySentImages.delete(key);
  }
}

const imageCacheGcTimer = setInterval(() => {
  pruneRecentlySentImages();
}, IMAGE_CACHE_SWEEP_MS);
imageCacheGcTimer.unref?.();

function shouldSendImage(userId, filename) {
  // Quét nhanh theo đường nóng để Map không phình nếu traffic cao bất thường.
  pruneRecentlySentImages();
  const key = `${userId}:${filename}`;
  const last = recentlySentImages.get(key);
  if (last && Date.now() - last < IMAGE_COOLDOWN_MS) return false;
  recentlySentImages.set(key, Date.now());
  return true;
}

function buildRequestedImages(userText, userId) {
  const files = [];
  const reasons = [];

  if (wantsMenuImages(userText)) {
    const menu1 = getImageFilename('menu1');
    const menu2 = getImageFilename('menu2');
    if (menu1) { files.push(menu1); reasons.push('menu1'); }
    if (menu2) { files.push(menu2); reasons.push('menu2'); }
  }

  if (wantsKeywordImage(userText, 'gel')) {
    const gel = getImageFilename('gel');
    if (gel) { files.push(gel); reasons.push('gel'); }
  }

  const maCodes = extractRequestedProductCodes(userText);
  if (maCodes.length) {
    const byCode = new Map(products.map(p => [String(p.code || '').toUpperCase(), p]));
    for (const code of maCodes) {
      const p = byCode.get(code.toUpperCase());
      if (!p) continue;
      const file = getImageFilenameForProduct(p);
      if (file) { files.push(file); reasons.push(code); }
    }
  }

  // Nếu khách chỉ nói "xem ảnh" sau khi vừa hỏi/chốt một mã, gửi lại ảnh của mã gần nhất thay vì menu.
  if (!files.length && wantsProductImage(userText)) {
    const lastCode = storage.getLastProductCode(userId);
    const product = products.find(p => String(p.code || '').toUpperCase() === String(lastCode || '').toUpperCase());
    const file = getImageFilenameForProduct(product);
    if (file) { files.push(file); reasons.push(lastCode); }
  }

  const unique = [...new Set(files)].slice(0, 6);
  return unique.filter(f => shouldSendImage(userId, f));
}

function buildRequestedImageUrls(userText, userId, baseUrlOverride = '') {
  const files = buildRequestedImages(userText, userId);
  return files
    .map(file => ({ file, url: getPublicImageUrl(file, baseUrlOverride) }))
    .filter(x => x.url);
}

let abandonedCartReminderTimer = null;
let abandonedCartReminderKickoffTimer = null;
let abandonedCartReminderRunning = false;

async function sendAbandonedCartReminder(candidate) {
  const senderId = candidate?.userId;
  if (!senderId || storage.inHandoff(senderId)) return false;

  const draft = storage.getOrderDraft(senderId);
  if (draft.abandonedCartReminderSentAt) return false;
  if (!Array.isArray(draft.cartItems) || !draft.cartItems.length) return false;
  if (deriveSessionState(senderId, draft) === STATES.CONFIRMED) return false;

  const reminder = buildAbandonedCartReminderText(draft);
  if (!reminder) return false;

  const quickReplies = buildQuickReplies({ stage: 'checkout' }, shopConfig);
  await sendQuickReplies(senderId, reminder, quickReplies);

  const missingFields = candidate.missingFields || ['name', 'phone', 'address']
    .filter(field => !String(draft[field] || '').trim());
  storage.markAbandonedCartReminderSent(senderId, {
    at: new Date().toISOString(),
    idleMs: candidate.idleMs,
    missingFields
  });
  trackEvent(senderId, 'abandoned_cart_reminder_sent', '', {
    idleMs: candidate.idleMs,
    missingFields,
    payloads: quickReplies.map(item => item.payload)
  });
  return true;
}

async function scanAbandonedCartReminders(options = {}) {
  if (abandonedCartReminderRunning) return 0;
  abandonedCartReminderRunning = true;
  let sent = 0;

  try {
    const candidates = storage.listAbandonedCartReminderCandidates({
      idleMs: options.idleMs || ABANDONED_CART_REMINDER_MS,
      maxAgeMs: options.maxAgeMs || ABANDONED_CART_REMINDER_MAX_AGE_MS,
      limit: options.limit || 50
    });

    for (const candidate of candidates) {
      try {
        if (await sendAbandonedCartReminder(candidate)) sent += 1;
      } catch (err) {
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message || err.message;
        console.error(`❌ Nhắc giỏ bỏ dở fail (${candidate.userId}): ${msg}`);
        trackEvent(candidate.userId, 'abandoned_cart_reminder_failed', '', {
          status: status || '',
          error: msg,
          idleMs: candidate.idleMs
        });
        if (status && status >= 400 && status < 500 && status !== 429) {
          storage.markAbandonedCartReminderFailed(candidate.userId, {
            at: new Date().toISOString(),
            status,
            error: msg
          });
        }
      }
    }
  } finally {
    abandonedCartReminderRunning = false;
  }

  return sent;
}

function startAbandonedCartReminderWorker(options = {}) {
  const enabled = options.enabled == null ? ABANDONED_CART_REMINDER_ENABLED : Boolean(options.enabled);
  if (!enabled) return null;
  if (abandonedCartReminderTimer) return abandonedCartReminderTimer;

  const optionIntervalMs = Number(options.intervalMs);
  const intervalMs = Number.isFinite(optionIntervalMs) && optionIntervalMs > 0
    ? optionIntervalMs
    : ABANDONED_CART_REMINDER_SCAN_MS;
  const firstDelayMs = Math.min(options.firstDelayMs || 10 * 1000, intervalMs);
  const run = () => {
    void scanAbandonedCartReminders(options).catch(err => {
      console.error(`❌ Worker nhắc giỏ bỏ dở lỗi: ${err.message}`);
    });
  };

  abandonedCartReminderKickoffTimer = setTimeout(run, firstDelayMs);
  abandonedCartReminderKickoffTimer.unref?.();
  abandonedCartReminderTimer = setInterval(run, intervalMs);
  abandonedCartReminderTimer.unref?.();
  console.log(
    `🛒 Nhắc giỏ bỏ dở bật: sau ${Math.round((options.idleMs || ABANDONED_CART_REMINDER_MS) / 60000)} phút, quét mỗi ${Math.round(intervalMs / 1000)} giây.`
  );
  return abandonedCartReminderTimer;
}

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

// ========== HEALTH CHECK ==========
app.get('/', (_req, res) => res.send('🤖 Shop Bot đang chạy!'));
app.get('/healthz', (_req, res) => res.json({
  ok: true,
  shop: ACTIVE_SHOP_ID,
  products: products.length,
  uptime: Math.round(process.uptime())
}));

registerAdminRoutes(app, {
  storage,
  adminExportToken: ADMIN_EXPORT_TOKEN,
  adminIpAllowlist: ADMIN_IP_ALLOWLIST,
  getClientIp
});

let server = null;

function shutdown(signal) {
  console.log(`🛑 Nhận ${signal}, đang dừng server...`);
  if (abandonedCartReminderKickoffTimer) clearTimeout(abandonedCartReminderKickoffTimer);
  if (abandonedCartReminderTimer) clearInterval(abandonedCartReminderTimer);
  if (!server) process.exit(0);

  server.close(() => {
    console.log('✅ Server đã dừng gọn.');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 8000).unref();
}

if (require.main === module) {
  server = app.listen(PORT, async () => {
    const geminiLabel = USE_GEMINI ? `${GEMINI_PROVIDER}/${GEMINI_MODEL}` : 'off';
    console.log(`🚀 Bot shop="${ACTIVE_SHOP_ID}" port ${PORT} (sản phẩm: ${products.length}, Gemini: ${geminiLabel})`);
    await checkPageToken();
    startSheetOutboxWorker();
    startAbandonedCartReminderWorker();
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

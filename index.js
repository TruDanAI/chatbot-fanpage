require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const storage = require('./core/storage');
const { pushLeadToSheet, startSheetOutboxWorker } = require('./core/sheets-webhook');
const { loadProducts } = require('./core/products');
const { createRuleEngine } = require('./core/rules');
const { buildQuickReplies, resolveQuickReplyPayload } = require('./core/quick-replies');

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
const TELEGRAM_ALERT_COOLDOWN_MS = Number(process.env.TELEGRAM_ALERT_COOLDOWN_MS || 10 * 60 * 1000);
const FALLBACK_ALERT_THRESHOLD = Number(process.env.FALLBACK_ALERT_THRESHOLD || 2);
const FALLBACK_HANDOFF_THRESHOLD = Number(process.env.FALLBACK_HANDOFF_THRESHOLD || 3);
const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS || 30 * 60 * 1000);
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  process.env.RENDER_EXTERNAL_URL ||
  '';

const required = { FB_VERIFY_TOKEN, FB_PAGE_TOKEN };
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
  console.warn('   Khuyến nghị thêm để tránh request giả từ ngoài.');
}

// ========== APP ==========
const app = express();
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

const attentionStateByUser = new Map();

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

// ========== SYSTEM PROMPT ==========
function buildSystemPrompt() {
  if (typeof shopConfig.buildSystemPrompt === 'function') {
    return shopConfig.buildSystemPrompt(products);
  }
  const lines = products.map(p => {
    const parts = [
      p.code,
      p.price,
      p.description,
      p.size,
      p.weight,
      p.gift ? `Tặng ${p.gift}` : '',
      p.preorder ? 'Hàng đặt' : ''
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  }).join('\n');

  return `Bạn là nhân viên tư vấn bán hàng thân thiện của ${shopConfig.shopName || 'shop'}.

DANH SÁCH SẢN PHẨM:
${lines}

Hãy trả lời ngắn gọn, tự nhiên; chỉ dùng sản phẩm và giá trong danh sách; xưng hô anh/chị nhất quán.`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ========== HÀM GỌI GEMINI ==========
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getGeminiErrorInfo(err) {
  const error = err?.response?.data?.error || {};
  const sdkError = err?.error || {};
  return {
    httpStatus: err?.response?.status || err?.status,
    code: error.code || err?.code || sdkError.code,
    status: error.status || err?.statusText || sdkError.status,
    message: error.message || sdkError.message || err?.message || 'Unknown Gemini error'
  };
}

function isGeminiRetryableError(err) {
  const info = getGeminiErrorInfo(err);
  const message = String(info.message || '').toLowerCase();
  return info.httpStatus === 503
    || info.code === 503
    || info.status === 'UNAVAILABLE'
    || message.includes('high demand')
    || message.includes('temporarily unavailable')
    || message.includes('timeout');
}

function getGoogleServiceAccountCredentials() {
  const rawBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const raw = rawBase64
    ? Buffer.from(rawBase64, 'base64').toString('utf8')
    : rawJson;
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ: ${err.message}`);
  }
}

let vertexGeminiClient = null;
function getVertexGeminiClient() {
  if (vertexGeminiClient) return vertexGeminiClient;

  const credentials = getGoogleServiceAccountCredentials();
  vertexGeminiClient = new GoogleGenAI({
    vertexai: true,
    project: GOOGLE_CLOUD_PROJECT,
    location: GOOGLE_CLOUD_LOCATION,
    googleAuthOptions: credentials ? { credentials } : undefined,
    httpOptions: { timeout: 20000 }
  });
  return vertexGeminiClient;
}

async function generateGeminiViaVertex(history) {
  return getVertexGeminiClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: history,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.8,
      maxOutputTokens: 800
    }
  });
}

async function generateGeminiViaApiKey(history) {
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: history,
      generationConfig: { temperature: 0.8, maxOutputTokens: 800 }
    },
    { timeout: 20000 }
  );
  return res.data;
}

function extractGeminiText(result) {
  if (typeof result?.text === 'string') return result.text;
  if (typeof result?.text === 'function') return result.text();
  return result?.candidates?.[0]?.content?.parts?.[0]?.text
    || result?.data?.candidates?.[0]?.content?.parts?.[0]?.text
    || '';
}

async function generateGeminiWithRetry(history) {
  const maxAttempts = 3;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return GEMINI_PROVIDER === 'api_key'
        ? await generateGeminiViaApiKey(history)
        : await generateGeminiViaVertex(history);
    } catch (err) {
      lastErr = err;
      if (!isGeminiRetryableError(err) || attempt === maxAttempts) break;

      const delayMs = 1000 * (2 ** (attempt - 1));
      const info = getGeminiErrorInfo(err);
      console.warn(`⚠️  Gemini tạm quá tải, retry ${attempt}/${maxAttempts - 1} sau ${delayMs}ms: ${info.message}`);
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

/** Bỏ phần model hay lặp từ system prompt (meta kỹ thuật / xưng hô sai). */
function sanitizeGeminiReply(text) {
  let s = String(text || '').trim();
  if (!s) return s;
  s = s.replace(/\s*\([^)]*(?:hệ\s*thống|tự\s*động|he\s*thong|tu\s*dong)[^)]*\)/gi, '');
  s = s.replace(/\s*\([^)]*(?:ảnh|anh|menu|sản\s*phẩm|san\s*pham)[^)]*(?:kèm|kem|gửi|gui|đây|day)[^)]*\)/gi, '');
  s = s.replace(/\s*\([^)]*(?:kèm|kem|gửi|gui|đây|day)[^)]*(?:ảnh|anh|menu|sản\s*phẩm|san\s*pham)[^)]*\)/gi, '');
  s = s.replace(/\s*\[[^\]]*(?:ảnh|anh|menu|sản\s*phẩm|san\s*pham|hình|hinh)[^\]]*(?:kèm|kem|gửi|gui|đây|day|ở\s*đây|o\s*day)[^\]]*\]/gi, '');
  s = s.replace(/\s*\[[^\]]*(?:kèm|kem|gửi|gui|đây|day|ở\s*đây|o\s*day)[^\]]*(?:ảnh|anh|menu|sản\s*phẩm|san\s*pham|hình|hinh)[^\]]*\]/gi, '');
  s = s.replace(/\banh\s*\/\s*em\b/gi, 'anh/chị');
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

async function callGemini(userId, userMessage) {
  const history = storage.getHistory(userId);
  history.push({ role: 'user', parts: [{ text: userMessage }] });

  // Giữ tối đa 20 tin nhắn để tiết kiệm token
  if (history.length > 20) history.splice(0, history.length - 20);

  const res = await generateGeminiWithRetry(history);

  const raw = extractGeminiText(res)
    || 'Xin lỗi anh/chị, em chưa hiểu ý. Anh/chị có thể nói rõ hơn không ạ? 😊';
  const botReply = sanitizeGeminiReply(raw) || raw;
  history.push({ role: 'model', parts: [{ text: botReply }] });
  if (history.length > 20) history.splice(0, history.length - 20);
  storage.setHistory(userId, history);

  return botReply;
}

// ========== HÀM GỬI TIN NHẮN FB ==========
const BOT_MESSAGE_METADATA = 'shop-bot:auto-reply';

async function postFb(payload, attempts = 2, options = {}) {
  const timeout = options.timeout || 10000;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await axios.post(
        `https://graph.facebook.com/v19.0/me/messages?access_token=${FB_PAGE_TOKEN}`,
        payload,
        { timeout }
      );
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Chỉ retry khi lỗi tạm thời (network / 5xx). 4xx (token sai, recipient lạ) thì fail nhanh.
      if (status && status >= 400 && status < 500) break;
      if (i < attempts - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

async function sendMessage(recipientId, text) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, 1900));
    text = text.slice(1900);
  }

  for (const chunk of chunks) {
    await postFb({
      recipient: { id: recipientId },
      message: { text: chunk, metadata: BOT_MESSAGE_METADATA }
    });
  }
}

async function sendQuickReplies(recipientId, text, quickReplies = []) {
  const replies = Array.isArray(quickReplies) ? quickReplies.filter(Boolean).slice(0, 13) : [];
  if (!replies.length) return sendMessage(recipientId, text);

  const chunks = [];
  text = String(text || '');
  while (text.length > 0) {
    chunks.push(text.slice(0, 1900));
    text = text.slice(1900);
  }
  if (!chunks.length) chunks.push('');

  for (let i = 0; i < chunks.length; i += 1) {
    const message = { text: chunks[i], metadata: BOT_MESSAGE_METADATA };
    if (i === chunks.length - 1) message.quick_replies = replies;
    await postFb({
      recipient: { id: recipientId },
      message
    });
  }
}

async function sendImage(recipientId, imageUrl) {
  if (!imageUrl) return;
  await postFb({
    recipient: { id: recipientId },
    message: {
      metadata: BOT_MESSAGE_METADATA,
      attachment: {
        type: 'image',
        payload: { url: imageUrl, is_reusable: true }
      }
    }
  });
}

async function sendCarousel(recipientId, elements) {
  if (!Array.isArray(elements) || !elements.length) return;
  await postFb({
    recipient: { id: recipientId },
    message: {
      metadata: BOT_MESSAGE_METADATA,
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          image_aspect_ratio: 'square',
          elements
        }
      }
    }
  });
}

function showTyping(recipientId) {
  // Fire-and-forget: lỗi typing không chặn flow trả lời chính
  return postFb(
    { recipient: { id: recipientId }, sender_action: 'typing_on' },
    1,
    { timeout: 5000 }
  ).catch(() => {});
}

// ========== XÁC THỰC CHỮ KÝ FB ==========
function verifySignature(req) {
  if (!FB_APP_SECRET) return true;
  const sig = req.get('X-Hub-Signature-256');
  if (!sig || !sig.startsWith('sha256=') || !req.rawBody) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', FB_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ========== HUMAN HANDOFF ==========
const HANDOFF_MS = Number(process.env.HANDOFF_MS || 30 * 60 * 1000); // 30 phút

function isBotEcho(event) {
  const message = event.message || {};
  // Human replies from Meta Inbox can also include app_id, so only trust
  // the metadata we attach to messages sent by this bot.
  return message.metadata === BOT_MESSAGE_METADATA;
}

function getEchoCustomerId(event) {
  return event.recipient?.id || event.sender?.id || '';
}

function inferBaseUrlFromRequest(req) {
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get('host');
  if (!host) return '';
  const proto = req.protocol || 'https';
  return `${proto}://${host}`;
}

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
  return /^(?:(?:em|minh|toi)\s+)?(?:xin\s*)?(?:chao|hello|hi|alo|shop|em\s*oi|chi\s*oi|anh\s*oi)(?:\s+(?:shop|em|ban))?(?:\s+(?:a|nha|nhe|nhe\s*shop|nha\s*shop))?[.!?\s]*$/.test(t);
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

function shouldUseFallbackReply(err) {
  const info = getGeminiErrorInfo(err);
  const message = String(info.message || '').toLowerCase();
  return info.httpStatus === 429
    || info.httpStatus === 503
    || info.code === 429
    || info.code === 503
    || info.status === 'RESOURCE_EXHAUSTED'
    || info.status === 'UNAVAILABLE'
    || message.includes('quota')
    || message.includes('resource_exhausted')
    || message.includes('high demand')
    || message.includes('unavailable');
}

function isProbablyIncompleteReply(reply, userText) {
  const text = String(reply || '').trim();
  if (!text) return true;

  const normalizedReply = normalizeText(text);
  const normalizedUserText = normalizeText(userText);
  const looksLikeBudgetAdvice = /\b\d{2,4}\s*k\b/.test(normalizedUserText)
    || normalizedUserText.includes('ngan sach')
    || normalizedReply.includes('ngan sach');

  const endsAbruptly = !/([.!?。😊🙏]|(ạ|nhé|nha)\s*)$/i.test(text)
    || /\b(với|voi|thì|thi|là|la|nếu|neu|và|va|nhưng|nhung|k|200k|300k)$/i.test(normalizedReply);

  return looksLikeBudgetAdvice && text.length < 180 && endsAbruptly;
}

function cleanLeadPart(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:nhé|nhe|nha|ạ)$/i, '')
    .replace(/\s+(?:shop|ad|minh|mình|anh|chị|chi|em)\s*(?:ơi|oi)?$/i, '')
    .replace(/^[,:;\-\s]+|[,:;\-\s]+$/g, '')
    .trim();
}

const LEAD_PRONOUN_PATTERN = '(?:mình|minh|em|anh|chị|chi|tôi|toi)';
const PHONE_LABEL_PATTERN = '(?:sđt|sdt|số\\s*điện\\s*thoại|so\\s*dien\\s*thoai|đt|dt|phone)';
const NAME_LABEL_PATTERN = '(?:tên\\s*người\\s*nhận|ten\\s*nguoi\\s*nhan|người\\s*nhận|nguoi\\s*nhan|tên|ten)';
const ADDRESS_LABEL_PATTERN = '(?:địa\\s*chỉ|dia\\s*chi|dc|ship\\s*về|ship\\s*ve|giao\\s*về|giao\\s*ve|nơi\\s*nhận|noi\\s*nhan|chỗ\\s*nhận|cho\\s*nhan)';
const ANY_LEAD_LABEL_PATTERN = `(?:${PHONE_LABEL_PATTERN}|${NAME_LABEL_PATTERN}|${ADDRESS_LABEL_PATTERN})`;

function stripLeadPrefixes(text) {
  return cleanLeadPart(text)
    .replace(new RegExp(`^(?:${LEAD_PRONOUN_PATTERN}\\s+)?${NAME_LABEL_PATTERN}\\s*(?:là|la|:)?\\s*`, 'i'), '')
    .replace(new RegExp(`^(?:${LEAD_PRONOUN_PATTERN}\\s+)?(?:là|la)\\s+`, 'i'), '')
    .replace(new RegExp(`^${ADDRESS_LABEL_PATTERN}\\s*(?:là|la|:)?\\s*`, 'i'), '')
    .trim();
}

function extractLabeledLeadValue(text, labelPattern) {
  const re = new RegExp(
    `(?:^|[\\s,;|+])${labelPattern}\\s*(?:là|la|:|-)?\\s*([\\s\\S]*?)(?=(?:[\\s,;|+]+${ANY_LEAD_LABEL_PATTERN}\\s*(?:là|la|:|-)?\\s*)|$)`,
    'i'
  );
  const match = String(text || '').match(re);
  return match ? cleanLeadPart(match[1]) : '';
}

function splitLabeledLeadFields(text) {
  const name = extractLabeledLeadValue(text, NAME_LABEL_PATTERN);
  const address = extractLabeledLeadValue(text, ADDRESS_LABEL_PATTERN);
  if (!name && !address) return null;
  return { name, address };
}

function prefixedLeadPart(text) {
  const raw = cleanLeadPart(text);
  const labeled = splitLabeledLeadFields(raw);
  if (labeled) return labeled;

  const name = raw.match(/^(?:tên người nhận|ten nguoi nhan|người nhận|nguoi nhan|tên|ten)\s*(?:là|la|:)?\s*(.+)$/i);
  if (name) return { name: cleanLeadPart(name[1]) };

  const address = raw.match(/^(?:địa chỉ|dia chi|dc|ship về|ship ve|giao về|giao ve)\s*(?:là|la|:)?\s*(.+)$/i);
  if (address) return { address: cleanLeadPart(address[1]) };

  return null;
}

function splitExplicitOrderFields(text) {
  const raw = cleanLeadPart(text);
  const labeled = splitLabeledLeadFields(raw);
  if (labeled) return labeled;

  const addressMatch = raw.match(/^(.*?)\b(?:và\s*)?(?:địa chỉ|dia chi|dc|ship về|ship ve|giao về|giao ve)\s*(?:là|la|:)?\s*(.+)$/i);
  if (!addressMatch) return null;

  const name = stripLeadPrefixes(addressMatch[1]).replace(/\b(và|va)$/i, '').trim();
  const address = cleanLeadPart(addressMatch[2]);
  if (!address) return null;

  return {
    name: cleanLeadPart(name),
    address
  };
}

function splitByPlusWithPhone(text) {
  const raw = cleanLeadPart(text);
  if (!/\+/.test(raw)) return null;

  const parts = raw
    .split(/\s*\+\s*/)
    .map(part => stripLeadPrefixes(part))
    .map(part => cleanLeadPart(part))
    .filter(Boolean);

  if (parts.length < 2) return null;

  const phoneIdx = parts.findIndex(part => Boolean(extractPhone(part)));
  if (phoneIdx < 0) return null;

  const name = cleanLeadPart(parts.slice(0, phoneIdx).join(' '));
  const address = cleanLeadPart(parts.slice(phoneIdx + 1).join(', '));
  return { name, address };
}

function findAddressStart(text) {
  const normalized = normalizeText(text);
  const keywordIndex = normalized.search(/\b(so|nha|ngo|ngach|hem|kiet|duong|thon|xom|ap|xa|phuong|huyen|quan|tinh|tp|thanh pho|ho chi minh|ha noi|sai gon|bac ninh|hai phong|da nang)\b/i);
  const numberMatch = normalized.match(/(?:^|\s)(?:so\s*)?\d+[a-z]?(?:[/-]\d+[a-z]?)?(?=\s+\S{2,})/i);
  const numberIndex = numberMatch
    ? numberMatch.index + (/^\s/.test(numberMatch[0]) ? 1 : 0)
    : -1;
  const indexes = [keywordIndex, numberIndex].filter(index => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function splitRestNameAndAddress(text) {
  const rest = stripLeadPrefixes(text);
  if (!rest) return { name: '', address: '' };

  const commaParts = rest
    .split(/[,;]+/)
    .map(part => stripLeadPrefixes(part))
    .filter(Boolean);
  if (commaParts.length >= 2) {
    return {
      name: commaParts[0],
      address: cleanLeadPart(commaParts.slice(1).join(', '))
    };
  }

  const addressStart = findAddressStart(rest);
  if (addressStart > 0) {
    return {
      name: cleanLeadPart(rest.slice(0, addressStart)),
      address: cleanLeadPart(rest.slice(addressStart))
    };
  }
  if (addressStart === 0) {
    return { name: '', address: cleanLeadPart(rest) };
  }

  const parts = rest.split(/\s+/);
  if (parts.length <= 3) return { name: rest, address: '' };
  return {
    name: cleanLeadPart(parts.slice(0, 2).join(' ')),
    address: cleanLeadPart(parts.slice(2).join(' '))
  };
}

function splitNameAndAddress(text) {
  const labeled = splitLabeledLeadFields(text);
  if (labeled) return labeled;

  const plusFormat = splitByPlusWithPhone(text);
  if (plusFormat) return plusFormat;

  const phoneMatch = String(text || '').match(/(?:\+?84|0)\d{8,10}/);
  if (phoneMatch) {
    const beforePhone = stripLeadPrefixes(String(text).slice(0, phoneMatch.index));
    const afterPhone = stripLeadPrefixes(String(text).slice(phoneMatch.index + phoneMatch[0].length));
    const name = cleanLeadPart(beforePhone);
    const afterParts = splitRestNameAndAddress(afterPhone);
    if (name && (afterParts.address || afterPhone)) {
      return { name, address: afterParts.address || cleanLeadPart(afterPhone) };
    }
    if (name) return { name, address: '' };
    if (afterParts.name || afterParts.address) return afterParts;
  }

  const withoutPhone = String(text || '').replace(/(?:\+?84|0)\d{8,10}/g, ' ');
  const explicit = splitExplicitOrderFields(withoutPhone);
  if (explicit) return explicit;

  const prefixed = prefixedLeadPart(withoutPhone);
  if (prefixed) return { name: prefixed.name || '', address: prefixed.address || '' };

  const lines = withoutPhone
    .split(/\r?\n/)
    .map(line => stripLeadPrefixes(line))
    .filter(Boolean);

  if (lines.length >= 2) {
    return {
      name: lines[0],
      address: cleanLeadPart(lines.slice(1).join(', '))
    };
  }

  return splitRestNameAndAddress(lines[0] || withoutPhone);
}

function normalizeLeadTextField(text) {
  return cleanLeadPart(
    String(text || '')
      .replace(/(?:\+?84|0)\d{8,10}/g, ' ')
      .replace(/\s*\+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
  );
}

function looksLikeShippingAddressPart(text) {
  const cleaned = cleanLeadPart(stripLeadPrefixes(text));
  if (!cleaned) return false;
  if (findAddressStart(cleaned) >= 0) return true;
  return /[,;]/.test(cleaned)
    && /\b(xa|phuong|huyen|quan|tinh|tp|thanh pho)\b/i.test(normalizeText(cleaned));
}

function extractAddressChangeText(userText, mentionedCode = '') {
  const raw = String(userText || '');
  const explicit = raw.match(new RegExp(
    `(?:đổi|doi|sửa|sua|cập\\s*nhật|cap\\s*nhat|chuyển|chuyen)\\s*(?:${ADDRESS_LABEL_PATTERN})\\s*(?:sang|thành|thanh|là|la|:)?\\s*(.+)$`,
    'i'
  ));
  if (explicit) return cleanLeadPart(explicit[1]);

  // Chỉ coi "đổi/sửa ... sang ..." là đổi địa chỉ khi phần sau thật sự giống địa chỉ.
  // Nếu câu có mã sản phẩm ("đổi sang mã 10") thì để luồng đổi mẫu xử lý.
  if (mentionedCode) return '';

  const broad = raw.match(/(?:đổi|doi|sửa|sua|cập\s*nhật|cap\s*nhat|chuyển|chuyen)\b[\s\S]*?\b(?:sang|thành|thanh|là|la|:)\s*(.+)$/i);
  if (!broad) return '';
  return looksLikeShippingAddressPart(broad[1]) ? cleanLeadPart(broad[1]) : '';
}

function isProductChangeText(text) {
  const t = normalizeText(text);
  return /\b(doi|sua|chuyen|cap\s*nhat)\b/.test(t)
    && (/\b(ma|mau|san\s*pham|sp)\b/.test(t) || /\bsang\b/.test(t));
}

function hasExistingOrderDraft(draft = {}) {
  return Boolean(
    draft.productCode
    || draft.phone
    || draft.name
    || draft.address
    || (Array.isArray(draft.cartItems) && draft.cartItems.length)
  );
}

function isCatalogProductCartItem(item = {}) {
  const code = String(item.code || '').trim().toUpperCase();
  const name = String(item.name || '').trim().toUpperCase();
  return /^MÃ\d+$/.test(code) || /^MÃ\d+$/.test(name);
}

function buildReplacementCartItems(draft = {}, productCode = '') {
  const code = String(productCode || '').trim().toUpperCase();
  if (!code) return [];

  const existing = Array.isArray(draft.cartItems) ? draft.cartItems : [];
  const previousProduct = existing.find(isCatalogProductCartItem);
  const productItem = {
    code,
    name: code,
    qty: Number(previousProduct?.qty || 1) || 1,
    variant: '',
    display: code
  };
  const extras = existing.filter(item => !isCatalogProductCartItem(item));
  return [productItem, ...extras];
}

/**
 * Khóa idempotent cho Google Sheet: retry webhook cùng tin nhắn → cùng key.
 * - Có mid (Meta): SHA-256(`fbmid:` + mid) — an toàn nhất, ổn định qua mọi lần retry.
 * - Không mid (hiếm, ví dụ postback): SHA-256 snapshot đơn + nội dung tin nhắn chuẩn hoá.
 */
function buildSheetDedupeKey(senderId, messageId, userText) {
  const mid = String(messageId || '').trim();
  if (mid) {
    return crypto.createHash('sha256').update(`fbmid:${mid}`, 'utf8').digest('hex');
  }

  const draft = storage.getOrderDraft(senderId);
  const codeRaw = String(draft.productCode || storage.getLastProductCode(senderId) || '').trim();
  const fingerprint = [
    'nomid',
    senderId,
    normalizeText(String(userText || '')),
    draft.updatedAt || '',
    String(draft.name || '').trim(),
    String(draft.phone || '').trim(),
    String(draft.address || '').trim(),
    codeRaw
  ].join('\x1e');

  return crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex');
}

function normalizeCartForHash(cartItems = []) {
  return (Array.isArray(cartItems) ? cartItems : [])
    .map(item => ({
      code: String(item.code || '').trim().toUpperCase(),
      name: String(item.name || '').trim().toLowerCase(),
      qty: Number(item.qty || 1) || 1,
      variant: String(item.variant || '').trim().toLowerCase()
    }))
    .filter(item => item.code || item.name)
    .sort((a, b) => `${a.code}|${a.name}|${a.variant}`.localeCompare(`${b.code}|${b.name}|${b.variant}`));
}

function buildOrderStaffNotificationHash(orderDraft = {}, fallbackProductCode = '') {
  const payload = {
    cartItems: normalizeCartForHash(orderDraft.cartItems),
    productCode: String(orderDraft.productCode || fallbackProductCode || '').trim().toUpperCase(),
    name: normalizeText(String(orderDraft.name || '').trim()),
    phone: String(orderDraft.phone || '').replace(/\D/g, ''),
    address: normalizeText(String(orderDraft.address || '').trim())
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

/** Lead đồng bộ Sheet khi đơn CONFIRMED: cùng trường với orderDraft + mô tả sản phẩm nếu có. */
function buildConfirmedSheetLead(senderId, opts = {}) {
  const { messageId = '', userText = '' } = opts;
  const draft = storage.getOrderDraft(senderId);
  const codeRaw = String(draft.productCode || storage.getLastProductCode(senderId) || '').trim();
  const codeUpper = codeRaw.toUpperCase();
  const product = products.find(p => String(p.code || '').toUpperCase() === codeUpper);
  const desc = String(product?.description || '').trim();
  const productInterest = product
    ? (desc ? `${product.code} — ${desc}` : String(product.code || ''))
    : codeRaw;
  const cartItems = Array.isArray(draft.cartItems) ? draft.cartItems : [];
  const cartText = cartItems.length
    ? cartItems.map(item => {
        const label = item.display
          || [item.qty && item.qty !== 1 ? item.qty : '', item.name || item.code, item.variant].filter(Boolean).join(' ');
        return label.trim();
      }).filter(Boolean).join(' + ')
    : '';

  return {
    dedupeKey: buildSheetDedupeKey(senderId, messageId, userText),
    senderId,
    name: String(draft.name || '').trim(),
    phone: String(draft.phone || '').trim(),
    address: String(draft.address || '').trim(),
    productCode: codeRaw,
    productInterest: cartText || productInterest,
    confirmedAt: new Date().toISOString()
  };
}

async function notifyStaffForReadyOrder(senderId, userText, opts = {}) {
  const draft = storage.getOrderDraft(senderId);
  if (deriveSessionState(senderId, draft) !== STATES.READY_TO_CONFIRM) return false;
  const hasProduct = Boolean(
    String(draft.productCode || storage.getLastProductCode(senderId) || '').trim()
    || (Array.isArray(draft.cartItems) && draft.cartItems.length)
  );
  if (!hasProduct) return false;

  const fallbackProductCode = storage.getLastProductCode(senderId);
  const hash = buildOrderStaffNotificationHash(draft, fallbackProductCode);
  const notified = storage.getOrderStaffNotification
    ? storage.getOrderStaffNotification(senderId)
    : {};
  if (notified.hash === hash) return false;

  const confirmedLead = buildConfirmedSheetLead(senderId, {
    messageId: opts.messageId || '',
    userText
  });
  const isUpdate = Boolean(notified.hash);
  trackEvent(senderId, isUpdate ? 'order_update_staff_notified' : 'order_staff_notified', userText, {
    productCode: confirmedLead.productCode || '',
    productInterest: confirmedLead.productInterest || '',
    previousNotifiedAt: notified.at || ''
  });
  console.log(`📤 Đơn đủ thông tin — gửi ${isUpdate ? 'cập nhật ' : ''}lead cho nhân viên (${senderId}).`);
  sendTelegramAlert({
    ...confirmedLead,
    text: isUpdate ? 'CẬP NHẬT ĐƠN ĐỦ THÔNG TIN' : 'ĐƠN ĐỦ THÔNG TIN - CHỜ KHÁCH OK'
  });
  if (storage.setOrderStaffNotification) {
    storage.setOrderStaffNotification(senderId, {
      hash,
      at: confirmedLead.confirmedAt
    });
  }
  return true;
}

function buildLeadDetails(userText, senderId) {
  const mentionedCode = extractRequestedProductCodes(userText)[0] || '';
  const productCode = mentionedCode || storage.getLastProductCode(senderId) || '';
  const phone = extractPhone(userText);
  const draft = storage.getOrderDraft(senderId);
  const addressChangeText = extractAddressChangeText(userText, mentionedCode);
  const hasLeadPrefix = new RegExp(
    `(?:^|\\n)\\s*(?:${LEAD_PRONOUN_PATTERN}\\s+)?(?:${NAME_LABEL_PATTERN}|${ADDRESS_LABEL_PATTERN})(?:\\s|:|$)`,
    'i'
  ).test(userText)
    || new RegExp(`(?:^|\\n)\\s*${LEAD_PRONOUN_PATTERN}\\s+(?:là|la)\\s+`, 'i').test(userText);
  const addressOnly = !phone && /[,;]/.test(userText) && /\b(xã|xa|phường|phuong|huyện|huyen|quận|quan|tỉnh|tinh|tp|thành phố|thanh pho)\b/i
    .test(normalizeText(userText));
  let parsed = addressChangeText
    ? { name: '', address: cleanLeadPart(addressChangeText) }
    : phone || hasLeadPrefix
    ? splitNameAndAddress(userText)
    : addressOnly
      ? { name: '', address: cleanLeadPart(stripLeadPrefixes(userText)) }
      : { name: '', address: '' };

  if (
    !parsed.name
    && !parsed.address
    && !phone
    && !mentionedCode
    && !draft.name
    && draft.phone
    && draft.address
    && looksLikeBareCustomerName(userText)
  ) {
    parsed = { name: cleanLeadPart(userText), address: '' };
  }

  const details = {
    productCode,
    phone,
    name: normalizeLeadTextField(parsed.name),
    address: normalizeLeadTextField(parsed.address)
  };
  if (mentionedCode && isProductChangeText(userText) && hasExistingOrderDraft(draft)) {
    details.cartItems = buildReplacementCartItems(draft, mentionedCode);
  }
  return details;
}

function shouldCaptureHandoffOrderUpdate(senderId, userText, leadDetails, previousDraft = {}) {
  const mentionedCode = extractRequestedProductCodes(userText)[0] || '';
  const previousCode = String(previousDraft.productCode || storage.getLastProductCode(senderId) || '').toUpperCase();
  const hasExistingOrder = Boolean(
    previousDraft.productCode
    || previousDraft.phone
    || previousDraft.name
    || previousDraft.address
    || (Array.isArray(previousDraft.cartItems) && previousDraft.cartItems.length)
  );
  const productChanged = mentionedCode
    && mentionedCode.toUpperCase() !== previousCode;

  if (!hasExistingOrder && !String(leadDetails.productCode || '').trim()) return false;

  return Boolean(
    leadDetails.phone
    || leadDetails.name
    || leadDetails.address
    || (hasExistingOrder && productChanged)
  );
}

function captureHandoffOrderUpdate(senderId, userText, opts = {}) {
  const previousDraft = storage.getOrderDraft(senderId);
  const leadDetails = buildLeadDetails(userText, senderId);
  if (!shouldCaptureHandoffOrderUpdate(senderId, userText, leadDetails, previousDraft)) return false;

  const currentLead = storage.mergeOrderDraft(senderId, leadDetails);
  trackEvent(senderId, 'handoff_order_update_received', userText, {
    fields: ['productCode', 'phone', 'name', 'address'].filter(field => Boolean(leadDetails[field]))
  });
  storage.appendCustomer({
    type: 'lead_update',
    senderId,
    ...currentLead,
    text: userText,
    history: storage.getHistory(senderId).slice(-10),
    at: new Date().toISOString()
  });

  const confirmedLead = buildConfirmedSheetLead(senderId, {
    messageId: opts.messageId || '',
    userText
  });
  void pushLeadToSheet(confirmedLead);
  sendTelegramAlert({
    ...confirmedLead,
    text: 'CẬP NHẬT ĐƠN TRONG HANDOFF'
  });
  return true;
}

function truncateText(text, max = 700) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function wantsUrgentHumanAttention(text) {
  const t = normalizeText(text);
  return /(?:khong\s*hieu|tra\s*loi\s*gi|noi\s*gi|bot|tu\s*van\s*te|hoi\s*mai|lau\s*the|buc\s*minh|kho\s*chiu|lua\s*dao|chan\s*the|mat\s*thoi\s*gian)/.test(t);
}

function looksLikeBareCustomerName(text) {
  const raw = cleanLeadPart(text);
  const t = normalizeText(raw);
  if (!raw || raw.length < 2 || raw.length > 50) return false;
  if (raw.includes('?') || extractPhone(raw) || extractRequestedProductCodes(raw).length) return false;
  if (/\d/.test(raw)) return false;
  if (/^(?:ok|oke|oki|okay|vang|da|duoc|chot|lay|mua|dat|gui|ship|khong|ko|k)\b/.test(t)) return false;
  if (/(?:dia\s*chi|sdt|so\s*dien\s*thoai|ship|giao|xa|phuong|huyen|quan|tinh|tp|duong|thon|xom|ngo|ngach|hem|gel|ma|mau|shop|tu\s*van|gia|bao\s*nhieu)/.test(t)) return false;

  const words = raw.split(/\s+/).filter(Boolean);
  return words.length <= 5 && /[A-Za-zÀ-ỹ]/.test(raw);
}

function trackEvent(senderId, type, text = '', meta = {}) {
  if (!senderId || !type) return;
  const draft = storage.getOrderDraft(senderId);
  storage.appendEvent({
    type,
    senderId,
    text,
    sessionState: deriveSessionState(senderId),
    productCode: draft.productCode || storage.getLastProductCode(senderId) || '',
    meta
  });
}

function maybeResetTimedOutSession(senderId, userText) {
  const previous = storage.getLastUserAt(senderId);
  const now = Date.now();
  storage.setLastUserAt(senderId, new Date(now).toISOString());

  if (!previous || !SESSION_TIMEOUT_MS) return false;
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(previousMs) || now - previousMs <= SESSION_TIMEOUT_MS) return false;

  const abandoned = storage.resetSessionAfterTimeout(senderId);
  trackEvent(senderId, 'session_timeout', userText, {
    idleMs: now - previousMs,
    abandonedProductCode: abandoned.productCode || '',
    hadCart: Array.isArray(abandoned.cartItems) && abandoned.cartItems.length > 0
  });
  return true;
}

function formatOrderDraftForAlert(senderId) {
  const draft = storage.getOrderDraft(senderId);
  const cartItems = Array.isArray(draft.cartItems) ? draft.cartItems : [];
  const cartText = cartItems.length
    ? cartItems.map(item => {
        const label = item.display
          || [item.qty && item.qty !== 1 ? item.qty : '', item.name || item.code, item.variant].filter(Boolean).join(' ');
        return label.trim();
      }).filter(Boolean).join(' + ')
    : '';

  return [
    `Stage: ${storage.getSessionState(senderId) || 'AUTO'}`,
    `Last product: ${storage.getLastProductCode(senderId) || 'Không có'}`,
    `Draft product: ${draft.productCode || 'Không có'}`,
    `Cart: ${cartText || 'Không có'}`,
    `Tên: ${draft.name || 'Chưa có'}`,
    `SĐT: ${draft.phone || 'Chưa có'}`,
    `Địa chỉ: ${draft.address || 'Chưa có'}`
  ].join('\n');
}

function shouldThrottleOperationalAlert(senderId, reason) {
  const key = `${senderId}:${reason}`;
  const now = Date.now();
  const state = attentionStateByUser.get(key) || {};
  if (state.lastAlertAt && now - state.lastAlertAt < TELEGRAM_ALERT_COOLDOWN_MS) return true;
  attentionStateByUser.set(key, { ...state, lastAlertAt: now });
  return false;
}

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return false;

  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text: truncateText(text, 3900)
  });
  return true;
}

async function sendTelegramOperationalAlert({ senderId, reason, userText = '', reply = '', error = '', force = false } = {}) {
  try {
    if (!senderId) return;
    if (!force && shouldThrottleOperationalAlert(senderId, reason || 'operational')) return;

    const history = storage.getHistory(senderId)
      .slice(-6)
      .map(item => {
        const role = item.role === 'model' ? 'Bot/Gemini' : 'Khách';
        const text = item.parts?.map(part => part.text).filter(Boolean).join(' ') || '';
        return `${role}: ${truncateText(text, 180)}`;
      })
      .filter(Boolean)
      .join('\n');

    const text = [
      '🚨 CẦN NHÂN VIÊN HỖ TRỢ',
      '',
      `Lý do: ${reason || 'Không rõ'}`,
      `User: ${senderId}`,
      '',
      formatOrderDraftForAlert(senderId),
      '',
      `Tin mới nhất: ${truncateText(userText, 500) || 'Không có'}`,
      reply ? `Bot vừa trả: ${truncateText(reply, 500)}` : '',
      error ? `Lỗi: ${truncateText(error, 700)}` : '',
      history ? `\nLịch sử Gemini gần nhất:\n${history}` : ''
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(text);
  } catch (err) {
    console.error('❌ Lỗi gửi Telegram operational alert:', err.response?.data || err.message);
  }
}

function resetFallbackAttention(senderId) {
  if (!senderId) return;
  const state = attentionStateByUser.get(senderId);
  if (!state) return;
  attentionStateByUser.set(senderId, { ...state, fallbackCount: 0 });
}

async function trackFallbackAttention(senderId, userText, reply) {
  if (!senderId) return;
  const state = attentionStateByUser.get(senderId) || {};
  const fallbackCount = Number(state.fallbackCount || 0) + 1;
  attentionStateByUser.set(senderId, { ...state, fallbackCount });

  if (fallbackCount >= FALLBACK_ALERT_THRESHOLD) {
    await sendTelegramOperationalAlert({
      senderId,
      reason: `Ngoài rule-base/fallback liên tiếp ${fallbackCount} lần`,
      userText,
      reply
    });
  }

  if (fallbackCount >= FALLBACK_HANDOFF_THRESHOLD) {
    storage.setHandoff(senderId, Date.now() + HANDOFF_MS);
    trackEvent(senderId, 'handoff_started', userText, {
      reason: 'fallback_threshold',
      fallbackCount
    });
    await sendTelegramOperationalAlert({
      senderId,
      reason: `Tự bật handoff vì fallback ${fallbackCount} lần liên tiếp`,
      userText,
      reply,
      force: true
    });
  }
}

async function sendTelegramAlert(leadData) {
  try {
    const title = leadData.text || 'CÓ ĐƠN HÀNG MỚI';
    const text = `🚨 ${title}
👤 Tên: ${leadData.name || 'Không có'}
📞 SĐT: ${leadData.phone || 'Không có'}
🏠 Địa chỉ: ${leadData.address || 'Không có'}
📦 Sản phẩm: ${leadData.productInterest || leadData.productCode || 'Không có'}`;

    await sendTelegramMessage(text);
  } catch (err) {
    console.error('❌ Lỗi gửi Telegram alert:', err.response?.data || err.message);
  }
}

// ========== WEBHOOK VERIFY (Meta yêu cầu) ==========
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    console.log('✅ Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ========== NHẬN TIN NHẮN ==========
app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    console.warn('⚠️  Sai chữ ký webhook, từ chối request.');
    return res.sendStatus(403);
  }

  res.sendStatus(200); // Trả 200 ngay để Meta không retry

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const inferredBaseUrl = inferBaseUrlFromRequest(req);
      handleEvent(event, inferredBaseUrl).catch(err => {
        console.error('❌ handleEvent:', err.response?.data || err.message);
      });
    }
  }
});

async function handleEvent(event, baseUrlOverride = '') {
  const senderId = event.sender?.id;
  if (!senderId) return;

  // Echo: tin bot tự gửi thì bỏ qua; tin page/người trực gửi tay thì tạm dừng đúng khách.
  if (event.message?.is_echo) {
    if (!isBotEcho(event)) {
      const customerId = getEchoCustomerId(event);
      if (customerId) {
        storage.setHandoff(customerId, Date.now() + HANDOFF_MS);
        console.log(`⏸️  Bật handoff do người trực trả lời: ${customerId}`);
      }
    }
    return;
  }

  // Dedup theo message id (Meta có thể retry)
  const mid = event.message?.mid;
  if (mid && storage.seenMid(mid)) return;
  if (mid) storage.markMid(mid);

  let userText = null;
  let quickReplyPayload = '';
  if (event.message?.quick_reply?.payload) {
    quickReplyPayload = event.message.quick_reply.payload;
    const resolved = resolveQuickReplyPayload(quickReplyPayload, shopConfig);
    userText = resolved?.text || event.message?.text || quickReplyPayload;
  } else if (event.message?.text) userText = event.message.text;
  else if (event.postback?.payload) userText = event.postback.payload;
  if (!userText) return;

  console.log(`📩 [${senderId}]: ${userText}`);
  trackEvent(senderId, 'message_received', userText, {
    messageId: mid || '',
    quickReplyPayload
  });

  // Đang trong khoảng human handoff → bot không trả lời, nhưng vẫn ghi nhận cập nhật đơn.
  if (storage.inHandoff(senderId)) {
    const captured = captureHandoffOrderUpdate(senderId, userText, { messageId: mid || '' });
    console.log(`⏸️  Bỏ qua tin (handoff): ${senderId}${captured ? ' — đã ghi nhận cập nhật đơn' : ''}`);
    return;
  }

  maybeResetTimedOutSession(senderId, userText);

  // Khách yêu cầu gặp nhân viên → tạm dừng bot, ghi log
  if (wantsHuman(userText)) {
    storage.setHandoff(senderId, Date.now() + HANDOFF_MS);
    trackEvent(senderId, 'handoff_started', userText, { reason: 'wants_human' });
    storage.appendCustomer({
      type: 'handoff_request',
      senderId,
      phone: '',
      text: userText,
      at: new Date().toISOString()
    });
    void sendTelegramOperationalAlert({
      senderId,
      reason: 'Khách yêu cầu gặp nhân viên',
      userText,
      force: true
    });
    try {
      await sendMessage(senderId, render('humanHandoff'));
    } catch {}
    return;
  }

  if (wantsUrgentHumanAttention(userText)) {
    storage.setHandoff(senderId, Date.now() + HANDOFF_MS);
    trackEvent(senderId, 'handoff_started', userText, { reason: 'urgent_attention' });
    storage.appendCustomer({
      type: 'handoff_attention',
      senderId,
      phone: '',
      text: userText,
      at: new Date().toISOString()
    });
    void sendTelegramOperationalAlert({
      senderId,
      reason: 'Khách có dấu hiệu bực/ngoài tầm xử lý',
      userText,
      force: true
    });
    try {
      await sendMessage(senderId, render('humanHandoff'));
    } catch {}
    return;
  }

  // Nhận diện sđt → ghi lead vào customers.csv để nhân viên xem lại.
  // Phần storage tự xếp hàng ghi file để nhiều khách nhắn cùng lúc không làm lẫn dòng CSV.
  const leadDetails = buildLeadDetails(userText, senderId);
  const prevOrderDraft = storage.getOrderDraft(senderId);
  const hasOrderDetail = Boolean(
    leadDetails.productCode || leadDetails.phone || leadDetails.name || leadDetails.address
  );
  const mergedOrderDraft = hasOrderDetail
    ? storage.mergeOrderDraft(senderId, leadDetails)
    : {};
  const currentLead = Object.keys(mergedOrderDraft).length ? mergedOrderDraft : leadDetails;

  // CONFIRMED lưu từ phiên trước + khách gửi đơn mới → xóa cờ để "ok" lại tạo transition và đẩy Sheet.
  const substantiveLead = Boolean(leadDetails.phone || leadDetails.name || leadDetails.address);
  const productChanged = Boolean(
    leadDetails.productCode &&
    String(leadDetails.productCode).toUpperCase() !== String(prevOrderDraft.productCode || '').toUpperCase()
  );
  if (
    storage.getSessionState(senderId) === STATES.CONFIRMED &&
    (substantiveLead || productChanged)
  ) {
    storage.setSessionState(senderId, '');
  }

  if (looksLikePhone(userText)) {
    trackEvent(senderId, 'lead_info_received', userText, { fields: ['phone'] });
    storage.appendCustomer({
      type: 'lead',
      senderId,
      ...currentLead,
      phone: currentLead.phone || leadDetails.phone,
      text: userText,
      history: storage.getHistory(senderId).slice(-10),
      at: new Date().toISOString()
    });
  } else if ((leadDetails.name || leadDetails.address) && currentLead.phone && currentLead.name && currentLead.address) {
    trackEvent(senderId, 'lead_info_received', userText, {
      fields: ['name', 'address'].filter(field => Boolean(leadDetails[field]))
    });
    storage.appendCustomer({
      type: 'lead_update',
      senderId,
      ...currentLead,
      text: userText,
      history: storage.getHistory(senderId).slice(-10),
      at: new Date().toISOString()
    });
  }

  await notifyStaffForReadyOrder(senderId, userText, { messageId: mid || '' });

  const sessionBeforeConfirm = storage.getSessionState(senderId);
  if (shouldSilenceAfterCompleteOrder(userText, senderId)) {
    const nowConfirmed = storage.getSessionState(senderId) === STATES.CONFIRMED;
    const justConfirmed = nowConfirmed && sessionBeforeConfirm !== STATES.CONFIRMED;
    if (justConfirmed) {
      console.log(`📤 Đơn vừa CONFIRMED — gửi lead lên Google Sheet (${senderId}).`);
      const confirmedLead = buildConfirmedSheetLead(senderId, { messageId: mid || '', userText });
      trackEvent(senderId, 'order_confirmed', userText, {
        productCode: confirmedLead.productCode || '',
        productInterest: confirmedLead.productInterest || ''
      });
      void pushLeadToSheet(confirmedLead);
      sendTelegramAlert({
        ...confirmedLead,
        text: 'ĐƠN ĐÃ ĐƯỢC KHÁCH XÁC NHẬN'
      });
      storage.setHandoff(senderId, Date.now() + HANDOFF_MS);
    }
    console.log(`⏸️  Bỏ qua tin xác nhận ngắn sau khi đã đủ thông tin đơn: ${senderId}`);
    return;
  }

  let imagePromise = Promise.resolve();
  try {
    showTyping(senderId);

    // Chạy song song: vừa gửi ảnh/carousel vừa xử lý reply để bớt độ trễ
    const isGreeting = isGreetingText(userText);
    const shouldSendHotCarousel = isHotProductsText(userText);
    const images = isGreeting
      ? getMenuImageUrls(baseUrlOverride)
      : shouldSendHotCarousel
        ? []
        : buildRequestedImageUrls(userText, senderId, baseUrlOverride);
    imagePromise = (async () => {
      if (shouldSendHotCarousel) {
        try {
          const sent = await sendHotCarousel(senderId, baseUrlOverride);
          if (sent) console.log(`🖼️  Gửi hot carousel cho ${senderId}`);
        } catch (e) {
          const msg = e.response?.data?.error?.message || e.message;
          console.error(`❌ Gửi hot carousel fail: ${msg}`);
        }
        return;
      }

      for (const { file, url } of images) {
        try {
          await sendImage(senderId, url);
          console.log(`🖼️  Gửi ảnh: ${file}`);
        } catch (e) {
          const msg = e.response?.data?.error?.message || e.message;
          console.error(`❌ Gửi ảnh ${file} fail: ${msg}`);
        }
      }
    })();

    const stateBeforeReply = deriveSessionState(senderId);
    let reply = buildDeterministicReply(userText, senderId);
    const deterministicMatched = Boolean(reply);
    let usedFallbackReply = false;
    if (deterministicMatched) {
      resetFallbackAttention(senderId);
      trackEvent(senderId, 'deterministic_reply', userText, { stateBefore: stateBeforeReply });
      console.log('⚡ Trả lời rule-based, không gọi Gemini');
    } else if (!USE_GEMINI) {
      reply = buildFallbackReply(userText, senderId);
      usedFallbackReply = true;
      trackEvent(senderId, 'fallback_used', userText, { reason: 'gemini_disabled' });
      console.log('🧩 USE_GEMINI=false, dùng fallback rule-based');
    } else {
      reply = await callGemini(senderId, userText);
      resetFallbackAttention(senderId);
      trackEvent(senderId, 'gemini_reply', userText, { stateBefore: stateBeforeReply });
    }
    if (isProbablyIncompleteReply(reply, userText)) {
      console.warn(`⚠️  Gemini trả lời có vẻ bị cụt, dùng fallback. Reply gốc: ${reply.replace(/\n/g, ' ')}`);
      reply = buildFallbackReply(userText, senderId);
      usedFallbackReply = true;
      trackEvent(senderId, 'fallback_used', userText, { reason: 'incomplete_reply' });
      await sendTelegramOperationalAlert({
        senderId,
        reason: 'Gemini trả lời có vẻ bị cụt',
        userText,
        reply
      });
    }
    if (usedFallbackReply) {
      await trackFallbackAttention(senderId, userText, reply);
    }
    const stateAfterReply = deriveSessionState(senderId);
    if (stateBeforeReply !== STATES.COLLECTING_INFO && stateAfterReply === STATES.COLLECTING_INFO) {
      trackEvent(senderId, 'checkout_started', userText, { stateBefore: stateBeforeReply });
    }
    const quickReplies = buildQuickReplies({
      stateBeforeReply,
      stateAfterReply,
      isGreeting,
      replyText: reply,
      fallbackUsed: usedFallbackReply,
      lastProductCode: storage.getLastProductCode(senderId),
      orderDraft: storage.getOrderDraft(senderId)
    }, shopConfig);
    console.log(`🤖 reply: ${reply.slice(0, 120).replace(/\n/g, ' ')}`);
    await imagePromise; // đợi ảnh xong rồi mới gửi text để text xuất hiện sau ảnh
    if (quickReplies.length) {
      trackEvent(senderId, 'quick_replies_sent', userText, {
        payloads: quickReplies.map(item => item.payload)
      });
      await sendQuickReplies(senderId, reply, quickReplies);
    } else {
      await sendMessage(senderId, reply);
    }
    console.log(`✉️  Đã gửi tin tới ${senderId}`);
  } catch (err) {
    const geminiInfo = getGeminiErrorInfo(err);
    console.error('❌ Lỗi xử lý tin:', err.response?.data || err.message || geminiInfo);
    void sendTelegramOperationalAlert({
      senderId,
      reason: 'Lỗi xử lý tin nhắn',
      userText,
      error: JSON.stringify(err.response?.data || err.message || geminiInfo),
      force: true
    });
    if (shouldUseFallbackReply(err)) {
      try {
        await imagePromise;
        const fallback = buildFallbackReply(userText, senderId);
        trackEvent(senderId, 'fallback_used', userText, {
          reason: 'gemini_error',
          status: geminiInfo.status || geminiInfo.code || geminiInfo.httpStatus || ''
        });
        await sendMessage(senderId, fallback);
        console.log(`🛟 Fallback do Gemini lỗi (${geminiInfo.status || geminiInfo.code || geminiInfo.httpStatus}): ${fallback.slice(0, 120).replace(/\n/g, ' ')}`);
        await trackFallbackAttention(senderId, userText, fallback);
      } catch {}
      return;
    }
    try {
      await sendMessage(senderId, render('systemBusy'));
    } catch {}
  }
}

// ========== HEALTH CHECK ==========
app.get('/', (_req, res) => res.send('🤖 Shop Bot đang chạy!'));
app.get('/healthz', (_req, res) => res.json({
  ok: true,
  shop: ACTIVE_SHOP_ID,
  products: products.length,
  uptime: Math.round(process.uptime())
}));

// ========== ADMIN EXPORT ==========
function requireAdminToken(req, res) {
  if (!ADMIN_EXPORT_TOKEN) {
    res.status(503).send('ADMIN_EXPORT_TOKEN chưa được cấu hình.');
    return false;
  }
  const token = req.query.token || req.get('x-admin-token');
  if (token !== ADMIN_EXPORT_TOKEN) {
    res.sendStatus(401);
    return false;
  }
  return true;
}

app.get('/admin/customers.csv', (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const file = storage.getCustomersFile();
  if (!fs.existsSync(file)) {
    return res.status(404).send('Chưa có file customers.csv.');
  }

  res.download(file, 'customers.csv');
});

app.get('/admin/events.jsonl', (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const file = storage.getEventsFile();
  if (!fs.existsSync(file)) {
    res.status(404).send('Chưa có events.jsonl');
    return;
  }
  res.download(file, 'events.jsonl');
});

// Debug: xem session/order draft hiện tại của 1 user. Hữu ích khi nhân viên cần tra soát.
app.get('/admin/state/:userId', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  const userId = req.params.userId;
  res.json({
    userId,
    inHandoff: storage.inHandoff(userId),
    lastUserAt: storage.getLastUserAt(userId),
    lastProductCode: storage.getLastProductCode(userId),
    orderDraft: storage.getOrderDraft(userId),
    sessionState: storage.getSessionState(userId),
    historyLength: storage.getHistory(userId).length
  });
});

// Kiểm tra Page Token lúc khởi động
async function checkPageToken() {
  try {
    await axios.get(
      `https://graph.facebook.com/v19.0/me/messenger_profile?fields=greeting&access_token=${FB_PAGE_TOKEN}`,
      { timeout: 5000 }
    );
    console.log('✅ Page Token có quyền pages_messaging — sẵn sàng gửi tin');
  } catch (err) {
    const e = err.response?.data?.error;
    console.warn(`⚠️  Page Token có vấn đề: ${e?.message || err.message}`);
    console.warn('   Bot vẫn chạy, nhưng có thể KHÔNG gửi được tin tới Messenger.');
  }
}

let server = null;

function shutdown(signal) {
  console.log(`🛑 Nhận ${signal}, đang dừng server...`);
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
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  buildDeterministicReply,
  buildFallbackReply,
  buildLeadDetails
};

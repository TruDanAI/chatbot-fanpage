const HOT_PRODUCTS_DEFAULTS = Object.freeze({
  enabled: false,
  trigger: 'keyword',
  maxItems: 3,
  cooldownMs: 60000,
  productCodes: []
});

const HOT_PRODUCTS_LIMITS = Object.freeze({
  maxItemsMin: 1,
  maxItemsMax: 5,
  cooldownMsMin: 10000,
  cooldownMsMax: 300000,
  productCodesMax: 20
});

const HOT_PRODUCTS_EMPTY_REPLY = 'Hiện shop chưa cấu hình sản phẩm nổi bật. Bạn có thể nhắn menu để xem danh sách.';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstSubmittedValue(value) {
  if (!Array.isArray(value)) return value;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const item = value[index];
    if (item != null && String(item).trim() !== '') return item;
  }
  return value[value.length - 1];
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeBoolean(value, fallback = false) {
  if (Array.isArray(value)) return value.some(item => normalizeBoolean(item, false));
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
}

function normalizeInteger(value, fallback, min, max) {
  const submitted = firstSubmittedValue(value);
  if (submitted == null || String(submitted).trim() === '') return fallback;
  const number = Number(submitted);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.floor(number);
  return Math.min(max, Math.max(min, integer));
}

function productCodeCandidates(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(productCodeCandidates);
  if (typeof value === 'object') return [];
  return String(value)
    .split(/[\r\n,]+/)
    .map(item => item.trim());
}

function normalizeHotProductCodes(value) {
  const seen = new Set();
  const codes = [];
  for (const code of productCodeCandidates(value)) {
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
    if (codes.length >= HOT_PRODUCTS_LIMITS.productCodesMax) break;
  }
  return codes;
}

function normalizeHotProductsTrigger(value) {
  const trigger = normalizeText(firstSubmittedValue(value), 80).toLowerCase();
  return trigger === 'keyword' ? 'keyword' : HOT_PRODUCTS_DEFAULTS.trigger;
}

function normalizeHotProductsConfig(value = {}) {
  const input = isPlainObject(value) ? value : {};
  return {
    enabled: normalizeBoolean(input.enabled, HOT_PRODUCTS_DEFAULTS.enabled),
    trigger: normalizeHotProductsTrigger(input.trigger),
    maxItems: normalizeInteger(
      input.maxItems,
      HOT_PRODUCTS_DEFAULTS.maxItems,
      HOT_PRODUCTS_LIMITS.maxItemsMin,
      HOT_PRODUCTS_LIMITS.maxItemsMax
    ),
    cooldownMs: normalizeInteger(
      input.cooldownMs,
      HOT_PRODUCTS_DEFAULTS.cooldownMs,
      HOT_PRODUCTS_LIMITS.cooldownMsMin,
      HOT_PRODUCTS_LIMITS.cooldownMsMax
    ),
    productCodes: normalizeHotProductCodes(input.productCodes)
  };
}

function foldVietnameseText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

function normalizeKeywordText(value = '', normalize = null) {
  const text = typeof normalize === 'function' ? normalize(value) : value;
  return foldVietnameseText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHotProductsKeyword(value = '', normalize = null) {
  const text = normalizeKeywordText(value, normalize);
  return /\b(?:hang\s+hot|san\s+pham\s+hot|san\s+pham\s+noi\s+bat|goi\s+y\s+san\s+pham)\b/.test(text);
}

function productCodeKey(code = '') {
  return String(code || '').trim().toUpperCase();
}

function isActiveProduct(product = {}) {
  if (!product || !product.code) return false;
  const status = String(product.status || '').trim().toLowerCase();
  if (status && status !== 'active') return false;
  if (product.hidden === true || product.archived === true) return false;
  return true;
}

function getHotProductsConfig(shopConfig = {}) {
  return normalizeHotProductsConfig(
    shopConfig.hotProducts
    || shopConfig.settings_json?.hotProducts
    || shopConfig.settingsJson?.hotProducts
    || {}
  );
}

function resolveHotProducts({ shopConfig = {}, products = [] } = {}) {
  const hotProducts = getHotProductsConfig(shopConfig);
  if (hotProducts.enabled !== true || hotProducts.trigger !== 'keyword') {
    return { enabled: false, config: hotProducts, products: [] };
  }

  const byCode = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    if (!isActiveProduct(product)) continue;
    const key = productCodeKey(product.code);
    if (key && !byCode.has(key)) byCode.set(key, product);
  }

  const selected = [];
  const selectedKeys = new Set();
  for (const code of hotProducts.productCodes) {
    const key = productCodeKey(code);
    if (!key || selectedKeys.has(key)) continue;
    const product = byCode.get(key);
    if (!product) continue;
    selected.push(product);
    selectedKeys.add(key);
    if (selected.length >= hotProducts.maxItems) break;
  }

  return { enabled: true, config: hotProducts, products: selected };
}

function formatHotProductLine(product = {}) {
  const parts = [
    String(product.code || '').trim(),
    String(product.name || product.title || '').trim(),
    String(product.price || '').trim()
  ].filter(Boolean);
  return `- ${parts.join(' - ')}`;
}

function buildHotProductsReply(products = []) {
  const lines = (Array.isArray(products) ? products : [])
    .map(formatHotProductLine)
    .filter(line => line !== '- ');
  if (!lines.length) return HOT_PRODUCTS_EMPTY_REPLY;

  return [
    '🔥 Hàng hot hôm nay',
    ...lines,
    'Nhắn mã sản phẩm, ví dụ MÃ10, để xem chi tiết.'
  ].join('\n');
}

module.exports = {
  HOT_PRODUCTS_DEFAULTS,
  HOT_PRODUCTS_EMPTY_REPLY,
  HOT_PRODUCTS_LIMITS,
  buildHotProductsReply,
  getHotProductsConfig,
  isHotProductsKeyword,
  normalizeHotProductCodes,
  normalizeHotProductsConfig,
  resolveHotProducts
};

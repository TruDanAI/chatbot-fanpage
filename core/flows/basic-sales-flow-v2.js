const {
  buildHotProductsReply,
  isHotProductsKeyword,
  resolveHotProducts
} = require('../hot-products');
const { createProductDetailResponseHelper } = require('../modes/product-detail-response');
const { getMenuCodeHandoffMessage } = require('../modes/menu-code-handoff');
const { uniqueImagesForRequest } = require('../runtime-image-dedupe');
const { pageRef, shopRef } = require('../utils/log-refs');

const BASIC_SALES_V2_MENU_REPLY = [
  'Dạ shop gửi mình danh sách sản phẩm ạ.',
  'Mình nhắn mã sản phẩm để em gửi chi tiết nhé.'
].join('\n');

function getBasicSalesV2Options(config = {}) {
  const settingsJson = config.settings_json || config.settingsJson || {};
  const options = config.basicSalesV2 || settingsJson.basicSalesV2 || settingsJson.basic_sales_v2 || {};
  return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

function getBasicSalesV2MenuReply(config = {}) {
  const options = getBasicSalesV2Options(config);
  return String(
    options.menuReply
    || options.menuFallbackReply
    || config.botMode?.menuIntroText
    || config.menuIntroText
    || BASIC_SALES_V2_MENU_REPLY
  ).trim() || BASIC_SALES_V2_MENU_REPLY;
}

function safeLogToken(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 120) || 'unknown';
}

function getShopIdForLogs(shopConfig = {}) {
  return String(
    shopConfig?.__dbShop?.shopId
    || shopConfig?.shopId
    || shopConfig?.shop_id
    || shopConfig?.shopName
    || ''
  ).trim();
}

function hotProductsCooldownKey({ pageId, senderId, shopId }) {
  return JSON.stringify([
    String(pageId || ''),
    String(senderId || ''),
    String(shopId || '')
  ]);
}

function createBasicSalesFlowV2Handler({
  storage,
  shopConfig,
  products = [],
  handoffMs,
  productCodeLookupEnabled,
  menuSendingEnabled = true,
  postProductHandoffEnabled = true,
  buildDeterministicReply,
  extractRequestedProductCodes = () => [],
  normalizeText,
  sendMessage,
  sendImage,
  showTyping,
  isGreetingText,
  buildRequestedImageUrls,
  shouldSkipRecentHotProductsSend,
  clearRecentHotProductsSend
}) {
  const localHotProductsCooldown = new Map();

  function markLastUserAt(senderId) {
    if (typeof storage.setLastUserAt === 'function') {
      storage.setLastUserAt(senderId);
    }
  }

  function normalizeForMenu(value = '') {
    const normalize = typeof normalizeText === 'function'
      ? normalizeText
      : text => String(text || '').toLowerCase();
    return normalize(value).replace(/\s+/g, ' ').trim();
  }

  function isMenuRequest(userText) {
    const t = normalizeForMenu(userText);
    if (!t) return false;
    if (typeof isGreetingText === 'function' && isGreetingText(userText)) return true;
    return /^(?:xin |cho |gui |xem |coi |tham khao )?(?:menu|bang gia|danh sach|danh muc|catalog)(?: san pham)?(?: shop)?$/.test(t)
      || /^(?:xem|coi|gui|cho xem|xin xem|co)\s+(?:san pham|sp|mau|hang)(?: nao| gi| ben shop| shop)?$/.test(t)
      || /^(?:gia|gia san pham|bao nhieu|co mau nao|co san pham nao|co hang nao)$/.test(t);
  }

  function pruneLocalHotProductsCooldown(nowMs = Date.now()) {
    for (const [key, expiresAt] of localHotProductsCooldown) {
      if (expiresAt > nowMs) continue;
      localHotProductsCooldown.delete(key);
    }
  }

  function shouldSkipLocalHotProductsSend({ pageId, senderId, shopId, cooldownMs }) {
    if (!senderId || !cooldownMs) return false;

    const nowMs = Date.now();
    pruneLocalHotProductsCooldown(nowMs);
    const key = hotProductsCooldownKey({ pageId, senderId, shopId });
    const expiresAt = localHotProductsCooldown.get(key);
    if (expiresAt && expiresAt > nowMs) {
      console.log(
        `[hot_products] skipped cooldown page_ref=${pageRef(pageId)} sender_ref=${pageRef(senderId)} shop_ref=${shopRef(shopId)}`
      );
      return true;
    }

    localHotProductsCooldown.set(key, nowMs + cooldownMs);
    return false;
  }

  function clearLocalHotProductsSend({ pageId, senderId, shopId }) {
    localHotProductsCooldown.delete(hotProductsCooldownKey({ pageId, senderId, shopId }));
  }

  async function sendImages(senderId, images, sentImages, options = {}) {
    for (const { file, url } of uniqueImagesForRequest(senderId, images, sentImages)) {
      const imageRef = pageRef(file || url);
      try {
        await sendImage(senderId, url);
        const phase = safeLogToken(options.phase || 'image');
        console.log(
          `[${phase}] image sent image_ref=${imageRef} page_ref=${pageRef(options.pageId)} sender_ref=${pageRef(senderId)}`
        );
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        console.error(`❌ Gửi ảnh fail image_ref=${imageRef}: ${msg}`);
      }
    }
  }

  function getHotProductImageUrls(product, senderId, baseUrlOverride) {
    if (!product?.code || typeof buildRequestedImageUrls !== 'function') return [];
    const images = buildRequestedImageUrls(product.code, senderId, baseUrlOverride);
    return Array.isArray(images) ? images.filter(image => image?.url).slice(0, 1) : [];
  }

  async function sendHotProducts(senderId, baseUrlOverride, options = {}) {
    const resolved = resolveHotProducts({ shopConfig, products });
    if (!resolved.enabled) return false;

    const shopId = getShopIdForLogs(shopConfig);
    const cooldownArgs = {
      pageId: options.pageId,
      senderId,
      shopId,
      cooldownMs: resolved.config.cooldownMs
    };
    const shouldSkipHotProducts = typeof shouldSkipRecentHotProductsSend === 'function'
      ? shouldSkipRecentHotProductsSend
      : shouldSkipLocalHotProductsSend;
    if (shouldSkipHotProducts(cooldownArgs)) return true;

    const clearHotProductsSend = typeof clearRecentHotProductsSend === 'function'
      ? clearRecentHotProductsSend
      : clearLocalHotProductsSend;

    try {
      showTyping(senderId);
      await sendMessage(senderId, buildHotProductsReply(resolved.products));
      console.log(
        `[basic_sales_v2] hot_products text sent count=${resolved.products.length} page_ref=${pageRef(options.pageId)} sender_ref=${pageRef(senderId)} shop_ref=${shopRef(shopId)}`
      );
    } catch (err) {
      clearHotProductsSend(cooldownArgs);
      throw err;
    }

    const images = [];
    for (const product of resolved.products) {
      images.push(...getHotProductImageUrls(product, senderId, baseUrlOverride));
    }
    await sendImages(senderId, images, options.requestImageDedupe || new Set(), {
      pageId: options.pageId,
      phase: 'hot_products'
    });
    return true;
  }

  async function sendMenuFallback(senderId) {
    if (!menuSendingEnabled) return false;
    showTyping(senderId);
    await sendMessage(senderId, getBasicSalesV2MenuReply(shopConfig));
    return true;
  }

  const productDetailResponse = createProductDetailResponseHelper({
    storage,
    handoffMs,
    productCodeLookupEnabled,
    postProductHandoffEnabled,
    buildDeterministicReply,
    extractRequestedProductCodes,
    buildRequestedImageUrls,
    sendMessage,
    sendImages,
    showTyping,
    getHandoffMessage: () => getMenuCodeHandoffMessage(shopConfig),
    markLastUserAt
  });

  async function handleEvent(senderId, userText, baseUrlOverride, options = {}) {
    const sentImages = options.requestImageDedupe || new Set();

    if (storage.inHandoff(senderId)) {
      console.log(`⏸️  Bỏ qua tin (handoff): sender_ref=${pageRef(senderId)}`);
      markLastUserAt(senderId);
      return true;
    }

    if (await productDetailResponse.handleProductCodeRequest(senderId, userText, baseUrlOverride, {
      pageId: options.pageId,
      requestImageDedupe: sentImages
    })) return true;

    if (isHotProductsKeyword(userText, normalizeText)) {
      const sent = await sendHotProducts(senderId, baseUrlOverride, {
        ...options,
        requestImageDedupe: sentImages
      });
      if (sent) {
        markLastUserAt(senderId);
        return true;
      }
    }

    if (isMenuRequest(userText)) {
      const sent = await sendMenuFallback(senderId);
      if (sent) {
        markLastUserAt(senderId);
        return true;
      }
    }

    markLastUserAt(senderId);
    return false;
  }

  return {
    handleEvent,
    isMenuRequest
  };
}

module.exports = {
  BASIC_SALES_V2_MENU_REPLY,
  createBasicSalesFlowV2Handler,
  getBasicSalesV2MenuReply
};

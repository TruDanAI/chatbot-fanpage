const MENU_CODE_HANDOFF_MESSAGE = [
  'E gửi anh xem qua sp, anh ưng mã nào em tư vấn ạ',
  'Bên em nhận hàng thanh toán, che tên sản phẩm trước khi gửi đi.',
  'Freeship + tặng gel',
  'Có kèm mã vận đơn để anh theo dõi hành trình của đơn hàng anh nhé. Bên em giao bằng đơn vị Giao Hàng Tiết Kiệm.'
].join('\n');

const MENU_CODE_MENU_PRICE_REPLY = 'Dạ sản phẩm bên em từ 150k tuỳ mã ạ. Em gửi mình xem qua menu, ưng mã nào nhắn em tư vấn kỹ hơn nhé.';
const { uniqueImagesForRequest } = require('../runtime-image-dedupe');
const {
  buildHotProductsReply,
  isHotProductsKeyword,
  resolveHotProducts
} = require('../hot-products');
const { createProductDetailResponseHelper } = require('./product-detail-response');
const { pageRef, shopRef } = require('../utils/log-refs');

// Khách quay lại sau ngần này mới được tự động chào lại bằng menu+cap.
const MENU_CODE_REENGAGE_MS = 30 * 24 * 60 * 60 * 1000;
// Các nguồn referral của Messenger được coi là "khách từ quảng cáo / link campaign".
const MENU_CODE_ADS_REFERRAL_SOURCES = new Set(['ADS', 'SHORTLINK']);
const MENU_CODE_REFERRAL_ONLY_AUTO_MENU_SOURCES = new Set(['ADS']);

function getMenuCodeHandoffMessage(config = {}) {
  const mode = config.botMode || {};
  const options = typeof mode === 'object' && mode ? mode : {};
  return String(options.handoffMessage || config.menuCodeHandoffMessage || MENU_CODE_HANDOFF_MESSAGE);
}

function createMenuCodeHandoffHandler({
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
  getMenuImageUrls,
  buildRequestedImageUrls,
  shouldSkipRecentMenuSend = () => false,
  clearRecentMenuSend = () => {},
  shouldSkipRecentHotProductsSend,
  clearRecentHotProductsSend
}) {
  const localHotProductsCooldown = new Map();

  function isMenuQuestion(userText) {
    const t = normalizeText(userText).replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (isGreetingText(userText)) return true;

    if (/^(?:yo|hey|helo|helu|hej|hola)\b/.test(t)) return true;
    if (/^(?:chao|hi|hello|alo|shop|em|chi|anh)\s+(?:ad|admin|mn|moi nguoi|cac ban|ban|page)\b/.test(t)) return true;
    if (/\bad(?:min)?\s*oi\b/.test(t)) return true;

    return /^(?:xin |cho |gui |xem |coi |tham khao )?(?:menu|bang gia|danh sach|danh muc|catalog)(?: san pham)?(?: shop)?$/.test(t)
      || /^(?:xem|coi|gui|cho xem|xin xem|co)\s+(?:san pham|sp|mau|hang)(?: nao| gi| ben shop| shop)?$/.test(t)
      || /^(?:gia|gia san pham|gia san pham tu bao nhieu|bao nhieu(?: vay)?|co mau nao|co san pham nao|co hang nao)$/.test(t)
      || /\bgia\b.*\b(?:san pham|bao nhieu|tu bao nhieu|the nao|ntn|ra sao|nhu nao)\b/.test(t)
      || /\b(?:san pham|mau|hang)\b.*\b(?:bao nhieu|nao|gi)\b/.test(t)
      || /^bao nhieu(?:\s+(?:tien|ay|a|vay|nhi|ne|z|day|ha|hi|shop|shop oi|tien vay|tien a|tien nhi|tien ne|tien z))?$/.test(t)
      || /^(?:bn|bnhieu|bnh|bnhiu)(?:\s+(?:tien|vay|ay|nhi|shop|shop oi))?$/.test(t)
      || /^gia\s*(?:the nao|sao|ntn|ra sao|nhu nao|nhu the nao)$/.test(t);
  }

  function hasReferralSource(event, sources) {
    if (!event) return false;
    const refs = [event.referral, event.message?.referral, event.postback?.referral];
    for (const ref of refs) {
      if (!ref) continue;
      const source = String(ref.source || '').toUpperCase();
      if (sources.has(source)) return true;
    }
    return false;
  }

  function isAdsReferralEvent(event) {
    return hasReferralSource(event, MENU_CODE_ADS_REFERRAL_SOURCES);
  }

  function isReferralOnlyAutoMenuEvent(event) {
    return hasReferralSource(event, MENU_CODE_REFERRAL_ONLY_AUTO_MENU_SOURCES);
  }

  function isFirstTouchOrLapsedCustomer(senderId) {
    if (typeof storage.getLastUserAt !== 'function') return true;
    const lastUserAt = storage.getLastUserAt(senderId);
    if (!lastUserAt) return true;
    const ts = Date.parse(lastUserAt);
    if (!Number.isFinite(ts)) return true;
    return (Date.now() - ts) > MENU_CODE_REENGAGE_MS;
  }

  function markLastUserAt(senderId) {
    if (typeof storage.setLastUserAt === 'function') {
      storage.setLastUserAt(senderId);
    }
  }

  function safeLogToken(value) {
    return String(value || 'unknown')
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 120) || 'unknown';
  }

  function getShopIdForLogs() {
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

  async function sendMenu(senderId, baseUrlOverride, options = {}) {
    const cooldownKey = { pageId: options.pageId, senderId };
    if (shouldSkipRecentMenuSend(cooldownKey)) {
      return false;
    }

    const sentImages = options.requestImageDedupe || new Set();
    try {
      showTyping(senderId);
      await sendMessage(senderId, MENU_CODE_MENU_PRICE_REPLY);
    } catch (err) {
      clearRecentMenuSend(cooldownKey);
      throw err;
    }
    console.log(`[menu] text sent page_ref=${pageRef(options.pageId)} sender_ref=${pageRef(senderId)}`);
    await sendImages(senderId, getMenuImageUrls(baseUrlOverride), sentImages, {
      pageId: options.pageId,
      phase: 'menu'
    });
    return true;
  }

  function getHotProductImageUrls(product, senderId, baseUrlOverride) {
    if (!product?.code || typeof buildRequestedImageUrls !== 'function') return [];
    const images = buildRequestedImageUrls(product.code, senderId, baseUrlOverride);
    return Array.isArray(images) ? images.filter(image => image?.url).slice(0, 1) : [];
  }

  async function sendHotProducts(senderId, baseUrlOverride, options = {}) {
    const resolved = resolveHotProducts({ shopConfig, products });
    if (!resolved.enabled) return false;

    const shopId = getShopIdForLogs();
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
        `[hot_products] text sent count=${resolved.products.length} page_ref=${pageRef(options.pageId)} sender_ref=${pageRef(senderId)} shop_ref=${shopRef(shopId)}`
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

  async function handleReferralOnly(senderId, baseUrlOverride, options = {}) {
    if (storage.inHandoff(senderId)) {
      return true;
    }

    if (!menuSendingEnabled) return false;

    const sent = await sendMenu(senderId, baseUrlOverride, options);
    if (sent) markLastUserAt(senderId);
    return true;
  }

  async function handleEvent(senderId, userText, baseUrlOverride, options = {}) {
    const adsReferral = options.adsReferral === true;
    const sentImages = options.requestImageDedupe || new Set();
    // Chụp trước flag first-touch để lát sau dù markLastUserAt cập nhật
    // timestamp thì quyết định vẫn dựa trên trạng thái lúc tin vừa tới.
    const firstTouch = isFirstTouchOrLapsedCustomer(senderId);

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

    if (menuSendingEnabled && (adsReferral || firstTouch || isMenuQuestion(userText))) {
      await sendMenu(senderId, baseUrlOverride, {
        ...options,
        requestImageDedupe: sentImages
      });
      markLastUserAt(senderId);
      return true;
    }

    markLastUserAt(senderId);
    return false;
  }

  return {
    handleReferralOnly,
    handleEvent,
    isAdsReferralEvent,
    isReferralOnlyAutoMenuEvent,
    isMenuQuestion
  };
}

module.exports = {
  MENU_CODE_HANDOFF_MESSAGE,
  MENU_CODE_MENU_PRICE_REPLY,
  createMenuCodeHandoffHandler,
  getMenuCodeHandoffMessage
};

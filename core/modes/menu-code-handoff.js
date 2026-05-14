const MENU_CODE_HANDOFF_MESSAGE = [
  'E gửi anh xem qua sp, anh ưng mã nào em tư vấn ạ',
  'Bên em nhận hàng thanh toán, che tên sản phẩm trước khi gửi đi.',
  'Freeship + tặng gel',
  'Có kèm mã vận đơn để anh theo dõi hành trình của đơn hàng anh nhé. Bên em giao bằng đơn vị Giao Hàng Tiết Kiệm.'
].join('\n');

const MENU_CODE_MENU_PRICE_REPLY = 'Dạ sản phẩm bên em từ 150k tuỳ mã ạ. Em gửi mình xem qua menu, ưng mã nào nhắn em tư vấn kỹ hơn nhé.';

// Khách quay lại sau ngần này mới được tự động chào lại bằng menu+cap.
const MENU_CODE_REENGAGE_MS = 30 * 24 * 60 * 60 * 1000;
// Các nguồn referral của Messenger được coi là "khách từ quảng cáo / link campaign".
const MENU_CODE_ADS_REFERRAL_SOURCES = new Set(['ADS', 'SHORTLINK']);

function getMenuCodeHandoffMessage(config = {}) {
  const mode = config.botMode || {};
  const options = typeof mode === 'object' && mode ? mode : {};
  return String(options.handoffMessage || config.menuCodeHandoffMessage || MENU_CODE_HANDOFF_MESSAGE);
}

function createMenuCodeHandoffHandler({
  storage,
  shopConfig,
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
  redactSensitiveText
}) {
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

  function isAdsReferralEvent(event) {
    if (!event) return false;
    const refs = [event.referral, event.message?.referral, event.postback?.referral];
    for (const ref of refs) {
      if (!ref) continue;
      const source = String(ref.source || '').toUpperCase();
      if (MENU_CODE_ADS_REFERRAL_SOURCES.has(source)) return true;
    }
    return false;
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

  async function sendImages(senderId, images) {
    for (const { file, url } of images) {
      try {
        await sendImage(senderId, url);
        console.log(`🖼️  Gửi ảnh: ${file}`);
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        console.error(`❌ Gửi ảnh ${file} fail: ${msg}`);
      }
    }
  }

  function getSuccessfulRequestedProductCodes(userText, senderId) {
    if (!productCodeLookupEnabled) return [];
    const requestedCodes = extractRequestedProductCodes(userText)
      .map(code => String(code || '').trim().toUpperCase())
      .filter(Boolean);
    if (!requestedCodes.length) return [];

    const lastCode = String(storage.getLastProductCode(senderId) || '').trim().toUpperCase();
    if (!lastCode) return [];
    return requestedCodes.filter(code => code === lastCode);
  }

  function buildProductImageLookupText(code) {
    const number = String(code || '').match(/\d+/)?.[0];
    return number ? `ma ${number}` : String(code || '');
  }

  async function handleEvent(senderId, userText, baseUrlOverride, options = {}) {
    const adsReferral = options.adsReferral === true;
    // Chụp trước flag first-touch để lát sau dù markLastUserAt cập nhật
    // timestamp thì quyết định vẫn dựa trên trạng thái lúc tin vừa tới.
    const firstTouch = isFirstTouchOrLapsedCustomer(senderId);

    if (storage.inHandoff(senderId)) {
      console.log(`⏸️  Bỏ qua tin (handoff): ${senderId}`);
      markLastUserAt(senderId);
      return;
    }

    const requestedCodes = productCodeLookupEnabled
      ? extractRequestedProductCodes(userText)
      : [];

    if (requestedCodes.length) {
      const reply = buildDeterministicReply(userText, senderId);
      const codes = getSuccessfulRequestedProductCodes(userText, senderId);
      if (reply && codes.length) {
        showTyping(senderId);
        await sendImages(
          senderId,
          buildRequestedImageUrls(buildProductImageLookupText(codes[0]), senderId, baseUrlOverride)
        );
        await sendMessage(senderId, reply);
        if (postProductHandoffEnabled) {
          await sendMessage(senderId, getMenuCodeHandoffMessage(shopConfig));
          storage.setHandoff(senderId, Date.now() + handoffMs);
          console.log(`⏸️  Bật handoff sau khi gửi mã sản phẩm (${codes[0]}): ${senderId}`);
        }
        markLastUserAt(senderId);
        return;
      }
    }

    if (menuSendingEnabled && (adsReferral || firstTouch || isMenuQuestion(userText))) {
      showTyping(senderId);
      await sendMessage(senderId, MENU_CODE_MENU_PRICE_REPLY);
      console.log(`🤖 reply: ${redactSensitiveText(MENU_CODE_MENU_PRICE_REPLY).slice(0, 120).replace(/\n/g, ' ')}`);
      await sendImages(senderId, getMenuImageUrls(baseUrlOverride));
      markLastUserAt(senderId);
      return;
    }

    markLastUserAt(senderId);
  }

  return {
    handleEvent,
    isAdsReferralEvent,
    isMenuQuestion
  };
}

module.exports = {
  MENU_CODE_HANDOFF_MESSAGE,
  MENU_CODE_MENU_PRICE_REPLY,
  createMenuCodeHandoffHandler,
  getMenuCodeHandoffMessage
};

const { pageRef } = require('../utils/log-refs');

function createProductDetailResponseHelper({
  storage,
  handoffMs,
  productCodeLookupEnabled,
  postProductHandoffEnabled = true,
  buildDeterministicReply,
  extractRequestedProductCodes = () => [],
  buildRequestedImageUrls,
  sendMessage,
  sendImages,
  showTyping,
  getHandoffMessage,
  markLastUserAt = () => {}
}) {
  function getRequestedCodes(userText) {
    return productCodeLookupEnabled
      ? extractRequestedProductCodes(userText)
      : [];
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

  function foldProductCode(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toUpperCase();
  }

  function buildNumericProductImageFallbackText(code) {
    const compact = foldProductCode(code).replace(/\s+/g, '');
    const match = compact.match(/^(?:MA|M)0*(\d{1,4})$/) || compact.match(/^0*(\d{1,4})$/);
    if (!match) return '';
    const number = Number(match[1]);
    return Number.isFinite(number) && number > 0 ? `ma ${number}` : '';
  }

  function buildProductImageLookupTexts(code) {
    const exact = String(code || '').trim();
    const fallback = buildNumericProductImageFallbackText(exact);
    return [exact, fallback]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
  }

  function buildProductImageUrls(code, senderId, baseUrlOverride) {
    if (typeof buildRequestedImageUrls !== 'function') return [];
    for (const lookupText of buildProductImageLookupTexts(code)) {
      const images = buildRequestedImageUrls(lookupText, senderId, baseUrlOverride);
      if (Array.isArray(images) && images.length) return images;
    }
    return [];
  }

  async function handleProductCodeRequest(senderId, userText, baseUrlOverride, options = {}) {
    const requestedCodes = getRequestedCodes(userText);
    if (!requestedCodes.length) return false;

    const reply = buildDeterministicReply(userText, senderId);
    const codes = getSuccessfulRequestedProductCodes(userText, senderId);
    if (!reply || !codes.length) return false;

    showTyping(senderId);
    await sendImages(
      senderId,
      buildProductImageUrls(codes[0], senderId, baseUrlOverride),
      options.requestImageDedupe || new Set(),
      { pageId: options.pageId, phase: 'product' }
    );
    await sendMessage(senderId, reply);
    if (postProductHandoffEnabled) {
      await sendMessage(senderId, getHandoffMessage());
      storage.setHandoff(senderId, Date.now() + handoffMs);
      console.log(`⏸️  Bật handoff sau khi gửi mã sản phẩm (${codes[0]}): sender_ref=${pageRef(senderId)}`);
    }
    markLastUserAt(senderId);
    return true;
  }

  return {
    handleProductCodeRequest
  };
}

module.exports = {
  createProductDetailResponseHelper
};

const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createAiClient({
  storage,
  products,
  shopConfig,
  deriveSessionState,
  normalizeText,
  render,
  truncateText,
  config
}) {
  const {
    geminiApiKey,
    geminiProvider,
    geminiModel,
    geminiTemperature,
    geminiMaxOutputTokens,
    googleCloudProject,
    googleCloudLocation,
    geminiHistoryLimit
  } = config;

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

  const systemPrompt = buildSystemPrompt();

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
      project: googleCloudProject,
      location: googleCloudLocation,
      googleAuthOptions: credentials ? { credentials } : undefined,
      httpOptions: { timeout: 20000 }
    });
    return vertexGeminiClient;
  }

  async function generateGeminiViaVertex(history) {
    return getVertexGeminiClient().models.generateContent({
      model: geminiModel,
      contents: history,
      config: {
        systemInstruction: systemPrompt,
        temperature: geminiTemperature,
        maxOutputTokens: geminiMaxOutputTokens
      }
    });
  }

  async function generateGeminiViaApiKey(history) {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
      {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: history,
        generationConfig: { temperature: geminiTemperature, maxOutputTokens: geminiMaxOutputTokens }
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
        return geminiProvider === 'api_key'
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

  function trimGeminiHistory(history) {
    const items = Array.isArray(history) ? history : [];
    return items.slice(-geminiHistoryLimit);
  }

  function addGeminiHistoryMessage(history, role, text) {
    const content = String(text || '').trim();
    if (!content) return history;
    history.push({
      role,
      parts: [{ text: truncateText(content, 1200) }]
    });
    return trimGeminiHistory(history);
  }

  function recordConversationTurn(userId, userText, botReply) {
    if (!userId) return;
    let history = storage.getHistory(userId);
    history = addGeminiHistoryMessage(history, 'user', userText);
    history = addGeminiHistoryMessage(history, 'model', botReply);
    storage.setHistory(userId, history);
  }

  function productSummary(product) {
    if (!product) return '';
    return [
      `${product.code} giá ${product.price}`,
      product.description || '',
      product.size ? `size ${product.size}` : '',
      product.weight ? `nặng ${product.weight}` : '',
      product.gift ? `tặng ${product.gift}` : '',
      product.preorder ? `hàng đặt ${shopConfig.policies?.preorderDays || ''}`.trim() : ''
    ].filter(Boolean).join(', ');
  }

  function formatGeminiCartItems(draft = {}) {
    const items = Array.isArray(draft.cartItems) ? draft.cartItems : [];
    if (!items.length && draft.productCode) return draft.productCode;
    return items
      .map(item => {
        const code = String(item.code || item.name || '').trim();
        const qty = Number(item.qty || 1) || 1;
        const variant = String(item.variant || '').trim();
        const display = String(item.display || '').trim();
        return display || `${qty} x ${code}${variant ? ` ${variant}` : ''}`;
      })
      .filter(Boolean)
      .join(', ');
  }

  const ORDER_FIELD_LABELS = {
    name: 'tên người nhận',
    phone: 'SĐT',
    address: 'địa chỉ giao hàng'
  };

  function getMissingOrderFieldLabels(draft = {}) {
    return ['name', 'phone', 'address']
      .filter(field => !String(draft[field] || '').trim())
      .map(field => ORDER_FIELD_LABELS[field]);
  }

  function buildAbandonedCartReminderText(draft = {}) {
    const missing = getMissingOrderFieldLabels(draft);
    if (!missing.length) return '';

    return render('abandonedCartReminder', {
      cartText: formatGeminiCartItems(draft) || 'mẫu mình đã chọn',
      missing: missing.join(' + ')
    });
  }

  function buildGeminiRuntimeContext(userId) {
    const draft = storage.getOrderDraft(userId);
    const lastCode = storage.getLastProductCode(userId) || draft.productCode || '';
    const lastProduct = products.find(p => String(p.code || '').toUpperCase() === String(lastCode || '').toUpperCase());
    const sessionState = deriveSessionState(userId, draft);
    const cartText = formatGeminiCartItems(draft);
    const leadFields = [
      draft.name ? `tên: ${draft.name}` : '',
      draft.phone ? `SĐT: ${draft.phone}` : '',
      draft.address ? `địa chỉ: ${draft.address}` : ''
    ].filter(Boolean).join(', ');

    const lines = [
      'Tóm tắt hội thoại để hiểu ngữ cảnh, không nhắc lại phần này với khách:',
      `- Trạng thái: ${sessionState || 'IDLE'}`,
      lastProduct ? `- Mã khách vừa xem/quan tâm: ${productSummary(lastProduct)}` : '',
      cartText ? `- Đơn/giỏ nháp: ${cartText}` : '',
      leadFields ? `- Thông tin khách đã gửi: ${leadFields}` : '',
      '- Nếu khách muốn chốt, đổi, hủy, gửi thông tin giao hàng hoặc hỏi giá/mã cụ thể mà rule chưa xử lý, trả lời ngắn và hướng khách gửi đủ tên + SĐT + địa chỉ; không tự nói đã lên đơn.'
    ].filter(Boolean);

    return lines.length > 2 ? lines.join('\n') : '';
  }

  function buildGeminiRequestHistory(userId, userMessage) {
    const storedHistory = trimGeminiHistory(storage.getHistory(userId)).slice(-(geminiHistoryLimit - 1));
    const context = buildGeminiRuntimeContext(userId);
    const currentText = context
      ? `${context}\n\nTin nhắn khách cần trả lời:\n${userMessage}`
      : String(userMessage || '');

    return addGeminiHistoryMessage([...storedHistory], 'user', currentText);
  }

  async function callGemini(userId, userMessage) {
    const history = buildGeminiRequestHistory(userId, userMessage);
    const res = await generateGeminiWithRetry(history);

    const raw = extractGeminiText(res)
      || 'Xin lỗi anh/chị, em chưa hiểu ý. Anh/chị có thể nói rõ hơn không ạ? 😊';
    const botReply = sanitizeGeminiReply(raw) || raw;

    return botReply;
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

  return {
    buildAbandonedCartReminderText,
    buildGeminiRequestHistory,
    buildGeminiRuntimeContext,
    callGemini,
    getGeminiErrorInfo,
    isProbablyIncompleteReply,
    recordConversationTurn,
    shouldUseFallbackReply
  };
}

module.exports = {
  createAiClient
};

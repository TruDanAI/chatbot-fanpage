const crypto = require('crypto');
const {
  MENU_CODE_MENU_PRICE_REPLY,
  getMenuCodeHandoffMessage,
  isAiFallbackEnabled,
  isLeadCaptureEnabled,
  isMenuCodeHandoffMode,
  isOrderFlowEnabled,
  isProductCodeLookupEnabled
} = require('./bot-mode');

function createWebhook({
  storage,
  shopConfig,
  fbVerifyToken,
  fbAppSecret,
  webhookRateLimiter,
  handoffMs,
  useGemini,
  botMessageMetadata,
  resolveQuickReplyPayload,
  buildQuickReplies,
  buildDeterministicReply,
  buildFallbackReply,
  buildLeadDetails,
  buildConfirmedSheetLead,
  extractRequestedProductCodes = () => [],
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
}) {
  function verifySignature(req) {
    if (!fbAppSecret) return true;
    const sig = req.get('X-Hub-Signature-256');
    if (!sig || !sig.startsWith('sha256=') || !req.rawBody) return false;

    const expected = 'sha256=' + crypto
      .createHmac('sha256', fbAppSecret)
      .update(req.rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  function isBotEcho(event) {
    const message = event.message || {};
    // Human replies from Meta Inbox can also include app_id, so only trust
    // the metadata we attach to messages sent by this bot.
    return message.metadata === botMessageMetadata;
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

  function wantsUrgentHumanAttention(text) {
    const t = normalizeText(text);
    return /(?:khong\s*hieu|tra\s*loi\s*gi|noi\s*gi|bot|tu\s*van\s*te|hoi\s*mai|lau\s*the|buc\s*minh|kho\s*chiu|lua\s*dao|chan\s*the|mat\s*thoi\s*gian)/.test(t);
  }

  const effectiveUseGemini = useGemini && isAiFallbackEnabled(shopConfig);
  const leadCaptureEnabled = isLeadCaptureEnabled(shopConfig);
  const orderFlowEnabled = isOrderFlowEnabled(shopConfig);
  const productCodeLookupEnabled = isProductCodeLookupEnabled(shopConfig);
  const menuCodeHandoffMode = isMenuCodeHandoffMode(shopConfig);

  // Khách quay lại sau ngần này mới được tự động chào lại bằng menu+cap.
  const MENU_CODE_REENGAGE_MS = 30 * 24 * 60 * 60 * 1000;
  // Các nguồn referral của Messenger được coi là "khách từ quảng cáo / link campaign".
  const MENU_CODE_ADS_REFERRAL_SOURCES = new Set(['ADS', 'SHORTLINK']);

  function isMenuCodeMenuQuestion(userText) {
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

  function isMenuCodeAdsReferral(event) {
    if (!menuCodeHandoffMode || !event) return false;
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

  function markMenuCodeLastUserAt(senderId) {
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
    if (!menuCodeHandoffMode || !productCodeLookupEnabled) return [];
    const requestedCodes = extractRequestedProductCodes(userText)
      .map(code => String(code || '').trim().toUpperCase())
      .filter(Boolean);
    if (!requestedCodes.length) return [];

    const lastCode = String(storage.getLastProductCode(senderId) || '').trim().toUpperCase();
    if (!lastCode) return [];
    return requestedCodes.filter(code => code === lastCode);
  }

  async function handoffAfterProductCode(senderId, userText) {
    const codes = getSuccessfulRequestedProductCodes(userText, senderId);
    if (!codes.length) return false;

    const message = getMenuCodeHandoffMessage(shopConfig);
    await sendMessage(senderId, message);
    storage.setHandoff(senderId, Date.now() + handoffMs);
    trackEvent(senderId, 'handoff_started', userText, {
      reason: 'menu_code_handoff',
      productCode: codes[0]
    });
    console.log(`⏸️  Bật handoff sau khi gửi mã sản phẩm (${codes[0]}): ${senderId}`);
    return true;
  }

  function buildProductImageLookupText(code) {
    const number = String(code || '').match(/\d+/)?.[0];
    return number ? `ma ${number}` : String(code || '');
  }

  async function handleMenuCodeHandoffEvent(senderId, userText, baseUrlOverride, options = {}) {
    const adsReferral = options.adsReferral === true;
    // Chụp trước flag first-touch để lát sau dù markMenuCodeLastUserAt cập nhật
    // timestamp thì quyết định vẫn dựa trên trạng thái lúc tin vừa tới.
    const firstTouch = isFirstTouchOrLapsedCustomer(senderId);

    if (storage.inHandoff(senderId)) {
      console.log(`⏸️  Bỏ qua tin (handoff): ${senderId}`);
      markMenuCodeLastUserAt(senderId);
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
        const message = getMenuCodeHandoffMessage(shopConfig);
        await sendMessage(senderId, message);
        storage.setHandoff(senderId, Date.now() + handoffMs);
        console.log(`⏸️  Bật handoff sau khi gửi mã sản phẩm (${codes[0]}): ${senderId}`);
        markMenuCodeLastUserAt(senderId);
        return;
      }
    }

    if (adsReferral || firstTouch || isMenuCodeMenuQuestion(userText)) {
      showTyping(senderId);
      await sendMessage(senderId, MENU_CODE_MENU_PRICE_REPLY);
      console.log(`🤖 reply: ${redactSensitiveText(MENU_CODE_MENU_PRICE_REPLY).slice(0, 120).replace(/\n/g, ' ')}`);
      await sendImages(senderId, getMenuImageUrls(baseUrlOverride));
      markMenuCodeLastUserAt(senderId);
      return;
    }

    markMenuCodeLastUserAt(senderId);
  }

  function registerWebhookRoutes(app) {
    app.get('/webhook', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === fbVerifyToken) {
        console.log('✅ Webhook verified!');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    });

    app.post('/webhook', webhookRateLimiter, (req, res) => {
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
  }

  async function handleEvent(event, baseUrlOverride = '') {
    const senderId = event.sender?.id;
    if (!senderId) return;

    // Echo: tin bot tự gửi thì bỏ qua; tin page/người trực gửi tay thì tạm dừng đúng khách.
    if (event.message?.is_echo) {
      if (!isBotEcho(event)) {
        const customerId = getEchoCustomerId(event);
        if (customerId) {
          storage.setHandoff(customerId, Date.now() + handoffMs);
          console.log(`⏸️  Bật handoff do người trực trả lời: ${customerId}`);
        }
      }
      return;
    }

    // Dedup theo message id (Meta có thể retry)
    const mid = event.message?.mid;
    if (mid && storage.seenMid(mid)) return;
    if (mid) storage.markMid(mid);

    const adsReferralEvent = isMenuCodeAdsReferral(event);

    let userText = null;
    let quickReplyPayload = '';
    if (event.message?.quick_reply?.payload) {
      quickReplyPayload = event.message.quick_reply.payload;
      const resolved = resolveQuickReplyPayload(quickReplyPayload, shopConfig);
      userText = resolved?.text || event.message?.text || quickReplyPayload;
    } else if (event.message?.text) userText = event.message.text;
    else if (event.postback?.payload) userText = event.postback.payload;

    if (!userText) {
      if (menuCodeHandoffMode && adsReferralEvent) {
        console.log(`📣 [${senderId}]: referral từ quảng cáo (không kèm tin nhắn)`);
        await handleMenuCodeHandoffEvent(senderId, '', baseUrlOverride, { adsReferral: true });
      }
      return;
    }

    console.log(`📩 [${senderId}]: ${redactSensitiveText(userText)}`);
    if (menuCodeHandoffMode) {
      await handleMenuCodeHandoffEvent(senderId, userText, baseUrlOverride, { adsReferral: adsReferralEvent });
      return;
    }

    trackEvent(senderId, 'message_received', userText, {
      messageId: mid || '',
      quickReplyPayload
    });

    // Đang trong khoảng human handoff → bot không trả lời, nhưng vẫn ghi nhận cập nhật đơn
    // nếu shop còn bật order flow.
    if (storage.inHandoff(senderId)) {
      const captured = orderFlowEnabled
        ? captureHandoffOrderUpdate(senderId, userText, { messageId: mid || '' })
        : false;
      console.log(`⏸️  Bỏ qua tin (handoff): ${senderId}${captured ? ' — đã ghi nhận cập nhật đơn' : ''}`);
      return;
    }

    maybeResetTimedOutSession(senderId, userText);

    // Khách yêu cầu gặp nhân viên → tạm dừng bot, ghi log
    if (wantsHuman(userText)) {
      storage.setHandoff(senderId, Date.now() + handoffMs);
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
      storage.setHandoff(senderId, Date.now() + handoffMs);
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

    if (leadCaptureEnabled || orderFlowEnabled) {
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
        orderFlowEnabled &&
        storage.getSessionState(senderId) === STATES.CONFIRMED &&
        (substantiveLead || productChanged)
      ) {
        storage.setSessionState(senderId, '');
      }

      if (leadCaptureEnabled && looksLikePhone(userText)) {
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
      } else if (
        leadCaptureEnabled &&
        (leadDetails.name || leadDetails.address) &&
        currentLead.phone &&
        currentLead.name &&
        currentLead.address
      ) {
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

      if (orderFlowEnabled) {
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
            storage.setHandoff(senderId, Date.now() + handoffMs);
          }
          console.log(`⏸️  Bỏ qua tin xác nhận ngắn sau khi đã đủ thông tin đơn: ${senderId}`);
          return;
        }
      }
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
      } else if (!effectiveUseGemini) {
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
        console.warn(`⚠️  Gemini trả lời có vẻ bị cụt, dùng fallback. Reply gốc: ${redactSensitiveText(reply).replace(/\n/g, ' ')}`);
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
      console.log(`🤖 reply: ${redactSensitiveText(reply).slice(0, 120).replace(/\n/g, ' ')}`);
      await imagePromise; // đợi ảnh xong rồi mới gửi text để text xuất hiện sau ảnh
      if (quickReplies.length) {
        trackEvent(senderId, 'quick_replies_sent', userText, {
          payloads: quickReplies.map(item => item.payload)
        });
        await sendQuickReplies(senderId, reply, quickReplies);
      } else {
        await sendMessage(senderId, reply);
      }
      await handoffAfterProductCode(senderId, userText);
      recordConversationTurn(senderId, userText, reply);
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
          recordConversationTurn(senderId, userText, fallback);
          console.log(`🛟 Fallback do Gemini lỗi (${geminiInfo.status || geminiInfo.code || geminiInfo.httpStatus}): ${redactSensitiveText(fallback).slice(0, 120).replace(/\n/g, ' ')}`);
          await trackFallbackAttention(senderId, userText, fallback);
        } catch {}
        return;
      }
      try {
        await sendMessage(senderId, render('systemBusy'));
      } catch {}
    }
  }

  return {
    handleEvent,
    registerWebhookRoutes,
    verifySignature
  };
}

module.exports = {
  createWebhook
};

const crypto = require('crypto');
const {
  isAiFallbackEnabled,
  isFallbackEnabled,
  isLeadCaptureEnabled,
  isMenuSendingEnabled,
  isMenuCodeHandoffMode,
  isOrderFlowEnabled,
  isPostProductHandoffEnabled,
  isProductCodeLookupEnabled
} = require('./bot-mode');
const { createMenuCodeHandoffHandler } = require('./modes/menu-code-handoff');
const { uniqueImagesForRequest } = require('./runtime-image-dedupe');
const { pageRef } = require('./utils/log-refs');

const MENU_CODE_ADS_REFERRAL_SOURCES = new Set(['ADS', 'SHORTLINK']);
const MESSAGE_TEXT_DEDUPE_TTL_MS = 5 * 1000;
const MESSAGE_TEXT_DEDUPE_MAX_KEYS = 2000;
const MENU_SEND_COOLDOWN_MS = 15 * 1000;
const MENU_SEND_COOLDOWN_MAX_KEYS = 2000;

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
  redactSensitiveText,
  resolveRuntimeForPage
}) {
  const recentMessageTextKeys = new Map();
  const recentMenuSendKeys = new Map();

  function pruneExpiringMap(map, maxKeys, nowMs = Date.now()) {
    for (const [key, expiresAt] of map) {
      if (expiresAt > nowMs) continue;
      map.delete(key);
    }

    while (map.size > maxKeys) {
      const oldestKey = map.keys().next().value;
      if (!oldestKey) break;
      map.delete(oldestKey);
    }
  }

  function pruneRecentMessageTextKeys(nowMs = Date.now()) {
    pruneExpiringMap(recentMessageTextKeys, MESSAGE_TEXT_DEDUPE_MAX_KEYS, nowMs);
  }

  function normalizeMessageTextForDedupe(text, normalize) {
    const normalized = typeof normalize === 'function'
      ? normalize(text)
      : String(text || '').toLowerCase();
    return String(normalized || '').replace(/\s+/g, ' ').trim();
  }

  function shouldSkipDuplicateMessageText({ pageId, senderId, userText, normalize }) {
    const normalizedText = normalizeMessageTextForDedupe(userText, normalize);
    if (!senderId || !normalizedText) return false;

    const nowMs = Date.now();
    pruneRecentMessageTextKeys(nowMs);

    const key = JSON.stringify([
      String(pageId || ''),
      String(senderId || ''),
      normalizedText
    ]);
    const expiresAt = recentMessageTextKeys.get(key);
    if (expiresAt && expiresAt > nowMs) return true;

    recentMessageTextKeys.set(key, nowMs + MESSAGE_TEXT_DEDUPE_TTL_MS);
    pruneRecentMessageTextKeys(nowMs);
    return false;
  }

  function shouldSkipRecentMenuSend({ pageId, senderId }) {
    if (!senderId) return false;

    const nowMs = Date.now();
    pruneExpiringMap(recentMenuSendKeys, MENU_SEND_COOLDOWN_MAX_KEYS, nowMs);

    const key = JSON.stringify([
      String(pageId || ''),
      String(senderId || '')
    ]);
    const expiresAt = recentMenuSendKeys.get(key);
    if (expiresAt && expiresAt > nowMs) {
      console.log(`skipped duplicate menu within cooldown: page_ref=${pageRef(pageId)} sender=${senderId}`);
      return true;
    }

    recentMenuSendKeys.set(key, nowMs + MENU_SEND_COOLDOWN_MS);
    pruneExpiringMap(recentMenuSendKeys, MENU_SEND_COOLDOWN_MAX_KEYS, nowMs);
    return false;
  }

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

  function shouldTrackEngagedFollowUp(text, payload = '', extractCodes = extractRequestedProductCodes) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    if (String(payload || '').trim()) return true;
    if (extractCodes(text).length) return true;
    return /(?:ma|mau|gia|tu van|goi y|bao nhieu|ship|dia chi|chot|dat|mua|order|combo|hang|san pham|menu)/.test(normalized);
  }

  function hasMessagePayload(event) {
    return Boolean(
      event?.message?.quick_reply?.payload
      || event?.message?.text
      || event?.postback?.payload
    );
  }

  function hasAdsReferralPayload(event) {
    const refs = [event?.referral, event?.message?.referral, event?.postback?.referral];
    return refs.some(ref => MENU_CODE_ADS_REFERRAL_SOURCES.has(String(ref?.source || '').toUpperCase()));
  }

  const defaultRuntime = {
    storage,
    shopConfig,
    useGemini,
    resolveQuickReplyPayload,
    buildQuickReplies,
    buildDeterministicReply,
    buildFallbackReply,
    buildLeadDetails,
    buildConfirmedSheetLead,
    extractRequestedProductCodes,
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
  };

  function createRuntimeMenuCodeHandoffHandler(runtime) {
    const productCodeLookupEnabled = isProductCodeLookupEnabled(runtime.shopConfig);
    const menuSendingEnabled = isMenuSendingEnabled(runtime.shopConfig);
    const postProductHandoffEnabled = isPostProductHandoffEnabled(runtime.shopConfig);
    return createMenuCodeHandoffHandler({
      storage: runtime.storage,
      shopConfig: runtime.shopConfig,
      handoffMs,
      productCodeLookupEnabled,
      menuSendingEnabled,
      postProductHandoffEnabled,
      buildDeterministicReply: runtime.buildDeterministicReply,
      extractRequestedProductCodes: runtime.extractRequestedProductCodes,
      normalizeText: runtime.normalizeText,
      sendMessage: runtime.sendMessage,
      sendImage: runtime.sendImage,
      showTyping: runtime.showTyping,
      isGreetingText: runtime.isGreetingText,
      getMenuImageUrls: runtime.getMenuImageUrls,
      buildRequestedImageUrls: runtime.buildRequestedImageUrls,
      redactSensitiveText: runtime.redactSensitiveText,
      shouldSkipRecentMenuSend
    });
  }

  function materializeRuntime(overrides = {}) {
    const runtime = { ...defaultRuntime, ...overrides };
    runtime.effectiveUseGemini = runtime.useGemini && isAiFallbackEnabled(runtime.shopConfig);
    runtime.leadCaptureEnabled = isLeadCaptureEnabled(runtime.shopConfig);
    runtime.orderFlowEnabled = isOrderFlowEnabled(runtime.shopConfig);
    runtime.fallbackEnabled = isFallbackEnabled(runtime.shopConfig);
    runtime.productCodeLookupEnabled = isProductCodeLookupEnabled(runtime.shopConfig);
    runtime.menuCodeHandoffMode = isMenuCodeHandoffMode(runtime.shopConfig);
    runtime.menuCodeHandoffHandler = runtime.menuCodeHandoffMode
      ? (runtime.menuCodeHandoffHandler || createRuntimeMenuCodeHandoffHandler(runtime))
      : null;
    return runtime;
  }

  const staticRuntime = materializeRuntime();

  function safeLogReason(reason) {
    const value = String(reason || 'unknown').trim().toLowerCase();
    return value.replace(/[^a-z0-9_.:-]/g, '_').slice(0, 80) || 'unknown';
  }

  function getEventPageId(event, options = {}) {
    return String(
      options.pageId
      || event.recipient?.id
      || event.page_id
      || event.pageId
      || ''
    ).trim();
  }

  async function resolveEventRuntime(event, options = {}) {
    const pageId = getEventPageId(event, options);
    if (typeof resolveRuntimeForPage !== 'function') return staticRuntime;

    try {
      const resolved = await resolveRuntimeForPage({
        pageId,
        event,
        fallbackRuntime: staticRuntime
      });
      if (!resolved) return staticRuntime;
      if (resolved.failClosed) {
        console.warn(`[multi-shop] DB config fail-closed reason=${safeLogReason(resolved.reason)} page_ref=${pageRef(pageId)}`);
        return { failClosed: true };
      }
      if (resolved.shopConfig) return materializeRuntime(resolved);
      if (resolved.reason) {
        console.warn(`[multi-shop] DB config fallback reason=${safeLogReason(resolved.reason)} page_ref=${pageRef(pageId)}`);
      }
      return staticRuntime;
    } catch (err) {
      const reason = err && (err.code || err.reason) ? (err.code || err.reason) : 'resolver_error';
      console.warn(`[multi-shop] DB config fallback reason=${safeLogReason(reason)} page_ref=${pageRef(pageId)}`);
      return staticRuntime;
    }
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

      const inferredBaseUrl = inferBaseUrlFromRequest(req);
      const requestEvents = [];
      const requestMessageSenders = new Set();
      const requestAdsReferralSenders = new Set();
      const requestImageDedupe = new Set();

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          requestEvents.push({ event, pageId: entry.id });
          if (hasMessagePayload(event) && event.sender?.id) {
            requestMessageSenders.add(event.sender.id);
          }
          if (hasAdsReferralPayload(event) && event.sender?.id) {
            requestAdsReferralSenders.add(event.sender.id);
          }
        }
      }

      void processWebhookRequestEvents(requestEvents, inferredBaseUrl, {
        requestMessageSenders,
        requestAdsReferralSenders,
        requestImageDedupe
      });
    });
  }

  async function processWebhookRequestEvents(requestEvents, inferredBaseUrl, requestOptions) {
    for (const { event, pageId } of requestEvents) {
      try {
        await handleEvent(event, inferredBaseUrl, {
          ...requestOptions,
          pageId
        });
      } catch (err) {
        console.error('❌ handleEvent:', err.response?.data || err.message);
      }
    }
  }

  async function handleEvent(event, baseUrlOverride = '', options = {}) {
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
    if (mid) {
      const pageId = getEventPageId(event, options);
      try {
        if (typeof storage.tryMarkMid !== 'function') {
          throw new Error('storage_tryMarkMid_unavailable');
        }
        const marked = await storage.tryMarkMid(mid, { senderId, pageId });
        if (!marked) return;
      } catch (err) {
        console.error(
          `[webhook] MID idempotency fail-closed page_ref=${pageRef(pageId)} sender=${senderId}: ${err.message}`
        );
        return;
      }
    }

    const runtime = await resolveEventRuntime(event, options);
    if (runtime.failClosed) return;

    const {
      shopConfig,
      effectiveUseGemini,
      leadCaptureEnabled,
      orderFlowEnabled,
      fallbackEnabled,
      menuCodeHandoffMode,
      menuCodeHandoffHandler,
      resolveQuickReplyPayload,
      buildQuickReplies,
      buildDeterministicReply,
      buildFallbackReply,
      buildLeadDetails,
      buildConfirmedSheetLead,
      extractRequestedProductCodes,
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
    } = runtime;

    const adsReferralEvent = menuCodeHandoffHandler?.isAdsReferralEvent(event) === true;
    const requestAdsReferralEvent = options.requestAdsReferralSenders?.has?.(senderId) === true;
    const effectiveAdsReferralEvent = adsReferralEvent || requestAdsReferralEvent;
    const requestImageDedupe = options.requestImageDedupe || new Set();

    let userText = null;
    let quickReplyPayload = '';
    if (event.message?.quick_reply?.payload) {
      quickReplyPayload = event.message.quick_reply.payload;
      const resolved = resolveQuickReplyPayload(quickReplyPayload, shopConfig);
      userText = resolved?.text || event.message?.text || quickReplyPayload;
    } else if (event.message?.text) userText = event.message.text;
    else if (event.postback?.payload) userText = event.postback.payload;

    if (!userText) {
      const siblingMessageInRequest = options.requestMessageSenders?.has?.(senderId) === true;
      if (menuCodeHandoffMode && effectiveAdsReferralEvent && !siblingMessageInRequest) {
        console.log(`📣 [${senderId}]: referral từ quảng cáo (không kèm tin nhắn)`);
      }
      return;
    }

    const pageId = getEventPageId(event, options);
    if (shouldSkipDuplicateMessageText({
      pageId,
      senderId,
      userText,
      normalize: normalizeText
    })) {
      console.log(`🔁 Bỏ qua tin trùng trong TTL: page_ref=${pageRef(pageId)} sender=${senderId}`);
      return;
    }

    console.log(`📩 [${senderId}]: ${redactSensitiveText(userText)}`);
    if (menuCodeHandoffHandler) {
      const handled = await menuCodeHandoffHandler.handleEvent(senderId, userText, baseUrlOverride, {
        adsReferral: effectiveAdsReferralEvent,
        pageId,
        requestImageDedupe
      });
      if (handled) return;
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
    if (typeof storage.setEngagedFollowUp === 'function' && shouldTrackEngagedFollowUp(userText, quickReplyPayload, extractRequestedProductCodes)) {
      storage.setEngagedFollowUp(senderId, {
        at: new Date().toISOString(),
        note: userText
      });
    }

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

        for (const { file, url } of uniqueImagesForRequest(senderId, images, requestImageDedupe)) {
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
        if (!fallbackEnabled) {
          trackEvent(senderId, 'fallback_suppressed', userText, { reason: 'gemini_disabled' });
          console.log('🧩 fallback disabled, không gửi fallback rule-based');
          return;
        }
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
        if (!fallbackEnabled) {
          trackEvent(senderId, 'fallback_suppressed', userText, { reason: 'incomplete_reply' });
          return;
        }
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
          if (!fallbackEnabled) {
            trackEvent(senderId, 'fallback_suppressed', userText, {
              reason: 'gemini_error',
              status: geminiInfo.status || geminiInfo.code || geminiInfo.httpStatus || ''
            });
            return;
          }
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

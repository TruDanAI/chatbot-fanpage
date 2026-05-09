const axios = require('axios');

function getFacebookProfileDisplayName(profile = {}) {
  return String(
    profile.name
    || [profile.firstName || profile.first_name, profile.lastName || profile.last_name].filter(Boolean).join(' ')
  ).replace(/\s+/g, ' ').trim();
}

function buildTelegramUserLines(senderId, profile = {}) {
  const displayName = getFacebookProfileDisplayName(profile);
  if (!senderId) return displayName ? [`User: ${displayName}`] : [];
  if (!displayName) return [`User: ${senderId}`];
  return [
    `User: ${displayName}`,
    `Facebook ID: ${senderId}`
  ];
}

function buildTelegramLeadAlertText(leadData, profile = {}) {
  const title = leadData.text || 'CÓ ĐƠN HÀNG MỚI';
  const userLines = buildTelegramUserLines(leadData.senderId || '', profile);
  return [
    `🚨 ${title}`,
    ...userLines,
    `👤 Tên nhận hàng: ${leadData.name || 'Không có'}`,
    `📞 SĐT: ${leadData.phone || 'Không có'}`,
    `🏠 Địa chỉ: ${leadData.address || 'Không có'}`,
    `📦 Sản phẩm: ${leadData.productInterest || leadData.productCode || 'Không có'}`
  ].filter(Boolean).join('\n');
}

function createNotificationService({
  storage,
  fbPageToken,
  fbProfileCacheTtlMs,
  telegramAlertCooldownMs,
  fallbackAlertThreshold,
  fallbackHandoffThreshold,
  handoffMs,
  trackEvent,
  truncateText
}) {
  const attentionStateByUser = new Map();
  const facebookProfileFetches = new Map();

  function isFreshFacebookProfile(profile = {}) {
    const updatedAt = Date.parse(String(profile.updatedAt || ''));
    return Number.isFinite(updatedAt) && Date.now() - updatedAt <= fbProfileCacheTtlMs;
  }

  async function fetchFacebookUserProfile(senderId, fallback = {}) {
    try {
      const { data } = await axios.get(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(senderId)}`,
        {
          params: {
            fields: 'first_name,last_name,profile_pic',
            access_token: fbPageToken
          },
          timeout: 5000
        }
      );
      const profile = {
        firstName: data?.first_name || '',
        lastName: data?.last_name || '',
        profilePic: data?.profile_pic || ''
      };
      profile.name = getFacebookProfileDisplayName(profile);
      if (!getFacebookProfileDisplayName(profile)) return fallback || {};
      return storage.setUserProfile ? storage.setUserProfile(senderId, profile) : profile;
    } catch (err) {
      if (getFacebookProfileDisplayName(fallback)) return fallback;
      const e = err.response?.data?.error;
      console.warn(`⚠️ Không lấy được tên Facebook của ${senderId}: ${e?.message || err.message}`);
      return {};
    }
  }

  async function getFacebookUserProfile(senderId, options = {}) {
    if (!senderId) return {};
    const cached = storage.getUserProfile ? storage.getUserProfile(senderId) : {};
    if (getFacebookProfileDisplayName(cached) && isFreshFacebookProfile(cached)) return cached;
    if (options.cachedOnly) return cached;
    if (facebookProfileFetches.has(senderId)) return facebookProfileFetches.get(senderId);

    const pending = fetchFacebookUserProfile(senderId, cached)
      .finally(() => facebookProfileFetches.delete(senderId));
    facebookProfileFetches.set(senderId, pending);
    return pending;
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
    if (state.lastAlertAt && now - state.lastAlertAt < telegramAlertCooldownMs) return true;
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
      const profile = await getFacebookUserProfile(senderId);
      const userLines = buildTelegramUserLines(senderId, profile);

      const text = [
        '🚨 CẦN NHÂN VIÊN HỖ TRỢ',
        '',
        `Lý do: ${reason || 'Không rõ'}`,
        ...userLines,
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

    if (fallbackCount >= fallbackAlertThreshold) {
      await sendTelegramOperationalAlert({
        senderId,
        reason: `Ngoài rule-base/fallback liên tiếp ${fallbackCount} lần`,
        userText,
        reply
      });
    }

    if (fallbackCount >= fallbackHandoffThreshold) {
      storage.setHandoff(senderId, Date.now() + handoffMs);
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
      const profile = await getFacebookUserProfile(leadData.senderId || '', { cachedOnly: false });
      const text = buildTelegramLeadAlertText(leadData, profile);

      await sendTelegramMessage(text);
    } catch (err) {
      console.error('❌ Lỗi gửi Telegram alert:', err.response?.data || err.message);
    }
  }

  return {
    buildTelegramLeadAlertText,
    buildTelegramUserLines,
    getFacebookProfileDisplayName,
    getFacebookUserProfile,
    resetFallbackAttention,
    sendTelegramAlert,
    sendTelegramMessage,
    sendTelegramOperationalAlert,
    trackFallbackAttention
  };
}

module.exports = {
  buildTelegramLeadAlertText,
  buildTelegramUserLines,
  createNotificationService,
  getFacebookProfileDisplayName
};

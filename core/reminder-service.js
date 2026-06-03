const MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS = 23 * 60 * 60 * 1000;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveMessengerAutomationMaxAgeMs(value, fallback = MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS, options = {}) {
  const resolved = positiveNumber(value, fallback);
  if (options.allowOutsideWindowAutomation === true) return resolved;
  return Math.min(resolved, MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS);
}

function isWithinMessengerAutomationWindow(candidate = {}, maxAgeMs = MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS) {
  const idleMs = Number(candidate.idleMs);
  return Number.isFinite(idleMs) && idleMs >= 0 && idleMs <= maxAgeMs;
}

function createReminderService({
  storage,
  shopConfig,
  buildAbandonedCartReminderText,
  buildQuickReplies,
  sendQuickReplies,
  deriveSessionState,
  STATES,
  trackEvent,
  config = {}
}) {
  const {
    enabled: reminderEnabled = true,
    reminderMs = 20 * 60 * 1000,
    scanMs = 60 * 1000,
    maxAgeMs = 23 * 60 * 60 * 1000,
    engagedFollowUpEnabled = false,
    engagedFollowUpMs = 2 * 60 * 60 * 1000,
    engagedFollowUpScanMs = 60 * 1000,
    engagedFollowUpMaxAgeMs = 3 * 24 * 60 * 60 * 1000,
    allowOutsideWindowAutomation = false
  } = config;
  const abandonedCartMaxAgeMs = resolveMessengerAutomationMaxAgeMs(maxAgeMs, MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS, {
    allowOutsideWindowAutomation
  });
  const engagedFollowUpSafeMaxAgeMs = resolveMessengerAutomationMaxAgeMs(engagedFollowUpMaxAgeMs, MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS, {
    allowOutsideWindowAutomation
  });

  let abandonedCartReminderTimer = null;
  let abandonedCartReminderKickoffTimer = null;
  let abandonedCartReminderRunning = false;
  let engagedFollowUpReminderTimer = null;
  let engagedFollowUpReminderKickoffTimer = null;
  let engagedFollowUpReminderRunning = false;

  function buildEngagedFollowUpReminderText(candidate = {}) {
    const fromConfig = String(config.engagedFollowUpText || '').trim();
    if (fromConfig) return fromConfig;
    const fromShopConfig = String(
      shopConfig?.followUp?.engagedReminderText ||
      shopConfig?.followUp?.idleReminderText ||
      ''
    ).trim();
    if (fromShopConfig) return fromShopConfig;

    const code = String(candidate.lastProductCode || '').trim();
    if (code) {
      return `Mình ơi, nãy mình đang xem ${code} đó ạ. Nếu cần em tư vấn nhanh theo nhu cầu hoặc ngân sách, nhắn em 1 tin là em hỗ trợ liền nhé.`;
    }
    return 'Mình ơi, nếu cần em tư vấn thêm mẫu phù hợp nhu cầu hoặc ngân sách thì nhắn em 1 tin nhé, em hỗ trợ liền ạ.';
  }

  async function sendAbandonedCartReminder(candidate) {
    const senderId = candidate?.userId;
    if (!senderId || storage.inHandoff(senderId)) return false;
    const maxSendAgeMs = resolveMessengerAutomationMaxAgeMs(candidate?.maxAgeMs, abandonedCartMaxAgeMs, {
      allowOutsideWindowAutomation
    });
    if (!isWithinMessengerAutomationWindow(candidate, maxSendAgeMs)) return false;

    const draft = storage.getOrderDraft(senderId);
    if (draft.abandonedCartReminderSentAt) return false;
    if (!Array.isArray(draft.cartItems) || !draft.cartItems.length) return false;
    if (deriveSessionState(senderId, draft) === STATES.CONFIRMED) return false;

    const reminder = buildAbandonedCartReminderText(draft);
    if (!reminder) return false;

    const quickReplies = buildQuickReplies({ stage: 'checkout' }, shopConfig);
    await sendQuickReplies(senderId, reminder, quickReplies);

    const missingFields = candidate.missingFields || ['name', 'phone', 'address']
      .filter(field => !String(draft[field] || '').trim());
    storage.markAbandonedCartReminderSent(senderId, {
      at: new Date().toISOString(),
      idleMs: candidate.idleMs,
      missingFields
    });
    trackEvent(senderId, 'abandoned_cart_reminder_sent', '', {
      idleMs: candidate.idleMs,
      missingFields,
      payloads: quickReplies.map(item => item.payload)
    });
    return true;
  }

  async function scanAbandonedCartReminders(options = {}) {
    if (abandonedCartReminderRunning) return 0;
    abandonedCartReminderRunning = true;
    let sent = 0;

    try {
      const effectiveMaxAgeMs = resolveMessengerAutomationMaxAgeMs(options.maxAgeMs, abandonedCartMaxAgeMs, {
        allowOutsideWindowAutomation
      });
      const candidates = storage.listAbandonedCartReminderCandidates({
        idleMs: options.idleMs || reminderMs,
        maxAgeMs: effectiveMaxAgeMs,
        limit: options.limit || 50
      });

      for (const candidate of candidates) {
        try {
          if (await sendAbandonedCartReminder({
            ...candidate,
            maxAgeMs: effectiveMaxAgeMs
          })) sent += 1;
        } catch (err) {
          const status = err.response?.status;
          const msg = err.response?.data?.error?.message || err.message;
          console.error(`❌ Nhắc giỏ bỏ dở fail (${candidate.userId}): ${msg}`);
          trackEvent(candidate.userId, 'abandoned_cart_reminder_failed', '', {
            status: status || '',
            error: msg,
            idleMs: candidate.idleMs
          });
          if (status && status >= 400 && status < 500 && status !== 429) {
            storage.markAbandonedCartReminderFailed(candidate.userId, {
              at: new Date().toISOString(),
              status,
              error: msg
            });
          }
        }
      }
    } finally {
      abandonedCartReminderRunning = false;
    }

    return sent;
  }

  async function sendEngagedFollowUpReminder(candidate) {
    const senderId = candidate?.userId;
    if (!senderId || storage.inHandoff(senderId)) return false;
    const maxSendAgeMs = resolveMessengerAutomationMaxAgeMs(candidate?.maxAgeMs, engagedFollowUpSafeMaxAgeMs, {
      allowOutsideWindowAutomation
    });

    const latest = storage.listEngagedFollowUpCandidates({
      now: Date.now(),
      idleMs: candidate.idleThresholdMs || engagedFollowUpMs,
      maxAgeMs: maxSendAgeMs,
      limit: 200
    }).find(item => item.userId === senderId);
    if (!latest) return false;
    if (!isWithinMessengerAutomationWindow(latest, maxSendAgeMs)) return false;

    const state = deriveSessionState(senderId, storage.getOrderDraft(senderId));
    if (state === STATES.CONFIRMED) return false;
    const reminder = buildEngagedFollowUpReminderText(latest);
    if (!reminder) return false;

    const quickReplies = buildQuickReplies({ stage: 'greeting' }, shopConfig);
    await sendQuickReplies(senderId, reminder, quickReplies);
    storage.markEngagedFollowUpReminderSent(senderId, {
      at: new Date().toISOString(),
      idleMs: latest.idleMs
    });
    trackEvent(senderId, 'engaged_followup_reminder_sent', '', {
      idleMs: latest.idleMs,
      payloads: quickReplies.map(item => item.payload)
    });
    return true;
  }

  async function scanEngagedFollowUpReminders(options = {}) {
    const enabled = options.enabled == null ? engagedFollowUpEnabled : Boolean(options.enabled);
    if (!enabled) return 0;
    if (engagedFollowUpReminderRunning) return 0;
    engagedFollowUpReminderRunning = true;
    let sent = 0;
    try {
      const effectiveIdleMs = options.idleMs || engagedFollowUpMs;
      const effectiveMaxAgeMs = resolveMessengerAutomationMaxAgeMs(options.maxAgeMs, engagedFollowUpSafeMaxAgeMs, {
        allowOutsideWindowAutomation
      });
      const candidates = storage.listEngagedFollowUpCandidates({
        idleMs: effectiveIdleMs,
        maxAgeMs: effectiveMaxAgeMs,
        limit: options.limit || 50
      });
      for (const candidate of candidates) {
        try {
          if (await sendEngagedFollowUpReminder({
            ...candidate,
            idleThresholdMs: effectiveIdleMs,
            maxAgeMs: effectiveMaxAgeMs
          })) {
            sent += 1;
          }
        } catch (err) {
          const status = err.response?.status;
          const msg = err.response?.data?.error?.message || err.message;
          console.error(`❌ Nhắc mời chào fail (${candidate.userId}): ${msg}`);
          trackEvent(candidate.userId, 'engaged_followup_reminder_failed', '', {
            status: status || '',
            error: msg,
            idleMs: candidate.idleMs
          });
          if (status && status >= 400 && status < 500 && status !== 429) {
            storage.markEngagedFollowUpReminderFailed(candidate.userId, {
              at: new Date().toISOString(),
              status,
              error: msg
            });
          }
        }
      }
    } finally {
      engagedFollowUpReminderRunning = false;
    }
    return sent;
  }

  function startAbandonedCartReminderWorker(options = {}) {
    const enabled = options.enabled == null ? reminderEnabled : Boolean(options.enabled);
    if (!enabled) return null;
    if (abandonedCartReminderTimer) return abandonedCartReminderTimer;

    const optionIntervalMs = Number(options.intervalMs);
    const intervalMs = Number.isFinite(optionIntervalMs) && optionIntervalMs > 0
      ? optionIntervalMs
      : scanMs;
    const firstDelayMs = Math.min(options.firstDelayMs || 10 * 1000, intervalMs);
    const run = () => {
      void scanAbandonedCartReminders(options).catch(err => {
        console.error(`❌ Worker nhắc giỏ bỏ dở lỗi: ${err.message}`);
      });
    };

    abandonedCartReminderKickoffTimer = setTimeout(run, firstDelayMs);
    abandonedCartReminderKickoffTimer.unref?.();
    abandonedCartReminderTimer = setInterval(run, intervalMs);
    abandonedCartReminderTimer.unref?.();
    const maxAgeMinutes = Math.round(resolveMessengerAutomationMaxAgeMs(options.maxAgeMs, abandonedCartMaxAgeMs, {
      allowOutsideWindowAutomation
    }) / 60000);
    console.log(
      `🛒 Nhắc giỏ bỏ dở bật: sau ${Math.round((options.idleMs || reminderMs) / 60000)} phút, tối đa ${maxAgeMinutes} phút, quét mỗi ${Math.round(intervalMs / 1000)} giây.`
    );
    return abandonedCartReminderTimer;
  }

  function stopAbandonedCartReminderWorker() {
    if (abandonedCartReminderKickoffTimer) clearTimeout(abandonedCartReminderKickoffTimer);
    if (abandonedCartReminderTimer) clearInterval(abandonedCartReminderTimer);
    abandonedCartReminderKickoffTimer = null;
    abandonedCartReminderTimer = null;
  }

  function startEngagedFollowUpReminderWorker(options = {}) {
    const enabled = options.enabled == null ? engagedFollowUpEnabled : Boolean(options.enabled);
    if (!enabled) return null;
    if (engagedFollowUpReminderTimer) return engagedFollowUpReminderTimer;

    const optionIntervalMs = Number(options.intervalMs);
    const intervalMs = Number.isFinite(optionIntervalMs) && optionIntervalMs > 0
      ? optionIntervalMs
      : engagedFollowUpScanMs;
    const firstDelayMs = Math.min(options.firstDelayMs || 15 * 1000, intervalMs);
    const run = () => {
      void scanEngagedFollowUpReminders(options).catch(err => {
        console.error(`❌ Worker nhắc mời chào lỗi: ${err.message}`);
      });
    };
    engagedFollowUpReminderKickoffTimer = setTimeout(run, firstDelayMs);
    engagedFollowUpReminderKickoffTimer.unref?.();
    engagedFollowUpReminderTimer = setInterval(run, intervalMs);
    engagedFollowUpReminderTimer.unref?.();
    const maxAgeMinutes = Math.round(resolveMessengerAutomationMaxAgeMs(options.maxAgeMs, engagedFollowUpSafeMaxAgeMs, {
      allowOutsideWindowAutomation
    }) / 60000);
    console.log(
      `📨 Nhắc mời chào bật: sau ${Math.round((options.idleMs || engagedFollowUpMs) / 60000)} phút, tối đa ${maxAgeMinutes} phút, quét mỗi ${Math.round(intervalMs / 1000)} giây.`
    );
    return engagedFollowUpReminderTimer;
  }

  function stopEngagedFollowUpReminderWorker() {
    if (engagedFollowUpReminderKickoffTimer) clearTimeout(engagedFollowUpReminderKickoffTimer);
    if (engagedFollowUpReminderTimer) clearInterval(engagedFollowUpReminderTimer);
    engagedFollowUpReminderKickoffTimer = null;
    engagedFollowUpReminderTimer = null;
  }

  return {
    scanAbandonedCartReminders,
    scanEngagedFollowUpReminders,
    sendAbandonedCartReminder,
    sendEngagedFollowUpReminder,
    startAbandonedCartReminderWorker,
    stopAbandonedCartReminderWorker,
    startEngagedFollowUpReminderWorker,
    stopEngagedFollowUpReminderWorker
  };
}

module.exports = {
  MESSENGER_STANDARD_AUTOMATION_MAX_AGE_MS,
  createReminderService,
  resolveMessengerAutomationMaxAgeMs
};

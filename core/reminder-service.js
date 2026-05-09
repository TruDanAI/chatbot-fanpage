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
    maxAgeMs = 23 * 60 * 60 * 1000
  } = config;

  let abandonedCartReminderTimer = null;
  let abandonedCartReminderKickoffTimer = null;
  let abandonedCartReminderRunning = false;

  async function sendAbandonedCartReminder(candidate) {
    const senderId = candidate?.userId;
    if (!senderId || storage.inHandoff(senderId)) return false;

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
      const candidates = storage.listAbandonedCartReminderCandidates({
        idleMs: options.idleMs || reminderMs,
        maxAgeMs: options.maxAgeMs || maxAgeMs,
        limit: options.limit || 50
      });

      for (const candidate of candidates) {
        try {
          if (await sendAbandonedCartReminder(candidate)) sent += 1;
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
    console.log(
      `🛒 Nhắc giỏ bỏ dở bật: sau ${Math.round((options.idleMs || reminderMs) / 60000)} phút, quét mỗi ${Math.round(intervalMs / 1000)} giây.`
    );
    return abandonedCartReminderTimer;
  }

  function stopAbandonedCartReminderWorker() {
    if (abandonedCartReminderKickoffTimer) clearTimeout(abandonedCartReminderKickoffTimer);
    if (abandonedCartReminderTimer) clearInterval(abandonedCartReminderTimer);
    abandonedCartReminderKickoffTimer = null;
    abandonedCartReminderTimer = null;
  }

  return {
    scanAbandonedCartReminders,
    sendAbandonedCartReminder,
    startAbandonedCartReminderWorker,
    stopAbandonedCartReminderWorker
  };
}

module.exports = {
  createReminderService
};

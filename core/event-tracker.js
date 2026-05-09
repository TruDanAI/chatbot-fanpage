function truncateText(text, max = 700) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function maskPhone(phone) {
  const raw = String(phone || '');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return '[redacted-phone]';
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

function redactSensitiveText(text) {
  let s = String(text || '');
  if (!s) return s;

  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  s = s.replace(/(^|[^\d])((?:\+?84|0)\d(?:[\s.-]?\d){8,10})(?!\d)/g, (_m, prefix, phone) => `${prefix}${maskPhone(phone)}`);
  s = s.replace(
    /(^|[\s,;])((?:tên người nhận|ten nguoi nhan|người nhận|nguoi nhan|tên|ten)\s*(?:là|la|:)?\s*)([^\n,;]+?)(?=(?:\s+(?:sđt|sdt|số điện thoại|so dien thoai|địa chỉ|dia chi|dc)\b)|[,;\n]|$)/gi,
    '$1$2[redacted-name]'
  );
  s = s.replace(
    /(^|[\s,;])((?:địa chỉ|dia chi|dc|ship về|ship ve|giao về|giao ve)\s*(?:là|la|:|-)?\s*)[^\n\r,;]+/gi,
    '$1$2[redacted-address]'
  );
  return s;
}

function redactEventMeta(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[redacted-depth]';
  if (Array.isArray(value)) return value.map(item => redactEventMeta(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactEventMeta(item, depth + 1)])
  );
}

function normalizeIp(ip) {
  return String(ip || '').trim().replace(/^::ffff:/, '');
}

function getClientIp(req) {
  const forwarded = String(req?.get?.('x-forwarded-for') || '')
    .split(',')[0]
    .trim();
  return normalizeIp(forwarded || req?.ip || req?.socket?.remoteAddress || '');
}

function createFixedWindowRateLimiter({ keyPrefix, windowMs, max }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const clientIp = getClientIp(req) || 'unknown';
    const key = `${keyPrefix}:${clientIp}`;
    const current = buckets.get(key);

    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return next();
    }

    current.count += 1;
    if (current.count <= max) return next();

    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).send('Too many requests.');
  };
}

function createEventTracker({ storage, deriveSessionState, sessionTimeoutMs }) {
  function trackEvent(senderId, type, text = '', meta = {}) {
    if (!senderId || !type) return;
    const draft = storage.getOrderDraft(senderId);
    storage.appendEvent({
      type,
      senderId,
      text: redactSensitiveText(text),
      sessionState: deriveSessionState(senderId),
      productCode: draft.productCode || storage.getLastProductCode(senderId) || '',
      meta: redactEventMeta(meta)
    });
  }

  function maybeResetTimedOutSession(senderId, userText) {
    const previous = storage.getLastUserAt(senderId);
    const now = Date.now();
    storage.setLastUserAt(senderId, new Date(now).toISOString());

    if (!previous || !sessionTimeoutMs) return false;
    const previousMs = Date.parse(previous);
    if (!Number.isFinite(previousMs) || now - previousMs <= sessionTimeoutMs) return false;

    const draft = storage.getOrderDraft(senderId);
    const reminderMs = Date.parse(String(draft.abandonedCartReminderSentAt || ''));
    if (Number.isFinite(reminderMs) && now - reminderMs <= sessionTimeoutMs) return false;

    const abandoned = storage.resetSessionAfterTimeout(senderId);
    trackEvent(senderId, 'session_timeout', userText, {
      idleMs: now - previousMs,
      abandonedProductCode: abandoned.productCode || '',
      hadCart: Array.isArray(abandoned.cartItems) && abandoned.cartItems.length > 0
    });
    return true;
  }

  return {
    maybeResetTimedOutSession,
    trackEvent
  };
}

module.exports = {
  createEventTracker,
  createFixedWindowRateLimiter,
  getClientIp,
  normalizeIp,
  redactEventMeta,
  redactSensitiveText,
  truncateText
};

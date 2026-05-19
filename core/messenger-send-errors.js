const OUTSIDE_ALLOWED_WINDOW_SUBCODES = new Set([
  2018278,
  2018065,
  2534022
]);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getMessengerSendError(err) {
  const error = err?.response?.data?.error || err?.error || err;
  if (!error || typeof error !== 'object') return null;

  const code = toNumber(error.code);
  const subcode = toNumber(error.error_subcode);
  const message = String(error.message || err?.message || '');
  return {
    status: toNumber(err?.response?.status),
    type: String(error.type || ''),
    code,
    subcode,
    message,
    fbtraceId: String(error.fbtrace_id || '')
  };
}

function isRecipientUnavailableMessengerError(err) {
  const error = getMessengerSendError(err);
  if (!error) return false;
  return error.subcode === 1545041 && (error.code === 551 || error.code === 200);
}

function isOutsideAllowedWindowMessengerError(err) {
  const error = getMessengerSendError(err);
  if (!error) return false;
  if (error.code === 10 && OUTSIDE_ALLOWED_WINDOW_SUBCODES.has(error.subcode)) return true;
  return error.code === 10 && /outside (?:of )?(?:the )?allowed window/i.test(error.message);
}

function isNonRetryableMessengerSendError(err) {
  return isRecipientUnavailableMessengerError(err) || isOutsideAllowedWindowMessengerError(err);
}

function getMessengerSendBlockReason(err) {
  if (isRecipientUnavailableMessengerError(err)) return 'recipient_unavailable';
  if (isOutsideAllowedWindowMessengerError(err)) return 'outside_allowed_window';
  return 'messenger_send_failed';
}

module.exports = {
  getMessengerSendBlockReason,
  getMessengerSendError,
  isNonRetryableMessengerSendError,
  isOutsideAllowedWindowMessengerError,
  isRecipientUnavailableMessengerError
};

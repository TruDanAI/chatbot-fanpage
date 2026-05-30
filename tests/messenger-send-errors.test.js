const { describe, it, expect } = require('./harness');
const {
  getMessengerSendBlockReason,
  getMessengerSendError,
  isNonRetryableMessengerSendError,
  isOutsideAllowedWindowMessengerError,
  isRecipientUnavailableMessengerError
} = require('../core/messenger-send-errors');

function facebookError(code, subcode, message) {
  const err = new Error(message || 'Facebook send failed');
  err.response = {
    status: 400,
    data: {
      error: {
        message,
        type: 'OAuthException',
        code,
        error_subcode: subcode,
        fbtrace_id: 'trace-test'
      }
    }
  };
  return err;
}

describe('messenger send error classification', () => {
  it('classifies recipient unavailable errors as non-retryable', () => {
    const err = facebookError(551, 1545041, '(#551) This person is not available right now.');

    expect(isRecipientUnavailableMessengerError(err)).toBeTrue();
    expect(isNonRetryableMessengerSendError(err)).toBeTrue();
    expect(getMessengerSendBlockReason(err)).toBe('recipient_unavailable');
    expect(getMessengerSendError(err).fbtraceId).toBe('trace-test');
  });

  it('classifies outside-window errors as non-retryable', () => {
    const err = facebookError(10, 2018278, '(#10) This message is sent outside of allowed window.');

    expect(isOutsideAllowedWindowMessengerError(err)).toBeTrue();
    expect(isNonRetryableMessengerSendError(err)).toBeTrue();
    expect(getMessengerSendBlockReason(err)).toBe('outside_allowed_window');
  });

  it('does not classify transient server errors as send blocks', () => {
    const err = facebookError(1, null, 'Unknown error');
    err.response.status = 500;

    expect(isNonRetryableMessengerSendError(err)).toBeFalse();
    expect(getMessengerSendBlockReason(err)).toBe('messenger_send_failed');
  });
});

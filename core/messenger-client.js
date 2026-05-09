const axios = require('axios');

const BOT_MESSAGE_METADATA = 'shop-bot:auto-reply';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createMessengerClient({ fbPageToken }) {
  async function postFb(payload, attempts = 2, options = {}) {
    const timeout = options.timeout || 10000;
    let lastErr;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await axios.post(
          `https://graph.facebook.com/v19.0/me/messages?access_token=${fbPageToken}`,
          payload,
          { timeout }
        );
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        // Chỉ retry khi lỗi tạm thời (network / 5xx). 4xx (token sai, recipient lạ) thì fail nhanh.
        if (status && status >= 400 && status < 500) break;
        if (i < attempts - 1) await sleep(500 * (i + 1));
      }
    }
    throw lastErr;
  }

  async function sendMessage(recipientId, text) {
    const chunks = [];
    while (text.length > 0) {
      chunks.push(text.slice(0, 1900));
      text = text.slice(1900);
    }

    for (const chunk of chunks) {
      await postFb({
        recipient: { id: recipientId },
        message: { text: chunk, metadata: BOT_MESSAGE_METADATA }
      });
    }
  }

  async function sendQuickReplies(recipientId, text, quickReplies = []) {
    const replies = Array.isArray(quickReplies) ? quickReplies.filter(Boolean).slice(0, 13) : [];
    if (!replies.length) return sendMessage(recipientId, text);

    const chunks = [];
    text = String(text || '');
    while (text.length > 0) {
      chunks.push(text.slice(0, 1900));
      text = text.slice(1900);
    }
    if (!chunks.length) chunks.push('');

    for (let i = 0; i < chunks.length; i += 1) {
      const message = { text: chunks[i], metadata: BOT_MESSAGE_METADATA };
      if (i === chunks.length - 1) message.quick_replies = replies;
      await postFb({
        recipient: { id: recipientId },
        message
      });
    }
  }

  async function sendImage(recipientId, imageUrl) {
    if (!imageUrl) return;
    await postFb({
      recipient: { id: recipientId },
      message: {
        metadata: BOT_MESSAGE_METADATA,
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true }
        }
      }
    });
  }

  async function sendCarousel(recipientId, elements) {
    if (!Array.isArray(elements) || !elements.length) return;
    await postFb({
      recipient: { id: recipientId },
      message: {
        metadata: BOT_MESSAGE_METADATA,
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            image_aspect_ratio: 'square',
            elements
          }
        }
      }
    });
  }

  function showTyping(recipientId) {
    // Fire-and-forget: lỗi typing không chặn flow trả lời chính
    return postFb(
      { recipient: { id: recipientId }, sender_action: 'typing_on' },
      1,
      { timeout: 5000 }
    ).catch(() => {});
  }

  async function checkPageToken() {
    try {
      await axios.get(
        `https://graph.facebook.com/v19.0/me/messenger_profile?fields=greeting&access_token=${fbPageToken}`,
        { timeout: 5000 }
      );
      console.log('✅ Page Token có quyền pages_messaging — sẵn sàng gửi tin');
    } catch (err) {
      const e = err.response?.data?.error;
      console.warn(`⚠️  Page Token có vấn đề: ${e?.message || err.message}`);
      console.warn('   Bot vẫn chạy, nhưng có thể KHÔNG gửi được tin tới Messenger.');
    }
  }

  return {
    BOT_MESSAGE_METADATA,
    checkPageToken,
    postFb,
    sendCarousel,
    sendImage,
    sendMessage,
    sendQuickReplies,
    showTyping
  };
}

module.exports = {
  BOT_MESSAGE_METADATA,
  createMessengerClient
};

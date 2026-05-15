const { describe, it, expect } = require('./harness');
const axios = require('axios');
const { createMessengerClient } = require('../core/messenger-client');

describe('messenger client dry-run', () => {
  it('does not call Facebook APIs while preserving send method behavior', async () => {
    const client = createMessengerClient({
      fbPageToken: 'fake-token',
      dryRun: true
    });

    await client.checkPageToken();
    await client.sendMessage('sender_1', 'hello');
    await client.sendQuickReplies('sender_1', 'choose', [{ content_type: 'text', title: 'A', payload: 'A' }]);
    await client.sendImage('sender_1', 'https://example.test/image.jpg');
    await client.sendCarousel('sender_1', [{ title: 'Item', image_url: 'https://example.test/item.jpg' }]);
    await client.showTyping('sender_1');

    const result = await client.postFb({ recipient: { id: 'sender_1' }, message: { text: 'ok' } });
    expect(result.data.dryRun).toBeTrue();
    expect(result.data.payloadType).toBe('message');
  });

  it('uses legacy FB_PAGE_TOKEN by default and page-scoped token for DB runtime sends', async () => {
    const calls = [];
    const originalPost = axios.post;
    axios.post = async (url, payload) => {
      calls.push({ url, payload });
      return { data: { ok: true } };
    };

    try {
      const client = createMessengerClient({
        fbPageToken: 'legacy-file-token',
        dryRun: false
      });
      await client.sendMessage('sender_legacy', 'hello');
      await client.withPageToken('db-page-token').sendImage('sender_db', 'https://example.test/image.jpg');

      expect(calls.length).toBe(2);
      expect(calls[0].url).toContain('access_token=legacy-file-token');
      expect(calls[1].url).toContain('access_token=db-page-token');
      expect(calls[1].url.includes('legacy-file-token')).toBeFalse();
    } finally {
      axios.post = originalPost;
    }
  });

  it('does not fallback to the legacy token when a page-scoped token is empty', async () => {
    const calls = [];
    const originalPost = axios.post;
    axios.post = async url => {
      calls.push(url);
      return { data: { ok: true } };
    };

    try {
      const client = createMessengerClient({
        fbPageToken: 'legacy-file-token',
        dryRun: false
      });
      let errorCode = '';
      try {
        await client.withPageToken('').sendMessage('sender_db', 'hello');
      } catch (err) {
        errorCode = err.code;
      }

      expect(errorCode).toBe('messenger_page_token_missing');
      expect(calls.length).toBe(0);
    } finally {
      axios.post = originalPost;
    }
  });
});

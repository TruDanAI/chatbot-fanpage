const { describe, it, expect } = require('./harness');
const axios = require('axios');
const { STANDARD_MESSAGING_TYPE, createMessengerClient } = require('../core/messenger-client');

async function withMockedPost(fn) {
  const calls = [];
  const originalPost = axios.post;
  axios.post = async (url, payload, options) => {
    calls.push({ url, payload, options });
    return { data: { ok: true } };
  };

  try {
    await fn(calls);
  } finally {
    axios.post = originalPost;
  }
}

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

  it('does not post typing indicators when global dry-run is enabled', async () => {
    await withMockedPost(async calls => {
      const client = createMessengerClient({
        fbPageToken: 'fake-token',
        dryRun: true
      });

      const result = await client.showTyping('sender_1');

      expect(result.data.dryRun).toBeTrue();
      expect(result.data.payloadType).toBe('sender_action');
      expect(calls.length).toBe(0);
    });
  });

  it('does not post typing indicators when scoped dry-run is enabled', async () => {
    await withMockedPost(async calls => {
      const client = createMessengerClient({
        fbPageToken: 'global-token',
        dryRun: false
      });

      const result = await client.showTyping('sender_1', { dryRun: true });

      expect(result.data.dryRun).toBeTrue();
      expect(result.data.payloadType).toBe('sender_action');
      expect(calls.length).toBe(0);
    });
  });

  it('posts typing indicators when global and scoped dry-run are disabled', async () => {
    await withMockedPost(async calls => {
      const client = createMessengerClient({
        fbPageToken: 'global-token',
        dryRun: false
      });

      await client.withPageToken('page-token', { dryRun: false }).showTyping('sender_1');

      expect(calls.length).toBe(1);
      expect(calls[0].payload.sender_action).toBe('typing_on');
      expect(calls[0].options.timeout).toBe(5000);
    });
  });

  it('propagates withPageToken scoped dry-run into typing indicators', async () => {
    await withMockedPost(async calls => {
      const client = createMessengerClient({
        fbPageToken: 'global-token',
        dryRun: false
      });

      const result = await client.withPageToken('page-token', { dryRun: true }).showTyping('sender_1');

      expect(result.data.dryRun).toBeTrue();
      expect(result.data.payloadType).toBe('sender_action');
      expect(calls.length).toBe(0);
    });
  });

  it('keeps client dry-run as a kill switch even when scoped sends request live mode', async () => {
    const calls = [];
    const originalPost = axios.post;
    axios.post = async url => {
      calls.push(url);
      return { data: { ok: true } };
    };

    try {
      const client = createMessengerClient({
        fbPageToken: 'global-token',
        dryRun: true
      });
      const scoped = client.withPageToken('page-token', { dryRun: false });
      const result = await scoped.postFb({ recipient: { id: 'sender_1' }, message: { text: 'ok' } });

      expect(result.data.dryRun).toBeTrue();
      expect(calls.length).toBe(0);
    } finally {
      axios.post = originalPost;
    }
  });

  it('allows page-scoped dry-run while the shared client is otherwise live', async () => {
    const calls = [];
    const originalPost = axios.post;
    axios.post = async url => {
      calls.push(url);
      return { data: { ok: true } };
    };

    try {
      const client = createMessengerClient({
        fbPageToken: 'global-token',
        dryRun: false
      });
      const dryRunPage = client.withPageToken('page-token', { dryRun: true });
      const dryRunResult = await dryRunPage.postFb({ recipient: { id: 'sender_1' }, message: { text: 'ok' } });
      await client.withPageToken('page-token', { dryRun: false }).sendMessage('sender_1', 'hello');

      expect(dryRunResult.data.dryRun).toBeTrue();
      expect(calls.length).toBe(1);
    } finally {
      axios.post = originalPost;
    }
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

  it('sends standard automated messages as Messenger RESPONSE payloads without tags', async () => {
    await withMockedPost(async calls => {
      const client = createMessengerClient({
        fbPageToken: 'page-token',
        dryRun: false
      });

      await client.sendMessage('sender_1', 'hello');
      await client.sendQuickReplies('sender_1', 'choose', [{ content_type: 'text', title: 'A', payload: 'A' }]);
      await client.sendImage('sender_1', 'https://example.test/image.jpg');
      await client.sendCarousel('sender_1', [{ title: 'Item', image_url: 'https://example.test/item.jpg' }]);

      expect(calls.length).toBe(4);
      for (const call of calls) {
        expect(call.payload.messaging_type).toBe(STANDARD_MESSAGING_TYPE);
        expect(call.payload.tag).toBe(undefined);
      }
    });
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

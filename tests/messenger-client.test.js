const { describe, it, expect } = require('./harness');
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
});

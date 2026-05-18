const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, expect } = require('./harness');
const { runStorageAdapterContract } = require('./storage-contract');
const { createPostgresStorageAdapter } = require('../core/storage/postgres-adapter');

function makeTempDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

class FakePgClient {
  constructor(seed = {}) {
    this.seed = {
      conversations: seed.conversations || [],
      profiles: seed.profiles || [],
      messages: seed.messages || [],
      mids: seed.mids || [],
      orders: seed.orders || []
    };
    this.connected = false;
    this.ended = false;
    this.queryCalls = [];
    this.nextOrderId = 1;
    this.processedMids = new Set(this.seed.mids.map(row => this.processedMidKey(
      row.tenant_id || 'tenant_test',
      row.page_id || 'page_test',
      row.mid
    )));
  }

  processedMidKey(tenantId, pageId, mid) {
    return [tenantId, pageId, mid].map(value => String(value || '')).join('\u0000');
  }

  async connect() {
    this.connected = true;
  }

  async end() {
    this.ended = true;
  }

  async query(sql, values = []) {
    this.queryCalls.push({ sql, values });
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      return { rows: [] };
    }

    if (normalized.startsWith('SELECT sender_id, session_state')) {
      return { rows: this.seed.conversations };
    }
    if (normalized.startsWith('SELECT sender_id, first_name')) {
      return { rows: this.seed.profiles };
    }
    if (normalized.startsWith('SELECT sender_id, role')) {
      return { rows: this.seed.messages };
    }
    if (normalized.startsWith('SELECT mid')) {
      return { rows: this.seed.mids };
    }
    if (normalized.includes('FROM orders o')) {
      return { rows: this.seed.orders };
    }
    if (normalized.startsWith('INSERT INTO orders')) {
      const id = this.nextOrderId;
      this.nextOrderId += 1;
      return { rows: [{ id }] };
    }
    if (normalized.startsWith('INSERT INTO processed_mids')) {
      const key = this.processedMidKey(values[0], values[1], values[2]);
      const mid = String(values[2] || '');
      if (this.processedMids.has(key)) return { rows: [] };
      this.processedMids.add(key);
      return { rows: [{ mid }] };
    }

    return { rows: [] };
  }
}

async function createReadyPostgresAdapter(options = {}) {
  const storage = createPostgresStorageAdapter({
    dataDir: options.dataDir,
    tenantId: 'tenant_test',
    pageId: 'page_test',
    client: options.client || new FakePgClient()
  });
  await storage.ready;
  return storage;
}

runStorageAdapterContract({
  name: 'postgres storage',
  createAdapter: createReadyPostgresAdapter
});

describe('postgres storage adapter', () => {
  it('hydrates runtime state from PostgreSQL rows', async () => {
    const client = new FakePgClient({
      conversations: [{
        sender_id: 'sender_1',
        session_state: 'READY_TO_CONFIRM',
        last_product_code: 'MÃ8',
        last_user_at: '2026-05-08T00:00:00.000Z',
        handoff_until: '2099-05-08T00:00:00.000Z',
        timed_out_at: null,
        abandoned_order_draft: {}
      }],
      profiles: [{
        sender_id: 'sender_1',
        first_name: 'Nguyễn',
        last_name: 'An',
        name: 'Nguyễn An',
        profile_pic: 'https://example.test/pic.jpg',
        updated_at: '2026-05-08T01:00:00.000Z'
      }],
      messages: [{
        sender_id: 'sender_1',
        role: 'user',
        text: 'mã 8',
        parts: [{ text: 'mã 8' }]
      }],
      mids: [{ mid: 'mid-1' }],
      orders: [{
        id: 1,
        sender_id: 'sender_1',
        status: 'ready_to_confirm',
        product_code: 'MÃ8',
        customer_name: 'Nguyễn An',
        phone: '0987654321',
        address: '12 Trần Phú',
        draft_updated_at: '2026-05-08T00:05:00.000Z',
        staff_notified_hash: '',
        staff_notified_at: null,
        abandoned_cart_reminder_sent_at: null,
        abandoned_cart_reminder_idle_ms: null,
        abandoned_cart_reminder_missing_fields: [],
        abandoned_cart_reminder_failed_at: null,
        abandoned_cart_reminder_failed_status: null,
        abandoned_cart_reminder_failed_error: '',
        abandoned_at: null,
        raw_draft: {},
        items: [{ code: 'MÃ8', name: 'MÃ8', qty: 1, variant: 'đỏ', display: '' }]
      }]
    });
    const storage = await createReadyPostgresAdapter({
      dataDir: makeTempDataDir('chatbot-postgres-storage-hydrate'),
      client
    });

    expect(storage.getLastProductCode('sender_1')).toBe('MÃ8');
    expect(storage.getSessionState('sender_1')).toBe('READY_TO_CONFIRM');
    expect(storage.inHandoff('sender_1')).toBeTrue();
    expect(await storage.tryMarkMid('mid-1')).toBeFalse();
    expect(storage.getUserProfile('sender_1').name).toBe('Nguyễn An');
    expect(storage.getHistory('sender_1')).toEqual([{ role: 'user', parts: [{ text: 'mã 8' }] }]);
    expect(storage.getOrderDraft('sender_1').cartItems).toEqual([
      { code: 'MÃ8', name: 'MÃ8', qty: 1, variant: 'đỏ', display: '' }
    ]);
  });

  it('persists writes through queued PostgreSQL queries', async () => {
    const client = new FakePgClient();
    const storage = await createReadyPostgresAdapter({
      dataDir: makeTempDataDir('chatbot-postgres-storage-persist'),
      client
    });

    storage.setLastProductCode('sender_2', 'MÃ10');
    storage.mergeOrderDraft('sender_2', {
      productCode: 'MÃ10',
      phone: '0987654321',
      cartItems: [{ code: 'MÃ10', name: 'MÃ10', qty: 1 }]
    });
    expect(await storage.tryMarkMid('mid-2', { senderId: 'sender_2' })).toBeTrue();
    expect(await storage.tryMarkMid('mid-2', { senderId: 'sender_2' })).toBeFalse();
    await storage.flush();

    const sql = client.queryCalls.map(call => String(call.sql).replace(/\s+/g, ' ').trim());
    expect(sql.some(item => item.startsWith('INSERT INTO conversations'))).toBeTrue();
    expect(sql.some(item => item.startsWith('INSERT INTO orders'))).toBeTrue();
    expect(sql.some(item => item.startsWith('INSERT INTO processed_mids'))).toBeTrue();
    expect(sql.some(item => item.includes('ON CONFLICT (tenant_id, page_id, mid) DO NOTHING RETURNING mid'))).toBeTrue();
  });

  it('scopes atomic mid idempotency by details page id', async () => {
    const client = new FakePgClient();
    const storage = await createReadyPostgresAdapter({
      dataDir: makeTempDataDir('chatbot-postgres-storage-page-scope'),
      client
    });

    expect(await storage.tryMarkMid('same-mid', { senderId: 'sender_3', pageId: 'page_a' })).toBeTrue();
    expect(await storage.tryMarkMid('same-mid', { senderId: 'sender_3', pageId: 'page_a' })).toBeFalse();
    expect(await storage.tryMarkMid('same-mid', { senderId: 'sender_3', pageId: 'page_b' })).toBeTrue();

    const pageIds = client.queryCalls
      .filter(call => String(call.sql).replace(/\s+/g, ' ').trim().startsWith('INSERT INTO processed_mids'))
      .map(call => call.values[1]);
    expect(pageIds.slice(-3)).toEqual(['page_a', 'page_a', 'page_b']);
  });

  it('binds runtime state to tenant/page contexts for same sender id', async () => {
    const client = new FakePgClient();
    const storage = await createReadyPostgresAdapter({
      dataDir: makeTempDataDir('chatbot-postgres-storage-context-state'),
      client
    });
    const pageA = storage.forContext({ tenantId: 'tenant_a', pageId: 'page_a', shopId: 'shop_a' });
    const pageB = storage.forContext({ tenantId: 'tenant_b', pageId: 'page_b', shopId: 'shop_b' });
    await pageA.ready;
    await pageB.ready;

    const senderId = 'same_sender';
    pageA.setHandoff(senderId, Date.now() + 60 * 1000);
    pageA.setLastProductCode(senderId, 'MÃ8');
    pageA.setLastUserAt(senderId, '2026-05-08T00:00:00.000Z');
    pageA.setUserProfile(senderId, { first_name: 'Page', last_name: 'A' });
    pageA.mergeOrderDraft(senderId, { productCode: 'MÃ8', phone: '0987654321' });
    pageA.setSessionState(senderId, 'READY_TO_CONFIRM');
    pageA.setHistory(senderId, [{ role: 'user', parts: [{ text: 'page a' }] }]);

    expect(pageB.inHandoff(senderId)).toBeFalse();
    expect(pageB.getLastProductCode(senderId)).toBe('');
    expect(pageB.getLastUserAt(senderId)).toBe('');
    expect(pageB.getUserProfile(senderId)).toEqual({});
    expect(pageB.getOrderDraft(senderId)).toEqual({});
    expect(pageB.getSessionState(senderId)).toBe('');
    expect(pageB.getHistory(senderId)).toEqual([]);

    pageB.setLastProductCode(senderId, 'MÃ10');
    pageB.mergeOrderDraft(senderId, { productCode: 'MÃ10', phone: '0111222333' });
    pageB.setSessionState(senderId, 'COLLECTING_INFO');
    pageB.setHistory(senderId, [{ role: 'user', parts: [{ text: 'page b' }] }]);

    expect(pageA.getLastProductCode(senderId)).toBe('MÃ8');
    expect(pageA.getOrderDraft(senderId).phone).toBe('0987654321');
    expect(pageA.getSessionState(senderId)).toBe('READY_TO_CONFIRM');
    expect(pageA.getHistory(senderId)[0].parts[0].text).toBe('page a');
  });

  it('writes events and customers with the bound tenant/page context', async () => {
    const client = new FakePgClient();
    const storage = await createReadyPostgresAdapter({
      dataDir: makeTempDataDir('chatbot-postgres-storage-context-events'),
      client
    });
    const pageA = storage.forContext({ tenantId: 'tenant_a', pageId: 'page_a', shopId: 'shop_a' });
    const pageB = storage.forContext({ tenantId: 'tenant_b', pageId: 'page_b', shopId: 'shop_b' });
    await pageA.ready;
    await pageB.ready;

    await pageA.appendEvent({
      at: '2026-05-08T00:00:00.000Z',
      type: 'message_received',
      senderId: 'same_sender',
      text: 'hello'
    });
    await pageB.appendCustomer({
      at: '2026-05-08T00:00:01.000Z',
      type: 'lead',
      senderId: 'same_sender',
      phone: '0987654321'
    });

    const eventWrites = client.queryCalls
      .filter(call => String(call.sql).replace(/\s+/g, ' ').trim().startsWith('INSERT INTO events'))
      .map(call => call.values.slice(0, 5));

    expect(eventWrites.slice(-2)).toEqual([
      ['tenant_a', 'page_a', 'same_sender', '2026-05-08T00:00:00.000Z', 'message_received'],
      ['tenant_b', 'page_b', 'same_sender', '2026-05-08T00:00:01.000Z', 'lead']
    ]);
  });

  it('uses the bound page id for mid idempotency by default', async () => {
    const client = new FakePgClient();
    const storage = await createReadyPostgresAdapter({
      dataDir: makeTempDataDir('chatbot-postgres-storage-context-mids'),
      client
    });
    const pageA = storage.forContext({ tenantId: 'tenant_a', pageId: 'page_a' });
    const pageB = storage.forContext({ tenantId: 'tenant_a', pageId: 'page_b' });
    await pageA.ready;
    await pageB.ready;

    expect(await pageA.tryMarkMid('same-mid', { senderId: 'same_sender' })).toBeTrue();
    expect(await pageA.tryMarkMid('same-mid', { senderId: 'same_sender' })).toBeFalse();
    expect(await pageB.tryMarkMid('same-mid', { senderId: 'same_sender' })).toBeTrue();

    const midScopes = client.queryCalls
      .filter(call => String(call.sql).replace(/\s+/g, ' ').trim().startsWith('INSERT INTO processed_mids'))
      .map(call => [call.values[0], call.values[1], call.values[2]]);
    expect(midScopes.slice(-3)).toEqual([
      ['tenant_a', 'page_a', 'same-mid'],
      ['tenant_a', 'page_a', 'same-mid'],
      ['tenant_a', 'page_b', 'same-mid']
    ]);
  });
});

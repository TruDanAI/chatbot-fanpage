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
    expect(storage.seenMid('mid-1')).toBeTrue();
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
    storage.markMid('mid-2');
    await storage.flush();

    const sql = client.queryCalls.map(call => String(call.sql).replace(/\s+/g, ' ').trim());
    expect(sql.some(item => item.startsWith('INSERT INTO conversations'))).toBeTrue();
    expect(sql.some(item => item.startsWith('INSERT INTO orders'))).toBeTrue();
    expect(sql.some(item => item.startsWith('INSERT INTO processed_mids'))).toBeTrue();
  });
});

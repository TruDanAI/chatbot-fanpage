const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, expect } = require('./harness');
const {
  applyMigrationPlan,
  buildMigrationPlan,
  formatApplySummary,
  formatPlanSummary,
  parseCliArgs,
  runCli
} = require('../scripts/migrate-file-storage-to-postgres');

function makeTempDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeJson(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
}

function csvCell(value) {
  const text = value == null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCustomersCsv(file, rows) {
  const headers = ['at', 'type', 'senderId', 'productCode', 'phone', 'name', 'address', 'text', 'history'];
  const body = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))
  ].join('\n') + '\n';
  fs.writeFileSync(file, body, 'utf8');
}

class FakePgClient {
  constructor() {
    this.queries = [];
    this.queryCalls = [];
    this.counts = {
      profiles: 0,
      conversations: 0,
      messages: 0,
      orders: 0,
      order_items: 0,
      events: 0,
      processed_mids: 0
    };
    this.nextOrderId = 1;
    this.connected = false;
    this.ended = false;
  }

  async connect() {
    this.connected = true;
  }

  async end() {
    this.ended = true;
  }

  async query(sql, values = []) {
    this.queries.push(sql);
    this.queryCalls.push({ sql, values });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

    const countMatch = sql.match(/FROM "([^"]+)"/);
    if (countMatch && sql.includes('COUNT(*)')) {
      return { rows: [{ count: this.counts[countMatch[1]] || 0 }] };
    }

    const insertMatch = sql.match(/^INSERT INTO "([^"]+)"/);
    if (insertMatch) {
      const table = insertMatch[1];
      this.counts[table] += 1;
      if (table === 'orders') {
        const id = this.nextOrderId;
        this.nextOrderId += 1;
        return { rows: [{ id, migration_source_key: `order-${id}` }] };
      }
      return { rows: [] };
    }

    throw new Error(`Unexpected fake query: ${sql}`);
  }
}

describe('migration planner: file storage to postgres', () => {
  it('builds a dry-run plan from file storage fixtures', () => {
    const dataDir = makeTempDataDir('chatbot-migration-plan');
    writeJson(path.join(dataDir, 'chat-state.json'), {
      history: {
        user_1: [
          { role: 'user', parts: [{ text: 'ma 8' }] },
          { role: 'model', parts: [{ text: 'Da ma 8 a' }] }
        ]
      },
      handoff: {
        user_1: Date.parse('2026-05-08T02:00:00.000Z')
      },
      context: {
        user_1: {
          sessionState: 'READY_TO_CONFIRM',
          lastProductCode: 'M8',
          lastUserAt: '2026-05-08T00:00:00.000Z',
          timedOutAt: '2026-05-08T01:00:00.000Z',
          orderDraft: {
            productCode: 'M8',
            phone: '0987654321',
            name: 'An',
            address: '12 Tran Phu',
            updatedAt: '2026-05-08T00:10:00.000Z',
            staffNotifiedHash: 'hash-1',
            staffNotifiedAt: '2026-05-08T00:11:00.000Z',
            abandonedCartReminderSentAt: '2026-05-08T00:12:00.000Z',
            abandonedCartReminderIdleMs: 1260000,
            abandonedCartReminderMissingFields: ['address'],
            cartItems: [
              { code: 'M8', name: 'M8', qty: 2, variant: 'red', display: '2 x M8 red' }
            ]
          },
          abandonedOrderDraft: {
            productCode: 'M7',
            abandonedAt: '2026-05-07T00:00:00.000Z'
          }
        }
      },
      profiles: {
        user_1: {
          firstName: 'Nguyen',
          lastName: 'An',
          profilePic: 'https://example.test/pic.jpg',
          updatedAt: '2026-05-08T00:05:00.000Z'
        }
      }
    });
    writeJson(path.join(dataDir, 'processed-mids.json'), ['mid-1', 'mid-1']);
    fs.writeFileSync(
      path.join(dataDir, 'events.jsonl'),
      JSON.stringify({
        at: '2026-05-08T00:20:00.000Z',
        type: 'message_received',
        senderId: 'user_1',
        sessionState: 'READY_TO_CONFIRM',
        productCode: 'M8',
        text: 'ok',
        meta: { messageId: 'mid-1' }
      }) + '\n',
      'utf8'
    );
    writeCustomersCsv(path.join(dataDir, 'customers.csv'), [{
      at: '2026-05-08T00:21:00.000Z',
      type: 'lead',
      senderId: 'user_1',
      productCode: 'M8',
      phone: '0987654321',
      name: 'An',
      address: '12 Tran Phu',
      text: 'ship',
      history: [{ role: 'user', parts: [{ text: 'ma 8' }] }]
    }]);
    fs.writeFileSync(
      path.join(dataDir, 'sheet-outbox.jsonl'),
      JSON.stringify({
        enqueuedAt: '2026-05-08T00:22:00.000Z',
        dedupeKey: 'sheet-1',
        leadData: {
          senderId: 'user_1',
          name: 'An',
          phone: '0987654321',
          address: '12 Tran Phu',
          productCode: 'M8',
          text: 'pending sheet sync'
        },
        lastError: 'timeout'
      }) + '\n',
      'utf8'
    );

    const plan = buildMigrationPlan({
      dataDir,
      tenantId: 'tenant_1',
      pageId: 'page_1',
      now: '2026-05-09T00:00:00.000Z'
    });

    expect(plan.dryRun).toBeTrue();
    expect(plan.counts).toEqual({
      profiles: 1,
      conversations: 1,
      messages: 2,
      orders: 2,
      order_items: 1,
      events: 3,
      processed_mids: 1
    });
    expect(plan.rows.conversations[0].handoff_until).toBe('2026-05-08T02:00:00.000Z');
    expect(plan.rows.orders[0].status).toBe('ready_to_confirm');
    expect(plan.rows.orders[0].staff_notified_hash).toBe('hash-1');
    expect(plan.rows.order_items[0].order_source_key).toBe('user_1:active');
    expect(plan.rows.events.map(event => event.source)).toEqual(['runtime', 'customer_export', 'sheet_outbox']);
    expect(plan.rows.processed_mids[0].mid).toBe('mid-1');
    expect(plan.warnings).toEqual([]);
  });

  it('returns an empty dry-run plan when storage files are missing', () => {
    const plan = buildMigrationPlan({
      dataDir: makeTempDataDir('chatbot-migration-empty'),
      now: '2026-05-09T00:00:00.000Z'
    });

    expect(plan.counts).toEqual({
      profiles: 0,
      conversations: 0,
      messages: 0,
      orders: 0,
      order_items: 0,
      events: 0,
      processed_mids: 0
    });
    expect(plan.warnings).toEqual([]);
  });

  it('prints count-only summaries and guards apply mode', async () => {
    const dataDir = makeTempDataDir('chatbot-migration-cli');
    const plan = buildMigrationPlan({
      dataDir,
      now: '2026-05-09T00:00:00.000Z'
    });
    const summary = formatPlanSummary(plan);
    expect(summary).toContain('No database writes were performed.');
    expect(summary).toContain('processed_mids: 0');

    const args = parseCliArgs(['--data-dir', dataDir, '--tenant-id', 't1', '--page-id', 'p1', '--json']);
    expect(args).toEqual({
      dryRun: true,
      json: true,
      dataDir,
      tenantId: 't1',
      pageId: 'p1'
    });

    let output = '';
    const exitCode = await runCli(['--data-dir', dataDir, '--json'], {
      log(message) {
        output = message;
      }
    });
    expect(exitCode).toBe(0);
    expect(output).toContain('"dryRun": true');

    let applyError = '';
    try {
      await runCli(['--apply'], { log() {} });
    } catch (err) {
      applyError = err.message;
    }
    expect(applyError).toContain('--i-have-backed-up-data');

    applyError = '';
    try {
      await runCli(['--apply', '--i-have-backed-up-data'], { log() {} }, { env: {} });
    } catch (err) {
      applyError = err.message;
    }
    expect(applyError).toContain('--database-url');
  });

  it('applies a plan through a guarded PostgreSQL writer transaction', async () => {
    const dataDir = makeTempDataDir('chatbot-migration-apply');
    writeJson(path.join(dataDir, 'chat-state.json'), {
      history: {
        user_1: [{ role: 'user', parts: [{ text: 'ma 8' }] }]
      },
      context: {
        user_1: {
          sessionState: 'READY_TO_CONFIRM',
          lastProductCode: 'M8',
          orderDraft: {
            productCode: 'M8',
            phone: '0987654321',
            name: 'An',
            address: '12 Tran Phu',
            updatedAt: '2026-05-08T00:10:00.000Z',
            cartItems: [{ code: 'M8', name: 'M8', qty: 1 }]
          }
        }
      },
      profiles: {
        user_1: { firstName: 'Nguyen', lastName: 'An' }
      }
    });
    writeJson(path.join(dataDir, 'processed-mids.json'), ['mid-1']);
    fs.writeFileSync(
      path.join(dataDir, 'events.jsonl'),
      JSON.stringify({ at: '2026-05-08T00:20:00.000Z', type: 'message_received', senderId: 'user_1' }) + '\n',
      'utf8'
    );

    const plan = buildMigrationPlan({
      dataDir,
      tenantId: 'tenant_1',
      pageId: 'page_1',
      now: '2026-05-09T00:00:00.000Z'
    });
    const client = new FakePgClient();
    const result = await applyMigrationPlan(plan, {
      client,
      databaseUrl: 'postgres://dev.example/chatbot',
      iHaveBackedUpData: true,
      migrationTarget: 'dev',
      skipSchemaCheck: true
    });

    expect(result.dryRun).toBeFalse();
    expect(result.appliedCounts).toEqual(plan.counts);
    expect(result.beforeCounts.profiles).toBe(0);
    expect(result.afterCounts.profiles).toBe(1);
    expect(client.queries).toContain('BEGIN');
    expect(client.queries).toContain('COMMIT');
    expect(formatApplySummary(result)).toContain('Database writes were performed inside one transaction.');

    const messageInsert = client.queryCalls.find(call => call.sql.startsWith('INSERT INTO "messages"'));
    expect(typeof messageInsert.values[6]).toBe('string');
    expect(JSON.parse(messageInsert.values[6])).toEqual([{ text: 'ma 8' }]);
    expect(typeof messageInsert.values[9]).toBe('string');
    expect(JSON.parse(messageInsert.values[9])).toEqual({});
  });
});

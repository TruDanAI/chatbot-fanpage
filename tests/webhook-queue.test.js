const { describe, it, expect } = require('./harness');
const {
  createWebhookQueueRepository,
  createWebhookQueueService
} = require('../core/webhook-queue');

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

class FakeQueueDb {
  constructor(seed = []) {
    this.rows = [];
    this.queryCalls = [];
    this.nextId = 1;
    for (const row of seed) this.insertSeed(row);
  }

  insertSeed(row = {}) {
    const now = row.created_at || new Date('2026-05-15T00:00:00.000Z');
    const id = row.id || this.nextId;
    this.nextId = Math.max(this.nextId, Number(id) + 1);
    const stored = {
      id,
      tenant_id: row.tenant_id || 'tenant_test',
      page_id: row.page_id || 'page_test',
      status: row.status || 'queued',
      payload_json: row.payload_json || {},
      event_json: row.event_json || {},
      attempt_count: Number(row.attempt_count || 0),
      max_attempts: Number(row.max_attempts || 5),
      available_at: row.available_at || now,
      locked_at: row.locked_at || null,
      locked_by: row.locked_by || '',
      last_error: row.last_error || '',
      created_at: now,
      updated_at: row.updated_at || now,
      processed_at: row.processed_at || null
    };
    this.rows.push(stored);
    return stored;
  }

  async query(sql, values = []) {
    const normalized = normalizeSql(sql);
    this.queryCalls.push({ sql: normalized, values });

    if (normalized.startsWith('INSERT INTO webhook_queue')) {
      const row = this.insertSeed({
        tenant_id: values[0],
        page_id: values[1],
        status: 'queued',
        payload_json: parseJson(values[2]),
        event_json: parseJson(values[3]),
        attempt_count: 0,
        max_attempts: values[4],
        available_at: values[5]
      });
      return { rows: [{ ...row }] };
    }

    if (normalized.includes('FOR UPDATE SKIP LOCKED')) {
      const [tenantId, now, limit, workerId] = values;
      const jobs = this.rows
        .filter(row => row.tenant_id === tenantId && row.status === 'queued' && row.available_at <= now)
        .sort((a, b) => {
          const byTime = new Date(a.available_at).getTime() - new Date(b.available_at).getTime();
          return byTime || Number(a.id) - Number(b.id);
        })
        .slice(0, limit);
      for (const row of jobs) {
        row.status = 'processing';
        row.locked_at = now;
        row.locked_by = workerId;
        row.updated_at = now;
      }
      return { rows: jobs.map(row => ({ ...row })) };
    }

    if (normalized.startsWith("UPDATE webhook_queue SET status = 'done'")) {
      const [tenantId, now, id] = values;
      const row = this.rows.find(item => item.tenant_id === tenantId && item.id === id && item.status === 'processing');
      if (!row) return { rows: [] };
      row.status = 'done';
      row.locked_at = null;
      row.locked_by = '';
      row.updated_at = now;
      row.processed_at = now;
      return { rows: [{ ...row }] };
    }

    if (normalized.startsWith('UPDATE webhook_queue SET attempt_count = attempt_count + 1')) {
      const [tenantId, now, id, availableAt, lastError] = values;
      const row = this.rows.find(item => item.tenant_id === tenantId && item.id === id && item.status === 'processing');
      if (!row) return { rows: [] };
      const nextAttempt = row.attempt_count + 1;
      const failed = nextAttempt >= row.max_attempts;
      row.attempt_count = nextAttempt;
      row.status = failed ? 'failed' : 'queued';
      row.available_at = failed ? row.available_at : availableAt;
      row.locked_at = null;
      row.locked_by = '';
      row.last_error = lastError;
      row.updated_at = now;
      row.processed_at = failed ? now : null;
      return { rows: [{ ...row }] };
    }

    throw new Error(`Unexpected fake query: ${normalized}`);
  }
}

describe('webhook queue repository', () => {
  it('enqueue creates a queued row', async () => {
    const db = new FakeQueueDb();
    const repo = createWebhookQueueRepository({
      db,
      tenantId: 'tenant_queue',
      maxAttempts: 3
    });
    const availableAt = new Date('2026-05-15T01:00:00.000Z');

    const job = await repo.enqueueEvent({
      pageId: 'page_queue',
      payload: { baseUrl: 'https://example.test', pageId: 'page_queue' },
      event: { sender: { id: 'sender_1' }, message: { mid: 'mid_1', text: 'hello' } },
      availableAt
    });

    expect(job.status).toBe('queued');
    expect(job.pageId).toBe('page_queue');
    expect(job.attemptCount).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(db.rows.length).toBe(1);
    expect(db.rows[0].payload_json.baseUrl).toBe('https://example.test');
    expect(db.rows[0].event_json.message.mid).toBe('mid_1');
  });

  it('claim uses FOR UPDATE SKIP LOCKED', async () => {
    const db = new FakeQueueDb([{
      tenant_id: 'tenant_queue',
      page_id: 'page_queue',
      available_at: new Date('2026-05-15T01:00:00.000Z')
    }]);
    const repo = createWebhookQueueRepository({ db, tenantId: 'tenant_queue' });

    const jobs = await repo.claimNextBatch({
      limit: 1,
      workerId: 'worker_1',
      now: new Date('2026-05-15T01:00:01.000Z')
    });

    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe('processing');
    expect(jobs[0].lockedBy).toBe('worker_1');
    expect(db.queryCalls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED'))).toBeTrue();
  });

  it('mark done finalizes a processing row', async () => {
    const db = new FakeQueueDb([{
      id: 9,
      tenant_id: 'tenant_queue',
      status: 'processing',
      locked_by: 'worker_1'
    }]);
    const repo = createWebhookQueueRepository({ db, tenantId: 'tenant_queue' });
    const now = new Date('2026-05-15T01:05:00.000Z');

    const job = await repo.markDone(9, { now });

    expect(job.status).toBe('done');
    expect(job.lockedBy).toBe('');
    expect(job.processedAt).toBe(now);
  });

  it('retry increments attempt_count and sets available_at', async () => {
    const db = new FakeQueueDb([{
      id: 10,
      tenant_id: 'tenant_queue',
      status: 'processing',
      attempt_count: 0,
      max_attempts: 3,
      available_at: new Date('2026-05-15T01:00:00.000Z')
    }]);
    const repo = createWebhookQueueRepository({ db, tenantId: 'tenant_queue' });
    const now = new Date('2026-05-15T01:10:00.000Z');

    const job = await repo.markFailedOrRetry(10, 'temporary_down', {
      now,
      retryDelayMs: 30000
    });

    expect(job.status).toBe('queued');
    expect(job.attemptCount).toBe(1);
    expect(new Date(job.availableAt).toISOString()).toBe('2026-05-15T01:10:30.000Z');
    expect(job.lastError).toBe('temporary_down');
  });

  it('max attempts moves to failed', async () => {
    const originalAvailableAt = new Date('2026-05-15T01:00:00.000Z');
    const db = new FakeQueueDb([{
      id: 11,
      tenant_id: 'tenant_queue',
      status: 'processing',
      attempt_count: 1,
      max_attempts: 2,
      available_at: originalAvailableAt
    }]);
    const repo = createWebhookQueueRepository({ db, tenantId: 'tenant_queue' });
    const now = new Date('2026-05-15T01:20:00.000Z');

    const job = await repo.markFailedOrRetry(11, 'permanent_down', {
      now,
      retryDelayMs: 30000
    });

    expect(job.status).toBe('failed');
    expect(job.attemptCount).toBe(2);
    expect(job.processedAt).toBe(now);
    expect(job.availableAt).toBe(originalAvailableAt);
  });
});

describe('webhook queue service', () => {
  it('does not log raw customer data from thrown errors', async () => {
    const db = new FakeQueueDb([{
      id: 12,
      tenant_id: 'tenant_queue',
      status: 'queued',
      max_attempts: 1,
      available_at: new Date('2026-05-15T01:00:00.000Z')
    }]);
    const repo = createWebhookQueueRepository({ db, tenantId: 'tenant_queue' });
    const warnings = [];
    const service = createWebhookQueueService({
      repository: repo,
      workerId: 'worker_1',
      logger: { warn: message => warnings.push(String(message)) },
      processJob: async () => {
        throw new Error('raw customer body 0987654321 token EAAB-secret');
      }
    });

    const summary = await service.processNextBatch({
      now: new Date('2026-05-15T01:30:00.000Z')
    });

    expect(summary.failed).toBe(1);
    const warningText = warnings.join('\n');
    expect(warningText.includes('0987654321')).toBeFalse();
    expect(warningText.includes('EAAB-secret')).toBeFalse();
    expect(warningText).toContain('reason=Error');
  });
});

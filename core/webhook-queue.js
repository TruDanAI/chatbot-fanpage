const os = require('os');

const DEFAULT_TENANT_ID = 'default';
const DEFAULT_PAGE_ID = 'unknown';
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_RETRY_DELAY_MS = 15 * 1000;
const DEFAULT_WORKER_INTERVAL_MS = 1000;

function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function normalizeIdentifier(value, fallback) {
  return trimText(value) || fallback;
}

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function positiveInteger(value, fallback, options = {}) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return fallback;
  if (options.max != null && number > options.max) return options.max;
  return number;
}

function nonNegativeInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toDate(value, fallback = new Date()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : fallback;
  }
  if (value != null && value !== '') {
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return new Date(parsed);
  }
  return fallback;
}

function safeErrorCode(error) {
  const raw = typeof error === 'string'
    ? error
    : error?.code || error?.reason || error?.name || 'webhook_queue_job_failed';
  return trimText(raw)
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 120) || 'webhook_queue_job_failed';
}

function mapJobRow(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    pageId: row.page_id,
    status: row.status,
    payloadJson: normalizeJsonObject(row.payload_json),
    eventJson: normalizeJsonObject(row.event_json),
    attemptCount: nonNegativeInteger(row.attempt_count, 0),
    maxAttempts: positiveInteger(row.max_attempts, DEFAULT_MAX_ATTEMPTS),
    availableAt: row.available_at || null,
    lockedAt: row.locked_at || null,
    lockedBy: row.locked_by || '',
    lastError: trimText(row.last_error),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    processedAt: row.processed_at || null
  };
}

function createWebhookQueueRepository(options = {}) {
  const db = options.db;
  if (!db || typeof db.query !== 'function') {
    throw new Error('webhook_queue_repository_requires_queryable_db');
  }

  const tenantId = normalizeIdentifier(options.tenantId, DEFAULT_TENANT_ID);
  const defaultMaxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const defaultRetryDelayMs = nonNegativeInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);

  async function enqueueEvent(eventOptions = {}) {
    const pageId = normalizeIdentifier(eventOptions.pageId, DEFAULT_PAGE_ID);
    const maxAttempts = positiveInteger(eventOptions.maxAttempts, defaultMaxAttempts);
    const availableAt = toDate(eventOptions.availableAt);
    const payloadJson = normalizeJsonObject(eventOptions.payload);
    const eventJson = normalizeJsonObject(eventOptions.event);

    const result = await db.query(
      `
        INSERT INTO webhook_queue (
          tenant_id, page_id, status, payload_json, event_json,
          attempt_count, max_attempts, available_at, created_at, updated_at
        )
        VALUES ($1, $2, 'queued', $3::jsonb, $4::jsonb, 0, $5, $6, now(), now())
        RETURNING id, tenant_id, page_id, status, payload_json, event_json,
                  attempt_count, max_attempts, available_at, locked_at,
                  locked_by, last_error, created_at, updated_at, processed_at
      `,
      [
        tenantId,
        pageId,
        JSON.stringify(payloadJson),
        JSON.stringify(eventJson),
        maxAttempts,
        availableAt
      ]
    );

    return mapJobRow(result.rows?.[0]);
  }

  async function claimNextBatch(claimOptions = {}) {
    const limit = positiveInteger(claimOptions.limit, DEFAULT_BATCH_SIZE, { max: 100 });
    const workerId = normalizeIdentifier(
      claimOptions.workerId,
      `${os.hostname() || 'worker'}:${process.pid || '0'}`
    ).slice(0, 120);
    const now = toDate(claimOptions.now);

    const result = await db.query(
      `
        WITH next_jobs AS (
          SELECT id
          FROM webhook_queue
          WHERE tenant_id = $1
            AND status = 'queued'
            AND available_at <= $2
          ORDER BY available_at ASC, id ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        )
        UPDATE webhook_queue q
        SET status = 'processing',
            locked_at = $2,
            locked_by = $4,
            updated_at = $2
        FROM next_jobs
        WHERE q.id = next_jobs.id
        RETURNING q.id, q.tenant_id, q.page_id, q.status, q.payload_json, q.event_json,
                  q.attempt_count, q.max_attempts, q.available_at, q.locked_at,
                  q.locked_by, q.last_error, q.created_at, q.updated_at, q.processed_at
      `,
      [tenantId, now, limit, workerId]
    );

    return (result.rows || []).map(mapJobRow);
  }

  async function markDone(id, doneOptions = {}) {
    const now = toDate(doneOptions.now);
    const result = await db.query(
      `
        UPDATE webhook_queue
        SET status = 'done',
            locked_at = NULL,
            locked_by = '',
            updated_at = $2,
            processed_at = $2
        WHERE tenant_id = $1
          AND id = $3
          AND status = 'processing'
        RETURNING id, tenant_id, page_id, status, payload_json, event_json,
                  attempt_count, max_attempts, available_at, locked_at,
                  locked_by, last_error, created_at, updated_at, processed_at
      `,
      [tenantId, now, id]
    );

    return result.rows?.[0] ? mapJobRow(result.rows[0]) : null;
  }

  async function markFailedOrRetry(id, error, failureOptions = {}) {
    const now = toDate(failureOptions.now);
    const retryDelayMs = nonNegativeInteger(failureOptions.retryDelayMs, defaultRetryDelayMs);
    const availableAt = toDate(failureOptions.availableAt, new Date(now.getTime() + retryDelayMs));
    const safeError = safeErrorCode(error);

    const result = await db.query(
      `
        UPDATE webhook_queue
        SET attempt_count = attempt_count + 1,
            status = CASE
              WHEN attempt_count + 1 >= max_attempts THEN 'failed'
              ELSE 'queued'
            END,
            available_at = CASE
              WHEN attempt_count + 1 >= max_attempts THEN available_at
              ELSE $4
            END,
            locked_at = NULL,
            locked_by = '',
            last_error = $5,
            updated_at = $2,
            processed_at = CASE
              WHEN attempt_count + 1 >= max_attempts THEN $2
              ELSE NULL
            END
        WHERE tenant_id = $1
          AND id = $3
          AND status = 'processing'
        RETURNING id, tenant_id, page_id, status, payload_json, event_json,
                  attempt_count, max_attempts, available_at, locked_at,
                  locked_by, last_error, created_at, updated_at, processed_at
      `,
      [tenantId, now, id, availableAt, safeError]
    );

    return result.rows?.[0] ? mapJobRow(result.rows[0]) : null;
  }

  return {
    claimNextBatch,
    enqueueEvent,
    markDone,
    markFailedOrRetry
  };
}

function createWebhookQueueService(options = {}) {
  const repository = options.repository;
  const processJob = options.processJob;
  if (!repository) throw new Error('webhook_queue_service_requires_repository');
  if (typeof processJob !== 'function') throw new Error('webhook_queue_service_requires_process_job');

  const logger = options.logger || console;
  const workerId = normalizeIdentifier(
    options.workerId,
    `${os.hostname() || 'worker'}:${process.pid || '0'}`
  ).slice(0, 120);
  const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, { max: 100 });
  const retryDelayMs = nonNegativeInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
  const intervalMs = positiveInteger(options.intervalMs, DEFAULT_WORKER_INTERVAL_MS);
  let timer = null;
  let running = false;

  async function processNextBatch(batchOptions = {}) {
    if (running) return { skipped: true, claimed: 0, done: 0, retried: 0, failed: 0 };
    running = true;
    const summary = { skipped: false, claimed: 0, done: 0, retried: 0, failed: 0 };

    try {
      const jobs = await repository.claimNextBatch({
        limit: positiveInteger(batchOptions.batchSize, batchSize, { max: 100 }),
        workerId: normalizeIdentifier(batchOptions.workerId, workerId),
        now: batchOptions.now
      });
      summary.claimed = jobs.length;

      for (const job of jobs) {
        try {
          await processJob(job);
          const done = await repository.markDone(job.id, { now: batchOptions.now });
          if (done) summary.done += 1;
        } catch (err) {
          const result = await repository.markFailedOrRetry(job.id, err, {
            now: batchOptions.now,
            retryDelayMs: batchOptions.retryDelayMs ?? retryDelayMs
          });
          const status = result?.status || 'unknown';
          if (status === 'failed') summary.failed += 1;
          else summary.retried += 1;
          logger.warn?.(
            `[webhook-queue] job failed id=${job.id} status=${status} attempt_count=${result?.attemptCount ?? ''}/${result?.maxAttempts ?? ''} reason=${result?.lastError || safeErrorCode(err)}`
          );
        }
      }

      return summary;
    } finally {
      running = false;
    }
  }

  function start(startOptions = {}) {
    if (timer) return timer;
    const effectiveIntervalMs = positiveInteger(startOptions.intervalMs, intervalMs);
    const tick = () => {
      void processNextBatch().catch(err => {
        logger.error?.(`[webhook-queue] worker tick failed reason=${safeErrorCode(err)}`);
      });
    };
    timer = setInterval(tick, effectiveIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    tick();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    processNextBatch,
    start,
    stop
  };
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  createWebhookQueueRepository,
  createWebhookQueueService,
  safeErrorCode
};

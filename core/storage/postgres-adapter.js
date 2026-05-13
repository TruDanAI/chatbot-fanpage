const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { CUSTOMER_HEADERS } = require('./file-adapter');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_TENANT_ID = 'default';
const DEFAULT_PAGE_ID = 'default';
const MID_LIMIT = 5000;

function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function normalizeIdentifier(value, fallback) {
  const normalized = trimText(value);
  return normalized || fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeJsonObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  const raw = trimText(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numericDate = new Date(Number(raw));
    if (Number.isFinite(numericDate.getTime())) return numericDate.toISOString();
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseTimeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function followUpMetaFromContext(context = {}) {
  const meta = {};
  if (trimText(context.engagedFollowUpAt)) meta.engagedFollowUpAt = trimText(context.engagedFollowUpAt);
  if (trimText(context.engagedFollowUpLastNote)) meta.engagedFollowUpLastNote = trimText(context.engagedFollowUpLastNote);
  if (trimText(context.engagedFollowUpReminderSentAt)) {
    meta.engagedFollowUpReminderSentAt = trimText(context.engagedFollowUpReminderSentAt);
  }
  if (Number.isFinite(Number(context.engagedFollowUpReminderIdleMs))) {
    meta.engagedFollowUpReminderIdleMs = Number(context.engagedFollowUpReminderIdleMs);
  }
  if (trimText(context.engagedFollowUpReminderFailedAt)) {
    meta.engagedFollowUpReminderFailedAt = trimText(context.engagedFollowUpReminderFailedAt);
  }
  if (Number.isFinite(Number(context.engagedFollowUpReminderFailedStatus))) {
    meta.engagedFollowUpReminderFailedStatus = Number(context.engagedFollowUpReminderFailedStatus);
  }
  if (trimText(context.engagedFollowUpReminderFailedError)) {
    meta.engagedFollowUpReminderFailedError = trimText(context.engagedFollowUpReminderFailedError).slice(0, 300);
  }
  return meta;
}

function role(value) {
  const normalized = trimText(value) || 'system';
  return ['user', 'model', 'bot', 'system'].includes(normalized) ? normalized : 'system';
}

function extractPartsText(parts) {
  return normalizeJsonArray(parts)
    .map(part => trimText(part && part.text))
    .filter(Boolean)
    .join(' ');
}

function csvCell(value) {
  const cell = value == null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);

  if (/[",\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

function ensureCustomersFile(file) {
  if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, CUSTOMER_HEADERS.join(',') + '\n');
    return;
  }

  const csv = fs.readFileSync(file, 'utf8');
  const firstLine = csv.split(/\r?\n/, 1)[0] || '';
  const currentHeaders = firstLine.split(',').map(header => header.trim());
  const hasAllHeaders = CUSTOMER_HEADERS.every(header => currentHeaders.includes(header));
  if (hasAllHeaders) return;

  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false
  });
  const migrated = [
    CUSTOMER_HEADERS.join(','),
    ...rows.map(row => CUSTOMER_HEADERS.map(header => csvCell(row[header] || '')).join(','))
  ].join('\n') + '\n';
  fs.writeFileSync(file, migrated, 'utf8');
}

function cloneOrderDraft(draft = {}) {
  const copy = { ...draft };
  if (Array.isArray(draft.cartItems)) {
    copy.cartItems = draft.cartItems.map(item => ({ ...item }));
  }
  return copy;
}

function missingOrderFieldKeys(draft = {}) {
  const missing = [];
  if (!String(draft.name || '').trim()) missing.push('name');
  if (!String(draft.phone || '').trim()) missing.push('phone');
  if (!String(draft.address || '').trim()) missing.push('address');
  return missing;
}

function orderStatusFromSession(sessionState, fallback = 'draft') {
  const normalized = trimText(sessionState).toUpperCase();
  if (normalized === 'CONFIRMED') return 'confirmed';
  if (normalized === 'READY_TO_CONFIRM') return 'ready_to_confirm';
  return fallback;
}

function draftFromOrder(row, items = []) {
  const rawDraft = normalizeJsonObject(row.raw_draft);
  const draft = { ...rawDraft };

  if (trimText(row.product_code)) draft.productCode = trimText(row.product_code);
  if (trimText(row.phone)) draft.phone = trimText(row.phone);
  if (trimText(row.customer_name)) draft.name = trimText(row.customer_name);
  if (trimText(row.address)) draft.address = trimText(row.address);
  if (row.draft_updated_at) draft.updatedAt = parseTimestamp(row.draft_updated_at);
  if (trimText(row.staff_notified_hash)) draft.staffNotifiedHash = trimText(row.staff_notified_hash);
  if (row.staff_notified_at) draft.staffNotifiedAt = parseTimestamp(row.staff_notified_at);
  if (row.abandoned_cart_reminder_sent_at) {
    draft.abandonedCartReminderSentAt = parseTimestamp(row.abandoned_cart_reminder_sent_at);
  }
  if (Number.isFinite(Number(row.abandoned_cart_reminder_idle_ms))) {
    draft.abandonedCartReminderIdleMs = Number(row.abandoned_cart_reminder_idle_ms);
  }
  if (Array.isArray(row.abandoned_cart_reminder_missing_fields)) {
    draft.abandonedCartReminderMissingFields = row.abandoned_cart_reminder_missing_fields.map(String);
  }
  if (row.abandoned_cart_reminder_failed_at) {
    draft.abandonedCartReminderFailedAt = parseTimestamp(row.abandoned_cart_reminder_failed_at);
  }
  if (Number.isFinite(Number(row.abandoned_cart_reminder_failed_status))) {
    draft.abandonedCartReminderFailedStatus = Number(row.abandoned_cart_reminder_failed_status);
  }
  if (trimText(row.abandoned_cart_reminder_failed_error)) {
    draft.abandonedCartReminderFailedError = trimText(row.abandoned_cart_reminder_failed_error);
  }
  if (row.abandoned_at) draft.abandonedAt = parseTimestamp(row.abandoned_at);

  const cartItems = normalizeJsonArray(items)
    .map(item => ({
      code: trimText(item.code),
      name: trimText(item.name),
      qty: Number(item.qty) > 0 ? Number(item.qty) : 1,
      variant: trimText(item.variant),
      display: trimText(item.display)
    }))
    .filter(item => item.code || item.name);
  if (cartItems.length) draft.cartItems = cartItems;

  return draft;
}

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch {
    throw new Error('Package "pg" is required when STORAGE_ADAPTER=postgres.');
  }
}

function createPostgresStorageAdapter(options = {}) {
  const DATA_DIR = options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.csv');
  const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
  const tenantId = normalizeIdentifier(options.tenantId || process.env.TENANT_ID, DEFAULT_TENANT_ID);
  const pageId = normalizeIdentifier(options.pageId || process.env.PAGE_ID || process.env.FB_PAGE_ID, DEFAULT_PAGE_ID);
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  const Client = options.Client || loadPgClient();
  const client = options.client || new Client({ connectionString: databaseUrl });
  const ownsClient = !options.client;
  const state = { history: {}, handoff: {}, context: {}, profiles: {} };
  const mids = new Set();
  let readyState = false;
  let readyError = null;
  let customerWriteQueue = Promise.resolve();
  let eventWriteQueue = Promise.resolve();
  let writeQueue = Promise.resolve();

  if (!options.client && !databaseUrl) {
    throw new Error('STORAGE_ADAPTER=postgres requires DATABASE_URL.');
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  ensureCustomersFile(CUSTOMERS_FILE);

  function assertReady() {
    if (readyError) throw readyError;
    if (!readyState) throw new Error('PostgreSQL storage adapter is not ready yet.');
  }

  function enqueueWrite(label, fn) {
    writeQueue = writeQueue
      .then(() => ready)
      .then(fn)
      .catch(err => {
        console.error(`Lỗi ghi PostgreSQL storage (${label}):`, err.message);
      });
    return writeQueue;
  }

  async function loadState() {
    const conversations = await client.query(
      `
        SELECT sender_id, session_state, last_product_code, last_user_at,
               handoff_until, timed_out_at, abandoned_order_draft, meta
        FROM conversations
        WHERE tenant_id = $1 AND page_id = $2
      `,
      [tenantId, pageId]
    );
    conversations.rows.forEach(row => {
      const senderId = trimText(row.sender_id);
      if (!senderId) return;
      state.context[senderId] = {
        sessionState: trimText(row.session_state),
        lastProductCode: trimText(row.last_product_code),
        lastUserAt: parseTimestamp(row.last_user_at) || '',
        timedOutAt: parseTimestamp(row.timed_out_at) || '',
        abandonedOrderDraft: normalizeJsonObject(row.abandoned_order_draft)
      };
      const meta = normalizeJsonObject(row.meta);
      if (parseTimestamp(meta.engagedFollowUpAt)) {
        state.context[senderId].engagedFollowUpAt = parseTimestamp(meta.engagedFollowUpAt);
      }
      if (trimText(meta.engagedFollowUpLastNote)) {
        state.context[senderId].engagedFollowUpLastNote = trimText(meta.engagedFollowUpLastNote);
      }
      if (parseTimestamp(meta.engagedFollowUpReminderSentAt)) {
        state.context[senderId].engagedFollowUpReminderSentAt = parseTimestamp(meta.engagedFollowUpReminderSentAt);
      }
      if (Number.isFinite(Number(meta.engagedFollowUpReminderIdleMs))) {
        state.context[senderId].engagedFollowUpReminderIdleMs = Number(meta.engagedFollowUpReminderIdleMs);
      }
      if (parseTimestamp(meta.engagedFollowUpReminderFailedAt)) {
        state.context[senderId].engagedFollowUpReminderFailedAt = parseTimestamp(meta.engagedFollowUpReminderFailedAt);
      }
      if (Number.isFinite(Number(meta.engagedFollowUpReminderFailedStatus))) {
        state.context[senderId].engagedFollowUpReminderFailedStatus = Number(meta.engagedFollowUpReminderFailedStatus);
      }
      if (trimText(meta.engagedFollowUpReminderFailedError)) {
        state.context[senderId].engagedFollowUpReminderFailedError = trimText(meta.engagedFollowUpReminderFailedError).slice(0, 300);
      }
      const handoffMs = parseTimeMs(row.handoff_until);
      if (Number.isFinite(handoffMs) && handoffMs > Date.now()) state.handoff[senderId] = handoffMs;
    });

    const profiles = await client.query(
      `
        SELECT sender_id, first_name, last_name, name, profile_pic, updated_at
        FROM profiles
        WHERE tenant_id = $1 AND page_id = $2
      `,
      [tenantId, pageId]
    );
    profiles.rows.forEach(row => {
      const senderId = trimText(row.sender_id);
      if (!senderId) return;
      state.profiles[senderId] = {
        firstName: trimText(row.first_name),
        lastName: trimText(row.last_name),
        name: trimText(row.name),
        profilePic: trimText(row.profile_pic),
        updatedAt: parseTimestamp(row.updated_at) || ''
      };
    });

    const histories = await client.query(
      `
        SELECT sender_id, role, text, parts
        FROM messages
        WHERE tenant_id = $1 AND page_id = $2 AND source = 'gemini_history'
        ORDER BY sender_id, id
      `,
      [tenantId, pageId]
    );
    histories.rows.forEach(row => {
      const senderId = trimText(row.sender_id);
      if (!senderId) return;
      if (!state.history[senderId]) state.history[senderId] = [];
      state.history[senderId].push({
        role: role(row.role),
        parts: normalizeJsonArray(row.parts).length
          ? cloneJson(row.parts)
          : [{ text: text(row.text) }]
      });
    });

    const processedMids = await client.query(
      `
        SELECT mid
        FROM processed_mids
        WHERE tenant_id = $1 AND page_id = $2
        ORDER BY first_seen_at, mid
      `,
      [tenantId, pageId]
    );
    processedMids.rows.slice(-MID_LIMIT).forEach(row => {
      const mid = trimText(row.mid);
      if (mid) mids.add(mid);
    });

    const orders = await client.query(
      `
        SELECT
          o.*,
          COALESCE(
            json_agg(
              json_build_object(
                'code', oi.code,
                'name', oi.name,
                'qty', oi.qty,
                'variant', oi.variant,
                'display', oi.display
              )
              ORDER BY oi.item_index
            ) FILTER (WHERE oi.id IS NOT NULL),
            '[]'::json
          ) AS items
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.tenant_id = $1
          AND o.page_id = $2
          AND o.status IN ('draft', 'ready_to_confirm', 'confirmed')
        GROUP BY o.id
        ORDER BY o.updated_at, o.id
      `,
      [tenantId, pageId]
    );
    orders.rows.forEach(row => {
      const senderId = trimText(row.sender_id);
      if (!senderId) return;
      if (!state.context[senderId]) state.context[senderId] = {};
      state.context[senderId].orderDraft = draftFromOrder(row, row.items);
      if (!state.context[senderId].sessionState) {
        state.context[senderId].sessionState =
          row.status === 'confirmed' ? 'CONFIRMED' :
            row.status === 'ready_to_confirm' ? 'READY_TO_CONFIRM' : '';
      }
    });
  }

  const ready = (async () => {
    try {
      if (ownsClient) await client.connect();
      await loadState();
      readyState = true;
    } catch (err) {
      readyError = err;
      throw err;
    }
  })();

  function upsertConversation(userId) {
    const context = state.context[userId] || {};
    const handoffUntil = state.handoff[userId]
      ? new Date(Number(state.handoff[userId])).toISOString()
      : null;
    return enqueueWrite('conversation', () => client.query(
      `
        INSERT INTO conversations (
          tenant_id, page_id, sender_id, session_state, last_product_code,
          last_user_at, handoff_until, timed_out_at, abandoned_order_draft,
          meta, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, now(), now())
        ON CONFLICT (tenant_id, page_id, sender_id)
        DO UPDATE SET
          session_state = EXCLUDED.session_state,
          last_product_code = EXCLUDED.last_product_code,
          last_user_at = EXCLUDED.last_user_at,
          handoff_until = EXCLUDED.handoff_until,
          timed_out_at = EXCLUDED.timed_out_at,
          abandoned_order_draft = EXCLUDED.abandoned_order_draft,
          meta = EXCLUDED.meta,
          updated_at = now()
      `,
      [
        tenantId,
        pageId,
        userId,
        trimText(context.sessionState),
        trimText(context.lastProductCode),
        parseTimestamp(context.lastUserAt),
        handoffUntil,
        parseTimestamp(context.timedOutAt),
        JSON.stringify(normalizeJsonObject(context.abandonedOrderDraft)),
        JSON.stringify(followUpMetaFromContext(context))
      ]
    ));
  }

  function persistHistory(userId) {
    const history = state.history[userId] || [];
    return enqueueWrite('history', async () => {
      await client.query('BEGIN');
      try {
        await client.query(
          `
            DELETE FROM messages
            WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3 AND source = 'gemini_history'
          `,
          [tenantId, pageId, userId]
        );
        for (const [index, item] of history.entries()) {
          const parts = normalizeJsonArray(item && item.parts);
          await client.query(
            `
              INSERT INTO messages (
                tenant_id, page_id, sender_id, facebook_mid, role, text,
                parts, source, migration_source_key, meta, created_at
              )
              VALUES ($1, $2, $3, '', $4, $5, $6::jsonb, 'gemini_history', $7, '{}'::jsonb, now())
            `,
            [
              tenantId,
              pageId,
              userId,
              role(item && item.role),
              extractPartsText(parts),
              JSON.stringify(parts),
              `history:${userId}:${index}`
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  function persistProfile(userId) {
    const profile = state.profiles[userId] || {};
    return enqueueWrite('profile', () => client.query(
      `
        INSERT INTO profiles (
          tenant_id, page_id, sender_id, first_name, last_name, name,
          profile_pic, raw_profile, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), $9)
        ON CONFLICT (tenant_id, page_id, sender_id)
        DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          name = EXCLUDED.name,
          profile_pic = EXCLUDED.profile_pic,
          raw_profile = EXCLUDED.raw_profile,
          updated_at = EXCLUDED.updated_at
      `,
      [
        tenantId,
        pageId,
        userId,
        trimText(profile.firstName),
        trimText(profile.lastName),
        trimText(profile.name),
        trimText(profile.profilePic),
        JSON.stringify(profile),
        parseTimestamp(profile.updatedAt) || new Date().toISOString()
      ]
    ));
  }

  function currentOrderStatus(userId, fallback = 'draft') {
    const sessionState = state.context[userId]?.sessionState || '';
    return orderStatusFromSession(sessionState, fallback);
  }

  function persistOrder(userId, status = currentOrderStatus(userId)) {
    const draft = state.context[userId]?.orderDraft || {};
    if (!Object.keys(draft).length) return Promise.resolve();
    const nowIso = new Date().toISOString();
    const draftUpdatedAt = parseTimestamp(draft.updatedAt) || nowIso;
    const migrationSourceKey = `${userId}:active`;
    return enqueueWrite('order', async () => {
      await client.query('BEGIN');
      try {
        const result = await client.query(
          `
            INSERT INTO orders (
              tenant_id, page_id, sender_id, status, product_code, customer_name,
              phone, address, draft_updated_at, staff_notified_hash, staff_notified_at,
              abandoned_cart_reminder_sent_at, abandoned_cart_reminder_idle_ms,
              abandoned_cart_reminder_missing_fields, abandoned_cart_reminder_failed_at,
              abandoned_cart_reminder_failed_status, abandoned_cart_reminder_failed_error,
              abandoned_at, confirmed_at, sheet_dedupe_key, product_interest,
              migration_source_key, raw_draft, created_at, updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              $12, $13, $14::text[], $15, $16, $17, $18, $19, '', '',
              $20, $21::jsonb, now(), now()
            )
            ON CONFLICT (tenant_id, page_id, migration_source_key) WHERE migration_source_key <> ''
            DO UPDATE SET
              status = EXCLUDED.status,
              product_code = EXCLUDED.product_code,
              customer_name = EXCLUDED.customer_name,
              phone = EXCLUDED.phone,
              address = EXCLUDED.address,
              draft_updated_at = EXCLUDED.draft_updated_at,
              staff_notified_hash = EXCLUDED.staff_notified_hash,
              staff_notified_at = EXCLUDED.staff_notified_at,
              abandoned_cart_reminder_sent_at = EXCLUDED.abandoned_cart_reminder_sent_at,
              abandoned_cart_reminder_idle_ms = EXCLUDED.abandoned_cart_reminder_idle_ms,
              abandoned_cart_reminder_missing_fields = EXCLUDED.abandoned_cart_reminder_missing_fields,
              abandoned_cart_reminder_failed_at = EXCLUDED.abandoned_cart_reminder_failed_at,
              abandoned_cart_reminder_failed_status = EXCLUDED.abandoned_cart_reminder_failed_status,
              abandoned_cart_reminder_failed_error = EXCLUDED.abandoned_cart_reminder_failed_error,
              abandoned_at = EXCLUDED.abandoned_at,
              confirmed_at = EXCLUDED.confirmed_at,
              raw_draft = EXCLUDED.raw_draft,
              updated_at = now()
            RETURNING id
          `,
          [
            tenantId,
            pageId,
            userId,
            status,
            trimText(draft.productCode),
            trimText(draft.name),
            trimText(draft.phone),
            trimText(draft.address),
            draftUpdatedAt,
            trimText(draft.staffNotifiedHash),
            parseTimestamp(draft.staffNotifiedAt),
            parseTimestamp(draft.abandonedCartReminderSentAt),
            Number.isFinite(Number(draft.abandonedCartReminderIdleMs))
              ? Number(draft.abandonedCartReminderIdleMs)
              : null,
            Array.isArray(draft.abandonedCartReminderMissingFields)
              ? draft.abandonedCartReminderMissingFields.map(String)
              : [],
            parseTimestamp(draft.abandonedCartReminderFailedAt),
            Number.isFinite(Number(draft.abandonedCartReminderFailedStatus))
              ? Number(draft.abandonedCartReminderFailedStatus)
              : null,
            trimText(draft.abandonedCartReminderFailedError).slice(0, 300),
            status === 'abandoned' ? parseTimestamp(draft.abandonedAt) || nowIso : null,
            status === 'confirmed' ? draftUpdatedAt : null,
            migrationSourceKey,
            JSON.stringify(draft)
          ]
        );
        const orderId = Number(result.rows[0] && result.rows[0].id);
        await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
        for (const [index, item] of normalizeJsonArray(draft.cartItems).entries()) {
          await client.query(
            `
              INSERT INTO order_items (
                order_id, tenant_id, page_id, item_index, code, name,
                qty, variant, display, raw_item, created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
            `,
            [
              orderId,
              tenantId,
              pageId,
              index,
              trimText(item && item.code),
              trimText(item && item.name),
              Number(item && item.qty) > 0 ? Number(item.qty) : 1,
              trimText(item && item.variant),
              trimText(item && item.display),
              JSON.stringify(isPlainObject(item) ? item : {})
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  function markCurrentOrderStatus(userId, status) {
    const draft = state.context[userId]?.orderDraft || {};
    if (!Object.keys(draft).length) return Promise.resolve();
    return persistOrder(userId, status);
  }

  function appendCustomerExport(customer) {
    const line = CUSTOMER_HEADERS
      .map(key => csvCell(customer[key]))
      .join(',') + '\n';
    customerWriteQueue = customerWriteQueue
      .then(() => fs.promises.appendFile(CUSTOMERS_FILE, line, 'utf8'))
      .catch(err => {
        console.error('Lỗi ghi customers.csv export:', err.message);
      });
    return customerWriteQueue;
  }

  function appendEventExport(event) {
    eventWriteQueue = eventWriteQueue
      .then(() => fs.promises.appendFile(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf8'))
      .catch(err => {
        console.error('Lỗi ghi events.jsonl export:', err.message);
      });
    return eventWriteQueue;
  }

  const adapter = {
    ready,

    getDataDir() {
      return DATA_DIR;
    },

    getCustomersFile() {
      return CUSTOMERS_FILE;
    },

    getEventsFile() {
      return EVENTS_FILE;
    },

    getHistory(userId) {
      assertReady();
      return state.history[userId] ? cloneJson(state.history[userId]) : [];
    },

    setHistory(userId, history) {
      assertReady();
      state.history[userId] = cloneJson(normalizeJsonArray(history));
      void persistHistory(userId);
    },

    setHandoff(userId, until) {
      assertReady();
      if (!userId) return;
      state.handoff[userId] = until;
      void upsertConversation(userId);
    },

    inHandoff(userId) {
      assertReady();
      const until = state.handoff[userId];
      if (!until) return false;
      if (Date.now() > until) {
        delete state.handoff[userId];
        void upsertConversation(userId);
        return false;
      }
      return true;
    },

    getLastProductCode(userId) {
      assertReady();
      return state.context[userId]?.lastProductCode || '';
    },

    setLastProductCode(userId, code) {
      assertReady();
      if (!userId || !code) return;
      if (!state.context[userId]) state.context[userId] = {};
      state.context[userId].lastProductCode = code;
      void upsertConversation(userId);
    },

    getLastUserAt(userId) {
      assertReady();
      return state.context[userId]?.lastUserAt || '';
    },

    setLastUserAt(userId, at = new Date().toISOString()) {
      assertReady();
      if (!userId) return;
      if (!state.context[userId]) state.context[userId] = {};
      state.context[userId].lastUserAt = at;
      void upsertConversation(userId);
    },

    getUserProfile(userId) {
      assertReady();
      return state.profiles[userId] ? { ...state.profiles[userId] } : {};
    },

    setUserProfile(userId, profile = {}) {
      assertReady();
      if (!userId) return {};
      const firstName = trimText(profile.firstName || profile.first_name);
      const lastName = trimText(profile.lastName || profile.last_name);
      const name = trimText(profile.name || [firstName, lastName].filter(Boolean).join(' '));
      const profilePic = trimText(profile.profilePic || profile.profile_pic);
      const current = state.profiles[userId] || {};
      const next = {
        ...current,
        firstName,
        lastName,
        name,
        profilePic,
        updatedAt: String(profile.updatedAt || new Date().toISOString())
      };

      if (!next.name && !next.firstName && !next.lastName && !next.profilePic) return { ...current };
      state.profiles[userId] = next;
      void persistProfile(userId);
      return { ...next };
    },

    getOrderDraft(userId) {
      assertReady();
      return state.context[userId]?.orderDraft
        ? cloneOrderDraft(state.context[userId].orderDraft)
        : {};
    },

    mergeOrderDraft(userId, details = {}) {
      assertReady();
      if (!userId) return {};
      if (!state.context[userId]) state.context[userId] = {};
      const current = state.context[userId].orderDraft || {};
      const next = { ...current };

      for (const key of ['productCode', 'phone', 'name', 'address']) {
        const value = trimText(details[key]);
        if (value) next[key] = value;
      }

      if (Array.isArray(details.cartItems) && details.cartItems.length) {
        next.cartItems = details.cartItems
          .map(item => ({
            code: trimText(item && item.code),
            name: trimText(item && item.name),
            qty: Number(item && item.qty) || 1,
            variant: trimText(item && item.variant)
          }))
          .filter(item => item.code || item.name);
      }

      if (Object.keys(next).length) {
        next.updatedAt = new Date().toISOString();
        state.context[userId].orderDraft = next;
        void upsertConversation(userId);
        void persistOrder(userId);
      }
      return cloneOrderDraft(next);
    },

    getSessionState(userId) {
      assertReady();
      return state.context[userId]?.sessionState || '';
    },

    setSessionState(userId, sessionState) {
      assertReady();
      if (!userId) return;
      if (!state.context[userId]) state.context[userId] = {};
      if (sessionState) {
        state.context[userId].sessionState = sessionState;
      } else {
        delete state.context[userId].sessionState;
      }
      void upsertConversation(userId);
      void markCurrentOrderStatus(userId, currentOrderStatus(userId));
    },

    getOrderStaffNotification(userId) {
      assertReady();
      const draft = state.context[userId]?.orderDraft || {};
      return {
        hash: draft.staffNotifiedHash || '',
        at: draft.staffNotifiedAt || ''
      };
    },

    setOrderStaffNotification(userId, details = {}) {
      assertReady();
      if (!userId) return {};
      if (!state.context[userId]) state.context[userId] = {};
      const current = state.context[userId].orderDraft || {};
      const next = {
        ...current,
        staffNotifiedHash: trimText(details.hash),
        staffNotifiedAt: trimText(details.at || new Date().toISOString())
      };
      state.context[userId].orderDraft = next;
      void persistOrder(userId);
      return cloneOrderDraft(next);
    },

    clearOrderDraft(userId) {
      assertReady();
      if (!userId || !state.context[userId]) return;
      void markCurrentOrderStatus(userId, 'cancelled');
      delete state.context[userId].orderDraft;
      delete state.context[userId].sessionState;
      void upsertConversation(userId);
    },

    resetSessionAfterTimeout(userId) {
      assertReady();
      if (!userId || !state.context[userId]) return {};
      const current = state.context[userId];
      const abandoned = current.orderDraft ? cloneOrderDraft(current.orderDraft) : {};
      if (Object.keys(abandoned).length) {
        const abandonedAt = new Date().toISOString();
        current.abandonedOrderDraft = {
          ...abandoned,
          abandonedAt
        };
        current.orderDraft = {
          ...current.orderDraft,
          abandonedAt
        };
        void persistOrder(userId, 'abandoned');
      }
      delete current.orderDraft;
      delete current.lastProductCode;
      current.sessionState = 'IDLE';
      current.timedOutAt = new Date().toISOString();
      void upsertConversation(userId);
      return abandoned;
    },

    listAbandonedCartReminderCandidates(options = {}) {
      assertReady();
      const nowMs = parseTimeMs(options.now == null ? Date.now() : options.now);
      if (!Number.isFinite(nowMs)) return [];

      const idleMs = positiveNumber(options.idleMs, 20 * 60 * 1000);
      const maxAgeMs = positiveNumber(options.maxAgeMs, 23 * 60 * 60 * 1000);
      const limit = Math.max(1, Math.floor(positiveNumber(options.limit, 50)));
      const result = [];

      for (const [userId, context] of Object.entries(state.context || {})) {
        if (result.length >= limit) break;
        const draft = context?.orderDraft;
        if (!draft) continue;
        if (context.sessionState === 'CONFIRMED') continue;
        if (draft.abandonedCartReminderSentAt || draft.abandonedCartReminderFailedAt) continue;

        const handoffUntil = Number(state.handoff?.[userId] || 0);
        if (handoffUntil && nowMs <= handoffUntil) continue;
        if (handoffUntil && nowMs > handoffUntil) {
          delete state.handoff[userId];
          void upsertConversation(userId);
        }

        const cartItems = Array.isArray(draft.cartItems) ? draft.cartItems : [];
        if (!cartItems.length) continue;

        const missingFields = missingOrderFieldKeys(draft);
        if (!missingFields.length) continue;

        const lastActivityMs = parseTimeMs(context.lastUserAt || draft.updatedAt);
        if (!Number.isFinite(lastActivityMs)) continue;

        const idleForMs = nowMs - lastActivityMs;
        if (idleForMs < idleMs || idleForMs > maxAgeMs) continue;

        result.push({
          userId,
          lastUserAt: context.lastUserAt || '',
          idleMs: idleForMs,
          missingFields,
          lastProductCode: context.lastProductCode || '',
          sessionState: context.sessionState || '',
          orderDraft: cloneOrderDraft(draft)
        });
      }

      return result;
    },

    markAbandonedCartReminderSent(userId, details = {}) {
      assertReady();
      if (!userId || !state.context[userId]?.orderDraft) return {};
      const current = state.context[userId].orderDraft || {};
      const next = {
        ...current,
        abandonedCartReminderSentAt: String(details.at || new Date().toISOString())
      };

      const idleMs = Number(details.idleMs);
      if (Number.isFinite(idleMs) && idleMs >= 0) next.abandonedCartReminderIdleMs = idleMs;
      if (Array.isArray(details.missingFields)) {
        next.abandonedCartReminderMissingFields = details.missingFields.map(item => String(item));
      }

      state.context[userId].orderDraft = next;
      void persistOrder(userId);
      return cloneOrderDraft(next);
    },

    markAbandonedCartReminderFailed(userId, details = {}) {
      assertReady();
      if (!userId || !state.context[userId]?.orderDraft) return {};
      const current = state.context[userId].orderDraft || {};
      const next = {
        ...current,
        abandonedCartReminderFailedAt: String(details.at || new Date().toISOString())
      };

      const status = Number(details.status);
      if (Number.isFinite(status)) next.abandonedCartReminderFailedStatus = status;
      if (details.error) next.abandonedCartReminderFailedError = String(details.error).slice(0, 300);

      state.context[userId].orderDraft = next;
      void persistOrder(userId);
      return cloneOrderDraft(next);
    },

    setEngagedFollowUp(userId, details = {}) {
      assertReady();
      if (!userId) return {};
      if (!state.context[userId]) state.context[userId] = {};
      const current = state.context[userId];
      const next = {
        ...current,
        engagedFollowUpAt: String(details.at || new Date().toISOString())
      };
      const note = trimText(details.note).slice(0, 300);
      if (note) next.engagedFollowUpLastNote = note;
      delete next.engagedFollowUpReminderSentAt;
      delete next.engagedFollowUpReminderIdleMs;
      delete next.engagedFollowUpReminderFailedAt;
      delete next.engagedFollowUpReminderFailedStatus;
      delete next.engagedFollowUpReminderFailedError;
      state.context[userId] = next;
      void upsertConversation(userId);
      return { ...next };
    },

    listEngagedFollowUpCandidates(options = {}) {
      assertReady();
      const nowMs = parseTimeMs(options.now == null ? Date.now() : options.now);
      if (!Number.isFinite(nowMs)) return [];
      const idleMs = positiveNumber(options.idleMs, 2 * 60 * 60 * 1000);
      const maxAgeMs = positiveNumber(options.maxAgeMs, 3 * 24 * 60 * 60 * 1000);
      const limit = Math.max(1, Math.floor(positiveNumber(options.limit, 50)));
      const result = [];

      for (const [userId, context] of Object.entries(state.context || {})) {
        if (result.length >= limit) break;
        if (!context) continue;
        if (trimText(context.sessionState).toUpperCase() === 'CONFIRMED') continue;
        if (context.engagedFollowUpReminderSentAt || context.engagedFollowUpReminderFailedAt) continue;

        const handoffUntil = Number(state.handoff?.[userId] || 0);
        if (handoffUntil && nowMs <= handoffUntil) continue;
        if (handoffUntil && nowMs > handoffUntil) {
          delete state.handoff[userId];
          void upsertConversation(userId);
        }

        const engagedAtMs = parseTimeMs(context.engagedFollowUpAt || context.lastUserAt);
        if (!Number.isFinite(engagedAtMs)) continue;
        const idleForMs = nowMs - engagedAtMs;
        if (idleForMs < idleMs || idleForMs > maxAgeMs) continue;

        result.push({
          userId,
          engagedAt: context.engagedFollowUpAt || '',
          idleMs: idleForMs,
          sessionState: context.sessionState || '',
          lastProductCode: context.lastProductCode || '',
          note: context.engagedFollowUpLastNote || ''
        });
      }
      return result;
    },

    markEngagedFollowUpReminderSent(userId, details = {}) {
      assertReady();
      if (!userId || !state.context[userId]) return {};
      const current = state.context[userId];
      const next = {
        ...current,
        engagedFollowUpReminderSentAt: String(details.at || new Date().toISOString())
      };
      const idleMs = Number(details.idleMs);
      if (Number.isFinite(idleMs) && idleMs >= 0) next.engagedFollowUpReminderIdleMs = idleMs;
      delete next.engagedFollowUpReminderFailedAt;
      delete next.engagedFollowUpReminderFailedStatus;
      delete next.engagedFollowUpReminderFailedError;
      state.context[userId] = next;
      void upsertConversation(userId);
      return { ...next };
    },

    markEngagedFollowUpReminderFailed(userId, details = {}) {
      assertReady();
      if (!userId || !state.context[userId]) return {};
      const current = state.context[userId];
      const next = {
        ...current,
        engagedFollowUpReminderFailedAt: String(details.at || new Date().toISOString())
      };
      const status = Number(details.status);
      if (Number.isFinite(status)) next.engagedFollowUpReminderFailedStatus = status;
      if (details.error) next.engagedFollowUpReminderFailedError = String(details.error).slice(0, 300);
      state.context[userId] = next;
      void upsertConversation(userId);
      return { ...next };
    },

    seenMid(mid) {
      assertReady();
      return mids.has(mid);
    },

    markMid(mid) {
      assertReady();
      const normalized = trimText(mid);
      if (!normalized) return;
      mids.add(normalized);
      if (mids.size > MID_LIMIT) {
        const arr = [...mids];
        mids.clear();
        arr.slice(-MID_LIMIT).forEach(m => mids.add(m));
      }
      void enqueueWrite('processed_mid', () => client.query(
        `
          INSERT INTO processed_mids (tenant_id, page_id, mid, sender_id, first_seen_at, meta)
          VALUES ($1, $2, $3, '', now(), '{}'::jsonb)
          ON CONFLICT (tenant_id, page_id, mid) DO NOTHING
        `,
        [tenantId, pageId, normalized]
      ));
    },

    appendCustomer(customer) {
      assertReady();
      const payload = {
        at: customer.at || new Date().toISOString(),
        type: customer.type || 'lead',
        senderId: customer.senderId || '',
        productCode: customer.productCode || '',
        phone: customer.phone || '',
        name: customer.name || '',
        address: customer.address || '',
        text: customer.text || '',
        history: customer.history || ''
      };

      const exportPromise = appendCustomerExport(payload);
      const dbPromise = enqueueWrite('customer_event', () => client.query(
        `
          INSERT INTO events (
            tenant_id, page_id, sender_id, event_at, type, source,
            migration_source_key, session_state, product_code, text, meta,
            customer_name, phone, address, customer_history, sheet_dedupe_key,
            sheet_synced_at, created_at
          )
          VALUES ($1, $2, $3, $4, $5, 'customer_export', '', '', $6, $7, '{}'::jsonb,
                  $8, $9, $10, $11::jsonb, '', NULL, now())
        `,
        [
          tenantId,
          pageId,
          trimText(payload.senderId),
          parseTimestamp(payload.at) || new Date().toISOString(),
          trimText(payload.type) || 'lead',
          trimText(payload.productCode),
          text(payload.text),
          trimText(payload.name),
          trimText(payload.phone),
          trimText(payload.address),
          JSON.stringify(normalizeJsonArray(payload.history))
        ]
      ));
      return Promise.all([exportPromise, dbPromise]).then(() => undefined);
    },

    appendEvent(event) {
      assertReady();
      const payload = {
        at: event.at || new Date().toISOString(),
        type: String(event.type || 'event'),
        senderId: String(event.senderId || ''),
        sessionState: String(event.sessionState || ''),
        productCode: String(event.productCode || ''),
        text: event.text == null ? '' : String(event.text),
        meta: event.meta || {}
      };
      const exportPromise = appendEventExport(payload);
      const dbPromise = enqueueWrite('runtime_event', () => client.query(
        `
          INSERT INTO events (
            tenant_id, page_id, sender_id, event_at, type, source,
            migration_source_key, session_state, product_code, text, meta,
            customer_name, phone, address, customer_history, sheet_dedupe_key,
            sheet_synced_at, created_at
          )
          VALUES ($1, $2, $3, $4, $5, 'runtime', '', $6, $7, $8, $9::jsonb,
                  '', '', '', '[]'::jsonb, '', NULL, now())
        `,
        [
          tenantId,
          pageId,
          trimText(payload.senderId),
          parseTimestamp(payload.at) || new Date().toISOString(),
          trimText(payload.type) || 'event',
          trimText(payload.sessionState),
          trimText(payload.productCode),
          text(payload.text),
          JSON.stringify(normalizeJsonObject(payload.meta))
        ]
      ));
      return Promise.all([exportPromise, dbPromise]).then(() => undefined);
    },

    async flush() {
      await ready;
      await writeQueue;
      await customerWriteQueue;
      await eventWriteQueue;
    },

    async close() {
      await adapter.flush();
      if (ownsClient) await client.end();
    }
  };

  return adapter;
}

module.exports = {
  createPostgresStorageAdapter
};

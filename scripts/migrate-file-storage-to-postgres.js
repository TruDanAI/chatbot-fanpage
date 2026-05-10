#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_TENANT_ID = 'default';
const DEFAULT_PAGE_ID = 'default';

const STORAGE_FILES = {
  state: 'chat-state.json',
  customers: 'customers.csv',
  events: 'events.jsonl',
  mids: 'processed-mids.json',
  sheetOutbox: 'sheet-outbox.jsonl'
};

const TARGET_TABLES = [
  'profiles',
  'conversations',
  'messages',
  'orders',
  'order_items',
  'events',
  'processed_mids'
];

const WRITE_COLUMNS = {
  profiles: [
    'tenant_id',
    'page_id',
    'sender_id',
    'first_name',
    'last_name',
    'name',
    'profile_pic',
    'raw_profile',
    'created_at',
    'updated_at'
  ],
  conversations: [
    'tenant_id',
    'page_id',
    'sender_id',
    'session_state',
    'last_product_code',
    'last_user_at',
    'handoff_until',
    'timed_out_at',
    'abandoned_order_draft',
    'meta',
    'created_at',
    'updated_at'
  ],
  messages: [
    'tenant_id',
    'page_id',
    'sender_id',
    'facebook_mid',
    'role',
    'text',
    'parts',
    'source',
    'migration_source_key',
    'meta',
    'created_at'
  ],
  orders: [
    'tenant_id',
    'page_id',
    'sender_id',
    'status',
    'product_code',
    'customer_name',
    'phone',
    'address',
    'draft_updated_at',
    'staff_notified_hash',
    'staff_notified_at',
    'abandoned_cart_reminder_sent_at',
    'abandoned_cart_reminder_idle_ms',
    'abandoned_cart_reminder_missing_fields',
    'abandoned_cart_reminder_failed_at',
    'abandoned_cart_reminder_failed_status',
    'abandoned_cart_reminder_failed_error',
    'abandoned_at',
    'confirmed_at',
    'sheet_dedupe_key',
    'product_interest',
    'migration_source_key',
    'raw_draft',
    'created_at',
    'updated_at'
  ],
  order_items: [
    'order_id',
    'tenant_id',
    'page_id',
    'item_index',
    'code',
    'name',
    'qty',
    'variant',
    'display',
    'raw_item',
    'created_at'
  ],
  events: [
    'tenant_id',
    'page_id',
    'sender_id',
    'event_at',
    'type',
    'source',
    'migration_source_key',
    'session_state',
    'product_code',
    'text',
    'meta',
    'customer_name',
    'phone',
    'address',
    'customer_history',
    'sheet_dedupe_key',
    'sheet_synced_at',
    'created_at'
  ],
  processed_mids: [
    'tenant_id',
    'page_id',
    'mid',
    'sender_id',
    'first_seen_at',
    'meta'
  ]
};

const JSON_COLUMNS = {
  profiles: new Set(['raw_profile']),
  conversations: new Set(['abandoned_order_draft', 'meta']),
  messages: new Set(['parts', 'meta']),
  orders: new Set(['raw_draft']),
  order_items: new Set(['raw_item']),
  events: new Set(['meta', 'customer_history']),
  processed_mids: new Set(['meta'])
};

const REQUIRED_UNIQUE_INDEXES = [
  'messages_migration_source_unique_idx',
  'orders_migration_source_unique_idx',
  'events_migration_source_unique_idx'
];

const PRODUCTION_DB_WRITE_UNLOCK_ENV = 'ALLOW_PRODUCTION_DB_WRITES';
const PRODUCTION_CONFIRMATION = 'duoc ghi DB production';
const SAFE_APPLY_TARGETS = new Set(['local', 'dev', 'staging', 'production']);

const ORDER_DRAFT_FIELDS = [
  'productCode',
  'phone',
  'name',
  'address',
  'cartItems',
  'updatedAt',
  'staffNotifiedHash',
  'staffNotifiedAt',
  'abandonedCartReminderSentAt',
  'abandonedCartReminderIdleMs',
  'abandonedCartReminderMissingFields',
  'abandonedCartReminderFailedAt',
  'abandonedCartReminderFailedStatus',
  'abandonedCartReminderFailedError',
  'abandonedAt'
];

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

function isNonEmptyObject(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
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

function normalizeJsonObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonArrayCell(value, warnings, label) {
  const raw = trimText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    warnings.push(`${label}: expected JSON array, kept empty array`);
    return [];
  } catch (err) {
    warnings.push(`${label}: invalid JSON array (${err.message}), kept empty array`);
    return [];
  }
}

function fileStatus(dataDir, name) {
  const fullPath = path.join(dataDir, name);
  return {
    path: fullPath,
    exists: fs.existsSync(fullPath)
  };
}

function readJsonFile(dataDir, name, fallback, warnings) {
  const status = fileStatus(dataDir, name);
  if (!status.exists) return { ...status, value: fallback };

  try {
    return {
      ...status,
      value: JSON.parse(fs.readFileSync(status.path, 'utf8'))
    };
  } catch (err) {
    warnings.push(`${name}: invalid JSON (${err.message}), using fallback`);
    return { ...status, value: fallback };
  }
}

function readCsvFile(dataDir, name, warnings) {
  const status = fileStatus(dataDir, name);
  if (!status.exists) return { ...status, rows: [] };

  try {
    const rows = parse(fs.readFileSync(status.path, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false
    });
    return { ...status, rows };
  } catch (err) {
    warnings.push(`${name}: invalid CSV (${err.message}), using empty rows`);
    return { ...status, rows: [] };
  }
}

function readJsonlFile(dataDir, name, warnings) {
  const status = fileStatus(dataDir, name);
  if (!status.exists) return { ...status, rows: [] };

  const rows = [];
  const lines = fs.readFileSync(status.path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    try {
      rows.push(JSON.parse(raw));
    } catch (err) {
      warnings.push(`${name}:${index + 1}: invalid JSONL (${err.message}), skipped`);
    }
  });
  return { ...status, rows };
}

function normalizeState(rawState, warnings) {
  const state = isPlainObject(rawState) ? rawState : {};
  const normalized = {
    history: normalizeJsonObject(state.history),
    handoff: normalizeJsonObject(state.handoff),
    context: normalizeJsonObject(state.context),
    profiles: normalizeJsonObject(state.profiles)
  };

  for (const key of ['history', 'handoff', 'context', 'profiles']) {
    if (state[key] != null && !isPlainObject(state[key])) {
      warnings.push(`chat-state.json: ${key} is not an object, using empty object`);
    }
  }

  return normalized;
}

function normalizeRole(role, warnings, label) {
  const normalized = trimText(role) || 'system';
  if (['user', 'model', 'bot', 'system'].includes(normalized)) return normalized;
  warnings.push(`${label}: unsupported role "${normalized}", mapped to system`);
  return 'system';
}

function extractPartsText(parts) {
  return normalizeJsonArray(parts)
    .map(part => trimText(part && part.text))
    .filter(Boolean)
    .join(' ');
}

function collectSenderIds(state, customers, events, outbox) {
  const senderIds = new Set();

  for (const source of [state.history, state.handoff, state.context, state.profiles]) {
    Object.keys(source || {}).forEach(senderId => {
      if (trimText(senderId)) senderIds.add(trimText(senderId));
    });
  }

  customers.forEach(row => {
    const senderId = trimText(row.senderId);
    if (senderId) senderIds.add(senderId);
  });

  events.forEach(row => {
    const senderId = trimText(row.senderId);
    if (senderId) senderIds.add(senderId);
  });

  outbox.forEach(row => {
    const senderId = trimText(row && row.leadData && row.leadData.senderId);
    if (senderId) senderIds.add(senderId);
  });

  return [...senderIds].sort();
}

function buildProfileRows({ state, tenantId, pageId, nowIso }) {
  return Object.entries(state.profiles)
    .filter(([senderId, profile]) => trimText(senderId) && isPlainObject(profile))
    .map(([senderId, profile]) => {
      const firstName = trimText(profile.firstName || profile.first_name);
      const lastName = trimText(profile.lastName || profile.last_name);
      const name = trimText(profile.name || [firstName, lastName].filter(Boolean).join(' '));
      const updatedAt = parseTimestamp(profile.updatedAt) || nowIso;
      return {
        tenant_id: tenantId,
        page_id: pageId,
        sender_id: trimText(senderId),
        first_name: firstName,
        last_name: lastName,
        name,
        profile_pic: trimText(profile.profilePic || profile.profile_pic),
        raw_profile: profile,
        created_at: updatedAt,
        updated_at: updatedAt
      };
    });
}

function buildConversationRows({ state, senderIds, tenantId, pageId, nowIso }) {
  return senderIds.map(senderId => {
    const context = isPlainObject(state.context[senderId]) ? state.context[senderId] : {};
    const handoffUntil = parseTimestamp(state.handoff[senderId]);
    const lastUserAt = parseTimestamp(context.lastUserAt);
    const timedOutAt = parseTimestamp(context.timedOutAt);
    const knownContext = new Set([
      'sessionState',
      'lastProductCode',
      'lastUserAt',
      'orderDraft',
      'abandonedOrderDraft',
      'timedOutAt'
    ]);
    const contextMeta = Object.fromEntries(
      Object.entries(context).filter(([key]) => !knownContext.has(key))
    );

    return {
      tenant_id: tenantId,
      page_id: pageId,
      sender_id: senderId,
      session_state: trimText(context.sessionState),
      last_product_code: trimText(context.lastProductCode),
      last_user_at: lastUserAt,
      handoff_until: handoffUntil,
      timed_out_at: timedOutAt,
      abandoned_order_draft: normalizeJsonObject(context.abandonedOrderDraft),
      meta: contextMeta,
      created_at: lastUserAt || timedOutAt || nowIso,
      updated_at: lastUserAt || timedOutAt || nowIso
    };
  });
}

function buildMessageRows({ state, tenantId, pageId, nowIso, warnings }) {
  const rows = [];
  for (const [senderId, history] of Object.entries(state.history)) {
    if (!trimText(senderId)) continue;
    if (!Array.isArray(history)) {
      warnings.push(`chat-state.json: history.${senderId} is not an array, skipped`);
      continue;
    }

    history.forEach((item, index) => {
      const parts = normalizeJsonArray(item && item.parts);
      rows.push({
        tenant_id: tenantId,
        page_id: pageId,
        sender_id: trimText(senderId),
        facebook_mid: '',
        role: normalizeRole(item && item.role, warnings, `history.${senderId}[${index}]`),
        text: extractPartsText(parts),
        parts,
        source: 'gemini_history',
        migration_source_key: `history:${trimText(senderId)}:${index}`,
        meta: {},
        created_at: nowIso
      });
    });
  }
  return rows;
}

function hasOrderDraftPayload(draft) {
  if (!isPlainObject(draft)) return false;
  return ORDER_DRAFT_FIELDS.some(field => {
    const value = draft[field];
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return trimText(value) !== '';
  });
}

function deriveOrderStatus(sessionState, kind) {
  if (kind === 'abandoned') return 'abandoned';
  const normalized = trimText(sessionState).toUpperCase();
  if (normalized === 'CONFIRMED') return 'confirmed';
  if (normalized === 'READY_TO_CONFIRM') return 'ready_to_confirm';
  return 'draft';
}

function buildOrderRows({ state, tenantId, pageId, nowIso }) {
  const orders = [];
  const orderItems = [];

  for (const [senderIdRaw, context] of Object.entries(state.context)) {
    const senderId = trimText(senderIdRaw);
    if (!senderId || !isPlainObject(context)) continue;

    const drafts = [
      { kind: 'active', draft: context.orderDraft || {} },
      { kind: 'abandoned', draft: context.abandonedOrderDraft || {} }
    ];

    drafts.forEach(({ kind, draft }) => {
      if (!hasOrderDraftPayload(draft)) return;

      const sourceKey = `${senderId}:${kind}`;
      const draftUpdatedAt = parseTimestamp(draft.updatedAt);
      const abandonedAt = parseTimestamp(draft.abandonedAt);
      const status = deriveOrderStatus(context.sessionState, kind);
      orders.push({
        source_key: sourceKey,
        tenant_id: tenantId,
        page_id: pageId,
        sender_id: senderId,
        status,
        product_code: trimText(draft.productCode),
        customer_name: trimText(draft.name),
        phone: trimText(draft.phone),
        address: trimText(draft.address),
        draft_updated_at: draftUpdatedAt,
        staff_notified_hash: trimText(draft.staffNotifiedHash),
        staff_notified_at: parseTimestamp(draft.staffNotifiedAt),
        abandoned_cart_reminder_sent_at: parseTimestamp(draft.abandonedCartReminderSentAt),
        abandoned_cart_reminder_idle_ms: Number.isFinite(Number(draft.abandonedCartReminderIdleMs))
          ? Number(draft.abandonedCartReminderIdleMs)
          : null,
        abandoned_cart_reminder_missing_fields: Array.isArray(draft.abandonedCartReminderMissingFields)
          ? draft.abandonedCartReminderMissingFields.map(item => trimText(item)).filter(Boolean)
          : [],
        abandoned_cart_reminder_failed_at: parseTimestamp(draft.abandonedCartReminderFailedAt),
        abandoned_cart_reminder_failed_status: Number.isFinite(Number(draft.abandonedCartReminderFailedStatus))
          ? Number(draft.abandonedCartReminderFailedStatus)
          : null,
        abandoned_cart_reminder_failed_error: trimText(draft.abandonedCartReminderFailedError).slice(0, 300),
        abandoned_at: abandonedAt,
        confirmed_at: status === 'confirmed' ? draftUpdatedAt : null,
        sheet_dedupe_key: '',
        product_interest: '',
        migration_source_key: sourceKey,
        raw_draft: draft,
        created_at: draftUpdatedAt || abandonedAt || nowIso,
        updated_at: draftUpdatedAt || abandonedAt || nowIso
      });

      normalizeJsonArray(draft.cartItems).forEach((item, index) => {
        orderItems.push({
          order_source_key: sourceKey,
          tenant_id: tenantId,
          page_id: pageId,
          item_index: index,
          code: trimText(item && item.code),
          name: trimText(item && item.name),
          qty: Number(item && item.qty) > 0 ? Number(item.qty) : 1,
          variant: trimText(item && item.variant),
          display: trimText(item && item.display),
          raw_item: isPlainObject(item) ? item : {},
          created_at: draftUpdatedAt || abandonedAt || nowIso
        });
      });
    });
  }

  return { orders, orderItems };
}

function buildRuntimeEventRows({ events, tenantId, pageId, nowIso }) {
  return events
    .filter(event => isPlainObject(event) && trimText(event.type))
    .map((event, index) => ({
      tenant_id: tenantId,
      page_id: pageId,
      sender_id: trimText(event.senderId),
      event_at: parseTimestamp(event.at) || nowIso,
      type: trimText(event.type),
      source: 'runtime',
      migration_source_key: `events.jsonl:${index + 1}`,
      session_state: trimText(event.sessionState),
      product_code: trimText(event.productCode),
      text: text(event.text),
      meta: normalizeJsonObject(event.meta),
      customer_name: '',
      phone: '',
      address: '',
      customer_history: [],
      sheet_dedupe_key: '',
      sheet_synced_at: null,
      created_at: parseTimestamp(event.at) || nowIso
    }));
}

function buildCustomerEventRows({ customers, tenantId, pageId, nowIso, warnings }) {
  return customers
    .filter(row => isPlainObject(row))
    .map((row, index) => ({
      tenant_id: tenantId,
      page_id: pageId,
      sender_id: trimText(row.senderId),
      event_at: parseTimestamp(row.at) || nowIso,
      type: trimText(row.type) || 'lead',
      source: 'customer_export',
      migration_source_key: `customers.csv:${index + 1}`,
      session_state: '',
      product_code: trimText(row.productCode),
      text: text(row.text),
      meta: {},
      customer_name: trimText(row.name),
      phone: trimText(row.phone),
      address: trimText(row.address),
      customer_history: parseJsonArrayCell(row.history, warnings, `customers.csv row ${index + 1} history`),
      sheet_dedupe_key: '',
      sheet_synced_at: null,
      created_at: parseTimestamp(row.at) || nowIso
    }));
}

function buildSheetOutboxEventRows({ outbox, tenantId, pageId, nowIso }) {
  return outbox
    .filter(row => isPlainObject(row))
    .map((row, index) => {
      const leadData = isPlainObject(row.leadData) ? row.leadData : {};
      return {
        tenant_id: tenantId,
        page_id: pageId,
        sender_id: trimText(leadData.senderId),
        event_at: parseTimestamp(row.enqueuedAt) || nowIso,
        type: row.parseError ? 'sheet_outbox_parse_error' : 'sheet_outbox_pending',
        source: 'sheet_outbox',
        migration_source_key: `sheet-outbox.jsonl:${index + 1}`,
        session_state: '',
        product_code: trimText(leadData.productCode),
        text: text(leadData.text),
        meta: row,
        customer_name: trimText(leadData.name),
        phone: trimText(leadData.phone),
        address: trimText(leadData.address),
        customer_history: [],
        sheet_dedupe_key: trimText(row.dedupeKey || leadData.dedupeKey),
        sheet_synced_at: null,
        created_at: parseTimestamp(row.enqueuedAt) || nowIso
      };
    });
}

function buildProcessedMidRows({ mids, tenantId, pageId, nowIso, warnings }) {
  if (!Array.isArray(mids)) {
    warnings.push('processed-mids.json: expected JSON array, using empty list');
    return [];
  }

  return [...new Set(mids.map(trimText).filter(Boolean))]
    .map(mid => ({
      tenant_id: tenantId,
      page_id: pageId,
      mid,
      sender_id: '',
      first_seen_at: nowIso,
      meta: {}
    }));
}

function countRows(rows) {
  return Object.fromEntries(
    Object.entries(rows).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
  );
}

function buildMigrationPlan(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR);
  const tenantId = normalizeIdentifier(options.tenantId || process.env.TENANT_ID, DEFAULT_TENANT_ID);
  const pageId = normalizeIdentifier(options.pageId || process.env.PAGE_ID || process.env.FB_PAGE_ID, DEFAULT_PAGE_ID);
  const nowIso = parseTimestamp(options.now) || new Date().toISOString();
  const warnings = [];

  const stateFile = readJsonFile(dataDir, STORAGE_FILES.state, {}, warnings);
  const midsFile = readJsonFile(dataDir, STORAGE_FILES.mids, [], warnings);
  const customersFile = readCsvFile(dataDir, STORAGE_FILES.customers, warnings);
  const eventsFile = readJsonlFile(dataDir, STORAGE_FILES.events, warnings);
  const sheetOutboxFile = readJsonlFile(dataDir, STORAGE_FILES.sheetOutbox, warnings);

  const state = normalizeState(stateFile.value, warnings);
  const senderIds = collectSenderIds(
    state,
    customersFile.rows,
    eventsFile.rows,
    sheetOutboxFile.rows
  );

  const profileRows = buildProfileRows({ state, tenantId, pageId, nowIso });
  const conversationRows = buildConversationRows({ state, senderIds, tenantId, pageId, nowIso });
  const messageRows = buildMessageRows({ state, tenantId, pageId, nowIso, warnings });
  const { orders, orderItems } = buildOrderRows({ state, tenantId, pageId, nowIso });
  const eventRows = [
    ...buildRuntimeEventRows({ events: eventsFile.rows, tenantId, pageId, nowIso }),
    ...buildCustomerEventRows({ customers: customersFile.rows, tenantId, pageId, nowIso, warnings }),
    ...buildSheetOutboxEventRows({ outbox: sheetOutboxFile.rows, tenantId, pageId, nowIso })
  ];
  const processedMidRows = buildProcessedMidRows({
    mids: midsFile.value,
    tenantId,
    pageId,
    nowIso,
    warnings
  });

  const rows = {
    profiles: profileRows,
    conversations: conversationRows,
    messages: messageRows,
    orders,
    order_items: orderItems,
    events: eventRows,
    processed_mids: processedMidRows
  };

  return {
    dryRun: true,
    dataDir,
    tenantId,
    pageId,
    generatedAt: nowIso,
    files: {
      [STORAGE_FILES.state]: { path: stateFile.path, exists: stateFile.exists },
      [STORAGE_FILES.customers]: { path: customersFile.path, exists: customersFile.exists },
      [STORAGE_FILES.events]: { path: eventsFile.path, exists: eventsFile.exists },
      [STORAGE_FILES.mids]: { path: midsFile.path, exists: midsFile.exists },
      [STORAGE_FILES.sheetOutbox]: { path: sheetOutboxFile.path, exists: sheetOutboxFile.exists }
    },
    counts: countRows(rows),
    warnings,
    rows
  };
}

function summarizePlan(plan) {
  return {
    dryRun: plan.dryRun,
    dataDir: plan.dataDir,
    tenantId: plan.tenantId,
    pageId: plan.pageId,
    generatedAt: plan.generatedAt,
    files: plan.files,
    counts: plan.counts,
    warnings: plan.warnings
  };
}

function formatPlanSummary(plan) {
  const summary = summarizePlan(plan);
  const lines = [
    'File storage -> PostgreSQL migration dry-run',
    `dataDir: ${summary.dataDir}`,
    `tenantId: ${summary.tenantId}`,
    `pageId: ${summary.pageId}`,
    '',
    'Files:'
  ];

  for (const [name, info] of Object.entries(summary.files)) {
    lines.push(`- ${name}: ${info.exists ? 'found' : 'missing'}`);
  }

  lines.push('', 'Planned rows:');
  for (const [table, count] of Object.entries(summary.counts)) {
    lines.push(`- ${table}: ${count}`);
  }

  if (summary.warnings.length) {
    lines.push('', 'Warnings:');
    summary.warnings.forEach(warning => lines.push(`- ${warning}`));
  }

  lines.push('', 'No database writes were performed.');
  lines.push('Before any real migration or STORAGE_ADAPTER switch, back up /data first.');
  return lines.join('\n');
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizeMigrationTarget(value) {
  const target = trimText(value || 'local').toLowerCase();
  return target || 'local';
}

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(trimText(value));
}

function isRailwayProductionRuntime(env = process.env) {
  const envName = trimText(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME).toLowerCase();
  return envName === 'production' || envName === 'prod';
}

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (err) {
    throw new Error('Package "pg" is required for --apply. Run npm install pg before using DB apply mode.');
  }
}

function buildUpsertSql({ table, columns, conflictClause, updateColumns, returningColumns = [] }) {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const columnSql = columns.map(quoteIdent).join(', ');
  const updates = updateColumns
    .map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
    .join(', ');
  const returningSql = returningColumns.length
    ? ` RETURNING ${returningColumns.map(quoteIdent).join(', ')}`
    : '';
  return [
    `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES (${placeholders})`,
    `ON CONFLICT ${conflictClause}`,
    updates ? `DO UPDATE SET ${updates}` : 'DO NOTHING',
    returningSql
  ].join(' ');
}

function serializeColumnValue(table, column, value) {
  if (JSON_COLUMNS[table] && JSON_COLUMNS[table].has(column)) {
    return JSON.stringify(value == null ? null : value);
  }
  return value;
}

function valuesForColumns(table, row, columns) {
  return columns.map(column => serializeColumnValue(table, column, row[column]));
}

function updateColumns(columns, excluded = []) {
  const excludedSet = new Set(excluded);
  return columns.filter(column => !excludedSet.has(column));
}

async function verifyPostgresSchema(client) {
  const expectedColumns = Object.entries(WRITE_COLUMNS)
    .flatMap(([table, columns]) => columns.map(column => ({ table, column })));
  const tableNames = TARGET_TABLES;
  const columnsResult = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [tableNames]
  );
  const existingColumns = new Set(
    columnsResult.rows.map(row => `${row.table_name}.${row.column_name}`)
  );
  const missingColumns = expectedColumns
    .filter(({ table, column }) => !existingColumns.has(`${table}.${column}`))
    .map(({ table, column }) => `${table}.${column}`);

  const indexesResult = await client.query(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
    `,
    [REQUIRED_UNIQUE_INDEXES]
  );
  const existingIndexes = new Set(indexesResult.rows.map(row => row.indexname));
  const missingIndexes = REQUIRED_UNIQUE_INDEXES.filter(index => !existingIndexes.has(index));

  if (missingColumns.length || missingIndexes.length) {
    const details = [];
    if (missingColumns.length) details.push(`missing columns: ${missingColumns.join(', ')}`);
    if (missingIndexes.length) details.push(`missing indexes: ${missingIndexes.join(', ')}`);
    throw new Error(`PostgreSQL schema is not ready for migration (${details.join('; ')}). Review and apply db/schema.sql to a dev/staging DB first.`);
  }
}

async function countTargetRows(client, tenantId, pageId) {
  const counts = {};
  for (const table of TARGET_TABLES) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)} WHERE tenant_id = $1 AND page_id = $2`,
      [tenantId, pageId]
    );
    counts[table] = Number(result.rows[0] && result.rows[0].count) || 0;
  }
  return counts;
}

async function upsertRows(client, table, rows, config) {
  if (!rows.length) return 0;
  const sql = buildUpsertSql({
    table,
    columns: config.columns,
    conflictClause: config.conflictClause,
    updateColumns: config.updateColumns,
    returningColumns: config.returningColumns || []
  });

  for (const row of rows) {
    await client.query(sql, valuesForColumns(table, row, config.columns));
  }
  return rows.length;
}

async function upsertOrdersAndItems(client, plan) {
  const orderIdBySource = new Map();
  const orderConfig = {
    columns: WRITE_COLUMNS.orders,
    conflictClause: '(tenant_id, page_id, migration_source_key) WHERE migration_source_key <> \'\'',
    updateColumns: updateColumns(WRITE_COLUMNS.orders, ['tenant_id', 'page_id', 'migration_source_key']),
    returningColumns: ['id', 'migration_source_key']
  };
  const orderSql = buildUpsertSql({
    table: 'orders',
    columns: orderConfig.columns,
    conflictClause: orderConfig.conflictClause,
    updateColumns: orderConfig.updateColumns,
    returningColumns: orderConfig.returningColumns
  });

  for (const order of plan.rows.orders) {
    const result = await client.query(orderSql, valuesForColumns('orders', order, orderConfig.columns));
    const row = result.rows[0];
    orderIdBySource.set(order.source_key, Number(row.id));
  }

  const itemConfig = {
    columns: WRITE_COLUMNS.order_items,
    conflictClause: '(order_id, item_index)',
    updateColumns: updateColumns(WRITE_COLUMNS.order_items, ['order_id', 'item_index'])
  };
  const itemSql = buildUpsertSql({
    table: 'order_items',
    columns: itemConfig.columns,
    conflictClause: itemConfig.conflictClause,
    updateColumns: itemConfig.updateColumns
  });

  for (const item of plan.rows.order_items) {
    const orderId = orderIdBySource.get(item.order_source_key);
    if (!orderId) {
      throw new Error(`order_items row references unknown order_source_key "${item.order_source_key}"`);
    }
    const row = { ...item, order_id: orderId };
    await client.query(itemSql, valuesForColumns('order_items', row, itemConfig.columns));
  }

  return {
    orders: plan.rows.orders.length,
    order_items: plan.rows.order_items.length
  };
}

function assertApplyOptions(options, plan, env = process.env) {
  if (!options.iHaveBackedUpData) {
    throw new Error('--apply requires --i-have-backed-up-data. Back up file storage before any DB write.');
  }

  const migrationTarget = normalizeMigrationTarget(options.migrationTarget || env.MIGRATION_TARGET);
  if (!SAFE_APPLY_TARGETS.has(migrationTarget)) {
    throw new Error('--apply only accepts --migration-target local, dev, staging, or production.');
  }

  const isProductionTarget = migrationTarget === 'production';
  if (isProductionTarget) {
    if (!envFlagEnabled(env[PRODUCTION_DB_WRITE_UNLOCK_ENV])) {
      throw new Error(`--apply --migration-target production requires ${PRODUCTION_DB_WRITE_UNLOCK_ENV}=true in the command environment.`);
    }
    if (trimText(options.productionConfirmation || env.PRODUCTION_DB_WRITE_CONFIRMATION) !== PRODUCTION_CONFIRMATION) {
      throw new Error(`--apply --migration-target production requires --production-confirmation "${PRODUCTION_CONFIRMATION}".`);
    }
  } else if (isRailwayProductionRuntime(env)) {
    throw new Error('--apply inside Railway production runtime requires --migration-target production and explicit production write confirmation.');
  }

  if (plan.warnings.length && (isProductionTarget || !options.allowWarnings)) {
    throw new Error('Apply refused because dry-run produced warnings. Fix the source data or pass --allow-warnings for a dev/staging test only.');
  }

  const databaseUrl = trimText(options.databaseUrl || env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error('--apply requires --database-url or DATABASE_URL for a local/dev/staging/production PostgreSQL database.');
  }

  return { migrationTarget, databaseUrl };
}

async function applyMigrationPlan(plan, options = {}) {
  const env = options.env || process.env;
  const { migrationTarget, databaseUrl } = assertApplyOptions(options, plan, env);
  const Client = options.Client || loadPgClient();
  const client = options.client || new Client({ connectionString: databaseUrl });
  const ownsClient = !options.client;

  if (ownsClient) await client.connect();

  try {
    await client.query('BEGIN');
    if (!options.skipSchemaCheck) await verifyPostgresSchema(client);
    const beforeCounts = await countTargetRows(client, plan.tenantId, plan.pageId);

    const appliedCounts = {};
    appliedCounts.profiles = await upsertRows(client, 'profiles', plan.rows.profiles, {
      columns: WRITE_COLUMNS.profiles,
      conflictClause: '(tenant_id, page_id, sender_id)',
      updateColumns: updateColumns(WRITE_COLUMNS.profiles, ['tenant_id', 'page_id', 'sender_id', 'created_at'])
    });
    appliedCounts.conversations = await upsertRows(client, 'conversations', plan.rows.conversations, {
      columns: WRITE_COLUMNS.conversations,
      conflictClause: '(tenant_id, page_id, sender_id)',
      updateColumns: updateColumns(WRITE_COLUMNS.conversations, ['tenant_id', 'page_id', 'sender_id', 'created_at'])
    });
    appliedCounts.messages = await upsertRows(client, 'messages', plan.rows.messages, {
      columns: WRITE_COLUMNS.messages,
      conflictClause: '(tenant_id, page_id, source, migration_source_key) WHERE migration_source_key <> \'\'',
      updateColumns: updateColumns(WRITE_COLUMNS.messages, ['tenant_id', 'page_id', 'source', 'migration_source_key'])
    });
    const orderCounts = await upsertOrdersAndItems(client, plan);
    appliedCounts.orders = orderCounts.orders;
    appliedCounts.order_items = orderCounts.order_items;
    appliedCounts.events = await upsertRows(client, 'events', plan.rows.events, {
      columns: WRITE_COLUMNS.events,
      conflictClause: '(tenant_id, page_id, source, migration_source_key) WHERE migration_source_key <> \'\'',
      updateColumns: updateColumns(WRITE_COLUMNS.events, ['tenant_id', 'page_id', 'source', 'migration_source_key'])
    });
    appliedCounts.processed_mids = await upsertRows(client, 'processed_mids', plan.rows.processed_mids, {
      columns: WRITE_COLUMNS.processed_mids,
      conflictClause: '(tenant_id, page_id, mid)',
      updateColumns: updateColumns(WRITE_COLUMNS.processed_mids, ['tenant_id', 'page_id', 'mid'])
    });

    const afterCounts = await countTargetRows(client, plan.tenantId, plan.pageId);
    await client.query('COMMIT');

    return {
      dryRun: false,
      migrationTarget,
      dataDir: plan.dataDir,
      tenantId: plan.tenantId,
      pageId: plan.pageId,
      generatedAt: plan.generatedAt,
      files: plan.files,
      plannedCounts: plan.counts,
      appliedCounts,
      beforeCounts,
      afterCounts,
      warnings: plan.warnings
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      err.message = `${err.message}; rollback failed: ${rollbackErr.message}`;
    }
    throw err;
  } finally {
    if (ownsClient) await client.end();
  }
}

function summarizeApplyResult(result) {
  return {
    dryRun: result.dryRun,
    migrationTarget: result.migrationTarget,
    dataDir: result.dataDir,
    tenantId: result.tenantId,
    pageId: result.pageId,
    generatedAt: result.generatedAt,
    files: result.files,
    plannedCounts: result.plannedCounts,
    appliedCounts: result.appliedCounts,
    beforeCounts: result.beforeCounts,
    afterCounts: result.afterCounts,
    warnings: result.warnings
  };
}

function formatApplySummary(result) {
  const summary = summarizeApplyResult(result);
  const lines = [
    'File storage -> PostgreSQL migration apply',
    `target: ${summary.migrationTarget}`,
    `dataDir: ${summary.dataDir}`,
    `tenantId: ${summary.tenantId}`,
    `pageId: ${summary.pageId}`,
    '',
    'Files:'
  ];

  for (const [name, info] of Object.entries(summary.files)) {
    lines.push(`- ${name}: ${info.exists ? 'found' : 'missing'}`);
  }

  lines.push('', 'Planned rows:');
  for (const [table, count] of Object.entries(summary.plannedCounts)) {
    lines.push(`- ${table}: ${count}`);
  }

  lines.push('', 'Rows before:');
  for (const [table, count] of Object.entries(summary.beforeCounts)) {
    lines.push(`- ${table}: ${count}`);
  }

  lines.push('', 'Rows after:');
  for (const [table, count] of Object.entries(summary.afterCounts)) {
    lines.push(`- ${table}: ${count}`);
  }

  if (summary.warnings.length) {
    lines.push('', 'Warnings:');
    summary.warnings.forEach(warning => lines.push(`- ${warning}`));
  }

  lines.push('', 'Database writes were performed inside one transaction.');
  lines.push('Source file storage was not modified or deleted.');
  return lines.join('\n');
}

function parseCliArgs(argv) {
  const options = {
    dryRun: true,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--apply') {
      options.dryRun = false;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--i-have-backed-up-data') {
      options.iHaveBackedUpData = true;
    } else if (arg === '--allow-warnings') {
      options.allowWarnings = true;
    } else if (arg === '--production-confirmation') {
      options.productionConfirmation = argv[++i];
    } else if (arg === '--data-dir') {
      options.dataDir = argv[++i];
    } else if (arg === '--tenant-id') {
      options.tenantId = argv[++i];
    } else if (arg === '--page-id') {
      options.pageId = argv[++i];
    } else if (arg === '--database-url' || arg === '--db-url') {
      options.databaseUrl = argv[++i];
    } else if (arg === '--migration-target') {
      options.migrationTarget = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function helpText() {
  return [
    'Usage: node scripts/migrate-file-storage-to-postgres.js [options]',
    '',
    'Options:',
    '  --dry-run              Build and print a migration plan. This is the default.',
    '  --apply                Write to a local/dev/staging/production PostgreSQL DB using a transaction.',
    '  --i-have-backed-up-data Required with --apply. Refuses DB writes without this flag.',
    '  --database-url <url>   PostgreSQL URL for --apply. Defaults to DATABASE_URL.',
    '  --migration-target <t> Apply target label: local, dev, staging, or production.',
    `  --production-confirmation <text> Required for production apply. Must equal "${PRODUCTION_CONFIRMATION}".`,
    '  --allow-warnings       Allow dev/staging apply when dry-run produced warnings.',
    '  --data-dir <path>      File storage directory. Defaults to DATA_DIR or ./data.',
    '  --tenant-id <id>       Tenant id to stamp on planned rows. Defaults to "default".',
    '  --page-id <id>         Page id to stamp on planned rows. Defaults to PAGE_ID/FB_PAGE_ID/default.',
    '  --json                 Print summary as JSON without row payloads.',
    '  -h, --help             Show this help.'
  ].join('\n');
}

async function runCli(argv = process.argv.slice(2), io = console, deps = {}) {
  const options = parseCliArgs(argv);
  if (options.help) {
    io.log(helpText());
    return 0;
  }

  if (!options.dryRun) {
    assertApplyOptions(options, { warnings: [] }, deps.env || process.env);
  }

  const plan = buildMigrationPlan(options);
  if (!options.dryRun) {
    const result = await applyMigrationPlan(plan, { ...deps, ...options });
    if (options.json) {
      io.log(JSON.stringify(summarizeApplyResult(result), null, 2));
    } else {
      io.log(formatApplySummary(result));
    }
    return 0;
  }

  if (options.json) {
    io.log(JSON.stringify(summarizePlan(plan), null, 2));
  } else {
    io.log(formatPlanSummary(plan));
  }
  return 0;
}

if (require.main === module) {
  runCli()
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  applyMigrationPlan,
  buildMigrationPlan,
  formatApplySummary,
  formatPlanSummary,
  helpText,
  parseCliArgs,
  runCli,
  summarizeApplyResult,
  summarizePlan
};

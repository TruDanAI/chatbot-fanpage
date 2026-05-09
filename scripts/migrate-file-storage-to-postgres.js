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
    .map(event => ({
      tenant_id: tenantId,
      page_id: pageId,
      sender_id: trimText(event.senderId),
      event_at: parseTimestamp(event.at) || nowIso,
      type: trimText(event.type),
      source: 'runtime',
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
    .map(row => {
      const leadData = isPlainObject(row.leadData) ? row.leadData : {};
      return {
        tenant_id: tenantId,
        page_id: pageId,
        sender_id: trimText(leadData.senderId),
        event_at: parseTimestamp(row.enqueuedAt) || nowIso,
        type: row.parseError ? 'sheet_outbox_parse_error' : 'sheet_outbox_pending',
        source: 'sheet_outbox',
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
    } else if (arg === '--data-dir') {
      options.dataDir = argv[++i];
    } else if (arg === '--tenant-id') {
      options.tenantId = argv[++i];
    } else if (arg === '--page-id') {
      options.pageId = argv[++i];
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
    '  --apply                Refused for now. DB writes are not implemented yet.',
    '  --data-dir <path>      File storage directory. Defaults to DATA_DIR or ./data.',
    '  --tenant-id <id>       Tenant id to stamp on planned rows. Defaults to "default".',
    '  --page-id <id>         Page id to stamp on planned rows. Defaults to PAGE_ID/FB_PAGE_ID/default.',
    '  --json                 Print summary as JSON without row payloads.',
    '  -h, --help             Show this help.'
  ].join('\n');
}

async function runCli(argv = process.argv.slice(2), io = console) {
  const options = parseCliArgs(argv);
  if (options.help) {
    io.log(helpText());
    return 0;
  }

  if (!options.dryRun) {
    throw new Error('Apply mode is intentionally not implemented. Back up /data and add DB write support in a separate reviewed step.');
  }

  const plan = buildMigrationPlan(options);
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
  buildMigrationPlan,
  formatPlanSummary,
  helpText,
  parseCliArgs,
  runCli,
  summarizePlan
};

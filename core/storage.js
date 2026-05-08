const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// DATA_DIR có thể trỏ sang Railway Volume, ví dụ DATA_DIR=/data.
// Mặc định: thư mục data/ ở root project (cùng cấp với core/).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'chat-state.json');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.csv');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const MIDS_FILE = path.join(DATA_DIR, 'processed-mids.json');
const CUSTOMER_HEADERS = ['at', 'type', 'senderId', 'productCode', 'phone', 'name', 'address', 'text', 'history'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
ensureCustomersFile();

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`⚠️ Không đọc được ${file}, dùng giá trị mặc định.`);
    return fallback;
  }
}

const state = loadJSON(STATE_FILE, { history: {}, handoff: {}, context: {} });
if (!state.history) state.history = {};
if (!state.handoff) state.handoff = {};
if (!state.context) state.context = {};
const mids = new Set(loadJSON(MIDS_FILE, []));
const MID_LIMIT = 5000;
let customerWriteQueue = Promise.resolve();
let eventWriteQueue = Promise.resolve();
let stateWriteQueue = Promise.resolve();

let saveTimer = null;
async function writeJsonAtomic(targetFile, payload) {
  const tempFile = `${targetFile}.tmp`;
  await fs.promises.writeFile(tempFile, JSON.stringify(payload), 'utf8');
  await fs.promises.rename(tempFile, targetFile);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const midsSnapshot = [...mids].slice(-MID_LIMIT);
    stateWriteQueue = stateWriteQueue
      .then(async () => {
        await writeJsonAtomic(STATE_FILE, stateSnapshot);
        await writeJsonAtomic(MIDS_FILE, midsSnapshot);
      })
      .catch(err => {
        console.error('Lỗi ghi state/mids:', err.message);
      });
  }, 1500);
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

function ensureCustomersFile() {
  if (!fs.existsSync(CUSTOMERS_FILE)) {
    fs.writeFileSync(CUSTOMERS_FILE, CUSTOMER_HEADERS.join(',') + '\n');
    return;
  }

  const csv = fs.readFileSync(CUSTOMERS_FILE, 'utf8');
  const firstLine = csv.split(/\r?\n/, 1)[0] || '';
  const currentHeaders = firstLine.split(',').map(header => header.trim());
  const hasAllHeaders = CUSTOMER_HEADERS.every(header => currentHeaders.includes(header));
  if (hasAllHeaders) return;

  try {
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
    fs.writeFileSync(CUSTOMERS_FILE, migrated, 'utf8');
    console.log('✅ Đã nâng cấp customers.csv với các cột lead mới.');
  } catch (e) {
    console.warn(`⚠️ Không nâng cấp được customers.csv: ${e.message}`);
  }
}

function appendCustomerQueued(customer) {
  const line = CUSTOMER_HEADERS
    .map(key => csvCell(customer[key]))
    .join(',') + '\n';

  customerWriteQueue = customerWriteQueue
    .then(() => fs.promises.appendFile(CUSTOMERS_FILE, line, 'utf8'))
    .catch(err => {
      console.error('Lỗi ghi customers.csv:', err.message);
    });

  return customerWriteQueue;
}

function appendEventQueued(event) {
  const payload = {
    at: event.at || new Date().toISOString(),
    type: String(event.type || 'event'),
    senderId: String(event.senderId || ''),
    sessionState: String(event.sessionState || ''),
    productCode: String(event.productCode || ''),
    text: event.text == null ? '' : String(event.text),
    meta: event.meta || {}
  };

  eventWriteQueue = eventWriteQueue
    .then(() => fs.promises.appendFile(EVENTS_FILE, JSON.stringify(payload) + '\n', 'utf8'))
    .catch(err => {
      console.error('Lỗi ghi events.jsonl:', err.message);
    });

  return eventWriteQueue;
}

module.exports = {
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
    return state.history[userId] ? [...state.history[userId]] : [];
  },

  setHistory(userId, history) {
    state.history[userId] = history;
    scheduleSave();
  },

  setHandoff(userId, until) {
    state.handoff[userId] = until;
    scheduleSave();
  },

  inHandoff(userId) {
    const until = state.handoff[userId];
    if (!until) return false;
    if (Date.now() > until) {
      delete state.handoff[userId];
      scheduleSave();
      return false;
    }
    return true;
  },

  getLastProductCode(userId) {
    return state.context[userId]?.lastProductCode || '';
  },

  setLastProductCode(userId, code) {
    if (!userId || !code) return;
    if (!state.context[userId]) state.context[userId] = {};
    state.context[userId].lastProductCode = code;
    scheduleSave();
  },

  getLastUserAt(userId) {
    return state.context[userId]?.lastUserAt || '';
  },

  setLastUserAt(userId, at = new Date().toISOString()) {
    if (!userId) return;
    if (!state.context[userId]) state.context[userId] = {};
    state.context[userId].lastUserAt = at;
    scheduleSave();
  },

  getOrderDraft(userId) {
    return state.context[userId]?.orderDraft
      ? { ...state.context[userId].orderDraft }
      : {};
  },

  mergeOrderDraft(userId, details = {}) {
    if (!userId) return {};
    if (!state.context[userId]) state.context[userId] = {};
    const current = state.context[userId].orderDraft || {};
    const next = { ...current };

    for (const key of ['productCode', 'phone', 'name', 'address']) {
      const value = String(details[key] || '').trim();
      if (value) next[key] = value;
    }

    if (Array.isArray(details.cartItems) && details.cartItems.length) {
      next.cartItems = details.cartItems
        .map(item => ({
          code: String(item.code || '').trim(),
          name: String(item.name || '').trim(),
          qty: Number(item.qty || 1) || 1,
          variant: String(item.variant || '').trim()
        }))
        .filter(item => item.code || item.name);
    }

    if (Object.keys(next).length) {
      next.updatedAt = new Date().toISOString();
      state.context[userId].orderDraft = next;
      scheduleSave();
    }
    return { ...next };
  },

  getSessionState(userId) {
    return state.context[userId]?.sessionState || '';
  },

  setSessionState(userId, sessionState) {
    if (!userId) return;
    if (!state.context[userId]) state.context[userId] = {};
    if (sessionState) {
      state.context[userId].sessionState = sessionState;
    } else {
      delete state.context[userId].sessionState;
    }
    scheduleSave();
  },

  getOrderStaffNotification(userId) {
    const draft = state.context[userId]?.orderDraft || {};
    return {
      hash: draft.staffNotifiedHash || '',
      at: draft.staffNotifiedAt || ''
    };
  },

  setOrderStaffNotification(userId, details = {}) {
    if (!userId) return {};
    if (!state.context[userId]) state.context[userId] = {};
    const current = state.context[userId].orderDraft || {};
    const next = {
      ...current,
      staffNotifiedHash: String(details.hash || '').trim(),
      staffNotifiedAt: String(details.at || new Date().toISOString()).trim()
    };
    state.context[userId].orderDraft = next;
    scheduleSave();
    return { ...next };
  },

  clearOrderDraft(userId) {
    if (!userId || !state.context[userId]) return;
    delete state.context[userId].orderDraft;
    delete state.context[userId].sessionState;
    scheduleSave();
  },

  resetSessionAfterTimeout(userId) {
    if (!userId || !state.context[userId]) return {};
    const current = state.context[userId];
    const abandoned = current.orderDraft ? { ...current.orderDraft } : {};
    if (Object.keys(abandoned).length) {
      current.abandonedOrderDraft = {
        ...abandoned,
        abandonedAt: new Date().toISOString()
      };
    }
    delete current.orderDraft;
    delete current.lastProductCode;
    current.sessionState = 'IDLE';
    current.timedOutAt = new Date().toISOString();
    scheduleSave();
    return abandoned;
  },

  seenMid(mid) {
    return mids.has(mid);
  },

  markMid(mid) {
    mids.add(mid);
    if (mids.size > MID_LIMIT) {
      const arr = [...mids];
      mids.clear();
      arr.slice(-MID_LIMIT).forEach(m => mids.add(m));
    }
    scheduleSave();
  },

  appendCustomer(customer) {
    return appendCustomerQueued({
      at: customer.at || new Date().toISOString(),
      type: customer.type || 'lead',
      senderId: customer.senderId || '',
      productCode: customer.productCode || '',
      phone: customer.phone || '',
      name: customer.name || '',
      address: customer.address || '',
      text: customer.text || '',
      history: customer.history || ''
    });
  },

  appendEvent(event) {
    return appendEventQueued(event);
  }
};

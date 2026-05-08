// Quick Replies/Suggestion Actions cho Messenger.
//
// Module này chỉ định nghĩa action + stage mapping. Business logic vẫn đi qua
// rules.js bằng cách map payload thành câu text tương đương khách tự gõ.

const DEFAULT_ACTIONS = {
  HOT_PRODUCTS: {
    title: '🔥 Hàng hot',
    payload: 'HOT_PRODUCTS',
    text: 'mẫu hot'
  },
  BUDGET_300: {
    title: '💰 Dưới 300k',
    payload: 'BUDGET_300',
    text: 'mẫu nào dưới 300k'
  },
  GEL_ACCESSORIES: {
    title: '🧴 Gel / phụ kiện',
    payload: 'GEL_ACCESSORIES',
    text: 'gel',
    contentTrigger: 'gel'
  },
  QUICK_ADVICE: {
    title: '👩 Tư vấn nhanh',
    payload: 'QUICK_ADVICE',
    text: 'tư vấn nhanh'
  },
  HUMAN_HANDOFF: {
    title: '👩 Gặp nhân viên',
    payload: 'HUMAN_HANDOFF',
    text: 'gặp nhân viên tư vấn'
  },
  ORDER_SELECTED: {
    title: '✅ Chốt mẫu này',
    payload: 'ORDER_SELECTED',
    text: 'chốt mẫu này'
  },
  CHEAPER_PRODUCTS: {
    title: '💰 Mẫu rẻ hơn',
    payload: 'CHEAPER_PRODUCTS',
    text: 'mẫu nào dưới 300k'
  },
  SEND_ORDER_INFO: {
    title: '📦 Gửi thông tin',
    payload: 'SEND_ORDER_INFO',
    text: 'chốt đơn cần gửi thông tin gì?'
  }
};

const DEFAULT_STAGE_ACTIONS = {
  greeting: ['HOT_PRODUCTS', 'BUDGET_300', 'GEL_ACCESSORIES', 'QUICK_ADVICE'],
  productDetail: ['GEL_ACCESSORIES', 'HOT_PRODUCTS', 'CHEAPER_PRODUCTS', 'ORDER_SELECTED'],
  checkout: ['SEND_ORDER_INFO', 'HUMAN_HANDOFF'],
  confused: ['HOT_PRODUCTS', 'QUICK_ADVICE']
};

const TERMINAL_STATES = new Set(['CONFIRMED']);
const CHECKOUT_STATES = new Set(['COLLECTING_INFO', 'READY_TO_CONFIRM']);

function getQuickReplyConfig(config = {}) {
  const qr = config.quickReplies || {};
  return {
    enabled: qr.enabled !== false,
    actions: { ...DEFAULT_ACTIONS, ...(qr.actions || {}) },
    stages: { ...DEFAULT_STAGE_ACTIONS, ...(qr.stages || {}) }
  };
}

function toMessengerQuickReply(action) {
  if (!action || !action.title || !action.payload) return null;
  const item = {
    content_type: 'text',
    title: String(action.title).slice(0, 20),
    payload: String(action.payload).slice(0, 1000)
  };
  if (action.imageUrl) item.image_url = action.imageUrl;
  return item;
}

function uniqueActions(ids, actions) {
  const seen = new Set();
  const result = [];

  for (const id of ids || []) {
    const action = actions[id];
    if (!action || seen.has(action.payload || id)) continue;
    seen.add(action.payload || id);
    result.push({ ...action, payload: action.payload || id });
    if (result.length >= 4) break;
  }
  return result;
}

function inferSuggestionStage(ctx = {}) {
  const state = ctx.stateAfterReply || ctx.stateAfter || ctx.sessionState || '';
  if (TERMINAL_STATES.has(state)) return '';
  if (CHECKOUT_STATES.has(state)) return 'checkout';
  if (ctx.fallbackUsed || ctx.confused) return 'confused';
  if (ctx.isGreeting) return 'greeting';
  if (state === 'PRODUCT_SELECTED' || ctx.viewingProduct || ctx.lastProductCode) return 'productDetail';
  return '';
}

function buildQuickReplies(ctx = {}, config = {}) {
  const qrConfig = getQuickReplyConfig(config);
  if (!qrConfig.enabled) return [];

  const stage = ctx.stage || inferSuggestionStage(ctx);
  if (!stage) return [];

  const actions = uniqueActions(qrConfig.stages[stage], qrConfig.actions);
  return actions.map(toMessengerQuickReply).filter(Boolean);
}

function resolveQuickReplyPayload(payload, config = {}) {
  const value = String(payload || '').trim();
  if (!value) return null;

  const qrConfig = getQuickReplyConfig(config);
  const action = Object.values(qrConfig.actions)
    .find(item => String(item.payload || '').trim() === value);

  if (!action) return null;
  return {
    payload: value,
    text: action.text || value,
    action
  };
}

module.exports = {
  DEFAULT_ACTIONS,
  DEFAULT_STAGE_ACTIONS,
  buildQuickReplies,
  inferSuggestionStage,
  resolveQuickReplyPayload
};

const {
  maskAddress,
  maskPhone
} = require('./views');

function limitText(value = '', max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function maskSensitiveText(value = '', max = 240) {
  return limitText(value, max)
    .replace(/\b(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/g, '[masked-phone]')
    .replace(/\b(?:sdt|sđt|phone|tel|dien thoai|điện thoại)\s*[:=-]?\s*\S+/gi, '$1 [masked-phone]')
    .replace(/\b(?:dia chi|địa chỉ|address)\s*[:=-]?\s*.+$/gi, '$1 [masked-address]');
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}

function presentFilters(filters = {}) {
  return {
    ...filters,
    activeCount: Number(filters.activeCount || 0)
  };
}

function presentPageMeta(page = {}) {
  return {
    page: Number(page.page || 1),
    limit: Number(page.limit || 0),
    offset: Number(page.offset || 0),
    total: Number(page.total || 0),
    hasPrevious: Boolean(page.hasPrevious),
    hasNext: Boolean(page.hasNext),
    previousPage: page.previousPage == null ? null : Number(page.previousPage),
    nextPage: page.nextPage == null ? null : Number(page.nextPage)
  };
}

function presentPagination(pagination = {}) {
  return Object.fromEntries(
    Object.entries(pagination).map(([key, value]) => [key, presentPageMeta(value)])
  );
}

function presentCounts(counts = {}) {
  return {
    profiles: Number(counts.profiles || 0),
    conversations: Number(counts.conversations || 0),
    messages: Number(counts.messages || 0),
    orders: Number(counts.orders || 0),
    order_items: Number(counts.order_items || 0),
    events: Number(counts.events || 0),
    processed_mids: Number(counts.processed_mids || 0)
  };
}

function presentOrder(order = {}) {
  return compactObject({
    id: order.id != null ? String(order.id) : '',
    sender_id: order.sender_id || '',
    status: order.status || '',
    product_code: order.product_code || '',
    customer_name: limitText(order.customer_name, 80),
    phone: maskPhone(order.phone),
    address: maskAddress(order.address),
    item_count: order.item_count != null ? Number(order.item_count) : undefined,
    draft_updated_at: order.draft_updated_at || undefined,
    staff_notified_at: order.staff_notified_at || undefined,
    abandoned_cart_reminder_sent_at: order.abandoned_cart_reminder_sent_at || undefined,
    abandoned_cart_reminder_failed_at: order.abandoned_cart_reminder_failed_at || undefined,
    abandoned_at: order.abandoned_at || undefined,
    confirmed_at: order.confirmed_at || undefined,
    updated_at: order.updated_at || ''
  });
}

function presentConversation(conversation = {}) {
  return {
    sender_id: conversation.sender_id || '',
    session_state: conversation.session_state || '',
    last_product_code: conversation.last_product_code || '',
    last_user_at: conversation.last_user_at || '',
    handoff_until: conversation.handoff_until || undefined,
    timed_out_at: conversation.timed_out_at || undefined,
    updated_at: conversation.updated_at || ''
  };
}

function presentEvent(event = {}) {
  return {
    id: event.id != null ? String(event.id) : '',
    sender_id: event.sender_id || '',
    type: event.type || '',
    source: event.source || '',
    session_state: event.session_state || '',
    product_code: event.product_code || '',
    event_at: event.event_at || '',
    text: maskSensitiveText(event.text, 180)
  };
}

function presentMessage(message = {}) {
  return {
    id: message.id != null ? String(message.id) : '',
    role: message.role || '',
    source: message.source || '',
    created_at: message.created_at || '',
    text: maskSensitiveText(message.text, 220)
  };
}

function presentOrderItem(item = {}) {
  return {
    order_id: item.order_id != null ? String(item.order_id) : '',
    item_index: item.item_index != null ? Number(item.item_index) : 0,
    code: item.code || '',
    name: limitText(item.name, 120),
    qty: item.qty != null ? Number(item.qty) : 0,
    variant: limitText(item.variant, 120),
    display: limitText(item.display, 160),
    created_at: item.created_at || ''
  };
}

function presentProfile(profile = {}) {
  const displayName = profile?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  return {
    sender_id: profile?.sender_id || '',
    display_name: limitText(displayName, 120),
    created_at: profile?.created_at || '',
    updated_at: profile?.updated_at || ''
  };
}

function presentAuditRow(row = {}) {
  return {
    occurred_at: row.occurred_at || '',
    actor_id: row.actor_id || '',
    actor_roles: Array.isArray(row.actor_roles) ? row.actor_roles : [],
    action: row.action || '',
    resource_type: row.resource_type || '',
    resource_id: row.resource_id || '',
    outcome: row.outcome || '',
    request_id: row.request_id || '',
    user_agent: limitText(row.user_agent, 120)
  };
}

function presentActivity(activity = {}) {
  return {
    orders_24h: Number(activity.orders_24h || 0),
    confirmed_24h: Number(activity.confirmed_24h || 0),
    ready_orders: Number(activity.ready_orders || 0),
    abandoned_24h: Number(activity.abandoned_24h || 0),
    active_handoffs: Number(activity.active_handoffs || 0),
    events_24h: Number(activity.events_24h || 0),
    last_user_message_at: activity.last_user_message_at || '',
    last_event_at: activity.last_event_at || ''
  };
}

function presentStatusBreakdown(row = {}) {
  return {
    status: row.status || '',
    total: Number(row.total || 0)
  };
}

function presentTopProduct(row = {}) {
  return {
    product_code: row.product_code || '',
    total_orders: Number(row.total_orders || 0),
    confirmed_orders: Number(row.confirmed_orders || 0)
  };
}

function presentAttentionOrder(order = {}) {
  return {
    reason: order.reason || 'needs_review',
    ...presentOrder(order)
  };
}

function presentAttentionHandoff(item = {}) {
  return {
    reason: 'active_handoff',
    sender_id: item.sender_id || '',
    session_state: item.session_state || '',
    last_product_code: item.last_product_code || '',
    last_user_at: item.last_user_at || '',
    handoff_until: item.handoff_until || '',
    updated_at: item.updated_at || ''
  };
}

function presentOperations(operations = {}) {
  const needsAttention = operations.needsAttention || {};
  return {
    windowHours: Number(operations.windowHours || 24),
    productWindowDays: Number(operations.productWindowDays || 30),
    activity: presentActivity(operations.activity || {}),
    orderStatusBreakdown: (operations.orderStatusBreakdown || []).map(presentStatusBreakdown),
    topProducts: (operations.topProducts || []).map(presentTopProduct),
    needsAttention: {
      orders: (needsAttention.orders || []).map(presentAttentionOrder),
      handoffs: (needsAttention.handoffs || []).map(presentAttentionHandoff)
    }
  };
}

function presentDashboardApi(model = {}) {
  return {
    tenantId: model.tenantId || '',
    pageId: model.pageId || '',
    counts: presentCounts(model.counts || {}),
    operations: presentOperations(model.operations || {}),
    filters: presentFilters(model.filters || {}),
    limits: model.limits || {},
    pagination: presentPagination(model.pagination || {}),
    orders: (model.orders || []).map(presentOrder),
    conversations: (model.conversations || []).map(presentConversation),
    events: (model.events || []).map(presentEvent)
  };
}

function presentUserDetailApi(model = {}) {
  return {
    tenantId: model.tenantId || '',
    pageId: model.pageId || '',
    senderId: model.senderId || '',
    profile: model.profile ? presentProfile(model.profile) : null,
    conversation: model.conversation ? presentConversation(model.conversation) : null,
    limits: model.limits || {},
    orders: (model.orders || []).map(presentOrder),
    orderItems: (model.orderItems || []).map(presentOrderItem),
    messages: (model.messages || []).map(presentMessage),
    events: (model.events || []).map(presentEvent)
  };
}

function presentAuditApi(model = {}) {
  return {
    tenantId: model.tenantId || '',
    pageId: model.pageId || '',
    schemaReady: model.schemaReady !== false,
    filters: presentFilters(model.filters || {}),
    limits: model.limits || {},
    pagination: presentPagination(model.pagination || {}),
    rows: (model.rows || []).map(presentAuditRow)
  };
}

module.exports = {
  maskSensitiveText,
  presentAuditApi,
  presentDashboardApi,
  presentOperations,
  presentUserDetailApi
};

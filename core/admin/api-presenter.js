const {
  maskAddress,
  maskPhone
} = require('./views');
const { pageRef } = require('../utils/log-refs');
const { buildShopReadiness } = require('./shop-readiness');

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

const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|authorization|cookie|credential|api[_-]?key|access[_-]?key|private[_-]?key|database[_-]?url|db[_-]?url|customer|phone|address|email)/i;
const SENSITIVE_VALUE_PATTERN = /\b(?:postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|redis:\/\/)/i;

function sanitizeAdminValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(String(key || ''))) return '[redacted]';
  if (value == null) return value;
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_PATTERN.test(value)) return '[redacted]';
    return limitText(value, 500);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map(item => sanitizeAdminValue(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .filter(([childKey]) => !SENSITIVE_KEY_PATTERN.test(String(childKey || '')))
        .map(([childKey, childValue]) => [
          childKey,
          sanitizeAdminValue(childValue, childKey, depth + 1)
        ])
    );
  }
  return limitText(value, 500);
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

function presentInternalNote(note = {}) {
  return {
    id: note.id != null ? String(note.id) : '',
    target_type: note.target_type || '',
    target_id: note.target_id || '',
    body: note.body || '',
    status: note.status || '',
    created_by: note.created_by || '',
    created_at: note.created_at || ''
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

function presentInternalNotesApi(model = {}) {
  const notes = (model.notes || []).map(presentInternalNote);
  const limit = Number(model.limit || 0);
  const offset = Number(model.offset || 0);
  return {
    schemaReady: model.schemaReady !== false,
    notes,
    pagination: {
      limit,
      offset,
      count: notes.length,
      hasNext: Boolean(model.hasNext || (limit > 0 && notes.length === limit))
    },
    ...(model.message ? { message: limitText(model.message, 160) } : {}),
    ...(model.error ? { error: limitText(model.error, 80) } : {})
  };
}

function presentShopListItem(shop = {}) {
  return {
    id: shop.id || '',
    slug: shop.slug || '',
    name: limitText(shop.name, 120),
    status: shop.status || '',
    package: shop.package || 'basic',
    lifecycle: shop.lifecycle || '',
    dry_run: shop.dry_run == null ? null : Boolean(shop.dry_run),
    live_enabled: Boolean(shop.live_enabled),
    last_readiness_status: shop.last_readiness_status || 'unknown',
    last_manual_test_status: shop.last_manual_test_status || 'unknown',
    page_count: Number(shop.page_count || 0),
    active_page_count: Number(shop.active_page_count || 0),
    product_count: Number(shop.product_count || 0),
    asset_count: Number(shop.asset_count || 0),
    bot_mode: shop.bot_mode || '',
    updated_at: shop.updated_at || ''
  };
}

function presentShopPage(page = {}) {
  const rawPageId = page.page_id || '';
  const result = {
    id: page.id || '',
    shop_id: page.shop_id || '',
    page_ref: page.page_ref || (rawPageId ? pageRef(rawPageId) : ''),
    page_name: limitText(page.page_name, 120),
    status: page.status || '',
    created_at: page.created_at || '',
    updated_at: page.updated_at || ''
  };
  if (page.active_credential_count != null) {
    result.active_credential_count = Number(page.active_credential_count || 0);
  }
  return result;
}

function presentShopSettings(settings = {}) {
  return {
    bot_mode: settings.bot_mode || '',
    handoff_enabled: Boolean(settings.handoff_enabled),
    handoff_message: limitText(settings.handoff_message, 500),
    menu_intro_text: limitText(settings.menu_intro_text, 500),
    fallback_text: limitText(settings.fallback_text, 500),
    settings_json: sanitizeAdminValue(settings.settings_json || {}),
    updated_at: settings.updated_at || ''
  };
}

function presentShopProduct(product = {}) {
  const metadata = product.metadata_json || {};
  return {
    id: product.id || '',
    code: product.code || '',
    name: limitText(product.name, 120),
    description: limitText(product.description, 500),
    price: product.price == null ? null : String(product.price),
    currency: product.currency || '',
    price_text: limitText(product.price_text || metadata.priceText || metadata.priceLabel || metadata.price || '', 120),
    status: product.status || '',
    enabled: String(product.status || '').toLowerCase() === 'active',
    sort_order: Number(product.sort_order || 0),
    tags: Array.isArray(product.tags)
      ? product.tags.map(item => limitText(item, 40)).filter(Boolean)
      : (Array.isArray(metadata.tags) ? metadata.tags.map(item => limitText(item, 40)).filter(Boolean) : []),
    category: limitText(product.category || metadata.category || '', 80),
    metadata_json: sanitizeAdminValue(metadata || {}),
    updated_at: product.updated_at || ''
  };
}

function presentShopAsset(asset = {}) {
  return {
    id: asset.id || '',
    product_id: asset.product_id || '',
    product_code: asset.product_code || '',
    asset_type: asset.asset_type || '',
    storage_provider: asset.storage_provider || '',
    public_url: asset.public_url || '',
    content_type: asset.content_type || '',
    size_bytes: asset.size_bytes == null ? null : Number(asset.size_bytes),
    status: asset.status || '',
    sort_order: Number(asset.sort_order || 0),
    updated_at: asset.updated_at || ''
  };
}

function presentShopAssetsSummary(summary = {}) {
  return {
    total: Number(summary.total || 0),
    active: Number(summary.active || 0),
    product_image: Number(summary.product_image || 0),
    product_image_active: Number(summary.product_image_active || 0),
    menu_image: Number(summary.menu_image || 0),
    menu_image_active: Number(summary.menu_image_active || 0)
  };
}

function activeCount(rows = []) {
  return (rows || []).filter(row => String(row.status || '').toLowerCase() === 'active').length;
}

function presentShopOnboarding(model = {}, shop = null) {
  if (!shop) return null;
  const settings = model.settings || null;
  const pages = model.pages || [];
  const products = model.products || [];
  const assetsSummary = model.assets?.summary || {};
  const credentials = model.credentials || {};
  const shopId = shop.id || '';
  const shopHref = `/admin/shops/${encodeURIComponent(shopId)}`;
  const counts = {
    active_page_mapping_count: activeCount(pages),
    active_credential_count: credentials.available === false
      ? 0
      : Number(credentials.active_fb_page_token_count || 0),
    active_product_count: activeCount(products),
    active_menu_image_count: Number(assetsSummary.menu_image_active || 0),
    active_product_image_count: Number(assetsSummary.product_image_active || 0)
  };
  const settingsReady = Boolean(settings && String(settings.bot_mode || '').trim());
  const item = (key, label, passed, nextAction, href = shopHref) => ({
    key,
    label,
    passed: Boolean(passed),
    next_action: nextAction,
    action_href: href
  });
  const shopActive = String(shop.status || '').toLowerCase() === 'active';
  const manualTestPassed = String(shop.last_manual_test_status || '').toLowerCase() === 'passed';
  const checklist = [
    item('shop_active', 'Shop active', shopActive, shopActive ? 'review shop status' : 'activate shop', `${shopHref}#metadata`),
    item('settings_ready', 'Settings ready', settingsReady, settingsReady ? 'edit settings' : 'create settings', `${shopHref}#settings`),
    item('page_mapping_ready', 'Page mapping ready', counts.active_page_mapping_count > 0, 'add page mapping', `${shopHref}#page-mappings`),
    item('credential_ready', 'Credential ready', counts.active_credential_count > 0, 'add credential', `${shopHref}#page-mappings`),
    item('product_ready', 'Product ready', counts.active_product_count > 0, 'add product', `${shopHref}#products`),
    item('menu_assets_ready', 'Menu assets ready', counts.active_menu_image_count > 0, 'add menu image', `${shopHref}#assets`),
    item('product_assets_ready', 'Product assets ready', counts.active_product_image_count > 0, 'add product image', `${shopHref}#assets`),
    item('manual_test_ready', 'Manual test passed', manualTestPassed, 'run manual test and mark passed', `${shopHref}#control-plane`),
    item('health_ready', 'Health ready', Boolean(shop.id), 'view health', `/admin/api/shops/${encodeURIComponent(shopId)}/health`)
  ];
  const readiness = presentReadinessResult(buildShopReadiness({
    shop,
    settings,
    counts,
    manualTestStatus: shop.last_manual_test_status,
    globalDryRunState: { available: true, dry_run: true }
  }));

  return {
    ready: checklist.every(entry => entry.passed),
    counts,
    checklist,
    readiness_status: readiness.readiness_status,
    hard_blockers: readiness.hard_blockers,
    warnings: readiness.warnings,
    checks: readiness.checks,
    safe_counts: readiness.safe_counts,
    ...(credentials.available === false ? { credential_status: 'unavailable' } : {})
  };
}

function presentReadinessIssue(item = {}) {
  return {
    key: limitText(item.key || '', 80),
    label: limitText(item.label || '', 120),
    detail: limitText(item.detail || '', 240),
    next_action: limitText(item.next_action || '', 240)
  };
}

function presentReadinessCheck(check = {}) {
  const status = ['pass', 'fail', 'warning'].includes(String(check.status || ''))
    ? String(check.status || '')
    : 'fail';
  const result = {
    key: limitText(check.key || '', 80),
    label: limitText(check.label || '', 120),
    status,
    next_action: limitText(check.next_action || '', 240)
  };
  if (check.count != null) result.count = Number(check.count || 0);
  if (check.detail) result.detail = limitText(check.detail || '', 240);
  return result;
}

function presentReadinessResult(readiness = {}) {
  const status = ['passed', 'failed', 'warnings'].includes(String(readiness.readiness_status || ''))
    ? String(readiness.readiness_status || '')
    : 'failed';
  const counts = readiness.safe_counts || {};
  return {
    shop_id: limitText(readiness.shop_id || '', 160),
    readiness_status: status,
    hard_blockers: (readiness.hard_blockers || []).map(presentReadinessIssue),
    warnings: (readiness.warnings || []).map(presentReadinessIssue),
    checks: (readiness.checks || []).map(presentReadinessCheck),
    safe_counts: {
      products: Number(counts.products || 0),
      menu_images: Number(counts.menu_images || 0),
      product_images: Number(counts.product_images || 0),
      active_page_mappings: Number(counts.active_page_mappings || 0),
      active_credentials: Number(counts.active_credentials || 0)
    }
  };
}

function presentHealthStatusSummary(section = {}, statuses = []) {
  const byStatus = {};
  for (const status of statuses) {
    byStatus[status] = Number(section.byStatus?.[status] || 0);
  }
  return {
    available: section.available !== false,
    total: Number(section.total || 0),
    byStatus,
    ...(section.reason ? { reason: limitText(section.reason, 80) } : {}),
    ...(section.message ? { message: limitText(section.message, 160) } : {})
  };
}

function presentProcessedMidsSummary(section) {
  if (!section || section.available === false) {
    return {
      available: false,
      reason: limitText(section?.reason || 'schema_not_ready', 80)
    };
  }
  const olderThan30d = Number(section.older_than_30d || section.cleanup_candidate_count || 0);
  return {
    available: true,
    retention_days: Number(section.retention_days || 30),
    total: Number(section.total || 0),
    older_than_7d: Number(section.older_than_7d || 0),
    older_than_30d: olderThan30d,
    cleanup_candidate_count: olderThan30d,
    oldest_first_seen_at: section.oldest_first_seen_at || null,
    newest_first_seen_at: section.newest_first_seen_at || null
  };
}

function presentShopHealthApi(model = {}) {
  const shop = model.shop ? {
    id: model.shop.id || '',
    slug: model.shop.slug || '',
    name: limitText(model.shop.name, 120),
    status: model.shop.status || '',
    package: model.shop.package || 'basic',
    lifecycle: model.shop.lifecycle || '',
    dry_run: model.shop.dry_run == null ? null : Boolean(model.shop.dry_run),
    live_enabled: Boolean(model.shop.live_enabled),
    last_readiness_status: model.shop.last_readiness_status || 'unknown',
    last_manual_test_status: model.shop.last_manual_test_status || 'unknown',
    updated_at: model.shop.updated_at || ''
  } : null;
  const activity = model.activity || {};
  const credentialSummary = presentHealthStatusSummary(model.credentials || {}, ['active', 'paused', 'archived']);
  if ((model.credentials || {}).available === false) {
    credentialSummary.available = false;
    credentialSummary.reason = limitText(model.credentials.reason || 'schema_not_ready', 80);
  }

  return {
    schemaReady: model.schemaReady !== false,
    shop,
    pageMappings: presentHealthStatusSummary(model.pageMappings || {}, ['active', 'paused', 'archived']),
    activity: activity.available === false ? {
      available: false,
      reason: limitText(activity.reason || 'schema_not_ready', 80)
    } : {
      available: true,
      last_webhook_received_at: activity.last_webhook_received_at || null,
      last_successful_send_at: activity.last_successful_send_at || null,
      send_error_rate_1h: activity.send_error_rate_1h == null ? null : Number(activity.send_error_rate_1h),
      send_errors_1h: Number(activity.send_errors_1h || 0),
      successful_sends_1h: Number(activity.successful_sends_1h || 0),
      active_handoff_count: Number(activity.active_handoff_count || 0)
    },
    processedMids: presentProcessedMidsSummary(model.processedMids),
    queue: presentHealthStatusSummary(model.queue || {}, ['queued', 'processing', 'done', 'failed']),
    credentials: credentialSummary,
    ...(model.message ? { message: limitText(model.message, 160) } : {})
  };
}

function presentShopsApi(model = {}) {
  return {
    schemaReady: model.schemaReady !== false,
    shops: (model.shops || []).map(presentShopListItem),
    ...(model.message ? { message: limitText(model.message, 160) } : {})
  };
}

function presentShopDetailApi(model = {}) {
  const shop = model.shop ? {
    id: model.shop.id || '',
    slug: model.shop.slug || '',
    name: limitText(model.shop.name, 120),
    status: model.shop.status || '',
    package: model.shop.package || 'basic',
    lifecycle: model.shop.lifecycle || '',
    dry_run: model.shop.dry_run == null ? null : Boolean(model.shop.dry_run),
    live_enabled: Boolean(model.shop.live_enabled),
    last_readiness_status: model.shop.last_readiness_status || 'unknown',
    last_readiness_checked_at: model.shop.last_readiness_checked_at || '',
    last_manual_test_status: model.shop.last_manual_test_status || 'unknown',
    last_manual_test_at: model.shop.last_manual_test_at || '',
    last_ready_by: model.shop.last_ready_by || '',
    default_locale: model.shop.default_locale || '',
    timezone: model.shop.timezone || '',
    created_at: model.shop.created_at || '',
    updated_at: model.shop.updated_at || ''
  } : null;

  return {
    schemaReady: model.schemaReady !== false,
    shop,
    pages: (model.pages || []).map(presentShopPage),
    settings: model.settings ? presentShopSettings(model.settings) : null,
    products: (model.products || []).map(presentShopProduct),
    assets: {
      summary: presentShopAssetsSummary(model.assets?.summary || {}),
      rows: (model.assets?.rows || [])
        .filter(asset => ['menu_image', 'product_image'].includes(String(asset.asset_type || '')))
        .map(presentShopAsset)
    },
    onboarding: presentShopOnboarding(model, shop),
    ...(model.message ? { message: limitText(model.message, 160) } : {})
  };
}

function presentProductWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    product: presentShopProduct(model.product || {})
  };
}

function presentShopSettingsWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    settings: presentShopSettings(model.settings || {})
  };
}

function presentShopControlWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || model.shop?.id || '',
    shop: model.shop ? {
      id: model.shop.id || '',
      slug: model.shop.slug || '',
      name: limitText(model.shop.name, 120),
      status: model.shop.status || '',
      package: model.shop.package || 'basic',
      lifecycle: model.shop.lifecycle || '',
      dry_run: model.shop.dry_run == null ? null : Boolean(model.shop.dry_run),
      live_enabled: Boolean(model.shop.live_enabled),
      last_readiness_status: model.shop.last_readiness_status || 'unknown',
      last_readiness_checked_at: model.shop.last_readiness_checked_at || '',
      last_manual_test_status: model.shop.last_manual_test_status || 'unknown',
      last_manual_test_at: model.shop.last_manual_test_at || '',
      last_ready_by: model.shop.last_ready_by || '',
      updated_at: model.shop.updated_at || ''
    } : null,
    readiness: {
      status: model.readiness?.status || 'unknown',
      hardBlockers: (model.readiness?.hardBlockers || []).map(item => ({
        key: item.key || '',
        label: limitText(item.label || '', 120)
      })),
      warnings: (model.readiness?.warnings || []).map(item => ({
        key: item.key || '',
        label: limitText(item.label || '', 120)
      }))
    }
  };
}

function presentShopReadinessCheckApi(model = {}) {
  return presentReadinessResult(model.readiness || {});
}

function presentPageMappingWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    page: presentShopPage(model.page || {})
  };
}

function presentPageMappingArchiveApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    page: presentShopPage(model.page || {}),
    already_archived: Boolean(model.already_archived),
    archived_credential_count: Number(model.archivedCredentialCount || 0),
    active_credential_count_after: Number(model.activeCredentialCountAfter || 0)
  };
}

function presentPageCredentialWriteApi(model = {}) {
  const credential = model.credential || {};
  return {
    page_ref: model.page_ref || '',
    credential: {
      id: credential.id || '',
      credential_type: credential.credential_type || '',
      status: credential.status || ''
    },
    active_credential_count: Number(model.active_credential_count || 0),
    archived_count: Number(model.archived_count || 0),
    rotated: Boolean(model.rotated)
  };
}

function presentPageCutoverWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    shop_ref: model.shop_ref || '',
    old_page_ref: model.old_page_ref || '',
    new_page_ref: model.new_page_ref || '',
    old_page_mapping_id: model.old_page_mapping_id || '',
    new_page_mapping_id: model.new_page_mapping_id || '',
    old_credential_ref: model.old_credential_ref || '',
    new_credential_ref: model.new_credential_ref || '',
    old_mapping_status: model.old_mapping_status || '',
    new_mapping_status: model.new_mapping_status || '',
    old_credential_status: model.old_credential_status || '',
    new_credential_status: model.new_credential_status || '',
    active_mapping_count: Number(model.active_mapping_count || 0),
    active_credential_count: Number(model.active_credential_count || 0),
    readiness_stale: Boolean(model.readiness_stale)
  };
}

function presentReadinessImpact(impact = {}) {
  return {
    validate_only: impact.validate_only !== false,
    changes_readiness: Boolean(impact.changes_readiness),
    blockers_remaining: Array.isArray(impact.blockers_remaining)
      ? impact.blockers_remaining.map(item => limitText(item, 80)).filter(Boolean)
      : [],
    live_enabled_after_preview: Boolean(impact.live_enabled_after_preview)
  };
}

function presentPageMappingPreviewApi(model = {}) {
  const pageName = model.page_name || {};
  return {
    ok: true,
    schemaReady: model.schemaReady !== false,
    validate_only: true,
    shop_ref: model.shop_ref || '',
    page_ref: model.page_ref || '',
    duplicate_active_mapping: Boolean(model.duplicate_active_mapping),
    conflict: Boolean(model.conflict),
    page_format_valid: Boolean(model.page_format_valid),
    page_name: {
      provided: Boolean(pageName.provided),
      length: Number(pageName.length || 0),
      max_length: Number(pageName.max_length || 0),
      status: pageName.status || ''
    },
    readiness_impact: presentReadinessImpact(model.readiness_impact || {})
  };
}

function presentPageCredentialPreviewApi(model = {}) {
  return {
    ok: true,
    schemaReady: model.schemaReady !== false,
    validate_only: true,
    shop_ref: model.shop_ref || '',
    page_ref: model.page_ref || '',
    credential_type: model.credential_type || '',
    credential_type_allowed: Boolean(model.credential_type_allowed),
    credential_master_key_configured: Boolean(model.credential_master_key_configured),
    token_accepted: false,
    health_check: false,
    messenger_send: false,
    readiness_impact: presentReadinessImpact(model.readiness_impact || {})
  };
}

function presentShopWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || model.shop?.id || '',
    shop: model.shop ? {
      id: model.shop.id || '',
      slug: model.shop.slug || '',
      name: limitText(model.shop.name, 120),
      status: model.shop.status || '',
      package: model.shop.package || 'basic',
      lifecycle: model.shop.lifecycle || '',
      dry_run: model.shop.dry_run == null ? null : Boolean(model.shop.dry_run),
      live_enabled: Boolean(model.shop.live_enabled),
      last_readiness_status: model.shop.last_readiness_status || 'unknown',
      last_readiness_checked_at: model.shop.last_readiness_checked_at || '',
      last_manual_test_status: model.shop.last_manual_test_status || 'unknown',
      last_manual_test_at: model.shop.last_manual_test_at || '',
      last_ready_by: model.shop.last_ready_by || '',
      default_locale: model.shop.default_locale || '',
      timezone: model.shop.timezone || '',
      created_at: model.shop.created_at || '',
      updated_at: model.shop.updated_at || ''
    } : null,
    settings: presentShopSettings(model.settings || {})
  };
}

function presentAssetWriteApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    asset: presentShopAsset(model.asset || {})
  };
}

function presentShopSettingsReadApi(model = {}) {
  return {
    schemaReady: model.schemaReady !== false,
    shop_id: model.shop?.id || model.shopId || '',
    settings: model.settings ? presentShopSettings(model.settings) : null,
    ...(model.message ? { message: limitText(model.message, 160) } : {})
  };
}

module.exports = {
  maskSensitiveText,
  presentAssetWriteApi,
  presentAuditApi,
  presentDashboardApi,
  presentInternalNotesApi,
  presentOperations,
  presentPageCredentialPreviewApi,
  presentPageCredentialWriteApi,
  presentPageCutoverWriteApi,
  presentPageMappingArchiveApi,
  presentPageMappingPreviewApi,
  presentPageMappingWriteApi,
  presentProductWriteApi,
  presentShopSettingsReadApi,
  presentShopSettingsWriteApi,
  presentShopControlWriteApi,
  presentShopReadinessCheckApi,
  presentShopWriteApi,
  presentShopDetailApi,
  presentShopHealthApi,
  presentShopsApi,
  presentUserDetailApi
};

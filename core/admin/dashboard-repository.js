function escapeSqlLike(value = '') {
  return String(value || '').replace(/[\\%_]/g, char => `\\${char}`);
}

function likeParam(value = '') {
  return `%${escapeSqlLike(value)}%`;
}

function addSqlCondition(conditions, params, sql, value, paramOffset = 2) {
  params.push(value);
  conditions.push(sql.replace('?', `$${paramOffset + params.length}`));
}

function buildOverviewQueryScope(filters, { tableAlias, productColumn, statusColumn, eventTypeColumn } = {}) {
  const conditions = [`${tableAlias}.tenant_id = $1`, `${tableAlias}.page_id = $2`];
  const params = [];
  if (filters.senderId) {
    addSqlCondition(conditions, params, `${tableAlias}.sender_id ILIKE ? ESCAPE '\\'`, likeParam(filters.senderId));
  }
  if (filters.productCode && productColumn) {
    addSqlCondition(conditions, params, `${productColumn} ILIKE ? ESCAPE '\\'`, likeParam(filters.productCode));
  }
  if (filters.status && statusColumn) {
    addSqlCondition(conditions, params, `${statusColumn} = ?`, filters.status);
  }
  if (filters.eventType && eventTypeColumn) {
    addSqlCondition(conditions, params, `${eventTypeColumn} ILIKE ? ESCAPE '\\'`, likeParam(filters.eventType));
  }
  return {
    whereSql: conditions.join(' AND '),
    filterParams: params
  };
}

function isMissingAuditSchemaError(err) {
  return err && ['42P01', '42703'].includes(String(err.code || ''));
}

function createPageMeta({ page = 1, limit = 25, offset = 0, total = 0 } = {}) {
  const safeTotal = Number(total || 0);
  const safeLimit = Number(limit || 1);
  const safePage = Number(page || 1);
  const safeOffset = Number(offset || 0);
  return {
    page: safePage,
    limit: safeLimit,
    offset: safeOffset,
    total: safeTotal,
    hasPrevious: safePage > 1,
    hasNext: safeOffset + safeLimit < safeTotal,
    previousPage: safePage > 1 ? safePage - 1 : null,
    nextPage: safeOffset + safeLimit < safeTotal ? safePage + 1 : null
  };
}

function createDashboardRepository({
  tenantId = 'default',
  pageId = '',
  limits = {}
} = {}) {
  async function getOverview(client, filters = {}) {
    const params = [tenantId, pageId];
    const pageLimit = Number(filters.limit || limits.overviewRows || 25);
    const pages = {
      conversations: {
        page: Number(filters.conversationsPage || filters.page || 1),
        limit: pageLimit,
        offset: Number(filters.conversationsOffset ?? filters.offset ?? 0)
      },
      orders: {
        page: Number(filters.ordersPage || filters.page || 1),
        limit: pageLimit,
        offset: Number(filters.ordersOffset ?? filters.offset ?? 0)
      },
      events: {
        page: Number(filters.eventsPage || filters.page || 1),
        limit: pageLimit,
        offset: Number(filters.eventsOffset ?? filters.offset ?? 0)
      }
    };
    const conversationsScope = buildOverviewQueryScope(filters, {
      tableAlias: 'c',
      productColumn: 'c.last_product_code'
    });
    const ordersScope = buildOverviewQueryScope(filters, {
      tableAlias: 'o',
      productColumn: 'o.product_code',
      statusColumn: 'o.status'
    });
    const eventsScope = buildOverviewQueryScope(filters, {
      tableAlias: 'e',
      productColumn: 'e.product_code',
      eventTypeColumn: 'e.type'
    });
    const conversationsLimitParam = 3 + conversationsScope.filterParams.length;
    const conversationsOffsetParam = conversationsLimitParam + 1;
    const ordersLimitParam = 3 + ordersScope.filterParams.length;
    const ordersOffsetParam = ordersLimitParam + 1;
    const eventsLimitParam = 3 + eventsScope.filterParams.length;
    const eventsOffsetParam = eventsLimitParam + 1;
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM profiles WHERE tenant_id = $1 AND page_id = $2) AS profiles,
        (SELECT COUNT(*)::int FROM conversations WHERE tenant_id = $1 AND page_id = $2) AS conversations,
        (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND page_id = $2) AS messages,
        (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND page_id = $2) AS orders,
        (SELECT COUNT(*)::int FROM order_items WHERE tenant_id = $1 AND page_id = $2) AS order_items,
        (SELECT COUNT(*)::int FROM events WHERE tenant_id = $1 AND page_id = $2) AS events,
        (SELECT COUNT(*)::int FROM processed_mids WHERE tenant_id = $1 AND page_id = $2) AS processed_mids
    `, params);
    const conversationRows = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM conversations c
      WHERE ${conversationsScope.whereSql}
    `, [...params, ...conversationsScope.filterParams]);
    const orderRows = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM orders o
      WHERE ${ordersScope.whereSql}
    `, [...params, ...ordersScope.filterParams]);
    const eventRows = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM events e
      WHERE ${eventsScope.whereSql}
    `, [...params, ...eventsScope.filterParams]);
    const conversations = await client.query(`
      SELECT sender_id, session_state, last_product_code, last_user_at, updated_at
      FROM conversations c
      WHERE ${conversationsScope.whereSql}
      ORDER BY updated_at DESC, sender_id ASC
      LIMIT $${conversationsLimitParam}
      OFFSET $${conversationsOffsetParam}
    `, [...params, ...conversationsScope.filterParams, pages.conversations.limit, pages.conversations.offset]);
    const orders = await client.query(`
      SELECT o.id, o.sender_id, o.status, o.product_code, o.customer_name,
             o.phone, o.address, o.updated_at, COUNT(oi.id)::int AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${ordersScope.whereSql}
      GROUP BY o.id, o.sender_id, o.status, o.product_code, o.customer_name,
               o.phone, o.address, o.updated_at
      ORDER BY o.updated_at DESC, o.id DESC
      LIMIT $${ordersLimitParam}
      OFFSET $${ordersOffsetParam}
    `, [...params, ...ordersScope.filterParams, pages.orders.limit, pages.orders.offset]);
    const events = await client.query(`
      SELECT id, sender_id, type, source, session_state, product_code, event_at, text
      FROM events e
      WHERE ${eventsScope.whereSql}
      ORDER BY event_at DESC, id DESC
      LIMIT $${eventsLimitParam}
      OFFSET $${eventsOffsetParam}
    `, [...params, ...eventsScope.filterParams, pages.events.limit, pages.events.offset]);
    const activity = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND page_id = $2 AND updated_at >= now() - interval '24 hours') AS orders_24h,
        (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND page_id = $2 AND status = 'confirmed' AND confirmed_at >= now() - interval '24 hours') AS confirmed_24h,
        (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND page_id = $2 AND status = 'ready_to_confirm') AS ready_orders,
        (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND page_id = $2 AND status = 'abandoned' AND updated_at >= now() - interval '24 hours') AS abandoned_24h,
        (SELECT COUNT(*)::int FROM conversations WHERE tenant_id = $1 AND page_id = $2 AND handoff_until > now()) AS active_handoffs,
        (SELECT COUNT(*)::int FROM events WHERE tenant_id = $1 AND page_id = $2 AND event_at >= now() - interval '24 hours') AS events_24h,
        (SELECT MAX(created_at) FROM messages WHERE tenant_id = $1 AND page_id = $2 AND role = 'user') AS last_user_message_at,
        (SELECT MAX(event_at) FROM events WHERE tenant_id = $1 AND page_id = $2) AS last_event_at
    `, params);
    const orderStatusBreakdown = await client.query(`
      SELECT status, COUNT(*)::int AS total
      FROM orders
      WHERE tenant_id = $1 AND page_id = $2
      GROUP BY status
      ORDER BY status ASC
    `, params);
    const topProducts = await client.query(`
      SELECT COALESCE(NULLIF(product_code, ''), 'unknown') AS product_code,
             COUNT(*)::int AS total_orders,
             COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_orders
      FROM orders
      WHERE tenant_id = $1 AND page_id = $2
        AND updated_at >= now() - interval '30 days'
      GROUP BY COALESCE(NULLIF(product_code, ''), 'unknown')
      ORDER BY total_orders DESC, product_code ASC
      LIMIT $3
    `, [...params, limits.topProductRows]);
    const attentionOrders = await client.query(`
      SELECT
        CASE
          WHEN o.abandoned_cart_reminder_failed_at IS NOT NULL THEN 'reminder_failed'
          WHEN o.status = 'ready_to_confirm' THEN 'ready_to_confirm'
          WHEN o.status = 'abandoned' OR o.abandoned_at IS NOT NULL THEN 'abandoned_cart'
          ELSE 'needs_review'
        END AS reason,
        o.id, o.sender_id, o.status, o.product_code, o.customer_name,
        o.phone, o.address, o.updated_at, o.draft_updated_at,
        o.staff_notified_at, o.abandoned_cart_reminder_sent_at,
        o.abandoned_cart_reminder_failed_at, o.abandoned_at,
        o.confirmed_at, COUNT(oi.id)::int AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.tenant_id = $1 AND o.page_id = $2
        AND (
          o.status = 'ready_to_confirm'
          OR o.status = 'abandoned'
          OR o.abandoned_cart_reminder_failed_at IS NOT NULL
        )
      GROUP BY o.id, o.sender_id, o.status, o.product_code, o.customer_name,
               o.phone, o.address, o.updated_at, o.draft_updated_at,
               o.staff_notified_at, o.abandoned_cart_reminder_sent_at,
               o.abandoned_cart_reminder_failed_at, o.abandoned_at,
               o.confirmed_at
      ORDER BY
        CASE
          WHEN o.abandoned_cart_reminder_failed_at IS NOT NULL THEN 1
          WHEN o.status = 'ready_to_confirm' THEN 2
          WHEN o.status = 'abandoned' OR o.abandoned_at IS NOT NULL THEN 3
          ELSE 4
        END ASC,
        o.updated_at DESC,
        o.id DESC
      LIMIT $3
    `, [...params, limits.attentionRows]);
    const attentionHandoffs = await client.query(`
      SELECT sender_id, session_state, last_product_code, last_user_at,
             handoff_until, updated_at
      FROM conversations c
      WHERE c.tenant_id = $1 AND c.page_id = $2 AND c.handoff_until > now()
      ORDER BY c.handoff_until DESC, c.updated_at DESC, c.sender_id ASC
      LIMIT $3
    `, [...params, limits.attentionRows]);

    return {
      tenantId,
      pageId,
      counts: counts.rows[0] || {},
      operations: {
        windowHours: 24,
        productWindowDays: 30,
        activity: activity.rows[0] || {},
        orderStatusBreakdown: orderStatusBreakdown.rows,
        topProducts: topProducts.rows,
        needsAttention: {
          orders: attentionOrders.rows,
          handoffs: attentionHandoffs.rows
        }
      },
      conversations: conversations.rows,
      orders: orders.rows,
      events: events.rows,
      filters,
      pagination: {
        conversations: createPageMeta({
          page: pages.conversations.page,
          limit: pages.conversations.limit,
          offset: pages.conversations.offset,
          total: conversationRows.rows[0]?.total
        }),
        orders: createPageMeta({
          page: pages.orders.page,
          limit: pages.orders.limit,
          offset: pages.orders.offset,
          total: orderRows.rows[0]?.total
        }),
        events: createPageMeta({
          page: pages.events.page,
          limit: pages.events.limit,
          offset: pages.events.offset,
          total: eventRows.rows[0]?.total
        })
      },
      limits: { ...limits, overviewRows: pageLimit }
    };
  }

  async function getUserDetail(client, senderId) {
    const normalizedSenderId = String(senderId || '').trim().slice(0, 160);
    const params = [tenantId, pageId, normalizedSenderId];
    const profile = await client.query(`
      SELECT sender_id, first_name, last_name, name, created_at, updated_at
      FROM profiles
      WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
      LIMIT 1
    `, params);
    const conversation = await client.query(`
      SELECT sender_id, session_state, last_product_code, last_user_at,
             handoff_until, timed_out_at, updated_at
      FROM conversations
      WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
      LIMIT 1
    `, params);
    const orders = await client.query(`
      SELECT id, sender_id, status, product_code, customer_name, phone, address,
             draft_updated_at, staff_notified_at, abandoned_cart_reminder_sent_at,
             abandoned_cart_reminder_failed_at, abandoned_at, confirmed_at, updated_at
      FROM orders
      WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
      ORDER BY updated_at DESC, id DESC
      LIMIT $4
    `, [...params, limits.detailOrders]);
    const orderIds = orders.rows.map(order => order.id).filter(Boolean);
    const items = orderIds.length
      ? await client.query(`
          SELECT order_id, item_index, code, name, qty, variant, display, created_at
          FROM order_items
          WHERE tenant_id = $1 AND page_id = $2 AND order_id = ANY($3::bigint[])
          ORDER BY order_id DESC, item_index ASC, id ASC
          LIMIT $4
        `, [tenantId, pageId, orderIds, limits.detailItems])
      : { rows: [] };
    const messages = await client.query(`
      SELECT id, role, text, source, created_at
      FROM messages
      WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
      ORDER BY created_at DESC, id DESC
      LIMIT $4
    `, [...params, limits.detailMessages]);
    const events = await client.query(`
      SELECT id, type, source, session_state, product_code, text, event_at
      FROM events
      WHERE tenant_id = $1 AND page_id = $2 AND sender_id = $3
      ORDER BY event_at DESC, id DESC
      LIMIT $4
    `, [...params, limits.detailEvents]);

    return {
      tenantId,
      pageId,
      senderId: normalizedSenderId,
      profile: profile.rows[0] || null,
      conversation: conversation.rows[0] || null,
      orders: orders.rows,
      orderItems: items.rows,
      messages: messages.rows,
      events: events.rows,
      limits
    };
  }

  async function getAuditLog(client, filters = {}) {
    const page = {
      page: Number(filters.page || 1),
      limit: Number(filters.limit || limits.auditRows || 50),
      offset: Number(filters.offset || 0)
    };
    const conditions = ['tenant_id = $1', 'page_id = $2'];
    const filterParams = [];
    if (filters.actorId) {
      addSqlCondition(conditions, filterParams, "actor_id ILIKE ? ESCAPE '\\'", likeParam(filters.actorId));
    }
    if (filters.action) {
      addSqlCondition(conditions, filterParams, "action ILIKE ? ESCAPE '\\'", likeParam(filters.action));
    }
    if (filters.outcome) {
      addSqlCondition(conditions, filterParams, 'outcome = ?', filters.outcome);
    }
    const limitParam = 3 + filterParams.length;
    const offsetParam = limitParam + 1;
    let audit;
    let totalRows = { rows: [{ total: 0 }] };
    let schemaReady = true;
    try {
      totalRows = await client.query(`
        SELECT COUNT(*)::int AS total
        FROM admin_audit_log
        WHERE ${conditions.join(' AND ')}
      `, [tenantId, pageId, ...filterParams]);
      audit = await client.query(`
        SELECT occurred_at, actor_id, actor_roles, action, resource_type,
               resource_id, outcome, request_id, user_agent
        FROM admin_audit_log
        WHERE ${conditions.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
        LIMIT $${limitParam}
        OFFSET $${offsetParam}
      `, [tenantId, pageId, ...filterParams, page.limit, page.offset]);
    } catch (err) {
      if (!isMissingAuditSchemaError(err)) throw err;
      schemaReady = false;
      audit = { rows: [] };
      totalRows = { rows: [{ total: 0 }] };
    }

    return {
      tenantId,
      pageId,
      rows: audit.rows,
      schemaReady,
      filters,
      pagination: {
        audit: createPageMeta({
          page: page.page,
          limit: page.limit,
          offset: page.offset,
          total: totalRows.rows[0]?.total
        })
      },
      limits: { ...limits, auditRows: page.limit }
    };
  }

  return {
    getAuditLog,
    getOverview,
    getUserDetail
  };
}

module.exports = {
  createDashboardRepository
};

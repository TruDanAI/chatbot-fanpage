const { safeErrorCode } = require('../webhook-queue');

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

function isMissingMultiShopSchemaError(err) {
  return err && ['42P01', '42703'].includes(String(err.code || ''));
}

function createStatusSummary(rows = [], statuses = []) {
  const summary = { total: 0, byStatus: {} };
  for (const status of statuses) summary.byStatus[status] = 0;
  for (const row of rows || []) {
    const status = String(row.status || 'unknown').trim() || 'unknown';
    const total = Number(row.total || 0);
    summary.total += total;
    summary.byStatus[status] = (summary.byStatus[status] || 0) + total;
  }
  return summary;
}

function createUnavailableSection(reason = 'schema_not_ready') {
  return {
    available: false,
    reason
  };
}

function safeQueueErrorCode(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/\s/.test(raw)) return 'webhook_queue_job_failed';
  const code = safeErrorCode(raw);
  if (/(?:eaab|token|secret|password|postgres|database[_-]?url|db[_-]?url|sender[_-]?id|customer|message[_-]?body|payload[_-]?json|page[_-]?id)/i.test(code)) {
    return 'webhook_queue_job_failed';
  }
  return code || 'webhook_queue_job_failed';
}

function nullableNonNegativeInteger(value) {
  if (value == null || value === '') return null;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return null;
  return Math.max(0, number);
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
  function createEmptyShopsModel(message = 'Multi-shop schema is not ready.') {
    return {
      schemaReady: false,
      shops: [],
      message
    };
  }

  function createEmptyShopDetailModel(message = 'Multi-shop schema is not ready.') {
    return {
      schemaReady: false,
      shop: null,
      pages: [],
      settings: null,
      products: [],
      assets: {
        summary: {},
        rows: []
      },
      credentials: createUnavailableSection('multi_shop_schema_not_ready'),
      pilotIsolation: createUnavailablePilotIsolation(),
      message
    };
  }

  function createEmptyShopHealthModel(message = 'Multi-shop schema is not ready.') {
    return {
      schemaReady: false,
      shop: null,
      pageMappings: {
        available: false,
        total: 0,
        byStatus: {},
        message
      },
      activity: createUnavailableSection('multi_shop_schema_not_ready'),
      processedMids: createUnavailableSection('multi_shop_schema_not_ready'),
      queue: createUnavailableSection('multi_shop_schema_not_ready'),
      credentials: createUnavailableSection('multi_shop_schema_not_ready'),
      message
    };
  }

  function createUnavailableShopSummary(message = 'Multi-shop schema is not ready.') {
    return {
      available: false,
      total: null,
      activeLive: null,
      needsSetup: null,
      dryRun: null,
      message
    };
  }

  function createUnavailablePilotIsolation(reason = 'multi_shop_schema_not_ready') {
    return {
      available: false,
      reason
    };
  }

  async function getShopSummary(client) {
    try {
      const result = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND (live_enabled IS TRUE OR lifecycle = 'live')
          )::int AS active_live,
          COUNT(*) FILTER (
            WHERE status <> 'archived'
              AND (
                COALESCE(last_readiness_status, 'unknown') <> 'passed'
                OR COALESCE(lifecycle, '') IN ('', 'draft', 'configuring')
                OR COALESCE(active_pages.active_page_count, 0) < 1
              )
          )::int AS needs_setup,
          COUNT(*) FILTER (WHERE dry_run IS TRUE)::int AS dry_run
        FROM shops s
        LEFT JOIN (
          SELECT shop_id, COUNT(*) FILTER (WHERE status = 'active')::int AS active_page_count
          FROM shop_pages
          GROUP BY shop_id
        ) active_pages ON active_pages.shop_id = s.id
      `, []);
      const row = result.rows[0] || {};
      return {
        available: true,
        total: Number(row.total || 0),
        activeLive: Number(row.active_live || 0),
        needsSetup: Number(row.needs_setup || 0),
        dryRun: Number(row.dry_run || 0)
      };
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return createUnavailableShopSummary();
    }
  }

  async function getShops(client) {
    try {
      const result = await client.query(`
        SELECT
          s.id,
          s.slug,
          s.name,
          s.status,
          s.package,
          s.lifecycle,
          s.dry_run,
          s.live_enabled,
          s.last_readiness_status,
          s.last_manual_test_status,
          COALESCE(pages.page_count, 0)::int AS page_count,
          COALESCE(pages.active_page_count, 0)::int AS active_page_count,
          COALESCE(products.product_count, 0)::int AS product_count,
          COALESCE(assets.asset_count, 0)::int AS asset_count,
          COALESCE(ss.bot_mode, '') AS bot_mode,
          s.updated_at
        FROM shops s
        LEFT JOIN shop_settings ss ON ss.shop_id = s.id
        LEFT JOIN (
          SELECT shop_id,
                 COUNT(*)::int AS page_count,
                 COUNT(*) FILTER (WHERE status = 'active')::int AS active_page_count
          FROM shop_pages
          GROUP BY shop_id
        ) pages ON pages.shop_id = s.id
        LEFT JOIN (
          SELECT shop_id, COUNT(*)::int AS product_count
          FROM shop_products
          GROUP BY shop_id
        ) products ON products.shop_id = s.id
        LEFT JOIN (
          SELECT shop_id, COUNT(*)::int AS asset_count
          FROM shop_assets
          GROUP BY shop_id
        ) assets ON assets.shop_id = s.id
        ORDER BY s.updated_at DESC, s.id ASC
      `, []);
      return {
        schemaReady: true,
        shops: result.rows
      };
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return createEmptyShopsModel();
    }
  }

  async function getShopDetail(client, shopId) {
    const normalizedShopId = String(shopId || '').trim().slice(0, 160);
    if (!normalizedShopId) {
      return {
        schemaReady: true,
        shop: null,
        pages: [],
        settings: null,
        products: [],
        assets: { summary: {}, rows: [] },
        credentials: createUnavailableSection('shop_not_found'),
        pilotIsolation: createUnavailablePilotIsolation('shop_not_found')
      };
    }

    try {
      const shopResult = await client.query(`
        SELECT id, slug, name, status, package, lifecycle, dry_run, live_enabled,
               last_readiness_status, last_readiness_checked_at,
               last_manual_test_status, last_manual_test_at, last_ready_by,
               default_locale, timezone, created_at, updated_at
        FROM shops
        WHERE id = $1 OR slug = $1
        ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
        LIMIT 1
      `, [normalizedShopId]);
      const shop = shopResult.rows[0] || null;
      if (!shop) {
        return {
          schemaReady: true,
          shop: null,
          pages: [],
          settings: null,
          products: [],
          assets: { summary: {}, rows: [] },
          credentials: createUnavailableSection('shop_not_found'),
          pilotIsolation: createUnavailablePilotIsolation('shop_not_found')
        };
      }

      const params = [shop.id];
      const pagesResult = await client.query(`
        SELECT id, page_id, page_name, status, created_at, updated_at
        FROM shop_pages
        WHERE shop_id = $1
        ORDER BY status ASC, updated_at DESC, id ASC
      `, params);
      let pages = pagesResult.rows;
      const settingsResult = await client.query(`
        SELECT bot_mode, handoff_enabled, handoff_message, menu_intro_text,
               fallback_text, settings_json, updated_at
        FROM shop_settings
        WHERE shop_id = $1
        LIMIT 1
      `, params);
      const productsResult = await client.query(`
        SELECT id, code, name, description, price, currency, status,
               sort_order, metadata_json, updated_at
        FROM shop_products
        WHERE shop_id = $1
        ORDER BY sort_order ASC, code ASC, id ASC
      `, params);
      const assetSummaryResult = await client.query(`
        SELECT asset_type,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'active')::int AS active
        FROM shop_assets
        WHERE shop_id = $1
        GROUP BY asset_type
        ORDER BY asset_type ASC
      `, params);
      const assetsResult = await client.query(`
        SELECT a.id, a.product_id, p.code AS product_code, a.asset_type,
               a.storage_provider, a.public_url, a.content_type, a.size_bytes,
               a.status, a.sort_order, a.updated_at
        FROM shop_assets a
        LEFT JOIN shop_products p ON p.id = a.product_id AND p.shop_id = a.shop_id
        WHERE a.shop_id = $1
        ORDER BY a.asset_type ASC, a.sort_order ASC, a.id ASC
      `, params);
      const pilotIsolationResult = await client.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE id <> $1
              AND COALESCE(status, '') <> 'archived'
          )::int AS other_shop_count,
          COUNT(*) FILTER (
            WHERE id <> $1
              AND COALESCE(status, '') <> 'archived'
              AND dry_run IS TRUE
          )::int AS other_dry_run_count,
          COUNT(*) FILTER (
            WHERE id <> $1
              AND COALESCE(status, '') <> 'archived'
              AND dry_run IS NOT TRUE
          )::int AS other_not_dry_run_count,
          COUNT(*) FILTER (
            WHERE id <> $1
              AND COALESCE(status, '') <> 'archived'
              AND (live_enabled IS TRUE OR COALESCE(lifecycle, '') = 'live')
          )::int AS other_live_capable_count
        FROM shops
      `, params);

      const summary = {
        total: 0,
        active: 0,
        product_image: 0,
        product_image_active: 0,
        menu_image: 0,
        menu_image_active: 0,
        shop_image: 0,
        shop_image_active: 0
      };
      for (const row of assetSummaryResult.rows) {
        const type = String(row.asset_type || '');
        const total = Number(row.total || 0);
        const active = Number(row.active || 0);
        summary.total += total;
        summary.active += active;
        if (Object.prototype.hasOwnProperty.call(summary, type)) summary[type] = total;
        if (Object.prototype.hasOwnProperty.call(summary, `${type}_active`)) summary[`${type}_active`] = active;
      }

      let credentials = createUnavailableSection('shop_page_credentials_schema_not_ready');
      try {
        const credentialResult = await client.query(`
          SELECT
            c.page_mapping_id,
            c.status,
            c.credential_type,
            sp.status AS page_status,
            COUNT(*)::int AS total
          FROM shop_page_credentials c
          JOIN shop_pages sp ON sp.id = c.page_mapping_id AND sp.shop_id = c.shop_id
          WHERE c.shop_id = $1
          GROUP BY c.page_mapping_id, c.status, c.credential_type, sp.status
          ORDER BY c.page_mapping_id ASC, c.status ASC, c.credential_type ASC
        `, params);
        const activeCredentialsByPage = new Map();
        let activeFbPageTokenCount = 0;
        for (const row of credentialResult.rows || []) {
          const total = Number(row.total || 0);
          const status = String(row.status || '').toLowerCase();
          const credentialType = String(row.credential_type || '').toLowerCase();
          if (status !== 'active' || credentialType !== 'fb_page_token') continue;
          if (String(row.page_status || '').toLowerCase() === 'active') {
            activeFbPageTokenCount += total;
          }
          const pageMappingId = String(row.page_mapping_id || '');
          if (pageMappingId) {
            activeCredentialsByPage.set(pageMappingId, (activeCredentialsByPage.get(pageMappingId) || 0) + total);
          }
        }
        pages = pages.map(page => ({
          ...page,
          active_credential_count: activeCredentialsByPage.get(String(page.id || '')) || 0
        }));
        credentials = {
          available: true,
          active_fb_page_token_count: activeFbPageTokenCount
        };
      } catch (err) {
        if (!isMissingMultiShopSchemaError(err)) throw err;
      }

      return {
        schemaReady: true,
        shop,
        pages,
        settings: settingsResult.rows[0] || null,
        products: productsResult.rows,
        assets: {
          summary,
          rows: assetsResult.rows
        },
        credentials,
        pilotIsolation: {
          available: true,
          other_shop_count: Number(pilotIsolationResult.rows[0]?.other_shop_count || 0),
          other_dry_run_count: Number(pilotIsolationResult.rows[0]?.other_dry_run_count || 0),
          other_not_dry_run_count: Number(pilotIsolationResult.rows[0]?.other_not_dry_run_count || 0),
          other_live_capable_count: Number(pilotIsolationResult.rows[0]?.other_live_capable_count || 0)
        }
      };
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return createEmptyShopDetailModel();
    }
  }

  async function getShopHealth(client, shopId) {
    const normalizedShopId = String(shopId || '').trim().slice(0, 160);
    if (!normalizedShopId) {
      return {
        schemaReady: true,
        shop: null,
        pageMappings: {
          available: true,
          total: 0,
          byStatus: {}
        },
        activity: createUnavailableSection('shop_not_found'),
        processedMids: createUnavailableSection('shop_not_found'),
        queue: createUnavailableSection('shop_not_found'),
        credentials: createUnavailableSection('shop_not_found')
      };
    }

    try {
      const shopResult = await client.query(`
        SELECT id, slug, name, status, package, lifecycle, dry_run, live_enabled,
               last_readiness_status, last_manual_test_status, updated_at
        FROM shops
        WHERE id = $1 OR slug = $1
        ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
        LIMIT 1
      `, [normalizedShopId]);
      const shop = shopResult.rows[0] || null;
      if (!shop) {
        return {
          schemaReady: true,
          shop: null,
          pageMappings: {
            available: true,
            total: 0,
            byStatus: {}
          },
          activity: createUnavailableSection('shop_not_found'),
          processedMids: createUnavailableSection('shop_not_found'),
          queue: createUnavailableSection('shop_not_found'),
          credentials: createUnavailableSection('shop_not_found')
        };
      }

      const pageStatusResult = await client.query(`
        SELECT status, COUNT(*)::int AS total
        FROM shop_pages
        WHERE shop_id = $1
        GROUP BY status
        ORDER BY status ASC
      `, [shop.id]);
      const pageIdsResult = await client.query(`
        SELECT DISTINCT page_id
        FROM shop_pages
        WHERE shop_id = $1
          AND page_id <> ''
      `, [shop.id]);
      const pageIds = (pageIdsResult.rows || []).map(row => String(row.page_id || '')).filter(Boolean);
      const pageMappings = {
        available: true,
        ...createStatusSummary(pageStatusResult.rows, ['active', 'paused', 'archived'])
      };

      let activity = {
        available: true,
        last_webhook_received_at: null,
        last_successful_send_at: null,
        send_error_rate_1h: null,
        send_errors_1h: 0,
        successful_sends_1h: 0,
        active_handoff_count: 0
      };
      try {
        const activityResult = await client.query(`
          SELECT
            (SELECT MAX(event_at)
             FROM events
             WHERE tenant_id = $1
               AND page_id = ANY($2::text[])
               AND type = 'message_received') AS last_webhook_received_at,
            (SELECT MAX(created_at)
             FROM messages
             WHERE tenant_id = $1
               AND page_id = ANY($2::text[])
               AND role IN ('model', 'bot')) AS last_successful_send_at,
            (SELECT COUNT(*)::int
             FROM events
             WHERE tenant_id = $1
               AND page_id = ANY($2::text[])
               AND event_at >= now() - interval '1 hour'
               AND type IN ('send_failed', 'send_error', 'message_send_failed', 'messenger_send_failed', 'messenger_send_error')) AS send_errors_1h,
            (SELECT COUNT(*)::int
             FROM messages
             WHERE tenant_id = $1
               AND page_id = ANY($2::text[])
               AND created_at >= now() - interval '1 hour'
               AND role IN ('model', 'bot')) AS successful_sends_1h,
            (SELECT COUNT(*)::int
             FROM conversations
             WHERE tenant_id = $1
               AND page_id = ANY($2::text[])
               AND handoff_until > now()) AS active_handoff_count
        `, [tenantId, pageIds]);
        const row = activityResult.rows[0] || {};
        const sendErrors = Number(row.send_errors_1h || 0);
        const successfulSends = Number(row.successful_sends_1h || 0);
        const denominator = sendErrors + successfulSends;
        activity = {
          available: true,
          last_webhook_received_at: row.last_webhook_received_at || null,
          last_successful_send_at: row.last_successful_send_at || null,
          send_error_rate_1h: denominator > 0 ? sendErrors / denominator : null,
          send_errors_1h: sendErrors,
          successful_sends_1h: successfulSends,
          active_handoff_count: Number(row.active_handoff_count || 0)
        };
      } catch (err) {
        if (!isMissingMultiShopSchemaError(err)) throw err;
        activity = createUnavailableSection('runtime_schema_not_ready');
      }

      let processedMids = createUnavailableSection('runtime_schema_not_ready');
      try {
        const processedMidsResult = await client.query(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE first_seen_at < now() - interval '7 days')::int AS older_than_7d,
            COUNT(*) FILTER (WHERE first_seen_at < now() - interval '30 days')::int AS older_than_30d,
            MIN(first_seen_at) AS oldest_first_seen_at,
            MAX(first_seen_at) AS newest_first_seen_at
          FROM processed_mids
          WHERE tenant_id = $1
            AND page_id = ANY($2::text[])
        `, [tenantId, pageIds]);
        const row = processedMidsResult.rows[0] || {};
        processedMids = {
          available: true,
          retention_days: 30,
          total: Number(row.total || 0),
          older_than_7d: Number(row.older_than_7d || 0),
          older_than_30d: Number(row.older_than_30d || 0),
          oldest_first_seen_at: row.oldest_first_seen_at || null,
          newest_first_seen_at: row.newest_first_seen_at || null
        };
      } catch (err) {
        if (!isMissingMultiShopSchemaError(err)) throw err;
      }

      let queue = createUnavailableSection('webhook_queue_schema_not_ready');
      try {
        const queueResult = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE q.status = 'queued')::int AS queued,
            COUNT(*) FILTER (WHERE q.status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE q.status = 'done')::int AS done,
            COUNT(*) FILTER (WHERE q.status = 'failed')::int AS failed,
            MIN(q.created_at) FILTER (WHERE q.status = 'queued') AS oldest_queued_created_at,
            MIN(q.available_at) FILTER (WHERE q.status = 'queued') AS oldest_queued_available_at,
            CASE
              WHEN MIN(q.created_at) FILTER (WHERE q.status = 'queued') IS NULL THEN NULL
              ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - MIN(q.created_at) FILTER (WHERE q.status = 'queued')))))::int
            END AS oldest_queued_age_seconds,
            (
              SELECT q2.last_error
              FROM webhook_queue q2
              JOIN (
                SELECT DISTINCT page_id
                FROM shop_pages
                WHERE shop_id = $1
                  AND page_id <> ''
              ) sp2 ON sp2.page_id = q2.page_id
              WHERE q2.tenant_id = $2
                AND q2.status = 'failed'
                AND q2.last_error <> ''
              ORDER BY q2.updated_at DESC, q2.id DESC
              LIMIT 1
            ) AS last_failed_error_code
          FROM webhook_queue q
          JOIN (
            SELECT DISTINCT page_id
            FROM shop_pages
            WHERE shop_id = $1
              AND page_id <> ''
          ) sp ON sp.page_id = q.page_id
          WHERE q.tenant_id = $2
        `, [shop.id, tenantId]);
        const row = queueResult.rows[0] || {};
        const summaryRows = ['queued', 'processing', 'done', 'failed'].map(status => ({
          status,
          total: Number(row[status] || 0)
        }));
        const summary = createStatusSummary(summaryRows, ['queued', 'processing', 'done', 'failed']);
        queue = {
          available: true,
          ...summary,
          oldest_queued_created_at: row.oldest_queued_created_at || null,
          oldest_queued_available_at: row.oldest_queued_available_at || null,
          oldest_queued_age_seconds: nullableNonNegativeInteger(row.oldest_queued_age_seconds),
          failed_count: Number(row.failed || summary.byStatus.failed || 0),
          last_failed_error_code: safeQueueErrorCode(row.last_failed_error_code)
        };
      } catch (err) {
        if (!isMissingMultiShopSchemaError(err)) throw err;
      }

      let credentials = createUnavailableSection('shop_page_credentials_schema_not_ready');
      try {
        const credentialResult = await client.query(`
          SELECT c.status, c.credential_type, COUNT(*)::int AS total
          FROM shop_page_credentials c
          JOIN shop_pages sp ON sp.id = c.page_mapping_id AND sp.shop_id = c.shop_id
          WHERE c.shop_id = $1
          GROUP BY c.status, c.credential_type
          ORDER BY c.status ASC, c.credential_type ASC
        `, [shop.id]);
        const byStatus = createStatusSummary(credentialResult.rows, ['active', 'paused', 'archived']);
        credentials = {
          available: true,
          total: byStatus.total,
          byStatus: byStatus.byStatus
        };
      } catch (err) {
        if (!isMissingMultiShopSchemaError(err)) throw err;
      }

      return {
        schemaReady: true,
        shop,
        pageMappings,
        activity,
        processedMids,
        queue,
        credentials
      };
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return createEmptyShopHealthModel();
    }
  }

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
    const shopSummary = await getShopSummary(client);
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
      shopSummary,
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
    getShopHealth,
    getShopDetail,
    getShops,
    getOverview,
    getUserDetail
  };
}

module.exports = {
  createDashboardRepository,
  isMissingMultiShopSchemaError
};

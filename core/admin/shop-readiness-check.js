const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const {
  READINESS_STATUSES,
  buildShopReadiness,
  resolveGlobalDryRunState
} = require('./shop-readiness');

const SHOP_READINESS_CHECK_ACTION = 'shop.readiness.checked';

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL shop readiness checks.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function createShopReadinessCheckError(code, message, statusCode = 400, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

function createShopReadinessCheckRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createShopReadinessCheckError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, name, status, package, lifecycle, live_enabled,
             last_readiness_status, last_readiness_checked_at,
             last_manual_test_status, last_manual_test_at, last_ready_by
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createShopReadinessCheckError('shop_not_found', 'Shop was not found.', 404);
    const status = normalizeText(shop.status, 80).toLowerCase();
    const lifecycle = normalizeText(shop.lifecycle, 80).toLowerCase();
    if (status === 'archived' || lifecycle === 'archived') {
      throw createShopReadinessCheckError('shop_archived', 'Archived shops cannot be readiness checked.', 409);
    }
    return shop;
  }

  async function getSettings(client, shopId) {
    const result = await client.query(`
      SELECT bot_mode
      FROM shop_settings
      WHERE shop_id = $1
      LIMIT 1
    `, [shopId]);
    return result.rows[0] || null;
  }

  async function getBaseCounts(client, shopId) {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shop_pages WHERE shop_id = $1 AND status = 'active') AS active_page_mapping_count,
        (SELECT COUNT(*)::int FROM shop_products WHERE shop_id = $1 AND status = 'active') AS active_product_count,
        (SELECT COUNT(*)::int FROM shop_assets WHERE shop_id = $1 AND asset_type = 'menu_image' AND status = 'active') AS active_menu_image_count,
        (SELECT COUNT(*)::int FROM shop_assets WHERE shop_id = $1 AND asset_type = 'product_image' AND status = 'active') AS active_product_image_count
    `, [shopId]);
    return result.rows[0] || {};
  }

  async function getActiveCredentialCount(client, shopId) {
    try {
      const result = await client.query(`
        SELECT COUNT(*)::int AS active_credential_count
        FROM shop_page_credentials c
        JOIN shop_pages sp ON sp.id = c.page_mapping_id AND sp.shop_id = c.shop_id
        WHERE c.shop_id = $1
          AND c.credential_type = 'fb_page_token'
          AND c.status = 'active'
          AND sp.status = 'active'
      `, [shopId]);
      return {
        active_credential_count: Number(result.rows[0]?.active_credential_count || 0),
        credential_count_available: true
      };
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return {
        active_credential_count: 0,
        credential_count_available: false
      };
    }
  }

  async function getOptionalDryRun(client, shopId) {
    try {
      const result = await client.query(`
        SELECT dry_run
        FROM shops
        WHERE id = $1
        LIMIT 1
      `, [shopId]);
      return {
        dry_run: result.rows[0]?.dry_run,
        dry_run_available: true
      };
    } catch (err) {
      if (!isMissingMultiShopSchemaError(err)) throw err;
      return {
        dry_run: null,
        dry_run_available: false
      };
    }
  }

  async function getReadinessInputs(client, shopId) {
    const [settings, baseCounts, credentialCount, dryRun] = [
      await getSettings(client, shopId),
      await getBaseCounts(client, shopId),
      await getActiveCredentialCount(client, shopId),
      await getOptionalDryRun(client, shopId)
    ];
    return {
      settings,
      counts: {
        ...baseCounts,
        active_credential_count: credentialCount.active_credential_count
      },
      dryRun
    };
  }

  async function updateReadinessFields(client, { shopId, readinessStatus } = {}) {
    const result = await client.query(`
      UPDATE shops
      SET last_readiness_status = $2,
          last_readiness_checked_at = now()
      WHERE id = $1
      RETURNING id, last_readiness_status, last_readiness_checked_at
    `, [shopId, readinessStatus]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    resourceId = '',
    readiness = {},
    requestContext = {}
  } = {}) {
    const counts = readiness.safe_counts || {};
    const entry = buildAuditLogEntry({
      principal,
      action: SHOP_READINESS_CHECK_ACTION,
      resourceType: 'shop',
      resourceId,
      outcome: 'success',
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata: {
        readiness_status: readiness.readiness_status || '',
        hard_blocker_keys: (readiness.hard_blockers || []).map(item => item.key || '').filter(Boolean),
        warning_keys: (readiness.warnings || []).map(item => item.key || '').filter(Boolean),
        check_statuses: (readiness.checks || []).map(item => ({
          key: item.key || '',
          status: item.status || ''
        })),
        count_summary: {
          products: Number(counts.products || 0),
          menu_images: Number(counts.menu_images || 0),
          product_images: Number(counts.product_images || 0),
          mappings: Number(counts.active_page_mappings || 0),
          auth_records: Number(counts.active_credentials || 0)
        },
        source: 'admin_readiness_check'
      }
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    getReadinessInputs,
    insertAudit,
    resolveShop,
    updateReadinessFields
  };
}

function createPostgresShopReadinessCheckService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createShopReadinessCheckRepository(),
  env = process.env
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createShopReadinessCheckError('database_url_required', 'DATABASE_URL is required for shop readiness checks.', 503);
    }
    let transactionOpen = false;
    const client = new (Client || loadPgClient())({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const result = await fn(client);
      let commitResult;
      try {
        commitResult = await client.query('COMMIT');
        transactionOpen = false;
      } catch (_) {
        throw createShopReadinessCheckError('readiness_check_commit_failed', 'Readiness check could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createShopReadinessCheckError('readiness_check_commit_failed', 'Readiness check could not be committed.', 500);
      }
      return result;
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createShopReadinessCheckError('permission_denied', 'Shop readiness check permission is required.', 403);
    }
  }

  async function checkReadiness({ principal, shopId, requestContext = {} } = {}) {
    assertWritePermission(principal);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const inputs = await repository.getReadinessInputs(client, shop.id);
      const readiness = buildShopReadiness({
        shop: {
          ...shop,
          dry_run: inputs.dryRun?.dry_run,
          dry_run_available: inputs.dryRun?.dry_run_available
        },
        settings: inputs.settings,
        counts: inputs.counts,
        manualTestStatus: shop.last_manual_test_status,
        globalDryRunState: resolveGlobalDryRunState(env)
      });
      if (!READINESS_STATUSES.has(readiness.readiness_status)) {
        throw createShopReadinessCheckError('invalid_readiness_status', 'Readiness status is invalid.', 500);
      }

      const updated = await repository.updateReadinessFields(client, {
        shopId: shop.id,
        readinessStatus: readiness.readiness_status
      });
      if (!updated?.id) {
        throw createShopReadinessCheckError('readiness_check_persist_failed', 'Readiness check could not be saved.', 500);
      }

      await repository.insertAudit(client, {
        principal,
        resourceId: shop.id,
        readiness,
        requestContext
      });

      return {
        shopId: shop.id,
        checkedAt: updated.last_readiness_checked_at || '',
        readiness
      };
    });
  }

  return {
    checkReadiness
  };
}

module.exports = {
  SHOP_READINESS_CHECK_ACTION,
  createPostgresShopReadinessCheckService,
  createShopReadinessCheckError,
  createShopReadinessCheckRepository,
  isMissingShopReadinessCheckSchemaError: isMissingMultiShopSchemaError
};

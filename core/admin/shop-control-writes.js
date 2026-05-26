const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { isProductionRuntime } = require('../storage-config');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const {
  buildShopReadiness,
  toLegacyReadinessSummary
} = require('./shop-readiness');
const { shopRef } = require('../utils/log-refs');

const SHOP_CONTROL_ACTION = 'shop.control_plane.updated';
const SHOP_PAUSE_ACTION = 'admin.shop.pause';
const SHOP_RESUME_ACTION = 'admin.shop.resume';
const SHOP_PACKAGES = Object.freeze(new Set(['basic', 'sales_flow', 'self_closing_addons']));
const SHOP_LIFECYCLES = Object.freeze(new Set(['draft', 'configuring', 'ready', 'live', 'paused', 'archived']));
const READINESS_STATUSES = Object.freeze(new Set(['unknown', 'passed', 'failed', 'warnings']));
const MANUAL_TEST_STATUSES = Object.freeze(new Set(['unknown', 'passed', 'failed']));
const ADULT_SHOP_ID = 'adult-shop';
const PAUSE_CONFIRMATION = 'PAUSE SHOP';
const RESUME_CONFIRMATION = 'RESUME SHOP';

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL shop control admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeBoolean(value, fallback = false) {
  if (Array.isArray(value)) return value.some(item => normalizeBoolean(item, false));
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
}

function normalizeEnvName(value = '') {
  return normalizeText(value, 80).toLowerCase();
}

function isStagingRuntime(env = process.env) {
  if (isProductionRuntime(env)) return false;
  return [
    env.NODE_ENV,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_ENVIRONMENT_NAME
  ].some(value => normalizeEnvName(value) === 'staging');
}

function createShopControlWriteError(code, message, statusCode = 400, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

function normalizePackage(value = '', fallback = 'basic') {
  const normalized = normalizeText(value, 80).toLowerCase();
  return normalized || fallback;
}

function normalizeLifecycle(value = '', fallback = 'draft') {
  const normalized = normalizeText(value, 80).toLowerCase();
  return normalized || fallback;
}

function defaultLifecycleForStatus(status = '') {
  const normalized = normalizeText(status, 40).toLowerCase();
  if (normalized === 'active') return 'live';
  if (normalized === 'archived') return 'archived';
  return 'paused';
}

function normalizeStatus(value = '', fallback = 'unknown') {
  const normalized = normalizeText(value, 80).toLowerCase();
  return normalized || fallback;
}

function normalizeConfirmationText(value = '') {
  return normalizeText(value, 200).toUpperCase();
}

function hasEmergencyConfirmation(body = {}, expectedText = '', confirmKeys = []) {
  const confirmationText = normalizeConfirmationText(
    body.confirmation_text ?? body.confirmationText ?? body.confirmation ?? ''
  );
  if (confirmationText === expectedText) return true;
  return confirmKeys.some(key => normalizeBoolean(body[key], false));
}

function validatePauseConfirmation(body = {}) {
  if (!hasEmergencyConfirmation(body, PAUSE_CONFIRMATION, ['confirm', 'confirm_pause', 'confirmPause'])) {
    throw createShopControlWriteError('pause_confirmation_required', 'Pause confirmation is required.', 400);
  }
}

function validateResumeConfirmation(body = {}) {
  if (!hasEmergencyConfirmation(body, RESUME_CONFIRMATION, ['confirm', 'confirm_resume', 'confirmResume'])) {
    throw createShopControlWriteError('resume_confirmation_required', 'Resume confirmation is required.', 400);
  }
}

function assertEmergencyControlRuntime(env = process.env) {
  if (!isStagingRuntime(env)) {
    throw createShopControlWriteError('staging_only', 'Shop emergency controls are available only in staging.', 403);
  }
}

function isAdultShop(shop = {}) {
  return [shop.id, shop.slug]
    .map(value => normalizeText(value, 160).toLowerCase())
    .includes(ADULT_SHOP_ID);
}

function assertAdultShopEmergencyAllowed(shop = {}) {
  if (isAdultShop(shop)) {
    throw createShopControlWriteError('adult_shop_protected', 'This shop is protected from emergency pause/resume in this slice.', 403);
  }
}

function assertNotArchivedShop(shop = {}) {
  const status = normalizeStatus(shop.status);
  const lifecycle = normalizeLifecycle(shop.lifecycle, defaultLifecycleForStatus(status));
  if (status === 'archived' || lifecycle === 'archived') {
    throw createShopControlWriteError('shop_archived', 'Archived shops cannot be paused or resumed.', 409);
  }
}

function safeResumeLifecycle(existing = {}) {
  const lifecycle = normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status));
  if (['draft', 'configuring', 'ready'].includes(lifecycle)) return lifecycle;
  return 'configuring';
}

function normalizeControlPlaneInput(existing = {}, body = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  return {
    package: has('package') || has('shop_package')
      ? normalizePackage(body.package ?? body.shop_package)
      : normalizePackage(existing.package),
    lifecycle: has('lifecycle')
      ? normalizeLifecycle(body.lifecycle)
      : normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status)),
    live_enabled: has('live_enabled') || has('liveEnabled')
      ? normalizeBoolean(body.live_enabled ?? body.liveEnabled, false)
      : normalizeBoolean(existing.live_enabled, String(existing.status || '').toLowerCase() === 'active'),
    last_manual_test_status: has('manual_test_status') || has('last_manual_test_status')
      ? normalizeStatus(body.manual_test_status ?? body.last_manual_test_status)
      : normalizeStatus(existing.last_manual_test_status)
  };
}

function validateControlPlaneInput(input = {}) {
  if (!SHOP_PACKAGES.has(input.package)) {
    throw createShopControlWriteError('invalid_shop_package', 'Shop package is invalid.', 400);
  }
  if (!SHOP_LIFECYCLES.has(input.lifecycle)) {
    throw createShopControlWriteError('invalid_shop_lifecycle', 'Shop lifecycle is invalid.', 400);
  }
  if (!MANUAL_TEST_STATUSES.has(input.last_manual_test_status)) {
    throw createShopControlWriteError('invalid_manual_test_status', 'Manual test status is invalid.', 400);
  }
}

function summarizeReadiness({
  shop = {},
  settings = null,
  counts = {},
  manualTestStatus = 'unknown'
} = {}) {
  return toLegacyReadinessSummary(buildShopReadiness({
    shop,
    settings,
    counts,
    manualTestStatus,
    globalDryRunState: { available: true, dry_run: true }
  }));
}

function presentShopControl(row = {}) {
  return {
    id: row.id || '',
    slug: row.slug || '',
    name: row.name || '',
    status: row.status || '',
    package: row.package || 'basic',
    lifecycle: row.lifecycle || '',
    dry_run: row.dry_run == null ? null : Boolean(row.dry_run),
    live_enabled: Boolean(row.live_enabled),
    last_readiness_status: row.last_readiness_status || 'unknown',
    last_readiness_checked_at: row.last_readiness_checked_at || '',
    last_manual_test_status: row.last_manual_test_status || 'unknown',
    last_manual_test_at: row.last_manual_test_at || '',
    last_ready_by: row.last_ready_by || '',
    updated_at: row.updated_at || ''
  };
}

function changedFieldsFor(existing = {}, input = {}) {
  const fields = [];
  if (normalizePackage(existing.package) !== input.package) fields.push('package');
  if (normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status)) !== input.lifecycle) fields.push('lifecycle');
  if (normalizeBoolean(existing.live_enabled, String(existing.status || '').toLowerCase() === 'active') !== input.live_enabled) fields.push('live_enabled');
  if (normalizeStatus(existing.last_manual_test_status) !== input.last_manual_test_status) fields.push('last_manual_test_status');
  return fields;
}

function changedFieldsForEmergency(existing = {}, target = {}) {
  const fields = [];
  if (normalizeStatus(existing.status) !== target.status) fields.push('status');
  if (normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status)) !== target.lifecycle) fields.push('lifecycle');
  if (normalizeBoolean(existing.dry_run, true) !== target.dry_run) fields.push('dry_run');
  if (normalizeBoolean(existing.live_enabled, false) !== target.live_enabled) fields.push('live_enabled');
  if (target.readinessStale && normalizeStatus(existing.last_readiness_status) !== 'unknown') fields.push('last_readiness_status');
  if (target.readinessStale && existing.last_readiness_checked_at) fields.push('last_readiness_checked_at');
  return fields;
}

function createShopControlWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createShopControlWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug, name, status, package, lifecycle, live_enabled,
             dry_run,
             last_readiness_status, last_readiness_checked_at,
             last_manual_test_status, last_manual_test_at, last_ready_by,
             updated_at
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createShopControlWriteError('shop_not_found', 'Shop was not found.', 404);
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

  async function getReadinessCounts(client, shopId) {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shop_pages WHERE shop_id = $1 AND status = 'active') AS active_page_mapping_count,
        (SELECT COUNT(*)::int FROM shop_products WHERE shop_id = $1 AND status = 'active') AS active_product_count,
        (SELECT COUNT(*)::int FROM shop_assets WHERE shop_id = $1 AND asset_type = 'menu_image' AND status = 'active') AS active_menu_image_count,
        (SELECT COUNT(*)::int FROM shop_assets WHERE shop_id = $1 AND asset_type = 'product_image' AND status = 'active') AS active_product_image_count,
        (SELECT COUNT(*)::int
         FROM shop_page_credentials c
         JOIN shop_pages sp ON sp.id = c.page_mapping_id AND sp.shop_id = c.shop_id
         WHERE c.shop_id = $1
           AND c.credential_type = 'fb_page_token'
           AND c.status = 'active'
           AND sp.status = 'active') AS active_credential_count
    `, [shopId]);
    return result.rows[0] || {};
  }

  async function updateShopControl(client, { shopId, input, readiness, readyBy = '' } = {}) {
    const result = await client.query(`
      UPDATE shops
      SET package = $2,
          lifecycle = $3,
          live_enabled = $4,
          last_readiness_status = $5,
          last_readiness_checked_at = now(),
          last_manual_test_status = $6,
          last_manual_test_at = CASE
            WHEN last_manual_test_status IS DISTINCT FROM $6 THEN now()
            ELSE last_manual_test_at
          END,
          last_ready_by = CASE
            WHEN $5 = 'passed' THEN $7
            ELSE last_ready_by
          END,
          updated_at = now()
      WHERE id = $1
      RETURNING id, slug, name, status, package, lifecycle, dry_run, live_enabled,
                last_readiness_status, last_readiness_checked_at,
                last_manual_test_status, last_manual_test_at, last_ready_by,
                updated_at
    `, [
      shopId,
      input.package,
      input.lifecycle,
      input.live_enabled,
      readiness.status,
      input.last_manual_test_status,
      readyBy
    ]);
    return result.rows[0] || null;
  }

  async function updateShopEmergencyControl(client, {
    shopId,
    targetStatus,
    targetLifecycle,
    dryRun = true,
    liveEnabled = false,
    readinessStale = false
  } = {}) {
    const result = await client.query(`
      UPDATE shops
      SET status = $2,
          lifecycle = $3,
          dry_run = $4,
          live_enabled = $5,
          last_readiness_status = CASE
            WHEN $6::boolean THEN 'unknown'
            ELSE last_readiness_status
          END,
          last_readiness_checked_at = CASE
            WHEN $6::boolean THEN NULL
            ELSE last_readiness_checked_at
          END,
          updated_at = now()
      WHERE id = $1
      RETURNING id, slug, name, status, package, lifecycle, dry_run, live_enabled,
                last_readiness_status, last_readiness_checked_at,
                last_manual_test_status, last_manual_test_at, last_ready_by,
                updated_at
    `, [
      shopId,
      targetStatus,
      targetLifecycle,
      dryRun,
      liveEnabled,
      readinessStale
    ]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    action = SHOP_CONTROL_ACTION,
    resourceId = '',
    metadata = {},
    requestContext = {},
    includeAuthMethod = true
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action,
      resourceType: 'shop',
      resourceId,
      outcome: 'success',
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata,
      includeAuthMethod
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    getReadinessCounts,
    getSettings,
    insertAudit,
    resolveShop,
    updateShopControl,
    updateShopEmergencyControl
  };
}

function createPostgresShopControlWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createShopControlWriteRepository(),
  shopLiveGateEnabled = /^(1|true|yes|on)$/i.test(String(process.env.SHOP_LIVE_GATE_ENABLED || '').trim()),
  env = process.env
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createShopControlWriteError('database_url_required', 'DATABASE_URL is required for shop control writes.', 503);
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
        throw createShopControlWriteError('shop_control_commit_failed', 'Shop control changes could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createShopControlWriteError('shop_control_commit_failed', 'Shop control changes could not be committed.', 500);
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
      throw createShopControlWriteError('permission_denied', 'Shop control write permission is required.', 403);
    }
  }

  async function updateControlPlane({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    return withTransaction(async client => {
      const existing = await repository.resolveShop(client, shopId);
      const input = normalizeControlPlaneInput(existing, body);
      validateControlPlaneInput(input);
      const settings = await repository.getSettings(client, existing.id);
      const counts = await repository.getReadinessCounts(client, existing.id);
      const readiness = summarizeReadiness({
        shop: existing,
        settings,
        counts,
        manualTestStatus: input.last_manual_test_status
      });
      if (!READINESS_STATUSES.has(readiness.status)) {
        throw createShopControlWriteError('invalid_readiness_status', 'Readiness status is invalid.', 500);
      }

      const existingLifecycle = normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status));
      const existingLiveEnabled = normalizeBoolean(existing.live_enabled, String(existing.status || '').toLowerCase() === 'active');
      const targetIsLive = input.lifecycle === 'live' || input.live_enabled;
      const liveStateChangedOn = (input.lifecycle === 'live' && existingLifecycle !== 'live')
        || (input.live_enabled && !existingLiveEnabled);
      const liveConfirmed = normalizeBoolean(body.confirm_live ?? body.confirmLive, false);
      const readinessOverride = normalizeBoolean(body.override_readiness ?? body.overrideReadiness, false);
      if (liveStateChangedOn && !liveConfirmed) {
        throw createShopControlWriteError('live_confirmation_required', 'Live enable requires explicit confirmation.', 400);
      }
      if (targetIsLive && readiness.hardBlockers.length && !readinessOverride) {
        throw createShopControlWriteError('readiness_blockers_present', 'Readiness hard blockers must pass before live enable.', 400, {
          blockers: readiness.hardBlockers.map(item => item.key)
        });
      }

      const dangerousLifecycleChange = ['paused', 'archived'].includes(input.lifecycle)
        && input.lifecycle !== existingLifecycle;
      if (dangerousLifecycleChange && !normalizeBoolean(body.confirm_pause_archive ?? body.confirmPauseArchive, false)) {
        throw createShopControlWriteError('pause_archive_confirmation_required', 'Pause/archive requires explicit confirmation.', 400);
      }

      const changedFields = changedFieldsFor(existing, input);
      const readyBy = readiness.status === 'passed' ? normalizeText(principal?.id, 120) : '';
      const updated = await repository.updateShopControl(client, {
        shopId: existing.id,
        input,
        readiness,
        readyBy
      });
      if (!updated?.id) {
        throw createShopControlWriteError('shop_control_persist_failed', 'Shop control changes could not be persisted.', 500);
      }
      await repository.insertAudit(client, {
        principal,
        resourceId: existing.id,
        metadata: {
          changedFields,
          oldPackage: normalizePackage(existing.package),
          newPackage: input.package,
          oldLifecycle: existingLifecycle,
          newLifecycle: input.lifecycle,
          oldLiveEnabled: existingLiveEnabled,
          newLiveEnabled: input.live_enabled,
          oldManualTestStatus: normalizeStatus(existing.last_manual_test_status),
          newManualTestStatus: input.last_manual_test_status,
          readinessStatus: readiness.status,
          liveImpact: changedFields.includes('lifecycle') || changedFields.includes('live_enabled'),
          gateEnabled: Boolean(shopLiveGateEnabled),
          source: 'admin_ui',
          hardBlockers: readiness.hardBlockers.map(item => item.key),
          warnings: readiness.warnings.map(item => item.key)
        },
        requestContext
      });
      return {
        shopId: existing.id,
        shop: presentShopControl(updated),
        readiness
      };
    });
  }

  async function pauseShop({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    return withTransaction(async client => {
      const existing = await repository.resolveShop(client, shopId);
      assertEmergencyControlRuntime(env);
      validatePauseConfirmation(body);
      assertAdultShopEmergencyAllowed(existing);
      assertNotArchivedShop(existing);

      const oldStatus = normalizeStatus(existing.status);
      const oldLifecycle = normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status));
      const target = {
        status: 'paused',
        lifecycle: 'paused',
        dry_run: true,
        live_enabled: false,
        readinessStale: false
      };
      const updated = await repository.updateShopEmergencyControl(client, {
        shopId: existing.id,
        targetStatus: target.status,
        targetLifecycle: target.lifecycle,
        dryRun: target.dry_run,
        liveEnabled: target.live_enabled,
        readinessStale: target.readinessStale
      });
      if (!updated?.id) {
        throw createShopControlWriteError('shop_control_persist_failed', 'Shop control changes could not be persisted.', 500);
      }

      await repository.insertAudit(client, {
        principal,
        action: SHOP_PAUSE_ACTION,
        resourceId: existing.id,
        metadata: {
          changedFields: changedFieldsForEmergency(existing, target),
          oldStatus,
          newStatus: 'paused',
          oldLifecycle,
          newLifecycle: 'paused',
          dryRunAfter: true,
          liveEnabledAfter: false,
          shop_ref: shopRef(existing.id)
        },
        requestContext,
        includeAuthMethod: false
      });

      return {
        shopId: existing.id,
        shop: presentShopControl(updated)
      };
    });
  }

  async function resumeShop({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    return withTransaction(async client => {
      const existing = await repository.resolveShop(client, shopId);
      assertEmergencyControlRuntime(env);
      validateResumeConfirmation(body);
      assertAdultShopEmergencyAllowed(existing);
      assertNotArchivedShop(existing);

      const oldStatus = normalizeStatus(existing.status);
      const oldLifecycle = normalizeLifecycle(existing.lifecycle, defaultLifecycleForStatus(existing.status));
      if (oldStatus !== 'paused' && oldLifecycle !== 'paused') {
        throw createShopControlWriteError('shop_not_paused', 'Only paused shops can be resumed.', 409);
      }

      const targetLifecycle = safeResumeLifecycle(existing);
      const target = {
        status: 'active',
        lifecycle: targetLifecycle,
        dry_run: true,
        live_enabled: false,
        readinessStale: true
      };
      const updated = await repository.updateShopEmergencyControl(client, {
        shopId: existing.id,
        targetStatus: target.status,
        targetLifecycle: target.lifecycle,
        dryRun: target.dry_run,
        liveEnabled: target.live_enabled,
        readinessStale: target.readinessStale
      });
      if (!updated?.id) {
        throw createShopControlWriteError('shop_control_persist_failed', 'Shop control changes could not be persisted.', 500);
      }

      await repository.insertAudit(client, {
        principal,
        action: SHOP_RESUME_ACTION,
        resourceId: existing.id,
        metadata: {
          changedFields: changedFieldsForEmergency(existing, target),
          oldStatus,
          newStatus: 'active',
          oldLifecycle,
          newLifecycle: targetLifecycle,
          dryRunAfter: true,
          liveEnabledAfter: false,
          shop_ref: shopRef(existing.id)
        },
        requestContext,
        includeAuthMethod: false
      });

      return {
        shopId: existing.id,
        shop: presentShopControl(updated)
      };
    });
  }

  return {
    pauseShop,
    resumeShop,
    updateControlPlane
  };
}

module.exports = {
  PAUSE_CONFIRMATION,
  MANUAL_TEST_STATUSES,
  READINESS_STATUSES,
  RESUME_CONFIRMATION,
  SHOP_CONTROL_ACTION,
  SHOP_LIFECYCLES,
  SHOP_PAUSE_ACTION,
  SHOP_PACKAGES,
  SHOP_RESUME_ACTION,
  createPostgresShopControlWriteService,
  createShopControlWriteError,
  createShopControlWriteRepository,
  isStagingRuntime,
  isMissingShopControlWriteSchemaError: isMissingMultiShopSchemaError,
  normalizeControlPlaneInput,
  presentShopControl,
  safeResumeLifecycle,
  summarizeReadiness,
  validateControlPlaneInput
};

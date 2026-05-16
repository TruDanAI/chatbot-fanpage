const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { BOT_MODES, presentShopSettings } = require('./shop-settings-writes');
const { normalizeRuleToggles } = require('../rule-toggles');

const SHOP_WRITE_ACTIONS = Object.freeze({
  CREATE: 'admin.shop.create'
});

const SHOP_STATUSES = Object.freeze(new Set(['active', 'paused', 'archived']));
const DEFAULT_SHOP_CREATE_INPUT = Object.freeze({
  status: 'active',
  botMode: 'menu_code_handoff',
  locale: 'vi-VN',
  timezone: 'Asia/Ho_Chi_Minh'
});

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL shop admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function createShopWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function normalizeShopSlug(value = '') {
  return normalizeText(value, 80);
}

function isSafeShopSlug(value = '') {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ''));
}

function normalizeCreateShopInput(body = {}) {
  const shopId = normalizeShopSlug(body.shop_id ?? body.shopId ?? body.slug);
  const name = normalizeText(body.name ?? body.display_name ?? body.displayName, 180);
  const status = normalizeText(body.status || DEFAULT_SHOP_CREATE_INPUT.status, 40).toLowerCase();
  const botMode = normalizeText(body.bot_mode ?? body.botMode ?? DEFAULT_SHOP_CREATE_INPUT.botMode, 80).toLowerCase();
  const locale = normalizeText(body.default_locale ?? body.locale ?? DEFAULT_SHOP_CREATE_INPUT.locale, 40);
  const timezone = normalizeText(body.timezone ?? DEFAULT_SHOP_CREATE_INPUT.timezone, 80);

  return {
    id: shopId,
    slug: shopId,
    name,
    status,
    botMode,
    locale,
    timezone,
    handoffEnabled: botMode === 'menu_code_handoff' || botMode === 'handoff_only',
    settingsJson: {
      ruleToggles: normalizeRuleToggles()
    }
  };
}

function validateCreateShopInput(input = {}) {
  if (!input.id || !isSafeShopSlug(input.id)) {
    throw createShopWriteError('invalid_shop_id', 'Shop id/slug is invalid.', 400);
  }
  if (!input.name) {
    throw createShopWriteError('invalid_shop_name', 'Display name is required.', 400);
  }
  if (!SHOP_STATUSES.has(input.status)) {
    throw createShopWriteError('invalid_shop_status', 'Shop status is invalid.', 400);
  }
  if (!BOT_MODES.has(input.botMode)) {
    throw createShopWriteError('invalid_bot_mode', 'Bot mode is invalid.', 400);
  }
  if (!input.locale) {
    throw createShopWriteError('invalid_shop_locale', 'Locale is required.', 400);
  }
  if (!input.timezone) {
    throw createShopWriteError('invalid_shop_timezone', 'Timezone is required.', 400);
  }
}

function presentShop(row = {}) {
  return {
    id: row.id || '',
    slug: row.slug || '',
    name: row.name || '',
    status: row.status || '',
    default_locale: row.default_locale || '',
    timezone: row.timezone || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

function createShopWriteRepository() {
  async function assertShopAvailable(client, shopId) {
    const result = await client.query(`
      SELECT id, slug
      FROM shops
      WHERE id = $1 OR slug = $1
      LIMIT 1
    `, [shopId]);
    if (result.rows[0]?.id || result.rows[0]?.slug) {
      throw createShopWriteError('duplicate_shop', 'Shop id/slug already exists.', 409);
    }
  }

  async function insertShop(client, input = {}) {
    const result = await client.query(`
      INSERT INTO shops (
        id, slug, name, status, default_locale, timezone
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, slug, name, status, default_locale, timezone, created_at, updated_at
    `, [
      input.id,
      input.slug,
      input.name,
      input.status,
      input.locale,
      input.timezone
    ]);
    return result.rows[0] || null;
  }

  async function insertDefaultSettings(client, input = {}) {
    const result = await client.query(`
      INSERT INTO shop_settings (
        shop_id, bot_mode, handoff_enabled, handoff_message, menu_intro_text,
        fallback_text, settings_json
      )
      VALUES ($1, $2, $3, '', '', '', $4::jsonb)
      RETURNING shop_id, bot_mode, handoff_enabled, handoff_message, menu_intro_text,
                fallback_text, settings_json, updated_at
    `, [
      input.id,
      input.botMode,
      input.handoffEnabled,
      JSON.stringify(input.settingsJson || {})
    ]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    resourceId = '',
    metadata = {},
    requestContext = {}
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action: SHOP_WRITE_ACTIONS.CREATE,
      resourceType: 'shop',
      resourceId,
      outcome: 'success',
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    assertShopAvailable,
    insertAudit,
    insertDefaultSettings,
    insertShop
  };
}

function createPostgresShopWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createShopWriteRepository()
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createShopWriteError('database_url_required', 'DATABASE_URL is required for shop writes.', 503);
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
        throw createShopWriteError('shop_create_commit_failed', 'Shop create could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createShopWriteError('shop_create_commit_failed', 'Shop create could not be committed.', 500);
      }
      return result;
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      if (String(err?.code || '') === '23505') {
        throw createShopWriteError('duplicate_shop', 'Shop id/slug already exists.', 409);
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  function assertWritePermission(principal) {
    if (!hasPermission(principal, PERMISSIONS.PRODUCT_WRITE)) {
      throw createShopWriteError('permission_denied', 'Shop write permission is required.', 403);
    }
  }

  async function createShop({ principal, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    const input = normalizeCreateShopInput(body);
    validateCreateShopInput(input);
    return withTransaction(async client => {
      await repository.assertShopAvailable(client, input.id);
      const shop = await repository.insertShop(client, input);
      if (!shop?.id) {
        throw createShopWriteError('shop_persist_failed', 'Shop could not be persisted.', 500);
      }
      const settings = await repository.insertDefaultSettings(client, input);
      if (!settings?.shop_id) {
        throw createShopWriteError('shop_settings_persist_failed', 'Default shop settings could not be persisted.', 500);
      }
      await repository.insertAudit(client, {
        principal,
        resourceId: shop.id,
        metadata: {
          shop_id: shop.id,
          slug: shop.slug,
          status: shop.status,
          bot_mode: input.botMode,
          default_locale: input.locale,
          timezone: input.timezone,
          display_name_length: input.name.length
        },
        requestContext
      });
      return {
        shopId: shop.id,
        shop: presentShop(shop),
        settings: presentShopSettings(settings)
      };
    });
  }

  return {
    createShop
  };
}

module.exports = {
  DEFAULT_SHOP_CREATE_INPUT,
  SHOP_STATUSES,
  SHOP_WRITE_ACTIONS,
  createPostgresShopWriteService,
  createShopWriteError,
  createShopWriteRepository,
  isMissingShopWriteSchemaError: isMissingMultiShopSchemaError,
  normalizeCreateShopInput,
  presentShop,
  validateCreateShopInput
};

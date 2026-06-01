const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isMissingMultiShopSchemaError } = require('./dashboard-repository');
const { mergeRuleToggleInput, normalizeRuleToggles } = require('../rule-toggles');

const SHOP_SETTINGS_WRITE_ACTIONS = Object.freeze({
  UPDATE: 'admin.shop_settings.update'
});

const BOT_MODES = Object.freeze(new Set([
  'menu_code_handoff',
  'menu_only',
  'handoff_only',
  'disabled'
]));

const TEXT_LIMITS = Object.freeze({
  handoff_message: 1000,
  menu_intro_text: 1000,
  fallback_text: 1000
});

const HOT_PRODUCTS_DEFAULTS = Object.freeze({
  enabled: false,
  trigger: 'keyword',
  maxItems: 3,
  cooldownMs: 60000,
  productCodes: []
});

const HOT_PRODUCTS_LIMITS = Object.freeze({
  maxItemsMin: 1,
  maxItemsMax: 5,
  cooldownMsMin: 10000,
  cooldownMsMax: 300000,
  productCodesMax: 20
});

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL shop settings admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeMultilineText(value = '') {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeBoolean(value, fallback = false) {
  if (Array.isArray(value)) return value.some(item => normalizeBoolean(item, false));
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
}

function firstSubmittedValue(value) {
  if (!Array.isArray(value)) return value;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const item = value[index];
    if (item != null && String(item).trim() !== '') return item;
  }
  return value[value.length - 1];
}

function normalizeInteger(value, fallback, min, max) {
  const submitted = firstSubmittedValue(value);
  if (submitted == null || String(submitted).trim() === '') return fallback;
  const number = Number(submitted);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.floor(number);
  return Math.min(max, Math.max(min, integer));
}

function productCodeCandidates(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(productCodeCandidates);
  if (typeof value === 'object') return [];
  return String(value)
    .split(/[\r\n,]+/)
    .map(item => item.trim());
}

function normalizeHotProductCodes(value) {
  const seen = new Set();
  const codes = [];
  for (const code of productCodeCandidates(value)) {
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
    if (codes.length >= HOT_PRODUCTS_LIMITS.productCodesMax) break;
  }
  return codes;
}

function normalizeHotProductsTrigger(value) {
  const trigger = normalizeText(firstSubmittedValue(value), 80).toLowerCase();
  return trigger === 'keyword' ? 'keyword' : HOT_PRODUCTS_DEFAULTS.trigger;
}

function normalizeHotProductsConfig(value = {}) {
  const input = jsonObject(value);
  return {
    enabled: normalizeBoolean(input.enabled, HOT_PRODUCTS_DEFAULTS.enabled),
    trigger: normalizeHotProductsTrigger(input.trigger),
    maxItems: normalizeInteger(
      input.maxItems,
      HOT_PRODUCTS_DEFAULTS.maxItems,
      HOT_PRODUCTS_LIMITS.maxItemsMin,
      HOT_PRODUCTS_LIMITS.maxItemsMax
    ),
    cooldownMs: normalizeInteger(
      input.cooldownMs,
      HOT_PRODUCTS_DEFAULTS.cooldownMs,
      HOT_PRODUCTS_LIMITS.cooldownMsMin,
      HOT_PRODUCTS_LIMITS.cooldownMsMax
    ),
    productCodes: normalizeHotProductCodes(input.productCodes)
  };
}

function jsonObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function createShopSettingsWriteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function normalizeBotMode(value = '', fallback = 'disabled') {
  const mode = normalizeText(value, 80).toLowerCase();
  return mode || fallback;
}

function readFirstPresentField(body = {}, names = []) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(body, name)) {
      return { found: true, value: body[name] };
    }
  }
  return { found: false, value: undefined };
}

function readHotProductsPatch(body = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  if (has('hotProducts')) {
    return {
      provided: true,
      replace: true,
      value: jsonObject(body.hotProducts)
    };
  }

  const fields = {
    enabled: ['hotProducts_enabled', 'hot_products_enabled'],
    trigger: ['hotProducts_trigger', 'hot_products_trigger'],
    maxItems: ['hotProducts_maxItems', 'hot_products_max_items'],
    cooldownMs: ['hotProducts_cooldownMs', 'hot_products_cooldown_ms'],
    productCodes: ['hotProducts_productCodes', 'hot_products_product_codes']
  };
  const patch = {};
  let provided = false;
  for (const [key, names] of Object.entries(fields)) {
    const result = readFirstPresentField(body, names);
    if (!result.found) continue;
    patch[key] = result.value;
    provided = true;
  }
  return {
    provided,
    replace: false,
    value: patch
  };
}

function assertTextLength(field, value) {
  const limit = TEXT_LIMITS[field] || 1000;
  if (String(value || '').length > limit) {
    throw createShopSettingsWriteError('setting_text_too_long', 'Setting text is too long.', 400);
  }
}

function normalizeSettingsInput(existing = {}, body = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  const existingSettingsJson = jsonObject(existing.settings_json);
  const existingRuleToggles = {
    ...jsonObject(jsonObject(existingSettingsJson.botMode)),
    ...jsonObject(existingSettingsJson.ruleToggles)
  };
  const hotProductsPatch = readHotProductsPatch(body);
  const existingHotProducts = normalizeHotProductsConfig(existingSettingsJson.hotProducts);
  const hotProducts = hotProductsPatch.provided
    ? normalizeHotProductsConfig(hotProductsPatch.replace
      ? hotProductsPatch.value
      : { ...existingHotProducts, ...hotProductsPatch.value })
    : existingHotProducts;
  const ruleToggles = mergeRuleToggleInput(existingRuleToggles, body);
  const botMode = has('bot_mode')
    ? normalizeBotMode(body.bot_mode)
    : normalizeBotMode(existing.bot_mode);
  const handoffMessage = has('handoff_message')
    ? normalizeMultilineText(body.handoff_message)
    : normalizeMultilineText(existing.handoff_message);
  const menuIntroText = has('menu_intro_text')
    ? normalizeMultilineText(body.menu_intro_text)
    : normalizeMultilineText(existing.menu_intro_text);
  const fallbackText = has('fallback_text')
    ? normalizeMultilineText(body.fallback_text)
    : normalizeMultilineText(existing.fallback_text);

  assertTextLength('handoff_message', handoffMessage);
  assertTextLength('menu_intro_text', menuIntroText);
  assertTextLength('fallback_text', fallbackText);

  return {
    bot_mode: botMode,
    handoff_enabled: has('handoff_enabled')
      ? normalizeBoolean(body.handoff_enabled, false)
      : normalizeBoolean(existing.handoff_enabled, false),
    handoff_message: handoffMessage,
    menu_intro_text: menuIntroText,
    fallback_text: fallbackText,
    settings_json: {
      ...existingSettingsJson,
      hotProducts,
      ruleToggles
    }
  };
}

function validateSettingsInput(input = {}) {
  if (!BOT_MODES.has(input.bot_mode)) {
    throw createShopSettingsWriteError('invalid_bot_mode', 'Bot mode is invalid.', 400);
  }
}

function presentShopSettings(row = {}) {
  return {
    shop_id: row.shop_id || '',
    bot_mode: row.bot_mode || '',
    handoff_enabled: Boolean(row.handoff_enabled),
    handoff_message: row.handoff_message || '',
    menu_intro_text: row.menu_intro_text || '',
    fallback_text: row.fallback_text || '',
    settings_json: jsonObject(row.settings_json),
    updated_at: row.updated_at || ''
  };
}

function createShopSettingsWriteRepository() {
  async function resolveShop(client, shopId) {
    const normalized = normalizeText(shopId, 160);
    if (!normalized) throw createShopSettingsWriteError('shop_not_found', 'Shop was not found.', 404);
    const result = await client.query(`
      SELECT id, slug
      FROM shops
      WHERE id = $1 OR slug = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT 1
    `, [normalized]);
    const shop = result.rows[0] || null;
    if (!shop?.id) throw createShopSettingsWriteError('shop_not_found', 'Shop was not found.', 404);
    return shop;
  }

  async function getSettingsForShop(client, shopId) {
    const result = await client.query(`
      SELECT shop_id, bot_mode, handoff_enabled, handoff_message, menu_intro_text,
             fallback_text, settings_json, updated_at
      FROM shop_settings
      WHERE shop_id = $1
      LIMIT 1
    `, [shopId]);
    return result.rows[0] || null;
  }

  async function upsertSettings(client, { shopId, input } = {}) {
    const result = await client.query(`
      INSERT INTO shop_settings (
        shop_id, bot_mode, handoff_enabled, handoff_message, menu_intro_text,
        fallback_text, settings_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (shop_id) DO UPDATE
      SET bot_mode = EXCLUDED.bot_mode,
          handoff_enabled = EXCLUDED.handoff_enabled,
          handoff_message = EXCLUDED.handoff_message,
          menu_intro_text = EXCLUDED.menu_intro_text,
          fallback_text = EXCLUDED.fallback_text,
          settings_json = EXCLUDED.settings_json,
          updated_at = now()
      RETURNING shop_id, bot_mode, handoff_enabled, handoff_message, menu_intro_text,
                fallback_text, settings_json, updated_at
    `, [
      shopId,
      input.bot_mode,
      input.handoff_enabled,
      input.handoff_message,
      input.menu_intro_text,
      input.fallback_text,
      JSON.stringify(input.settings_json || {})
    ]);
    return result.rows[0] || null;
  }

  async function insertAudit(client, {
    principal,
    action,
    resourceId = '',
    outcome = 'success',
    metadata = {},
    requestContext = {}
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action,
      resourceType: 'shop_settings',
      resourceId,
      outcome,
      requestId: requestContext.requestId,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      metadata
    });
    await insertAuditLogEntry(client, entry);
    return entry;
  }

  return {
    getSettingsForShop,
    insertAudit,
    resolveShop,
    upsertSettings
  };
}

function createPostgresShopSettingsWriteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  repository = createShopSettingsWriteRepository()
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createShopSettingsWriteError('database_url_required', 'DATABASE_URL is required for shop settings writes.', 503);
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
        throw createShopSettingsWriteError('settings_commit_failed', 'Shop settings could not be committed.', 500);
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createShopSettingsWriteError('settings_commit_failed', 'Shop settings could not be committed.', 500);
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
      throw createShopSettingsWriteError('permission_denied', 'Shop settings write permission is required.', 403);
    }
  }

  async function updateSettings({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    return withTransaction(async client => {
      const shop = await repository.resolveShop(client, shopId);
      const existing = await repository.getSettingsForShop(client, shop.id);
      const input = normalizeSettingsInput(existing || {}, body);
      validateSettingsInput(input);
      const row = await repository.upsertSettings(client, { shopId: shop.id, input });
      if (!row?.shop_id) {
        throw createShopSettingsWriteError('settings_persist_failed', 'Shop settings could not be persisted.', 500);
      }
      await repository.insertAudit(client, {
        principal,
        action: SHOP_SETTINGS_WRITE_ACTIONS.UPDATE,
        resourceId: shop.id,
        metadata: {
          shop_id: shop.id,
          bot_mode: input.bot_mode,
          handoff_enabled: input.handoff_enabled,
          text_fields: {
            handoff_message_length: input.handoff_message.length,
            menu_intro_text_length: input.menu_intro_text.length,
            fallback_text_length: input.fallback_text.length
          },
          rule_toggles: normalizeRuleToggles(input.settings_json.ruleToggles),
          hot_products: {
            enabled: Boolean(input.settings_json.hotProducts?.enabled),
            maxItems: Number(input.settings_json.hotProducts?.maxItems || HOT_PRODUCTS_DEFAULTS.maxItems),
            cooldownMs: Number(input.settings_json.hotProducts?.cooldownMs || HOT_PRODUCTS_DEFAULTS.cooldownMs),
            product_code_count: Array.isArray(input.settings_json.hotProducts?.productCodes)
              ? input.settings_json.hotProducts.productCodes.length
              : 0
          }
        },
        requestContext
      });
      return { shopId: shop.id, settings: presentShopSettings(row) };
    });
  }

  return {
    updateSettings
  };
}

module.exports = {
  BOT_MODES,
  HOT_PRODUCTS_DEFAULTS,
  HOT_PRODUCTS_LIMITS,
  SHOP_SETTINGS_WRITE_ACTIONS,
  TEXT_LIMITS,
  createPostgresShopSettingsWriteService,
  createShopSettingsWriteError,
  createShopSettingsWriteRepository,
  isMissingShopSettingsWriteSchemaError: isMissingMultiShopSchemaError,
  normalizeHotProductsConfig,
  normalizeSettingsInput,
  presentShopSettings
};

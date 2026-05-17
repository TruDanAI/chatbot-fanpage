const {
  DEFAULT_CREDENTIAL_TYPE,
  decryptCredential
} = require('./page-credentials');

const DEFAULT_REQUIRED_PERMISSIONS = Object.freeze(['pages_messaging']);
const HEALTH_STATUSES = Object.freeze([
  'valid',
  'invalid',
  'expired',
  'page_mismatch',
  'permission_missing',
  'app_mismatch',
  'config_missing',
  'decrypt_failed',
  'rate_limited',
  'check_failed'
]);

function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function nowEpochSeconds(now = Date.now) {
  const value = typeof now === 'function' ? now() : now;
  return Math.floor(Number(value || 0) / 1000);
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(item => trimText(item)).filter(Boolean);
  }
  return trimText(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeRequiredPermissions(value) {
  if (value === undefined || value === null) return [...DEFAULT_REQUIRED_PERMISSIONS];
  return normalizeList(value);
}

function createCounts() {
  const counts = {
    credentials: 0,
    checked: 0,
    writes: 0,
    no_active_credentials: 0,
    ambiguous_credentials: 0
  };
  for (const status of HEALTH_STATUSES) counts[status] = 0;
  return counts;
}

function incrementStatus(counts, status) {
  const normalized = HEALTH_STATUSES.includes(status) ? status : 'check_failed';
  counts[normalized] += 1;
}

function normalizeErrorCategory(value) {
  const category = trimText(value).toLowerCase().replace(/[-\s]+/g, '_');
  if (!category) return 'check_failed';
  if (category === 'rate_limit' || category === 'rate_limited') return 'rate_limited';
  if (category === 'config_missing' || category === 'missing_config') return 'config_missing';
  if (category === 'decrypt_failed' || category === 'credential_decrypt_failed') return 'decrypt_failed';
  if (category === 'invalid' || category === 'invalid_token') return 'invalid';
  if (category === 'expired' || category === 'token_expired') return 'expired';
  if (category === 'permission_missing' || category === 'missing_permission') return 'permission_missing';
  if (category === 'app_mismatch') return 'app_mismatch';
  if (category === 'page_mismatch') return 'page_mismatch';
  return 'check_failed';
}

function statusFromErrorCategory(value) {
  const category = normalizeErrorCategory(value);
  return HEALTH_STATUSES.includes(category) ? category : 'check_failed';
}

function errorCategoryFromException(err) {
  return normalizeErrorCategory(
    err?.error_category
      || err?.errorCategory
      || err?.category
      || err?.code
      || 'check_failed'
  );
}

function rowPageRef(row = {}) {
  return trimText(row.page_ref || row.page_mapping_id || row.shop_page_id);
}

function credentialScopeKey(row = {}) {
  return [
    trimText(row.shop_id),
    trimText(row.page_mapping_id || row.page_ref || row.shop_page_id)
  ].join('\u0000');
}

function safeResult(row, {
  credentialStatus,
  tokenHealthStatus,
  errorCategory = '',
  activeCredentialCount = 1,
  checked = false
} = {}) {
  return {
    shop_id: trimText(row.shop_id),
    page_ref: rowPageRef(row),
    credential_status: trimText(credentialStatus || row.credential_status || row.status || 'active'),
    token_health_status: HEALTH_STATUSES.includes(tokenHealthStatus) ? tokenHealthStatus : 'check_failed',
    error_category: trimText(errorCategory),
    counts: {
      active_credentials: Number(activeCredentialCount || 0),
      checked: checked ? 1 : 0
    }
  };
}

function addResult(report, result) {
  report.results.push(result);
  incrementStatus(report.counts, result.token_health_status);
  report.counts.checked += result.counts.checked;
}

async function fetchActivePageTokenCredentials(client, credentialType = DEFAULT_CREDENTIAL_TYPE) {
  const result = await client.query(
    `
      SELECT
        c.shop_id,
        c.page_mapping_id,
        c.status AS credential_status,
        c.encrypted_value,
        sp.id AS page_ref,
        sp.page_id AS expected_page_id
      FROM shop_page_credentials c
      JOIN shop_pages sp ON sp.id = c.page_mapping_id
      WHERE c.credential_type = $1
        AND c.status = 'active'
        AND sp.status = 'active'
      ORDER BY c.shop_id ASC, c.page_mapping_id ASC, c.updated_at DESC, c.id ASC
    `,
    [credentialType]
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

function groupCredentialRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = credentialScopeKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function hasDebugFields(value) {
  return value && typeof value === 'object' && (
    Object.prototype.hasOwnProperty.call(value, 'is_valid')
      || Object.prototype.hasOwnProperty.call(value, 'isValid')
      || Object.prototype.hasOwnProperty.call(value, 'valid')
      || Object.prototype.hasOwnProperty.call(value, 'app_id')
      || Object.prototype.hasOwnProperty.call(value, 'appId')
      || Object.prototype.hasOwnProperty.call(value, 'expires_at')
      || Object.prototype.hasOwnProperty.call(value, 'expiresAt')
  );
}

function unwrapDebugData(response) {
  if (response && typeof response === 'object') {
    if (response.ok === false || response.error_category || response.errorCategory) return response;
    if (response.data && typeof response.data === 'object') {
      if (response.data.data && typeof response.data.data === 'object') return response.data.data;
      if (hasDebugFields(response.data)) return response.data;
    }
  }
  return response;
}

function booleanTokenValidity(data) {
  if (Object.prototype.hasOwnProperty.call(data, 'is_valid')) return data.is_valid === true;
  if (Object.prototype.hasOwnProperty.call(data, 'isValid')) return data.isValid === true;
  if (Object.prototype.hasOwnProperty.call(data, 'valid')) return data.valid === true;
  return false;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function addScope(scopes, value) {
  if (Array.isArray(value)) {
    for (const item of value) addScope(scopes, item);
    return;
  }
  if (value && typeof value === 'object') {
    addScope(scopes, value.scope);
    return;
  }
  const normalized = trimText(value);
  if (!normalized) return;
  for (const part of normalized.split(/[,\s]+/)) {
    const scope = part.trim();
    if (scope) scopes.add(scope);
  }
}

function extractScopes(data = {}) {
  const scopes = new Set();
  addScope(scopes, data.scopes);
  addScope(scopes, data.scope);
  addScope(scopes, data.granular_scopes);
  addScope(scopes, data.granularScopes);
  return [...scopes];
}

function normalizeDebugResponse(response) {
  const data = unwrapDebugData(response);
  if (!data || typeof data !== 'object') {
    return { ok: false, errorCategory: 'check_failed' };
  }
  if (data.ok === false || data.error_category || data.errorCategory) {
    return {
      ok: false,
      errorCategory: normalizeErrorCategory(data.error_category || data.errorCategory || data.status)
    };
  }
  return {
    ok: true,
    isValid: booleanTokenValidity(data),
    appId: trimText(data.app_id || data.appId),
    expiresAt: numberValue(data.expires_at || data.expiresAt),
    scopes: extractScopes(data)
  };
}

function normalizePageResponse(response) {
  const data = response && typeof response === 'object' && response.data && typeof response.data === 'object'
    ? response.data
    : response;
  if (!data || typeof data !== 'object') {
    return { ok: false, errorCategory: 'check_failed' };
  }
  if (data.ok === false || data.error_category || data.errorCategory) {
    return {
      ok: false,
      errorCategory: normalizeErrorCategory(data.error_category || data.errorCategory || data.status)
    };
  }
  return {
    ok: true,
    id: trimText(data.id)
  };
}

function missingRequiredPermission(scopes, requiredPermissions) {
  const actual = new Set((scopes || []).map(scope => trimText(scope)).filter(Boolean));
  return requiredPermissions.some(permission => !actual.has(permission));
}

async function callDebugToken(metaClient, token) {
  if (!metaClient || typeof metaClient.debugToken !== 'function') {
    return { ok: false, errorCategory: 'config_missing' };
  }
  try {
    return normalizeDebugResponse(await metaClient.debugToken({ token }));
  } catch (err) {
    return { ok: false, errorCategory: errorCategoryFromException(err) };
  }
}

async function callPageIdentity(metaClient, token) {
  const pageMethod = metaClient && (metaClient.pageMe || metaClient.getPageIdentity);
  if (typeof pageMethod !== 'function') {
    return { ok: false, errorCategory: 'config_missing' };
  }
  try {
    return normalizePageResponse(await pageMethod.call(metaClient, { token, fields: ['id', 'name'] }));
  } catch (err) {
    return { ok: false, errorCategory: errorCategoryFromException(err) };
  }
}

async function evaluateCredentialRow({
  row,
  masterKey,
  metaClient,
  expectedAppId,
  requiredPermissions,
  now = Date.now
}) {
  let token;
  try {
    token = decryptCredential(row.encrypted_value, masterKey);
  } catch (_) {
    return safeResult(row, {
      tokenHealthStatus: 'decrypt_failed',
      errorCategory: 'decrypt_failed',
      checked: false
    });
  }

  if (!trimText(token)) {
    return safeResult(row, {
      tokenHealthStatus: 'decrypt_failed',
      errorCategory: 'decrypt_failed',
      checked: false
    });
  }

  const debug = await callDebugToken(metaClient, token);
  if (!debug.ok) {
    const status = statusFromErrorCategory(debug.errorCategory);
    return safeResult(row, {
      tokenHealthStatus: status,
      errorCategory: normalizeErrorCategory(debug.errorCategory),
      checked: false
    });
  }

  if (debug.expiresAt > 0 && debug.expiresAt <= nowEpochSeconds(now)) {
    return safeResult(row, {
      tokenHealthStatus: 'expired',
      errorCategory: 'expired',
      checked: true
    });
  }
  if (!debug.isValid) {
    return safeResult(row, {
      tokenHealthStatus: 'invalid',
      errorCategory: 'invalid',
      checked: true
    });
  }

  const normalizedExpectedAppId = trimText(expectedAppId);
  if (normalizedExpectedAppId && trimText(debug.appId) !== normalizedExpectedAppId) {
    return safeResult(row, {
      tokenHealthStatus: 'app_mismatch',
      errorCategory: 'app_mismatch',
      checked: true
    });
  }

  if (requiredPermissions.length && missingRequiredPermission(debug.scopes, requiredPermissions)) {
    return safeResult(row, {
      tokenHealthStatus: 'permission_missing',
      errorCategory: 'permission_missing',
      checked: true
    });
  }

  const identity = await callPageIdentity(metaClient, token);
  if (!identity.ok) {
    const status = statusFromErrorCategory(identity.errorCategory);
    return safeResult(row, {
      tokenHealthStatus: status,
      errorCategory: normalizeErrorCategory(identity.errorCategory),
      checked: false
    });
  }

  if (!trimText(identity.id) || trimText(identity.id) !== trimText(row.expected_page_id)) {
    return safeResult(row, {
      tokenHealthStatus: 'page_mismatch',
      errorCategory: 'page_mismatch',
      checked: true
    });
  }

  return safeResult(row, {
    tokenHealthStatus: 'valid',
    errorCategory: '',
    checked: true
  });
}

async function checkPageTokenHealth({
  db,
  client,
  credentialType = DEFAULT_CREDENTIAL_TYPE,
  masterKey = process.env.CREDENTIAL_MASTER_KEY,
  metaClient,
  expectedAppId = process.env.META_APP_ID || process.env.FB_APP_ID,
  requiredPermissions,
  now = Date.now,
  apply = false
} = {}) {
  if (apply) throw new Error('apply_disabled');

  const queryable = db || client;
  if (!queryable || typeof queryable.query !== 'function') {
    throw new Error('client_required');
  }

  const report = {
    mode: 'dry-run',
    dry_run: true,
    results: [],
    counts: createCounts()
  };

  if (!trimText(masterKey)) {
    addResult(report, {
      shop_id: '',
      page_ref: '',
      credential_status: 'not_checked',
      token_health_status: 'config_missing',
      error_category: 'credential_master_key_missing',
      counts: {
        active_credentials: 0,
        checked: 0
      }
    });
    return report;
  }

  const rows = await fetchActivePageTokenCredentials(queryable, trimText(credentialType) || DEFAULT_CREDENTIAL_TYPE);
  report.counts.credentials = rows.length;
  if (!rows.length) {
    report.counts.no_active_credentials = 1;
    return report;
  }

  const permissions = normalizeRequiredPermissions(requiredPermissions);
  const groups = groupCredentialRows(rows);
  for (const group of groups) {
    const [row] = group;
    if (group.length > 1) {
      report.counts.ambiguous_credentials += group.length;
      addResult(report, safeResult(row, {
        credentialStatus: 'ambiguous_active',
        tokenHealthStatus: 'check_failed',
        errorCategory: 'credential_ambiguous',
        activeCredentialCount: group.length,
        checked: false
      }));
      continue;
    }

    addResult(report, await evaluateCredentialRow({
      row,
      masterKey,
      metaClient,
      expectedAppId,
      requiredPermissions: permissions,
      now
    }));
  }

  return report;
}

module.exports = {
  DEFAULT_REQUIRED_PERMISSIONS,
  HEALTH_STATUSES,
  checkPageTokenHealth,
  createCounts,
  evaluateCredentialRow,
  fetchActivePageTokenCredentials,
  normalizeDebugResponse,
  normalizePageResponse,
  normalizeRequiredPermissions
};

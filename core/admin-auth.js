const crypto = require('crypto');

const PERMISSIONS = Object.freeze({
  DASHBOARD_READ: 'admin.dashboard.read',
  USER_DETAIL_READ: 'admin.user_detail.read',
  LEGACY_STATE_READ: 'admin.legacy_state.read',
  EXPORT_READ: 'admin.export.read',
  AUDIT_READ: 'admin.audit.read',
  INTERNAL_NOTE_WRITE: 'admin.internal_note.write',
  PRODUCT_WRITE: 'admin.product.write',
  ORDER_WRITE: 'admin.order.write',
  ADMIN_MANAGE: 'admin.manage'
});

const ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze([
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.USER_DETAIL_READ
  ]),
  support: Object.freeze([
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.USER_DETAIL_READ,
    PERMISSIONS.LEGACY_STATE_READ
  ]),
  maintainer: Object.freeze([
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.USER_DETAIL_READ,
    PERMISSIONS.LEGACY_STATE_READ,
    PERMISSIONS.EXPORT_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.INTERNAL_NOTE_WRITE,
    PERMISSIONS.PRODUCT_WRITE
  ]),
  owner: Object.freeze(Object.values(PERMISSIONS))
});

const WRITE_PERMISSIONS = Object.freeze(new Set([
  PERMISSIONS.ORDER_WRITE,
  PERMISSIONS.INTERNAL_NOTE_WRITE,
  PERMISSIONS.PRODUCT_WRITE,
  PERMISSIONS.ADMIN_MANAGE
]));

const AUDIT_OUTCOMES = Object.freeze(new Set(['success', 'denied', 'error', 'noop']));
const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|database|authorization|cookie|phone|address|customer|service[_-]?account|fb[_-]?|telegram|google)/i;
const SAFE_SENSITIVE_FLAG_KEYS = Object.freeze(new Set([
  'token_accepted'
]));
const PHONE_PATTERN = /\b(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ADDRESS_LABEL_PATTERN = /\b(address|dia chi|shipping_address)\b\s*[:=-]?\s*.+$/gi;

function normalizeText(value = '', max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeRoleName(role = '') {
  const normalized = normalizeText(role, 60).toLowerCase().replace(/\s+/g, '_');
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, normalized) ? normalized : '';
}

function normalizeRoles(roles = []) {
  const list = Array.isArray(roles) ? roles : [roles];
  return [...new Set(list.map(normalizeRoleName).filter(Boolean))];
}

function permissionsForRoles(roles = []) {
  const permissions = new Set();
  for (const role of normalizeRoles(roles)) {
    for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission);
  }
  return [...permissions].sort();
}

function normalizePermission(permission = '') {
  return normalizeText(permission, 120).toLowerCase();
}

function isWritePermission(permission = '') {
  return WRITE_PERMISSIONS.has(normalizePermission(permission));
}

function normalizePermissions(permissions = []) {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  const known = new Set(Object.values(PERMISSIONS));
  return [...new Set(list.map(normalizePermission).filter(permission => known.has(permission)))].sort();
}

function buildAdminPrincipal({
  id = '',
  displayName = '',
  roles = [],
  permissions = [],
  tenantId = '',
  pageId = '',
  authMethod = 'bearer'
} = {}) {
  const normalizedRoles = normalizeRoles(roles);
  const mergedPermissions = new Set([
    ...permissionsForRoles(normalizedRoles),
    ...normalizePermissions(permissions)
  ]);

  return {
    id: normalizeText(id, 120) || 'anonymous',
    displayName: normalizeText(displayName, 120),
    roles: normalizedRoles,
    permissions: [...mergedPermissions].sort(),
    tenantId: normalizeText(tenantId, 120),
    pageId: normalizeText(pageId, 120),
    authMethod: normalizeText(authMethod, 40) || 'bearer'
  };
}

function hasPermission(principal, permission) {
  const expected = normalizePermission(permission);
  if (!expected) return false;
  const granted = new Set([
    ...permissionsForRoles(principal?.roles || []),
    ...normalizePermissions(principal?.permissions || [])
  ]);
  return granted.has(expected);
}

function requirePermission(principal, permission) {
  if (hasPermission(principal, permission)) {
    return { ok: true, statusCode: 200, principal };
  }
  return {
    ok: false,
    statusCode: principal ? 403 : 401,
    reason: principal ? 'permission_denied' : 'unauthenticated',
    permission: normalizePermission(permission)
  };
}

function getBearerToken(header = '') {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getAdminBearerToken(req) {
  return getBearerToken(req?.get?.('authorization'));
}

function getAdminRequestToken(req) {
  return String(req?.get?.('x-admin-token') || getAdminBearerToken(req) || '').trim();
}

function safeEqualSecret(actual = '', expected = '') {
  const actualText = String(actual || '');
  const expectedText = String(expected || '');
  if (!actualText || !expectedText) return false;
  const actualHash = crypto.createHash('sha256').update(actualText).digest();
  const expectedHash = crypto.createHash('sha256').update(expectedText).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function authenticateStaticBearer(req, {
  token = '',
  principalId = 'legacy-admin',
  displayName = '',
  roles = ['owner'],
  permissions = [],
  tenantId = '',
  pageId = ''
} = {}) {
  if (!token) return { ok: false, statusCode: 503, reason: 'admin_token_not_configured' };
  const bearer = getAdminBearerToken(req);
  if (!bearer) return { ok: false, statusCode: 401, reason: 'missing_bearer_token' };
  if (!safeEqualSecret(bearer, token)) return { ok: false, statusCode: 401, reason: 'invalid_bearer_token' };
  return {
    ok: true,
    statusCode: 200,
    principal: buildAdminPrincipal({
      id: principalId,
      displayName,
      roles,
      permissions,
      tenantId,
      pageId,
      authMethod: 'static_bearer'
    })
  };
}

function authenticateStaticRequestToken(req, {
  token = '',
  principalId = 'legacy-admin',
  displayName = '',
  roles = ['owner'],
  permissions = [],
  tenantId = '',
  pageId = ''
} = {}) {
  if (!token) return { ok: false, statusCode: 503, reason: 'admin_token_not_configured' };
  const requestToken = getAdminRequestToken(req);
  if (!requestToken) return { ok: false, statusCode: 401, reason: 'missing_admin_token' };
  if (!safeEqualSecret(requestToken, token)) return { ok: false, statusCode: 401, reason: 'invalid_admin_token' };
  return {
    ok: true,
    statusCode: 200,
    principal: buildAdminPrincipal({
      id: principalId,
      displayName,
      roles,
      permissions,
      tenantId,
      pageId,
      authMethod: 'static_admin_token'
    })
  };
}

function hashAuditValue(value = '') {
  const text = normalizeText(value, 512);
  if (!text) return '';
  return crypto.createHash('sha256').update(text).digest('hex');
}

function redactString(value = '', max = 400) {
  return normalizeText(value, max)
    .replace(PHONE_PATTERN, '[redacted-phone]')
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(ADDRESS_LABEL_PATTERN, '$1 [redacted-address]');
}

function redactAuditValue(value, key = '', depth = 0) {
  const normalizedKey = String(key || '').trim().toLowerCase();
  if (SENSITIVE_KEY_PATTERN.test(normalizedKey) && !(SAFE_SENSITIVE_FLAG_KEYS.has(normalizedKey) && typeof value === 'boolean')) {
    return '[redacted]';
  }
  if (value == null) return value;
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redactAuditValue(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 80).map(([childKey, childValue]) => [
        childKey,
        redactAuditValue(childValue, childKey, depth + 1)
      ])
    );
  }
  return redactString(value);
}

function redactAuditMetadata(metadata = {}) {
  return redactAuditValue(metadata, 'metadata');
}

function buildAuditLogEntry({
  principal,
  action = '',
  resourceType = '',
  resourceId = '',
  outcome = 'success',
  requestId = '',
  ip = '',
  userAgent = '',
  metadata = {},
  includeAuthMethod = true
} = {}) {
  const normalizedOutcome = AUDIT_OUTCOMES.has(outcome) ? outcome : 'error';
  const actor = principal || {};
  const metadataObject = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : { value: metadata };
  const authMethod = includeAuthMethod ? normalizeText(actor.authMethod, 40) : '';
  const auditMetadata = {
    ...metadataObject,
    ...(authMethod && !Object.prototype.hasOwnProperty.call(metadataObject, 'auth_method')
      ? { auth_method: authMethod }
      : {})
  };
  return {
    occurred_at: new Date().toISOString(),
    actor_id: normalizeText(actor.id, 120) || 'anonymous',
    actor_roles: normalizeRoles(actor.roles || []),
    action: normalizeText(action, 120),
    resource_type: normalizeText(resourceType, 80),
    resource_id: normalizeText(resourceId, 160),
    outcome: normalizedOutcome,
    tenant_id: normalizeText(actor.tenantId, 120),
    page_id: normalizeText(actor.pageId, 120),
    request_id: normalizeText(requestId, 120),
    request_ip_hash: hashAuditValue(ip),
    user_agent: redactString(userAgent, 240),
    metadata: redactAuditMetadata(auditMetadata)
  };
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  authenticateStaticBearer,
  authenticateStaticRequestToken,
  buildAdminPrincipal,
  buildAuditLogEntry,
  getAdminBearerToken,
  getAdminRequestToken,
  hasPermission,
  isWritePermission,
  permissionsForRoles,
  redactAuditMetadata,
  requirePermission
};

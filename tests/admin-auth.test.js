const { describe, it, expect } = require('./harness');
const {
  PERMISSIONS,
  authenticateStaticBearer,
  buildAdminPrincipal,
  buildAuditLogEntry,
  hasPermission,
  isWritePermission,
  permissionsForRoles,
  redactAuditMetadata,
  requirePermission
} = require('../core/admin-auth');

function createReq(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    get(name) {
      return normalized[String(name).toLowerCase()] || '';
    }
  };
}

describe('admin auth and RBAC helpers', () => {
  it('authenticates static bearer without exposing the raw token', () => {
    const result = authenticateStaticBearer(createReq({ authorization: 'Bearer secret-token' }), {
      token: 'secret-token',
      principalId: 'admin-1',
      roles: ['maintainer'],
      tenantId: 'default',
      pageId: 'page-1'
    });

    expect(result.ok).toBeTrue();
    expect(result.principal.id).toBe('admin-1');
    expect(JSON.stringify(result).includes('secret-token')).toBeFalse();
    expect(hasPermission(result.principal, PERMISSIONS.DASHBOARD_READ)).toBeTrue();
    expect(hasPermission(result.principal, PERMISSIONS.EXPORT_READ)).toBeTrue();
    expect(hasPermission(result.principal, PERMISSIONS.ORDER_WRITE)).toBeFalse();
  });

  it('rejects missing or invalid bearer tokens', () => {
    const missing = authenticateStaticBearer(createReq({ 'x-admin-token': 'secret-token' }), {
      token: 'secret-token'
    });
    const invalid = authenticateStaticBearer(createReq({ authorization: 'Bearer wrong-token' }), {
      token: 'secret-token'
    });

    expect(missing.ok).toBeFalse();
    expect(missing.statusCode).toBe(401);
    expect(invalid.ok).toBeFalse();
    expect(invalid.statusCode).toBe(401);
  });

  it('combines role permissions and distinguishes future write permissions', () => {
    const support = buildAdminPrincipal({ id: 'support-1', roles: ['support'] });
    const ownerPermissions = permissionsForRoles(['owner']);

    expect(hasPermission(support, PERMISSIONS.USER_DETAIL_READ)).toBeTrue();
    expect(hasPermission(support, PERMISSIONS.EXPORT_READ)).toBeFalse();
    expect(ownerPermissions.includes(PERMISSIONS.ADMIN_MANAGE)).toBeTrue();
    expect(isWritePermission(PERMISSIONS.ORDER_WRITE)).toBeTrue();
    expect(isWritePermission(PERMISSIONS.DASHBOARD_READ)).toBeFalse();
  });

  it('returns explicit permission decisions for routes to consume', () => {
    const viewer = buildAdminPrincipal({ id: 'viewer-1', roles: ['viewer'] });
    const allowed = requirePermission(viewer, PERMISSIONS.DASHBOARD_READ);
    const denied = requirePermission(viewer, PERMISSIONS.EXPORT_READ);
    const anonymous = requirePermission(null, PERMISSIONS.DASHBOARD_READ);

    expect(allowed.ok).toBeTrue();
    expect(denied.ok).toBeFalse();
    expect(denied.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('admin audit helpers', () => {
  it('redacts sensitive audit metadata recursively', () => {
    const redacted = redactAuditMetadata({
      token: 'raw-token',
      nested: {
        phone: '0987654321',
        note: 'email a@test.com address 12 Tran Phu'
      }
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized.includes('raw-token')).toBeFalse();
    expect(serialized.includes('0987654321')).toBeFalse();
    expect(serialized.includes('a@test.com')).toBeFalse();
    expect(serialized.includes('12 Tran Phu')).toBeFalse();
    expect(serialized).toContain('[redacted]');
    expect(serialized).toContain('[redacted-email]');
    expect(serialized).toContain('[redacted-address]');
  });

  it('builds audit log entries without raw IP, token, phone, or address values', () => {
    const principal = buildAdminPrincipal({
      id: 'admin-1',
      roles: ['maintainer'],
      tenantId: 'default',
      pageId: 'page-1'
    });
    const entry = buildAuditLogEntry({
      principal,
      action: 'admin.dashboard.read',
      resourceType: 'dashboard',
      outcome: 'success',
      requestId: 'req-1',
      ip: '203.0.113.10',
      userAgent: 'test-agent',
      metadata: {
        authorization: 'Bearer secret-token',
        filter: 'sdt 0987654321 dia chi 12 Tran Phu'
      }
    });
    const serialized = JSON.stringify(entry);

    expect(entry.actor_id).toBe('admin-1');
    expect(entry.request_ip_hash.length).toBe(64);
    expect(serialized.includes('203.0.113.10')).toBeFalse();
    expect(serialized.includes('secret-token')).toBeFalse();
    expect(serialized.includes('0987654321')).toBeFalse();
    expect(serialized.includes('12 Tran Phu')).toBeFalse();
  });
});

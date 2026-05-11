const { describe, it, expect } = require('./harness');
const {
  PERMISSIONS,
  buildAdminPrincipal,
  hasPermission,
  permissionsForRoles
} = require('../core/admin-auth');
const {
  INTERNAL_NOTE_ACTION,
  createPostgresInternalNoteService,
  validateInternalNoteInput
} = require('../core/admin/internal-notes');

function createPrincipal(role = 'maintainer', id = 'admin-1') {
  return buildAdminPrincipal({
    id,
    roles: [role],
    tenantId: 'default',
    pageId: 'page',
    authMethod: 'admin_session'
  });
}

function createFakeClientClass({ failAudit = false, queries = [] } = {}) {
  return class FakeClient {
    async connect() {
      queries.push({ sql: 'CONNECT', params: [] });
    }

    async end() {
      queries.push({ sql: 'END', params: [] });
    }

    async query(sql, params = []) {
      const normalized = String(sql || '').trim();
      queries.push({ sql: normalized, params });
      if (/^INSERT INTO internal_notes/i.test(normalized)) {
        return {
          rows: [{
            id: '42',
            status: 'visible',
            created_by: params[5],
            created_at: '2026-05-12T00:00:00.000Z'
          }]
        };
      }
      if (/^INSERT INTO admin_audit_log/i.test(normalized)) {
        if (failAudit) throw new Error('audit insert failed');
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

function findQuery(queries, pattern) {
  return queries.find(item => pattern.test(item.sql));
}

describe('admin internal note RBAC and validation', () => {
  it('maps internal note write only to maintainer and owner roles', () => {
    expect(permissionsForRoles(['maintainer']).includes(PERMISSIONS.INTERNAL_NOTE_WRITE)).toBeTrue();
    expect(permissionsForRoles(['owner']).includes(PERMISSIONS.INTERNAL_NOTE_WRITE)).toBeTrue();
    expect(permissionsForRoles(['support']).includes(PERMISSIONS.INTERNAL_NOTE_WRITE)).toBeFalse();
    expect(permissionsForRoles(['viewer']).includes(PERMISSIONS.INTERNAL_NOTE_WRITE)).toBeFalse();
    expect(hasPermission(createPrincipal('maintainer'), PERMISSIONS.INTERNAL_NOTE_WRITE)).toBeTrue();
    expect(hasPermission(createPrincipal('support'), PERMISSIONS.INTERNAL_NOTE_WRITE)).toBeFalse();
  });

  it('rejects invalid target type', () => {
    const result = validateInternalNoteInput({
      tenantId: 'default',
      pageId: 'page',
      targetType: 'profile',
      targetId: 'sender_1',
      body: 'safe note',
      createdBy: 'admin-1'
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('invalid_target_type');
  });

  it('rejects empty target id', () => {
    const result = validateInternalNoteInput({
      tenantId: 'default',
      pageId: 'page',
      targetType: 'customer',
      targetId: '  ',
      body: 'safe note',
      createdBy: 'admin-1'
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('target_id_required');
  });

  it('rejects empty body', () => {
    const result = validateInternalNoteInput({
      tenantId: 'default',
      pageId: 'page',
      targetType: 'conversation',
      targetId: 'sender_1',
      body: '  ',
      createdBy: 'admin-1'
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('body_required');
  });

  it('rejects body longer than 2000 characters', () => {
    const result = validateInternalNoteInput({
      tenantId: 'default',
      pageId: 'page',
      targetType: 'order',
      targetId: '123',
      body: 'x'.repeat(2001),
      createdBy: 'admin-1'
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('body_too_long');
  });

  it('rejects empty created_by', () => {
    const result = validateInternalNoteInput({
      tenantId: 'default',
      pageId: 'page',
      targetType: 'customer',
      targetId: 'sender_1',
      body: 'safe note',
      createdBy: ''
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('created_by_required');
  });
});

describe('admin internal note PostgreSQL service', () => {
  it('inserts note and audit in one transaction', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createFakeClientClass({ queries })
    });

    const result = await service.createNote({
      principal: createPrincipal('maintainer'),
      targetType: 'order',
      targetId: '123',
      body: 'safe internal context',
      requestContext: {
        requestId: 'req-1',
        ip: '203.0.113.10',
        userAgent: 'unit-test'
      }
    });
    const noteInsertIndex = queries.findIndex(item => /^INSERT INTO internal_notes/i.test(item.sql));
    const auditInsertIndex = queries.findIndex(item => /^INSERT INTO admin_audit_log/i.test(item.sql));
    const commitIndex = queries.findIndex(item => item.sql === 'COMMIT');

    expect(result.id).toBe('42');
    expect(result.bodyLength).toBe('safe internal context'.length);
    expect(JSON.stringify(result).includes('safe internal context')).toBeFalse();
    expect(queries.findIndex(item => item.sql === 'BEGIN') < noteInsertIndex).toBeTrue();
    expect(noteInsertIndex < auditInsertIndex).toBeTrue();
    expect(auditInsertIndex < commitIndex).toBeTrue();
    expect(findQuery(queries, /^ROLLBACK$/)).toBe(undefined);

    const auditInsert = queries[auditInsertIndex];
    const auditMetadata = JSON.parse(auditInsert.params[12]);
    expect(auditInsert.params[5]).toBe(INTERNAL_NOTE_ACTION);
    expect(auditInsert.params[6]).toBe('internal_note');
    expect(auditInsert.params[7]).toBe('42');
    expect(auditInsert.params[8]).toBe('success');
    expect(auditMetadata.target_type).toBe('order');
    expect(auditMetadata.target_id).toBe('123');
    expect(auditMetadata.body_length).toBe('safe internal context'.length);
    expect(auditMetadata.auth_method).toBe('admin_session');
  });

  it('rolls back note insert when audit insert fails', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createFakeClientClass({ failAudit: true, queries })
    });

    let failed = false;
    try {
      await service.createNote({
        principal: createPrincipal('owner'),
        targetType: 'customer',
        targetId: 'sender_1',
        body: 'safe note'
      });
    } catch (err) {
      failed = true;
      expect(err.message).toBe('audit insert failed');
    }

    expect(failed).toBeTrue();
    expect(Boolean(findQuery(queries, /^INSERT INTO internal_notes/i))).toBeTrue();
    expect(Boolean(findQuery(queries, /^INSERT INTO admin_audit_log/i))).toBeTrue();
    expect(Boolean(findQuery(queries, /^ROLLBACK$/))).toBeTrue();
    expect(Boolean(findQuery(queries, /^COMMIT$/))).toBeFalse();
  });

  it('denies support without inserting a note and records denied audit', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createFakeClientClass({ queries })
    });

    let failed = false;
    try {
      await service.createNote({
        principal: createPrincipal('support', 'support-1'),
        targetType: 'customer',
        targetId: 'sender_1',
        body: 'safe note'
      });
    } catch (err) {
      failed = true;
      expect(err.statusCode).toBe(403);
    }

    const auditInsert = findQuery(queries, /^INSERT INTO admin_audit_log/i);
    const metadata = JSON.parse(auditInsert.params[12]);
    expect(failed).toBeTrue();
    expect(Boolean(findQuery(queries, /^INSERT INTO internal_notes/i))).toBeFalse();
    expect(auditInsert.params[8]).toBe('denied');
    expect(metadata.reason).toBe('permission_denied');
    expect(metadata.required_permission).toBe(PERMISSIONS.INTERNAL_NOTE_WRITE);
    expect(Boolean(findQuery(queries, /^COMMIT$/))).toBeTrue();
  });

  it('audits invalid input without inserting a note', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createFakeClientClass({ queries })
    });

    let failed = false;
    try {
      await service.createNote({
        principal: createPrincipal('maintainer'),
        targetType: 'profile',
        targetId: 'sender_1',
        body: 'safe note'
      });
    } catch (err) {
      failed = true;
      expect(err.code).toBe('invalid_target_type');
    }

    const auditInsert = findQuery(queries, /^INSERT INTO admin_audit_log/i);
    const metadata = JSON.parse(auditInsert.params[12]);
    expect(failed).toBeTrue();
    expect(Boolean(findQuery(queries, /^INSERT INTO internal_notes/i))).toBeFalse();
    expect(auditInsert.params[8]).toBe('denied');
    expect(metadata.reason).toBe('invalid_target_type');
    expect(Boolean(findQuery(queries, /^COMMIT$/))).toBeTrue();
  });

  it('rejects unresolved actor before inserting a note', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createFakeClientClass({ queries })
    });

    let failed = false;
    try {
      await service.createNote({
        principal: buildAdminPrincipal({
          id: '',
          roles: ['owner'],
          tenantId: 'default',
          pageId: 'page',
          authMethod: 'admin_session'
        }),
        targetType: 'customer',
        targetId: 'sender_1',
        body: 'safe note'
      });
    } catch (err) {
      failed = true;
      expect(err.code).toBe('created_by_required');
      expect(err.statusCode).toBe(500);
    }

    const auditInsert = findQuery(queries, /^INSERT INTO admin_audit_log/i);
    const metadata = JSON.parse(auditInsert.params[12]);
    expect(failed).toBeTrue();
    expect(Boolean(findQuery(queries, /^INSERT INTO internal_notes/i))).toBeFalse();
    expect(auditInsert.params[8]).toBe('error');
    expect(metadata.reason).toBe('created_by_required');
    expect(Boolean(findQuery(queries, /^COMMIT$/))).toBeTrue();
  });

  it('keeps note body and raw sensitive fields out of audit metadata', async () => {
    const queries = [];
    const service = createPostgresInternalNoteService({
      databaseUrl: 'postgres://example.test/db',
      tenantId: 'default',
      pageId: 'page',
      Client: createFakeClientClass({ queries })
    });
    const noteBody = 'do not leak this note body token DATABASE_URL 0987654321 address 12 Tran Phu';

    await service.createNote({
      principal: createPrincipal('maintainer'),
      targetType: 'conversation',
      targetId: 'sender_1',
      body: noteBody
    });

    const auditInsert = findQuery(queries, /^INSERT INTO admin_audit_log/i);
    const metadataText = auditInsert.params[12];
    expect(metadataText).toContain('"target_type":"conversation"');
    expect(metadataText).toContain('"target_id":"sender_1"');
    expect(metadataText).toContain('"body_length"');
    expect(metadataText.includes(noteBody)).toBeFalse();
    expect(metadataText.includes('do not leak this note body')).toBeFalse();
    expect(metadataText.includes('DATABASE_URL')).toBeFalse();
    expect(metadataText.includes('0987654321')).toBeFalse();
    expect(metadataText.includes('12 Tran Phu')).toBeFalse();
    expect(metadataText.includes('raw_customer')).toBeFalse();
    expect(metadataText.includes('raw_order')).toBeFalse();
    expect(metadataText.includes('raw_message')).toBeFalse();
    expect(metadataText.includes('token')).toBeFalse();
    expect(metadataText.includes('secret')).toBeFalse();
  });
});

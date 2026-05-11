const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');

const INTERNAL_NOTE_ACTION = 'admin.internal_note.create';
const INTERNAL_NOTE_RESOURCE_TYPE = 'internal_note';
const INTERNAL_NOTE_TARGET_TYPES = Object.freeze(['order', 'conversation', 'customer']);
const MAX_INTERNAL_NOTE_BODY_LENGTH = 2000;
const DEFAULT_INTERNAL_NOTE_LIST_LIMIT = 25;
const MAX_INTERNAL_NOTE_LIST_LIMIT = 100;

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL internal notes.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTargetType(value = '') {
  return normalizeText(value, 40).toLowerCase();
}

function normalizeTargetId(value = '') {
  return normalizeText(value, 200);
}

function normalizeNoteBody(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function resolveCreatedBy(principal) {
  const actorId = normalizeText(principal?.id, 120);
  return actorId && actorId !== 'anonymous' ? actorId : '';
}

function createInternalNoteError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function toBoundedInteger(value, fallback, { min = 0, max = MAX_INTERNAL_NOTE_LIST_LIMIT } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function validateInternalNoteInput({
  tenantId = '',
  pageId = '',
  targetType = '',
  targetId = '',
  body = '',
  createdBy = ''
} = {}) {
  const normalized = {
    tenantId: normalizeText(tenantId, 120),
    pageId: normalizeText(pageId, 120),
    targetType: normalizeTargetType(targetType),
    targetId: normalizeTargetId(targetId),
    body: normalizeNoteBody(body),
    createdBy: normalizeText(createdBy, 120)
  };

  if (!normalized.tenantId) {
    return { ok: false, reason: 'tenant_id_required', normalized };
  }
  if (!normalized.pageId) {
    return { ok: false, reason: 'page_id_required', normalized };
  }
  if (!INTERNAL_NOTE_TARGET_TYPES.includes(normalized.targetType)) {
    return { ok: false, reason: 'invalid_target_type', normalized };
  }
  if (!normalized.targetId) {
    return { ok: false, reason: 'target_id_required', normalized };
  }
  if (!normalized.body) {
    return { ok: false, reason: 'body_required', normalized };
  }
  if (normalized.body.length > MAX_INTERNAL_NOTE_BODY_LENGTH) {
    return { ok: false, reason: 'body_too_long', normalized };
  }
  if (!normalized.createdBy) {
    return { ok: false, reason: 'created_by_required', normalized };
  }
  return { ok: true, normalized };
}

function validateInternalNoteListInput({
  tenantId = '',
  pageId = '',
  targetType = '',
  targetId = '',
  limit = DEFAULT_INTERNAL_NOTE_LIST_LIMIT,
  offset = 0
} = {}) {
  const normalized = {
    tenantId: normalizeText(tenantId, 120),
    pageId: normalizeText(pageId, 120),
    targetType: normalizeTargetType(targetType),
    targetId: normalizeTargetId(targetId),
    limit: toBoundedInteger(limit, DEFAULT_INTERNAL_NOTE_LIST_LIMIT, { min: 1, max: MAX_INTERNAL_NOTE_LIST_LIMIT }),
    offset: toBoundedInteger(offset, 0, { min: 0, max: 100000 })
  };

  if (!normalized.tenantId) {
    return { ok: false, reason: 'tenant_id_required', normalized };
  }
  if (!normalized.pageId) {
    return { ok: false, reason: 'page_id_required', normalized };
  }
  if (!INTERNAL_NOTE_TARGET_TYPES.includes(normalized.targetType)) {
    return { ok: false, reason: 'invalid_target_type', normalized };
  }
  if (!normalized.targetId) {
    return { ok: false, reason: 'target_id_required', normalized };
  }
  return { ok: true, normalized };
}

function presentInternalNoteRow(row = {}) {
  return {
    id: row.id != null ? String(row.id) : '',
    target_type: row.target_type || '',
    target_id: row.target_id || '',
    body: row.body || '',
    status: row.status || '',
    created_by: row.created_by || '',
    created_at: row.created_at || ''
  };
}

function buildInternalNoteAuditMetadata({
  targetType = '',
  targetId = '',
  body = '',
  authMethod = '',
  reason = '',
  requiredPermission = ''
} = {}) {
  return {
    target_type: normalizeTargetType(targetType),
    target_id: normalizeTargetId(targetId),
    body_length: normalizeNoteBody(body).length,
    ...(authMethod ? { auth_method: normalizeText(authMethod, 40) } : {}),
    ...(reason ? { reason: normalizeText(reason, 80) } : {}),
    ...(requiredPermission ? { required_permission: normalizeText(requiredPermission, 120) } : {})
  };
}

function createInternalNoteRepository() {
  async function listNotes(client, {
    tenantId = '',
    pageId = '',
    targetType = '',
    targetId = '',
    visibleOnly = true,
    limit = DEFAULT_INTERNAL_NOTE_LIST_LIMIT,
    offset = 0
  } = {}) {
    const statusSql = visibleOnly ? 'AND status = $5' : '';
    const limitParam = visibleOnly ? 6 : 5;
    const offsetParam = limitParam + 1;
    const params = visibleOnly
      ? [tenantId, pageId, targetType, targetId, 'visible', limit, offset]
      : [tenantId, pageId, targetType, targetId, limit, offset];
    const result = await client.query(`
      SELECT id, target_type, target_id, body, status, created_by, created_at
      FROM internal_notes
      WHERE tenant_id = $1
        AND page_id = $2
        AND target_type = $3
        AND target_id = $4
        ${statusSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `, params);
    return (result.rows || []).map(presentInternalNoteRow);
  }

  async function insertNote(client, note) {
    const result = await client.query(`
      INSERT INTO internal_notes (
        tenant_id, page_id, target_type, target_id, body, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, status, created_by, created_at
    `, [
      note.tenantId,
      note.pageId,
      note.targetType,
      note.targetId,
      note.body,
      note.createdBy
    ]);
    const row = result.rows[0];
    if (!row?.id) {
      throw createInternalNoteError('internal_note_insert_failed', 'Internal note insert did not return an id.', 500);
    }
    return row;
  }

  async function insertCreateAudit(client, {
    principal,
    resourceId = '',
    outcome = 'success',
    metadata = {},
    requestContext = {}
  } = {}) {
    const entry = buildAuditLogEntry({
      principal,
      action: INTERNAL_NOTE_ACTION,
      resourceType: INTERNAL_NOTE_RESOURCE_TYPE,
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
    insertCreateAudit,
    insertNote,
    listNotes
  };
}

function createPostgresInternalNoteService({
  databaseUrl = process.env.DATABASE_URL,
  tenantId = 'default',
  pageId = '',
  Client,
  repository = createInternalNoteRepository()
} = {}) {
  async function createNote({
    principal,
    targetType = '',
    targetId = '',
    body = '',
    requestContext = {}
  } = {}) {
    if (!databaseUrl) {
      throw createInternalNoteError('database_url_required', 'DATABASE_URL is required for internal notes.', 503);
    }

    const PgClient = Client || loadPgClient();
    const client = new PgClient({ connectionString: databaseUrl });
    let committed = false;
    await client.connect();
    try {
      await client.query('BEGIN');

      const baseMetadata = buildInternalNoteAuditMetadata({
        targetType,
        targetId,
        body,
        authMethod: principal?.authMethod
      });
      if (!hasPermission(principal, PERMISSIONS.INTERNAL_NOTE_WRITE)) {
        const metadata = {
          ...baseMetadata,
          reason: 'permission_denied',
          required_permission: PERMISSIONS.INTERNAL_NOTE_WRITE
        };
        await repository.insertCreateAudit(client, {
          principal,
          outcome: 'denied',
          metadata,
          requestContext
        });
        await client.query('COMMIT');
        committed = true;
        throw createInternalNoteError('permission_denied', 'Internal note write permission is required.', 403);
      }

      const createdBy = resolveCreatedBy(principal);
      const validation = validateInternalNoteInput({
        tenantId,
        pageId,
        targetType,
        targetId,
        body,
        createdBy
      });
      if (!validation.ok) {
        const isActorError = validation.reason === 'created_by_required';
        await repository.insertCreateAudit(client, {
          principal,
          outcome: isActorError ? 'error' : 'denied',
          metadata: {
            ...baseMetadata,
            reason: validation.reason
          },
          requestContext
        });
        await client.query('COMMIT');
        committed = true;
        throw createInternalNoteError(
          validation.reason,
          isActorError ? 'Internal note actor is unresolved.' : 'Internal note input is invalid.',
          isActorError ? 500 : 400
        );
      }

      const note = await repository.insertNote(client, validation.normalized);
      await repository.insertCreateAudit(client, {
        principal,
        resourceId: String(note.id),
        outcome: 'success',
        metadata: buildInternalNoteAuditMetadata({
          targetType: validation.normalized.targetType,
          targetId: validation.normalized.targetId,
          body: validation.normalized.body,
          authMethod: principal?.authMethod
        }),
        requestContext
      });
      await client.query('COMMIT');
      committed = true;

      return {
        id: String(note.id),
        targetType: validation.normalized.targetType,
        targetId: validation.normalized.targetId,
        bodyLength: validation.normalized.body.length,
        status: note.status || 'visible',
        createdBy: note.created_by || validation.normalized.createdBy,
        createdAt: note.created_at || ''
      };
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  async function listNotes({
    targetType = '',
    targetId = '',
    visibleOnly = true,
    limit = DEFAULT_INTERNAL_NOTE_LIST_LIMIT,
    offset = 0
  } = {}) {
    if (!databaseUrl) {
      throw createInternalNoteError('database_url_required', 'DATABASE_URL is required for internal notes.', 503);
    }

    const validation = validateInternalNoteListInput({
      tenantId,
      pageId,
      targetType,
      targetId,
      limit,
      offset
    });
    if (!validation.ok) {
      throw createInternalNoteError(validation.reason, 'Internal note list input is invalid.', 400);
    }

    const PgClient = Client || loadPgClient();
    const client = new PgClient({ connectionString: databaseUrl });
    await client.connect();
    try {
      return {
        tenantId: validation.normalized.tenantId,
        pageId: validation.normalized.pageId,
        targetType: validation.normalized.targetType,
        targetId: validation.normalized.targetId,
        limit: validation.normalized.limit,
        offset: validation.normalized.offset,
        visibleOnly: visibleOnly !== false,
        notes: await repository.listNotes(client, {
          ...validation.normalized,
          visibleOnly: visibleOnly !== false
        })
      };
    } finally {
      await client.end();
    }
  }

  return {
    createNote,
    listNotes
  };
}

module.exports = {
  DEFAULT_INTERNAL_NOTE_LIST_LIMIT,
  INTERNAL_NOTE_ACTION,
  INTERNAL_NOTE_RESOURCE_TYPE,
  INTERNAL_NOTE_TARGET_TYPES,
  MAX_INTERNAL_NOTE_BODY_LENGTH,
  MAX_INTERNAL_NOTE_LIST_LIMIT,
  buildInternalNoteAuditMetadata,
  createInternalNoteRepository,
  createPostgresInternalNoteService,
  validateInternalNoteInput,
  validateInternalNoteListInput
};

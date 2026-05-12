const {
  PERMISSIONS,
  hasPermission
} = require('../admin-auth');
const {
  presentAuditApi,
  presentDashboardApi,
  presentInternalNotesApi,
  presentUserDetailApi
} = require('./api-presenter');
const {
  DEFAULT_INTERNAL_NOTE_LIST_LIMIT,
  MAX_INTERNAL_NOTE_LIST_LIMIT,
  validateInternalNoteListInput
} = require('./internal-notes');
const { normalizeDashboardFilters } = require('./reader');
const {
  renderAuditHtml,
  renderDashboardHtml,
  renderUserDetailHtml
} = require('./views');

const USER_DETAIL_INTERNAL_NOTE_LIMIT = 20;

function createAdminReadHandlers({
  reader,
  internalNoteService,
  tenantId = 'default',
  pageId = '',
  authorizeAdminRequest,
  recordAdminAudit
} = {}) {
  function resolveInternalNoteReadPermission(targetType = '') {
    const normalized = String(targetType || '').trim().toLowerCase();
    if (normalized === 'order') return PERMISSIONS.DASHBOARD_READ;
    return PERMISSIONS.USER_DETAIL_READ;
  }

  function normalizePaginationQuery(query = {}) {
    const validation = validateInternalNoteListInput({
      tenantId,
      pageId,
      targetType: query.target_type,
      targetId: query.target_id,
      limit: query.limit,
      offset: query.offset
    });
    return validation.normalized || {
      targetType: String(query.target_type || '').trim().slice(0, 40).toLowerCase(),
      targetId: String(query.target_id || '').trim().slice(0, 200),
      limit: DEFAULT_INTERNAL_NOTE_LIST_LIMIT,
      offset: 0
    };
  }

  function createEmptyInternalNotesModel({ query = {}, schemaReady = true, message = '', error = '' } = {}) {
    const normalized = normalizePaginationQuery(query);
    return presentInternalNotesApi({
      schemaReady,
      notes: [],
      limit: Math.min(Number(normalized.limit || DEFAULT_INTERNAL_NOTE_LIST_LIMIT), MAX_INTERNAL_NOTE_LIST_LIMIT),
      offset: Number(normalized.offset || 0),
      message,
      error
    });
  }

  function isMissingInternalNotesSchemaError(err) {
    return err?.code === '42P01' || err?.code === '42703';
  }

  function getInternalNoteSortTime(note = {}) {
    if (!note.created_at) return 0;
    const date = note.created_at instanceof Date ? note.created_at : new Date(note.created_at);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function compareInternalNotesNewestFirst(a = {}, b = {}) {
    const timeDelta = getInternalNoteSortTime(b) - getInternalNoteSortTime(a);
    if (timeDelta) return timeDelta;
    return String(b.id || '').localeCompare(String(a.id || ''), undefined, { numeric: true });
  }

  async function getUserDetailInternalNotes(senderId = '', principal) {
    const targetId = String(senderId || '').trim().slice(0, 160);
    const base = {
      canCreate: hasPermission(principal, PERMISSIONS.INTERNAL_NOTE_WRITE),
      schemaReady: true,
      notes: [],
      targetId
    };
    if (!targetId) {
      return {
        ...base,
        error: 'invalid_internal_note_target',
        message: 'Không đọc được ghi chú nội bộ.'
      };
    }

    try {
      const [customerModel, conversationModel] = await Promise.all([
        internalNoteService.listNotes({
          targetType: 'customer',
          targetId,
          visibleOnly: true,
          limit: USER_DETAIL_INTERNAL_NOTE_LIMIT + 1,
          offset: 0
        }),
        internalNoteService.listNotes({
          targetType: 'conversation',
          targetId,
          visibleOnly: true,
          limit: USER_DETAIL_INTERNAL_NOTE_LIMIT + 1,
          offset: 0
        })
      ]);
      const sortedNotes = [
        ...(customerModel.notes || []),
        ...(conversationModel.notes || [])
      ]
        .filter(note => String(note.status || '').toLowerCase() === 'visible')
        .sort(compareInternalNotesNewestFirst);

      return {
        ...base,
        hasNext: sortedNotes.length > USER_DETAIL_INTERNAL_NOTE_LIMIT,
        notes: sortedNotes.slice(0, USER_DETAIL_INTERNAL_NOTE_LIMIT)
      };
    } catch (err) {
      if (isMissingInternalNotesSchemaError(err)) {
        return {
          ...base,
          schemaReady: false,
          notes: [],
          message: 'Ghi chú nội bộ chưa sẵn sàng.'
        };
      }
      return {
        ...base,
        notes: [],
        error: 'internal_notes_read_failed',
        message: 'Không đọc được ghi chú nội bộ.'
      };
    }
  }

  function buildInternalNoteReadAuditMetadata({
    query = {},
    schemaReady = true
  } = {}) {
    const normalized = normalizePaginationQuery(query);
    return {
      target_type: normalized.targetType,
      target_id: normalized.targetId,
      limit: normalized.limit,
      offset: normalized.offset,
      schemaReady
    };
  }

  async function sendDashboard(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: PERMISSIONS.DASHBOARD_READ,
      resourceType: 'dashboard'
    });
    if (!principal) return;
    try {
      const model = await reader.getOverview(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      res.type('html').send(renderDashboardHtml(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      res.status(err.statusCode || 500).send('Không đọc được dashboard.');
    }
  }

  async function sendUserDetail(req, res) {
    const senderId = String(req.params.senderId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.USER_DETAIL_READ,
      bearerOnly: true,
      action: PERMISSIONS.USER_DETAIL_READ,
      resourceType: 'sender',
      resourceId: senderId
    });
    if (!principal) return;
    try {
      const model = await reader.getUserDetail(senderId);
      model.filters = normalizeDashboardFilters(req.query || {});
      model.internalNotes = await getUserDetailInternalNotes(senderId, principal);
      model.notes = model.internalNotes.notes || [];
      model.notesHasNext = Boolean(model.internalNotes.hasNext);
      model.notesSchemaReady = model.internalNotes.schemaReady !== false;
      model.canCreateNote = Boolean(model.internalNotes.canCreate);
      model.notesMessage = model.internalNotes.message || '';
      model.notesError = model.internalNotes.error || '';
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender',
        resourceId: senderId,
        outcome: 'success'
      });
      res.type('html').send(renderUserDetailHtml(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender',
        resourceId: senderId,
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      res.status(err.statusCode || 500).send('Không đọc được dashboard detail.');
    }
  }

  async function sendAuditLog(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.AUDIT_READ,
      bearerOnly: true,
      action: PERMISSIONS.AUDIT_READ,
      resourceType: 'audit_log'
    });
    if (!principal) return;
    try {
      const model = await reader.getAuditLog(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      res.type('html').send(renderAuditHtml(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      res.status(err.statusCode || 500).send('Không đọc được audit log.');
    }
  }

  async function sendDashboardApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.DASHBOARD_READ,
      bearerOnly: true,
      action: PERMISSIONS.DASHBOARD_READ,
      resourceType: 'dashboard_api'
    });
    if (!principal) return;
    try {
      const model = await reader.getOverview(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard_api',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      return res.json(presentDashboardApi(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.DASHBOARD_READ,
        resourceType: 'dashboard_api',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      return res.status(err.statusCode || 500).json({ error: 'dashboard_read_failed' });
    }
  }

  async function sendUserDetailApi(req, res) {
    const senderId = String(req.params.senderId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.USER_DETAIL_READ,
      bearerOnly: true,
      action: PERMISSIONS.USER_DETAIL_READ,
      resourceType: 'sender_api',
      resourceId: senderId
    });
    if (!principal) return;
    try {
      const model = await reader.getUserDetail(senderId);
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender_api',
        resourceId: senderId,
        outcome: 'success'
      });
      return res.json(presentUserDetailApi(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.USER_DETAIL_READ,
        resourceType: 'sender_api',
        resourceId: senderId,
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      return res.status(err.statusCode || 500).json({ error: 'user_detail_read_failed' });
    }
  }

  async function sendAuditLogApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.AUDIT_READ,
      bearerOnly: true,
      action: PERMISSIONS.AUDIT_READ,
      resourceType: 'audit_log_api'
    });
    if (!principal) return;
    try {
      const model = await reader.getAuditLog(req.query || {});
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log_api',
        outcome: 'success',
        metadata: { filters: req.query || {} }
      });
      return res.json(presentAuditApi(model));
    } catch (err) {
      await recordAdminAudit(req, {
        principal,
        action: PERMISSIONS.AUDIT_READ,
        resourceType: 'audit_log_api',
        outcome: 'error',
        metadata: { statusCode: err.statusCode || 500 }
      });
      return res.status(err.statusCode || 500).json({ error: 'audit_log_read_failed' });
    }
  }

  async function sendInternalNotesApi(req, res) {
    const permission = resolveInternalNoteReadPermission(req.query?.target_type);
    const principal = await authorizeAdminRequest(req, res, {
      permission,
      bearerOnly: true,
      action: 'admin.internal_note.read',
      resourceType: 'internal_note'
    });
    if (!principal) return;

    try {
      const validation = validateInternalNoteListInput({
        tenantId,
        pageId,
        targetType: req.query?.target_type,
        targetId: req.query?.target_id,
        limit: req.query?.limit,
        offset: req.query?.offset
      });
      if (!validation.ok) {
        await recordAdminAudit(req, {
          principal,
          action: 'admin.internal_note.read',
          resourceType: 'internal_note',
          outcome: 'denied',
          includeAuthMethod: false,
          metadata: buildInternalNoteReadAuditMetadata({ query: req.query || {}, schemaReady: true })
        });
        return res.status(400).json(createEmptyInternalNotesModel({
          query: req.query || {},
          error: 'invalid_internal_note_target',
          message: 'Internal note target is invalid.'
        }));
      }

      const model = await internalNoteService.listNotes({
        targetType: validation.normalized.targetType,
        targetId: validation.normalized.targetId,
        limit: validation.normalized.limit,
        offset: validation.normalized.offset,
        visibleOnly: true
      });
      await recordAdminAudit(req, {
        principal,
        action: 'admin.internal_note.read',
        resourceType: 'internal_note',
        outcome: 'success',
        includeAuthMethod: false,
        metadata: buildInternalNoteReadAuditMetadata({ query: req.query || {}, schemaReady: true })
      });
      return res.json(presentInternalNotesApi({
        schemaReady: true,
        notes: model.notes || [],
        limit: model.limit,
        offset: model.offset
      }));
    } catch (err) {
      if (isMissingInternalNotesSchemaError(err)) {
        await recordAdminAudit(req, {
          principal,
          action: 'admin.internal_note.read',
          resourceType: 'internal_note',
          outcome: 'success',
          includeAuthMethod: false,
          metadata: buildInternalNoteReadAuditMetadata({ query: req.query || {}, schemaReady: false })
        });
        return res.json(createEmptyInternalNotesModel({
          query: req.query || {},
          schemaReady: false,
          message: 'Internal notes schema is not ready.'
        }));
      }
      await recordAdminAudit(req, {
        principal,
        action: 'admin.internal_note.read',
        resourceType: 'internal_note',
        outcome: 'error',
        includeAuthMethod: false,
        metadata: buildInternalNoteReadAuditMetadata({ query: req.query || {}, schemaReady: true })
      });
      return res.status(err.statusCode || 500).json(createEmptyInternalNotesModel({
        query: req.query || {},
        error: 'internal_notes_read_failed',
        message: 'Internal notes could not be read.'
      }));
    }
  }

  return {
    sendAuditLog,
    sendAuditLogApi,
    sendDashboard,
    sendDashboardApi,
    sendInternalNotesApi,
    sendUserDetail,
    sendUserDetailApi
  };
}

module.exports = {
  createAdminReadHandlers
};

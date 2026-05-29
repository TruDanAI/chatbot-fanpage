const {
  PERMISSIONS,
  getAdminBearerToken,
  getAdminRequestToken
} = require('./admin-auth');
const { createPostgresAuditLogger } = require('./admin/audit');
const {
  presentAssetWriteApi,
  presentPageCredentialPreviewApi,
  presentPageCredentialWriteApi,
  presentPageMappingArchiveApi,
  presentPageMappingPreviewApi,
  presentPageMappingWriteApi,
  presentProductWriteApi,
  presentShopControlWriteApi,
  presentShopReadinessCheckApi,
  presentShopSettingsWriteApi,
  presentShopWriteApi
} = require('./admin/api-presenter');
const {
  INTERNAL_NOTE_ACTION,
  INTERNAL_NOTE_RESOURCE_TYPE,
  createPostgresInternalNoteService
} = require('./admin/internal-notes');
const {
  createPostgresAssetWriteService,
  isMissingAssetWriteSchemaError
} = require('./admin/asset-writes');
const {
  createPostgresAssetUploadService,
  isAdminImageUploadEnabled,
  isMissingAssetUploadSchemaError,
  resolveImageUploadPolicy
} = require('./admin/asset-uploads');
const {
  createPostgresProductImportService,
  isMissingProductImportSchemaError,
  presentImportSummary,
  safeSubmittedValue: safeProductImportSubmittedValue
} = require('./admin/product-import-writes');
const {
  createPostgresProductWriteService,
  isMissingProductWriteSchemaError
} = require('./admin/product-writes');
const {
  createPostgresPageCredentialWriteService,
  isMissingPageCredentialWriteSchemaError
} = require('./admin/page-credential-writes');
const {
  createPostgresPageMappingWriteService,
  isStagingRuntime,
  isMissingPageMappingWriteSchemaError
} = require('./admin/page-mapping-writes');
const {
  PAGE_SETUP_PREVIEW_ACTIONS,
  createPostgresPageSetupPreviewService,
  isMissingPageSetupPreviewSchemaError
} = require('./admin/page-setup-preview');
const {
  createPostgresShopControlWriteService,
  isMissingShopControlWriteSchemaError,
  SHOP_DRY_RUN_DISABLE_ACTION,
  SHOP_DRY_RUN_ENABLE_ACTION
} = require('./admin/shop-control-writes');
const {
  createPostgresShopReadinessCheckService,
  isMissingShopReadinessCheckSchemaError
} = require('./admin/shop-readiness-check');
const {
  createPostgresShopSettingsWriteService,
  isMissingShopSettingsWriteSchemaError
} = require('./admin/shop-settings-writes');
const {
  createPostgresShopWriteService,
  isMissingShopWriteSchemaError
} = require('./admin/shop-writes');
const {
  createPostgresShopDeleteService
} = require('./admin/shop-delete-writes');
const { createAdminLegacyHandlers } = require('./admin/legacy-routes');
const {
  assertReadOnlySql,
  createPostgresDashboardReader
} = require('./admin/reader');
const { createAdminReadHandlers } = require('./admin/read-routes');
const {
  createAdminRouteAuthorizer,
  parseAdminRoles
} = require('./admin/route-auth');
const {
  createAdminLoginRateLimiter,
  createAdminSessionHandlers,
  createAdminSessionManager
} = require('./admin/session');
const {
  maskAddress,
  maskPhone,
  renderBulkMenuImageImportResultHtml,
  renderPageSetupPreviewResultHtml,
  renderProductImportResultHtml,
  renderShopCreateHtml
} = require('./admin/views');

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function isRotateCredentialRequest(body = {}) {
  return /^(1|true|yes|on|rotate)$/i.test(String(body?.rotate || body?.mode || '').trim());
}

function setResponseHeader(res, name, value) {
  if (typeof res?.set === 'function') return res.set(name, value);
  if (typeof res?.setHeader === 'function') return res.setHeader(name, value);
  if (res?.headers) res.headers[String(name).toLowerCase()] = value;
  return undefined;
}

function setAdminNoStoreHeaders(_req, res, next) {
  setResponseHeader(res, 'Cache-Control', 'no-store');
  setResponseHeader(res, 'Pragma', 'no-cache');
  setResponseHeader(res, 'Expires', '0');
  setResponseHeader(res, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(res, 'Referrer-Policy', 'no-referrer');
  if (typeof next === 'function') return next();
  return undefined;
}

function loadMulter() {
  try {
    return require('multer');
  } catch (_) {
    const err = new Error('Package "multer" is required for admin image uploads.');
    err.code = 'feature_not_configured';
    err.statusCode = 503;
    throw err;
  }
}

function getUploadedImageFile(req = {}) {
  if (req.file) return req.file;
  const files = req.files || {};
  if (Array.isArray(files.image) && files.image[0]) return files.image[0];
  if (Array.isArray(files.file) && files.file[0]) return files.file[0];
  if (Array.isArray(files.upload) && files.upload[0]) return files.upload[0];
  return null;
}

function createAssetUploadParser(policy = resolveImageUploadPolicy()) {
  const multer = loadMulter();
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Number(policy.maxBytes || 5242880),
      files: 1,
      fields: 12,
      parts: 16
    }
  }).fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'upload', maxCount: 1 }
  ]);
}

function parseAssetUploadRequest(req, res, assetUploads) {
  if (getUploadedImageFile(req)) return Promise.resolve();
  const policy = typeof assetUploads?.getPolicy === 'function'
    ? assetUploads.getPolicy()
    : resolveImageUploadPolicy();
  const parser = createAssetUploadParser(policy);
  return new Promise((resolve, reject) => {
    parser(req, res, err => {
      if (!err) {
        resolve();
        return;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.code = 'file_too_large';
        err.statusCode = 413;
      } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        err.code = 'invalid_file_field';
        err.statusCode = 400;
      } else {
        err.code = 'upload_parse_failed';
        err.statusCode = 400;
      }
      reject(err);
    });
  });
}

function getRequestHeader(req, name) {
  return String(req?.get?.(name) || '');
}

function getRequestIp(req, getClientIp) {
  if (typeof getClientIp === 'function') return getClientIp(req);
  return String(req?.ip || req?.socket?.remoteAddress || '');
}

function buildInternalNoteRequestContext(req, getClientIp) {
  return {
    requestId: getRequestHeader(req, 'x-request-id') || getRequestHeader(req, 'x-correlation-id'),
    ip: getRequestIp(req, getClientIp),
    userAgent: getRequestHeader(req, 'user-agent')
  };
}

function isMissingInternalNotesSchemaError(err) {
  return err?.code === '42P01' || err?.code === '42703';
}

function presentInternalNoteCreateApi(note = {}) {
  const bodyLength = Number(note.bodyLength || 0);
  return {
    ok: true,
    schemaReady: true,
    note: {
      id: note.id != null ? String(note.id) : '',
      target_type: note.targetType || '',
      target_id: note.targetId || '',
      status: note.status || '',
      created_by: note.createdBy || '',
      created_at: note.createdAt ? String(note.createdAt) : '',
      body_length: Number.isFinite(bodyLength) ? bodyLength : 0
    }
  };
}

function presentInternalNoteCreateError(err) {
  if (isMissingInternalNotesSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'internal_notes_schema_not_ready',
        message: 'Internal notes schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  if (code === 'invalid_target_type' || code === 'target_id_required') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'invalid_internal_note_target',
        message: 'Internal note target is invalid.'
      }
    };
  }
  if (code === 'body_required') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'invalid_internal_note_body',
        message: 'Internal note body is required.'
      }
    };
  }
  if (code === 'body_too_long') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'invalid_internal_note_body',
        message: 'Internal note body is too long.'
      }
    };
  }
  if (code === 'created_by_required') {
    return {
      statusCode: 500,
      body: {
        ok: false,
        schemaReady: true,
        error: 'internal_note_actor_unresolved',
        message: 'Internal note actor could not be resolved.'
      }
    };
  }
  if (code === 'permission_denied') {
    return {
      statusCode: 403,
      body: {
        ok: false,
        schemaReady: true,
        error: 'permission_denied',
        message: 'Internal note write permission is required.'
      }
    };
  }
  if (code === 'database_url_required') {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: true,
        error: 'internal_notes_unavailable',
        message: 'Internal notes are unavailable.'
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'internal_note_create_failed',
      message: 'Internal note could not be created.'
    }
  };
}

function presentInternalNoteCreateTextError(err) {
  const response = presentInternalNoteCreateError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Internal note could not be created.'
  };
}

function presentProductWriteError(err) {
  if (isMissingProductWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_product_code: ['invalid_product_input', 'Product code is required.', 400],
    invalid_product_name: ['invalid_product_input', 'Product name is required.', 400],
    invalid_product_status: ['invalid_product_input', 'Product status is invalid.', 400],
    duplicate_product_code: ['duplicate_product_code', 'Product code already exists in this shop.', 409],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    product_not_found: ['product_not_found', 'Product was not found.', 404],
    permission_denied: ['permission_denied', 'Product write permission is required.', 403],
    database_url_required: ['product_write_unavailable', 'Product writes are unavailable.', 503],
    product_commit_failed: ['product_commit_failed', 'Product write could not be committed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'product_write_failed',
      message: 'Product write could not be completed.'
    }
  };
}

function presentProductWriteTextError(err) {
  const response = presentProductWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Product write could not be completed.'
  };
}

function presentProductImportApi(result = {}) {
  return {
    ok: true,
    schemaReady: true,
    ...presentImportSummary(result)
  };
}

function presentImportErrors(errors = []) {
  return (Array.isArray(errors) ? errors : []).slice(0, 100).map(error => {
    const field = String(error?.field || '').trim().slice(0, 80);
    const safeValue = typeof error?.value === 'string'
      ? safeProductImportSubmittedValue(field, error.value)
      : '';
    return {
      row: Number(error?.row || 0),
      field,
      code: String(error?.code || 'invalid_row').trim().slice(0, 120),
      message: String(error?.message || 'Row is invalid.').trim().slice(0, 180),
      value: safeValue || '',
      related_rows: Array.isArray(error?.related_rows)
        ? error.related_rows.map(row => Number(row || 0)).filter(row => Number.isInteger(row) && row > 0).slice(0, 10)
        : [],
      suggested_fix: String(error?.suggested_fix || 'Edit this cell and validate again.').trim().slice(0, 240)
    };
  });
}

function presentProductImportError(err) {
  if (isMissingProductImportSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  if (code === 'product_import_validation_failed') {
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'product_import_validation_failed',
        message: 'Product import validation failed.',
        rows_received: Number(err?.rows_received || 0),
        ignored_columns: Array.isArray(err?.ignored_columns)
          ? err.ignored_columns.map(column => String(column || '').trim().slice(0, 80)).filter(Boolean)
          : [],
        errors: presentImportErrors(err?.errors)
      }
    };
  }

  const safe = {
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    permission_denied: ['permission_denied', 'Product write permission is required.', 403],
    database_url_required: ['product_import_unavailable', 'Product imports are unavailable.', 503],
    product_import_commit_failed: ['product_import_commit_failed', 'Product import could not be committed.', 500],
    product_import_persist_failed: ['product_import_failed', 'Product import could not be completed.', 500],
    product_import_asset_persist_failed: ['product_import_failed', 'Product import could not be completed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'product_import_failed',
      message: 'Product import could not be completed.'
    }
  };
}

function presentProductImportTextError(err) {
  const response = presentProductImportError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Product import could not be completed.'
  };
}

function isProductImportValidateOnly(body = {}) {
  return /^(1|true|yes|on|validate_only)$/i.test(String(body?.validate_only ?? body?.validateOnly ?? '').trim());
}

function presentShopSettingsWriteError(err) {
  if (isMissingShopSettingsWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_bot_mode: ['invalid_bot_mode', 'Bot mode is invalid.', 400],
    setting_text_too_long: ['invalid_shop_settings_input', 'Shop settings text is too long.', 400],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    permission_denied: ['permission_denied', 'Shop settings write permission is required.', 403],
    database_url_required: ['shop_settings_write_unavailable', 'Shop settings writes are unavailable.', 503],
    settings_commit_failed: ['settings_commit_failed', 'Shop settings write could not be committed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'shop_settings_write_failed',
      message: 'Shop settings write could not be completed.'
    }
  };
}

function presentShopSettingsWriteTextError(err) {
  const response = presentShopSettingsWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Shop settings write could not be completed.'
  };
}

function presentShopWriteError(err) {
  if (isMissingShopWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_shop_id: ['invalid_shop_input', 'Shop id/slug is invalid.', 400],
    invalid_shop_name: ['invalid_shop_input', 'Display name is required.', 400],
    invalid_shop_status: ['invalid_shop_status', 'Shop status is invalid.', 400],
    invalid_shop_package: ['invalid_shop_package', 'Shop package is invalid.', 400],
    invalid_shop_lifecycle: ['invalid_shop_lifecycle', 'Shop lifecycle is invalid.', 400],
    invalid_shop_locale: ['invalid_shop_input', 'Shop locale is invalid.', 400],
    invalid_shop_timezone: ['invalid_shop_input', 'Shop timezone is invalid.', 400],
    invalid_bot_mode: ['invalid_bot_mode', 'Bot mode is invalid.', 400],
    duplicate_shop: ['duplicate_shop', 'Shop id/slug already exists.', 409],
    permission_denied: ['permission_denied', 'Shop write permission is required.', 403],
    database_url_required: ['shop_write_unavailable', 'Shop writes are unavailable.', 503],
    shop_create_commit_failed: ['shop_create_commit_failed', 'Shop create could not be committed.', 500],
    shop_persist_failed: ['shop_create_failed', 'Shop could not be created.', 500],
    shop_settings_persist_failed: ['shop_create_failed', 'Default shop settings could not be created.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'shop_write_failed',
      message: 'Shop write could not be completed.'
    }
  };
}

function presentShopWriteTextError(err) {
  const response = presentShopWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Shop write could not be completed.'
  };
}

function presentShopControlWriteError(err) {
  if (isMissingShopControlWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_shop_package: ['invalid_shop_package', 'Shop package is invalid.', 400],
    invalid_shop_lifecycle: ['invalid_shop_lifecycle', 'Shop lifecycle is invalid.', 400],
    invalid_manual_test_status: ['invalid_manual_test_status', 'Manual test status is invalid.', 400],
    live_confirmation_required: ['live_confirmation_required', 'Live enable requires explicit confirmation.', 400],
    pause_archive_confirmation_required: ['pause_archive_confirmation_required', 'Pause/archive requires explicit confirmation.', 400],
    pause_confirmation_required: ['pause_confirmation_required', 'Pause confirmation is required.', 400],
    resume_confirmation_required: ['resume_confirmation_required', 'Resume confirmation is required.', 400],
    dry_run_enable_confirmation_required: ['dry_run_enable_confirmation_required', 'Enable dry-run confirmation is required.', 400],
    dry_run_disable_confirmation_required: ['dry_run_disable_confirmation_required', 'Disable dry-run requires typing the exact confirmation text.', 400],
    dry_run_disable_readiness_required: ['dry_run_disable_readiness_required', 'Readiness check must be passed before disabling dry-run.', 409],
    dry_run_disable_shop_not_active: ['dry_run_disable_shop_not_active', 'Only active shops can disable dry-run mode.', 409],
    dry_run_disable_live_enabled: ['dry_run_disable_live_enabled', 'Dry-run cannot be disabled while live_enabled is true.', 409],
    readiness_blockers_present: ['readiness_blockers_present', 'Readiness hard blockers must pass before live enable.', 400],
    adult_shop_protected: ['adult_shop_protected', 'This shop is protected from emergency pause/resume.', 403],
    staging_only: ['staging_only', 'Shop emergency controls are available only in staging.', 403],
    shop_archived: ['shop_archived', 'Archived shops cannot be paused or resumed.', 409],
    shop_not_paused: ['shop_not_paused', 'Only paused shops can be resumed.', 409],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    permission_denied: ['permission_denied', 'Shop control write permission is required.', 403],
    database_url_required: ['shop_control_unavailable', 'Shop control writes are unavailable.', 503],
    shop_control_commit_failed: ['shop_control_commit_failed', 'Shop control changes could not be committed.', 500],
    shop_control_persist_failed: ['shop_control_failed', 'Shop control changes could not be saved.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1],
        ...(Array.isArray(err?.details?.blockers) ? { blockers: err.details.blockers } : {})
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'shop_control_write_failed',
      message: 'Shop control write could not be completed.'
    }
  };
}

function presentShopControlWriteTextError(err) {
  const response = presentShopControlWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Shop control write could not be completed.'
  };
}

function presentShopReadinessCheckError(err) {
  if (isMissingShopReadinessCheckSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    shop_archived: ['shop_archived', 'Archived shops cannot be readiness checked.', 409],
    permission_denied: ['permission_denied', 'Shop readiness check permission is required.', 403],
    database_url_required: ['shop_readiness_check_unavailable', 'Shop readiness checks are unavailable.', 503],
    invalid_readiness_status: ['invalid_readiness_status', 'Readiness status is invalid.', 500],
    readiness_check_commit_failed: ['readiness_check_commit_failed', 'Readiness check could not be committed.', 500],
    readiness_check_persist_failed: ['readiness_check_failed', 'Readiness check could not be saved.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'shop_readiness_check_failed',
      message: 'Shop readiness check could not be completed.'
    }
  };
}

function presentShopReadinessCheckTextError(err) {
  const response = presentShopReadinessCheckError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Shop readiness check could not be completed.'
  };
}

function presentPageMappingWriteError(err) {
  if (isMissingPageMappingWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_page_id: ['invalid_page_id', 'Page id is invalid.', 400],
    invalid_page_mapping_status: ['invalid_page_mapping_status', 'Page mapping status is invalid.', 400],
    page_id_not_accepted: ['page_id_not_accepted', 'Page id is not accepted for this action.', 400],
    archive_confirmation_required: ['archive_confirmation_required', 'Archive confirmation is required.', 400],
    duplicate_active_page_id: ['duplicate_active_page_id', 'Page id already has an active mapping.', 409],
    page_setup_preview_only: ['page_setup_preview_only', 'Demo-shop page setup is preview-only while configuring/non-live.', 409],
    staging_only: ['staging_only', 'Page mapping archive is available only in staging.', 403],
    adult_shop_protected: ['adult_shop_protected', 'This shop is protected from page mapping archive.', 403],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    page_mapping_not_found: ['page_mapping_not_found', 'Page mapping was not found for this shop.', 404],
    page_mapping_not_active: ['page_mapping_not_active', 'Page mapping is not active.', 409],
    permission_denied: ['permission_denied', 'Page mapping write permission is required.', 403],
    database_url_required: ['page_mapping_write_unavailable', 'Page mapping writes are unavailable.', 503],
    page_mapping_commit_failed: ['page_mapping_commit_failed', 'Page mapping write could not be committed.', 500],
    page_mapping_persist_failed: ['page_mapping_create_failed', 'Page mapping could not be created.', 500],
    page_mapping_archive_failed: ['page_mapping_archive_failed', 'Page mapping could not be archived.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'page_mapping_write_failed',
      message: 'Page mapping write could not be completed.'
    }
  };
}

function presentPageMappingWriteTextError(err) {
  const response = presentPageMappingWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Page mapping write could not be completed.'
  };
}

function presentPageCredentialWriteError(err) {
  if (isMissingPageCredentialWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    unsupported_credential_type: ['unsupported_credential_type', 'Credential type is not supported.', 400],
    credential_token_missing: ['credential_token_missing', 'Credential token is required.', 400],
    credential_token_invalid: ['credential_token_invalid', 'Credential token is invalid.', 400],
    credential_master_key_missing: ['credential_write_unavailable', 'Credential writes are unavailable.', 503],
    active_credential_exists: ['active_credential_exists', 'An active credential already exists. Use rotate mode to replace it.', 409],
    page_setup_preview_only: ['page_setup_preview_only', 'Demo-shop page setup is preview-only while configuring/non-live.', 409],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    page_mapping_not_found: ['page_mapping_not_found', 'Page mapping was not found for this shop.', 404],
    permission_denied: ['permission_denied', 'Page credential write permission is required.', 403],
    database_url_required: ['credential_write_unavailable', 'Credential writes are unavailable.', 503],
    page_credential_commit_failed: ['page_credential_commit_failed', 'Page credential write could not be committed.', 500],
    page_credential_persist_failed: ['page_credential_write_failed', 'Page credential could not be saved.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'page_credential_write_failed',
      message: 'Page credential write could not be completed.'
    }
  };
}

function presentPageCredentialWriteTextError(err) {
  const response = presentPageCredentialWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Page credential write could not be completed.'
  };
}

function presentPageSetupPreviewError(err) {
  if (isMissingPageSetupPreviewSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    page_id_required: ['page_id_required', 'Page id is required for preview.', 400],
    credential_token_not_accepted_in_preview: ['credential_token_not_accepted_in_preview', 'Credential token is not accepted in preview.', 400],
    setup_preview_not_allowed: ['setup_preview_not_allowed', 'Page setup preview is not available for this shop state.', 403],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    permission_denied: ['permission_denied', 'Page setup preview permission is required.', 403],
    database_url_required: ['page_setup_preview_unavailable', 'Page setup preview is unavailable.', 503]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'page_setup_preview_failed',
      message: 'Page setup preview could not be completed.'
    }
  };
}

function presentPageSetupPreviewTextError(err) {
  const response = presentPageSetupPreviewError(err);
  return {
    statusCode: response.statusCode,
    body: response.body
  };
}

function presentAssetWriteError(err) {
  if (isMissingAssetWriteSchemaError(err)) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schemaReady: false,
        error: 'multi_shop_schema_not_ready',
        message: 'Multi-shop schema is not ready.'
      }
    };
  }

  const code = String(err?.code || '');
  const safe = {
    invalid_asset_type: ['invalid_asset_input', 'Asset type is invalid.', 400],
    invalid_asset_status: ['invalid_asset_input', 'Asset status is invalid.', 400],
    public_url_required: ['invalid_public_url', 'Public URL is required.', 400],
    public_url_too_long: ['invalid_public_url', 'Public URL is too long.', 400],
    invalid_public_url: ['invalid_public_url', 'Public URL is invalid.', 400],
    product_id_required: ['product_id_required', 'Product image requires product_id.', 400],
    product_not_found: ['product_not_found', 'Product was not found for this shop.', 404],
    shop_not_found: ['shop_not_found', 'Shop was not found.', 404],
    asset_not_found: ['asset_not_found', 'Asset was not found.', 404],
    permission_denied: ['permission_denied', 'Asset write permission is required.', 403],
    database_url_required: ['asset_write_unavailable', 'Asset writes are unavailable.', 503],
    asset_commit_failed: ['asset_commit_failed', 'Asset write could not be committed.', 500]
  }[code];
  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  const fallbackStatusCode = Number(err?.statusCode || 0);
  return {
    statusCode: fallbackStatusCode >= 400 && fallbackStatusCode < 600 ? fallbackStatusCode : 500,
    body: {
      ok: false,
      schemaReady: true,
      error: 'asset_write_failed',
      message: 'Asset write could not be completed.'
    }
  };
}

function presentAssetWriteTextError(err) {
  const response = presentAssetWriteError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Asset write could not be completed.'
  };
}

function presentAssetUploadError(err) {
  if (isMissingAssetUploadSchemaError(err)) {
    return presentAssetWriteError(err);
  }

  const code = String(err?.code || '');
  const safe = {
    feature_disabled: ['feature_disabled', 'Image upload is disabled.', 404],
    feature_not_configured: ['feature_not_configured', 'Image upload storage is not configured.', 503],
    missing_file: ['missing_file', 'Image file is required.', 400],
    file_too_large: ['file_too_large', 'Image file is too large.', 413],
    invalid_file_field: ['invalid_file_input', 'Image file field is invalid.', 400],
    invalid_file_extension: ['invalid_file_input', 'Image extension is not allowed.', 400],
    invalid_file_type: ['invalid_file_input', 'Image MIME type is not allowed.', 400],
    invalid_file_signature: ['invalid_file_input', 'Image file signature is not allowed.', 400],
    file_type_mismatch: ['invalid_file_input', 'Image file type does not match its extension or MIME type.', 400],
    svg_not_allowed: ['invalid_file_input', 'SVG uploads are not allowed.', 400],
    product_code_not_supported: ['invalid_asset_input', 'Product code is not accepted for image upload.', 400],
    insecure_upload_url: ['upload_failed', 'Image upload could not be completed.', 502],
    cloudinary_upload_failed: ['upload_failed', 'Image upload could not be completed.', 502],
    upload_parse_failed: ['invalid_file_input', 'Image upload request is invalid.', 400],
    asset_upload_commit_failed: ['asset_commit_failed', 'Asset upload could not be committed.', 500],
    asset_persist_failed: ['asset_write_failed', 'Asset write could not be completed.', 500]
  }[code];

  if (safe) {
    return {
      statusCode: safe[2],
      body: {
        ok: false,
        schemaReady: true,
        error: safe[0],
        message: safe[1]
      }
    };
  }

  return presentAssetWriteError(err);
}

function presentAssetUploadTextError(err) {
  const response = presentAssetUploadError(err);
  return {
    statusCode: response.statusCode,
    text: response.body?.message || 'Image upload could not be completed.'
  };
}

function sanitizeBulkMenuImageErrors(errors = []) {
  return (Array.isArray(errors) ? errors : []).slice(0, 200).map(error => ({
    row: Number(error?.row || 0),
    field: String(error?.field || '').slice(0, 80),
    code: String(error?.code || 'invalid_row').slice(0, 80),
    message: String(error?.message || 'Invalid row.').slice(0, 240),
    ...(error?.suggested_fix ? { suggested_fix: String(error.suggested_fix).slice(0, 240) } : {})
  }));
}

function presentBulkMenuImageImportApi(model = {}) {
  return {
    ok: true,
    schemaReady: true,
    shop_id: model.shopId || '',
    asset_type: 'menu_image',
    rows_received: Number(model.rows_received || 0),
    assets_created: Number(model.assets_created || 0),
    errors_count: Number(model.errors_count || 0)
  };
}

function presentBulkMenuImageImportError(err) {
  if (err?.code === 'bulk_menu_image_validation_failed') {
    const errors = sanitizeBulkMenuImageErrors(err.errors);
    return {
      statusCode: 400,
      body: {
        ok: false,
        schemaReady: true,
        error: 'bulk_menu_image_validation_failed',
        message: 'Bulk menu image import validation failed.',
        rows_received: Number(err.rowsReceived || 0),
        errors_count: errors.length,
        errors
      }
    };
  }
  return presentAssetWriteError(err);
}

function registerAdminRoutes(app, {
  storage,
  adminExportToken,
  adminIpAllowlist = [],
  getClientIp,
  dashboardReader,
  internalNoteService,
  assetUploadService,
  assetWriteService,
  pageSetupPreviewService,
  pageCredentialWriteService,
  pageMappingWriteService,
  productImportService,
  productWriteService,
  shopControlWriteService,
  shopReadinessCheckService,
  shopSettingsWriteService,
  shopWriteService,
  shopDeleteWriteService,
  dashboardDatabaseUrl = process.env.DATABASE_URL,
  tenantId = process.env.TENANT_ID || 'default',
  pageId = process.env.PAGE_ID || '',
  adminPrincipalId = process.env.ADMIN_PRINCIPAL_ID || 'legacy-admin',
  adminPrincipalDisplayName = process.env.ADMIN_PRINCIPAL_DISPLAY_NAME || '',
  adminPrincipalRoles = parseAdminRoles(process.env.ADMIN_ROLES || 'owner'),
  adminPrincipalPermissions = [],
  adminSessionManager,
  adminSessionSecret = process.env.SESSION_SECRET || '',
  adminSessionCookieName = process.env.ADMIN_SESSION_COOKIE_NAME || 'chatbot_admin_session',
  adminPublicBaseUrl = process.env.ADMIN_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '',
  adminSessionTtlMs = parsePositiveInteger(process.env.ADMIN_SESSION_TTL_MS, 8 * 60 * 60 * 1000),
  adminLoginRateLimiter,
  adminLoginRateLimitWindowMs = parsePositiveInteger(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
  adminLoginRateLimitMax = parsePositiveInteger(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX, 10),
  auditLogger,
  adminAuditLogEnabled = process.env.ADMIN_AUDIT_LOG_ENABLED === 'true',
  adminAuditFailClosed = false,
  adminImageUploadEnabled = isAdminImageUploadEnabled(process.env.ADMIN_IMAGE_UPLOAD_ENABLED),
  adminPageArchiveEnabled = isStagingRuntime(process.env)
}) {
  const imageUploadEnabled = isAdminImageUploadEnabled(adminImageUploadEnabled);
  const reader = dashboardReader || createPostgresDashboardReader({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });
  const audit = auditLogger || createPostgresAuditLogger({
    enabled: adminAuditLogEnabled,
    databaseUrl: dashboardDatabaseUrl
  });
  const notes = internalNoteService || createPostgresInternalNoteService({
    databaseUrl: dashboardDatabaseUrl,
    tenantId,
    pageId
  });
  const assetWrites = assetWriteService || createPostgresAssetWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const assetUploads = assetUploadService || createPostgresAssetUploadService({
    enabled: imageUploadEnabled,
    databaseUrl: dashboardDatabaseUrl
  });
  const pageSetupPreviews = pageSetupPreviewService || createPostgresPageSetupPreviewService({
    databaseUrl: dashboardDatabaseUrl
  });
  const pageCredentialWrites = pageCredentialWriteService || createPostgresPageCredentialWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const pageMappingWrites = pageMappingWriteService || createPostgresPageMappingWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const productImports = productImportService || createPostgresProductImportService({
    databaseUrl: dashboardDatabaseUrl
  });
  const productWrites = productWriteService || createPostgresProductWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopControlWrites = shopControlWriteService || createPostgresShopControlWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopReadinessChecks = shopReadinessCheckService || createPostgresShopReadinessCheckService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopSettingsWrites = shopSettingsWriteService || createPostgresShopSettingsWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopWrites = shopWriteService || createPostgresShopWriteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const shopDeleteWrites = shopDeleteWriteService || createPostgresShopDeleteService({
    databaseUrl: dashboardDatabaseUrl
  });
  const sessionManager = adminSessionManager || createAdminSessionManager({
    sessionSecret: adminSessionSecret,
    cookieName: adminSessionCookieName,
    publicBaseUrl: adminPublicBaseUrl,
    nodeEnv: process.env.NODE_ENV || '',
    ttlMs: adminSessionTtlMs
  });
  const loginRateLimiter = adminLoginRateLimiter || createAdminLoginRateLimiter({
    windowMs: adminLoginRateLimitWindowMs,
    max: adminLoginRateLimitMax,
    getClientIp
  });
  const {
    authorizeAdminRequest,
    recordAdminAudit,
    requireAdminBearerToken,
    requireAdminToken
  } = createAdminRouteAuthorizer({
    adminExportToken,
    adminIpAllowlist,
    getClientIp,
    tenantId,
    pageId,
    adminPrincipalId,
    adminPrincipalDisplayName,
    adminPrincipalRoles,
    adminPrincipalPermissions,
    sessionManager,
    auditLogger: audit,
    adminAuditFailClosed
  });
  const {
    sendLoginForm,
    submitLogin,
    submitLogout
  } = createAdminSessionHandlers({
    sessionManager,
    adminExportToken,
    tenantId,
    pageId,
    adminPrincipalId,
    adminPrincipalDisplayName,
    adminPrincipalRoles,
    adminPrincipalPermissions,
    loginRateLimiter,
    recordAdminAudit
  });
  const {
    sendAuditLog,
    sendAuditLogApi,
    sendDashboard,
    sendDashboardApi,
    sendInternalNotesApi,
    sendShopDetail,
    sendShopDetailApi,
    sendShopHealthApi,
    sendShopSettingsApi,
    sendShops,
    sendShopsApi,
    sendUserDetail,
    sendUserDetailApi
  } = createAdminReadHandlers({
    reader,
    internalNoteService: notes,
    tenantId,
    pageId,
    adminImageUploadEnabled: imageUploadEnabled,
    adminPageArchiveEnabled,
    authorizeAdminRequest,
    recordAdminAudit
  });
  const {
    sendCustomersCsv,
    sendEventsJsonl,
    sendLegacyState
  } = createAdminLegacyHandlers({
    storage,
    authorizeAdminRequest,
    recordAdminAudit
  });

  async function createInternalNoteApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.INTERNAL_NOTE_WRITE,
      bearerOnly: true,
      action: INTERNAL_NOTE_ACTION,
      resourceType: INTERNAL_NOTE_RESOURCE_TYPE
    });
    if (!principal) return;

    const body = req.body || {};
    try {
      const note = await notes.createNote({
        principal,
        targetType: body.target_type,
        targetId: body.target_id,
        body: body.body,
        requestContext: buildInternalNoteRequestContext(req, getClientIp)
      });
      return res.status(201).json(presentInternalNoteCreateApi(note));
    } catch (err) {
      const response = presentInternalNoteCreateError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createInternalNoteHtml(req, res) {
    const senderId = String(req.params.senderId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.INTERNAL_NOTE_WRITE,
      bearerOnly: true,
      action: INTERNAL_NOTE_ACTION,
      resourceType: INTERNAL_NOTE_RESOURCE_TYPE,
      resourceId: senderId
    });
    if (!principal) return;

    const body = req.body || {};
    try {
      await notes.createNote({
        principal,
        targetType: body.target_type,
        targetId: senderId,
        body: body.body,
        allowedTargetTypes: ['customer', 'conversation'],
        requestContext: buildInternalNoteRequestContext(req, getClientIp)
      });
      return res.redirect(303, `/admin/dashboard/users/${encodeURIComponent(senderId)}`);
    } catch (err) {
      const response = presentInternalNoteCreateTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  function buildProductWriteRequestContext(req) {
    return buildInternalNoteRequestContext(req, getClientIp);
  }

  async function sendNewShopForm(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.create.form',
      resourceType: 'shop'
    });
    if (!principal) return;
    return res.type('html').send(renderShopCreateHtml());
  }

  async function createShopApi(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.create',
      resourceType: 'shop'
    });
    if (!principal) return;
    try {
      const result = await shopWrites.createShop({
        principal,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentShopWriteApi(result));
    } catch (err) {
      const response = presentShopWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createShopHtml(req, res) {
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.create',
      resourceType: 'shop'
    });
    if (!principal) return;
    try {
      const result = await shopWrites.createShop({
        principal,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, `/admin/shops/${encodeURIComponent(result.shopId)}`);
    } catch (err) {
      const response = presentShopWriteTextError(err);
      return res.status(response.statusCode).type('html').send(renderShopCreateHtml({
        values: req.body || {},
        error: response.text
      }));
    }
  }

  function shopControlRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?controlMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  async function checkShopReadinessApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'shop.readiness.checked',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopReadinessChecks.checkReadiness({
        principal,
        shopId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopReadinessCheckApi(result));
    } catch (err) {
      const response = presentShopReadinessCheckError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function checkShopReadinessHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'shop.readiness.checked',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopReadinessChecks.checkReadiness({
        principal,
        shopId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopControlRedirect(shopId, 'readiness-checked'));
    } catch (err) {
      const response = presentShopReadinessCheckTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function updateShopControlApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'shop.control_plane.updated',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopControlWrites.updateControlPlane({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopControlWriteApi(result));
    } catch (err) {
      const response = presentShopControlWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateShopControlHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'shop.control_plane.updated',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopControlWrites.updateControlPlane({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopControlRedirect(shopId, 'updated'));
    } catch (err) {
      const response = presentShopControlWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function pauseShopApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.pause',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopControlWrites.pauseShop({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopControlWriteApi(result));
    } catch (err) {
      const response = presentShopControlWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function resumeShopApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.resume',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopControlWrites.resumeShop({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopControlWriteApi(result));
    } catch (err) {
      const response = presentShopControlWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function pauseShopHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.pause',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopControlWrites.pauseShop({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopControlRedirect(shopId, 'paused'));
    } catch (err) {
      const response = presentShopControlWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function resumeShopHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.resume',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopControlWrites.resumeShop({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopControlRedirect(shopId, 'resumed'));
    } catch (err) {
      const response = presentShopControlWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function enableShopDryRunApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: SHOP_DRY_RUN_ENABLE_ACTION,
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopControlWrites.enableDryRun({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopControlWriteApi(result));
    } catch (err) {
      const response = presentShopControlWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function disableShopDryRunApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: SHOP_DRY_RUN_DISABLE_ACTION,
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopControlWrites.disableDryRun({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopControlWriteApi(result));
    } catch (err) {
      const response = presentShopControlWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function enableShopDryRunHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: SHOP_DRY_RUN_ENABLE_ACTION,
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopControlWrites.enableDryRun({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopControlRedirect(shopId, 'dry-run-enabled'));
    } catch (err) {
      const response = presentShopControlWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function disableShopDryRunHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: SHOP_DRY_RUN_DISABLE_ACTION,
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopControlWrites.disableDryRun({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopControlRedirect(shopId, 'dry-run-disabled'));
    } catch (err) {
      const response = presentShopControlWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function deleteDraftShopHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop.delete_draft',
      resourceType: 'shop',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const result = await shopDeleteWrites.deleteDraftShop({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Xóa cửa hàng thành công</title>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h1 { font-size: 20px; color: #1e3a8a; margin: 0 0 12px; }
            p { font-size: 14px; color: #64748b; line-height: 1.5; margin: 0 0 24px; }
            .btn { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; transition: background 0.2s; }
            .btn:hover { background: #1d4ed8; }
          </style>
          <meta http-equiv="refresh" content="3;url=/admin/shops">
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>Xóa cửa hàng thành công</h1>
            <p>Cửa hàng <strong>${result.slug}</strong> đã được xóa hoàn toàn và vĩnh viễn khỏi hệ thống.</p>
            <p style="font-size: 12px; color: #94a3b8;">Đang tự động chuyển hướng về danh sách cửa hàng sau 3 giây...</p>
            <a href="/admin/shops" class="btn">Quay lại danh sách cửa hàng</a>
          </div>
        </body>
        </html>
      `;
      return res.status(200).type('html').send(html);
    } catch (err) {
      if (err.code === 'shop_deletion_blocked') {
        const reasonsLi = (err.details?.reasons || []).map(r => `<li>${r}</li>`).join('');
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Thao tác bị chặn</title>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff5f5; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
              .card { background: white; border: 1px solid #fee2e2; border-radius: 12px; padding: 32px; max-width: 580px; width: 100%; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
              .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; border-bottom: 1px solid #fee2e2; padding-bottom: 16px; }
              .icon { font-size: 32px; }
              h1 { font-size: 20px; color: #991b1b; margin: 0; }
              p { font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 16px; }
              ul { margin: 0 0 24px; padding-left: 20px; font-size: 14px; color: #b91c1c; line-height: 1.6; }
              li { margin-bottom: 8px; }
              .actions { display: flex; gap: 12px; }
              .btn { display: inline-block; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; text-align: center; }
              .btn-primary { background: #dc2626; color: white; }
              .btn-primary:hover { background: #b91c1c; }
              .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
              .btn-secondary:hover { background: #e5e7eb; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="header">
                <span class="icon">🛑</span>
                <h1>Thao tác bị chặn</h1>
              </div>
              <p>Yêu cầu xóa cửa hàng nháp đã bị hệ thống chặn vì lý do an toàn tuyệt đối. Cửa hàng không đủ điều kiện để thực hiện thao tác xóa cứng do phát hiện các lỗi sau:</p>
              <ul>
                ${reasonsLi}
              </ul>
              <p><strong>Khuyến nghị:</strong> Đối với các cửa hàng đã từng phát sinh dữ liệu, đã kết nối Fanpage hoặc cấu hình Page Token, bạn <strong>chỉ có thể Lưu trữ (Archive)</strong> cửa hàng này để ngắt kết nối an toàn, không thể xóa vĩnh viễn.</p>
              <div class="actions">
                <a href="/admin/shops/${encodeURIComponent(shopId)}" class="btn btn-secondary">Quay lại chi tiết cửa hàng</a>
                <a href="/admin/shops" class="btn btn-secondary">Quay lại danh sách</a>
              </div>
            </div>
          </body>
          </html>
        `;
        return res.status(409).type('html').send(html);
      }

      const response = presentShopControlWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  function shopProductRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?productMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  function shopPageMappingRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?pageMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  function shopPageCredentialRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?credentialMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  function pageSetupPreviewAuditMetadata(result = {}, credentialType = '') {
    return {
      shop_ref: result.shop_ref || '',
      page_ref: result.page_ref || '',
      credential_type: credentialType || result.credential_type || '',
      validate_only: true,
      token_accepted: false,
      health_check: false,
      messenger_send: false
    };
  }

  async function recordPageSetupPreviewAudit(req, { principal, action, result, credentialType = '' } = {}) {
    await recordAdminAudit(req, {
      principal,
      action,
      resourceType: 'shop_page_setup_preview',
      resourceId: result?.shop_ref || '',
      outcome: 'success',
      metadata: pageSetupPreviewAuditMetadata(result || {}, credentialType),
      includeAuthMethod: false
    });
  }

  async function previewPageMappingApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_MAPPING,
      resourceType: 'shop_page_setup_preview',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await pageSetupPreviews.previewPageMapping({
        principal,
        shopId,
        body: req.body || {}
      });
      await recordPageSetupPreviewAudit(req, {
        principal,
        action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_MAPPING,
        result
      });
      return res.json(presentPageMappingPreviewApi(result));
    } catch (err) {
      const response = presentPageSetupPreviewError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function previewPageMappingHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_MAPPING,
      resourceType: 'shop_page_setup_preview',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await pageSetupPreviews.previewPageMapping({
        principal,
        shopId,
        body: req.body || {}
      });
      await recordPageSetupPreviewAudit(req, {
        principal,
        action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_MAPPING,
        result
      });
      return res.type('html').send(renderPageSetupPreviewResultHtml({
        shopId,
        title: 'Page Mapping Preview',
        result: presentPageMappingPreviewApi(result)
      }));
    } catch (err) {
      const response = presentPageSetupPreviewTextError(err);
      return res.status(response.statusCode).type('html').send(renderPageSetupPreviewResultHtml({
        shopId,
        title: 'Page Mapping Preview',
        error: response.body
      }));
    }
  }

  async function previewPageCredentialApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_CREDENTIAL,
      resourceType: 'shop_page_setup_preview',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await pageSetupPreviews.previewCredentialPrerequisites({
        principal,
        shopId,
        body: req.body || {}
      });
      await recordPageSetupPreviewAudit(req, {
        principal,
        action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_CREDENTIAL,
        result,
        credentialType: result.credential_type
      });
      return res.json(presentPageCredentialPreviewApi(result));
    } catch (err) {
      const response = presentPageSetupPreviewError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function previewPageCredentialHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_CREDENTIAL,
      resourceType: 'shop_page_setup_preview',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await pageSetupPreviews.previewCredentialPrerequisites({
        principal,
        shopId,
        body: req.body || {}
      });
      await recordPageSetupPreviewAudit(req, {
        principal,
        action: PAGE_SETUP_PREVIEW_ACTIONS.PAGE_CREDENTIAL,
        result,
        credentialType: result.credential_type
      });
      return res.type('html').send(renderPageSetupPreviewResultHtml({
        shopId,
        title: 'Credential Prerequisites Preview',
        result: presentPageCredentialPreviewApi(result)
      }));
    } catch (err) {
      const response = presentPageSetupPreviewTextError(err);
      return res.status(response.statusCode).type('html').send(renderPageSetupPreviewResultHtml({
        shopId,
        title: 'Credential Prerequisites Preview',
        error: response.body
      }));
    }
  }

  async function createPageMappingApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_page.create',
      resourceType: 'shop_page',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await pageMappingWrites.createPageMapping({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentPageMappingWriteApi(result));
    } catch (err) {
      const response = presentPageMappingWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createPageMappingHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_page.create',
      resourceType: 'shop_page',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await pageMappingWrites.createPageMapping({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopPageMappingRedirect(shopId, 'created'));
    } catch (err) {
      const response = presentPageMappingWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function archivePageMappingApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const pageMappingId = String(req.params.pageMappingId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_page.archive',
      resourceType: 'shop_page',
      resourceId: pageMappingId
    });
    if (!principal) return;
    try {
      const result = await pageMappingWrites.archivePageMapping({
        principal,
        shopId,
        pageMappingId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentPageMappingArchiveApi(result));
    } catch (err) {
      const response = presentPageMappingWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function archivePageMappingHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const pageMappingId = String(req.params.pageMappingId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_page.archive',
      resourceType: 'shop_page',
      resourceId: pageMappingId
    });
    if (!principal) return;
    try {
      const result = await pageMappingWrites.archivePageMapping({
        principal,
        shopId,
        pageMappingId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopPageMappingRedirect(shopId, result.already_archived ? 'already-archived' : 'archived'));
    } catch (err) {
      const response = presentPageMappingWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function createPageCredentialApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const pageMappingId = String(req.params.pageMappingId || '').trim().slice(0, 160);
    const action = isRotateCredentialRequest(req.body || {})
      ? 'admin.shop_page_credential.rotate'
      : 'admin.shop_page_credential.create';
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action,
      resourceType: 'shop_page_credential',
      resourceId: pageMappingId
    });
    if (!principal) return;
    try {
      const result = await pageCredentialWrites.createPageCredential({
        principal,
        shopId,
        pageMappingId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentPageCredentialWriteApi(result));
    } catch (err) {
      const response = presentPageCredentialWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createPageCredentialHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const pageMappingId = String(req.params.pageMappingId || '').trim().slice(0, 160);
    const action = isRotateCredentialRequest(req.body || {})
      ? 'admin.shop_page_credential.rotate'
      : 'admin.shop_page_credential.create';
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action,
      resourceType: 'shop_page_credential',
      resourceId: pageMappingId
    });
    if (!principal) return;
    try {
      const result = await pageCredentialWrites.createPageCredential({
        principal,
        shopId,
        pageMappingId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopPageCredentialRedirect(shopId, result.rotated ? 'rotated' : 'created'));
    } catch (err) {
      const response = presentPageCredentialWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function createProductApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.create',
      resourceType: 'shop_product',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await productWrites.createProduct({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function importProductsApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.import',
      resourceType: 'shop_product',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await productImports.importProducts({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductImportApi(result));
    } catch (err) {
      const response = presentProductImportError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateProductApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.update',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const result = await productWrites.updateProduct({
        principal,
        shopId,
        productId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function setProductStatusApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.status',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const body = req.body || {};
      const enabled = Object.prototype.hasOwnProperty.call(body, 'enabled')
        ? /^(1|true|yes|on|active|enabled)$/i.test(String(body.enabled || '').trim())
        : /^(active|enable|enabled)$/i.test(String(body.status || '').trim());
      const result = await productWrites.setProductEnabled({
        principal,
        shopId,
        productId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function archiveProductApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.archive',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const result = await productWrites.archiveProduct({
        principal,
        shopId,
        productId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentProductWriteApi(result));
    } catch (err) {
      const response = presentProductWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateShopSettingsApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_settings.update',
      resourceType: 'shop_settings',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await shopSettingsWrites.updateSettings({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentShopSettingsWriteApi(result));
    } catch (err) {
      const response = presentShopSettingsWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createAssetApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.create',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.createAsset({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createAssetUploadApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.upload',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;

    try {
      const featureError = getAssetUploadFeatureError();
      if (featureError) throw featureError;
      await parseAssetUploadRequest(req, res, assetUploads);
      const result = await assetUploads.createUploadedAsset({
        principal,
        shopId,
        body: req.body || {},
        file: getUploadedImageFile(req),
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetUploadError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function updateAssetApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.update',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.updateAsset({
        principal,
        shopId,
        assetId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function setAssetStatusApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.status',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const body = req.body || {};
      const enabled = Object.prototype.hasOwnProperty.call(body, 'enabled')
        ? /^(1|true|yes|on|active|enabled)$/i.test(String(body.enabled || '').trim())
        : /^(active|enable|enabled)$/i.test(String(body.status || '').trim());
      const result = await assetWrites.setAssetEnabled({
        principal,
        shopId,
        assetId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function archiveAssetApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.archive',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.archiveAsset({
        principal,
        shopId,
        assetId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.json(presentAssetWriteApi(result));
    } catch (err) {
      const response = presentAssetWriteError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function createProductHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.create',
      resourceType: 'shop_product',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await productWrites.createProduct({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'created'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function importMenuImagesApi(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.bulk_menu_import',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await assetWrites.importMenuImages({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.status(201).json(presentBulkMenuImageImportApi(result));
    } catch (err) {
      const response = presentBulkMenuImageImportError(err);
      return res.status(response.statusCode).json(response.body);
    }
  }

  async function importProductsHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.import',
      resourceType: 'shop_product',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const result = await productImports.importProducts({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      if (isProductImportValidateOnly(req.body || {})) {
        return res.status(200).type('html').send(renderProductImportResultHtml({
          shopId,
          result: presentProductImportApi(result)
        }));
      }
      return res.redirect(303, shopProductRedirect(shopId, 'imported'));
    } catch (err) {
      const response = presentProductImportError(err);
      return res.status(response.statusCode).type('html').send(renderProductImportResultHtml({
        shopId,
        error: response.body
      }));
    }
  }

  async function updateProductHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.update',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      await productWrites.updateProduct({
        principal,
        shopId,
        productId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'updated'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function setProductStatusHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.status',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      const enabled = /^(1|true|yes|on|active|enabled)$/i.test(String(req.body?.enabled || '').trim());
      await productWrites.setProductEnabled({
        principal,
        shopId,
        productId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, enabled ? 'enabled' : 'disabled'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function archiveProductHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const productId = String(req.params.productId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.product.archive',
      resourceType: 'shop_product',
      resourceId: productId
    });
    if (!principal) return;
    try {
      await productWrites.archiveProduct({
        principal,
        shopId,
        productId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'archived'));
    } catch (err) {
      const response = presentProductWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  function shopAssetRedirect(shopId = '', message = '') {
    const base = `/admin/shops/${encodeURIComponent(shopId)}`;
    const safeMessage = String(message || '').trim();
    return safeMessage ? `${base}?assetMessage=${encodeURIComponent(safeMessage)}` : base;
  }

  function getAssetUploadFeatureError() {
    if (typeof assetUploads.isEnabled === 'function' && !assetUploads.isEnabled()) {
      const err = new Error('Image upload is disabled.');
      err.code = 'feature_disabled';
      err.statusCode = 404;
      return err;
    }
    if (typeof assetUploads.getCloudinaryConfig === 'function') {
      const config = assetUploads.getCloudinaryConfig();
      if (config && config.ok === false) {
        const err = new Error('Image upload storage is not configured.');
        err.code = 'feature_not_configured';
        err.statusCode = 503;
        return err;
      }
    }
    return null;
  }

  async function importMenuImagesHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.bulk_menu_import',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await assetWrites.importMenuImages({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'menu-imported'));
    } catch (err) {
      const response = presentBulkMenuImageImportError(err);
      return res.status(response.statusCode).type('html').send(renderBulkMenuImageImportResultHtml({
        shopId,
        error: response.body
      }));
    }
  }

  async function createAssetHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.create',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await assetWrites.createAsset({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'created'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function createAssetUploadHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.upload',
      resourceType: 'shop_asset',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      const featureError = getAssetUploadFeatureError();
      if (featureError) throw featureError;
      await parseAssetUploadRequest(req, res, assetUploads);
      await assetUploads.createUploadedAsset({
        principal,
        shopId,
        body: req.body || {},
        file: getUploadedImageFile(req),
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'uploaded'));
    } catch (err) {
      const response = presentAssetUploadTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function updateAssetHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.update',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      await assetWrites.updateAsset({
        principal,
        shopId,
        assetId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'updated'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function setAssetStatusHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.status',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      const enabled = /^(1|true|yes|on|active|enabled)$/i.test(String(req.body?.enabled || '').trim());
      await assetWrites.setAssetEnabled({
        principal,
        shopId,
        assetId,
        enabled,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, enabled ? 'enabled' : 'disabled'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function archiveAssetHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const assetId = String(req.params.assetId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_asset.archive',
      resourceType: 'shop_asset',
      resourceId: assetId
    });
    if (!principal) return;
    try {
      await assetWrites.archiveAsset({
        principal,
        shopId,
        assetId,
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopAssetRedirect(shopId, 'archived'));
    } catch (err) {
      const response = presentAssetWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  async function updateShopSettingsHtml(req, res) {
    const shopId = String(req.params.shopId || '').trim().slice(0, 160);
    const principal = await authorizeAdminRequest(req, res, {
      permission: PERMISSIONS.PRODUCT_WRITE,
      bearerOnly: true,
      action: 'admin.shop_settings.update',
      resourceType: 'shop_settings',
      resourceId: shopId
    });
    if (!principal) return;
    try {
      await shopSettingsWrites.updateSettings({
        principal,
        shopId,
        body: req.body || {},
        requestContext: buildProductWriteRequestContext(req)
      });
      return res.redirect(303, shopProductRedirect(shopId, 'settings-updated'));
    } catch (err) {
      const response = presentShopSettingsWriteTextError(err);
      return res.status(response.statusCode).type('text').send(response.text);
    }
  }

  if (typeof app.use === 'function') {
    app.use('/admin', setAdminNoStoreHeaders);
  }

  app.get('/admin/login', sendLoginForm);
  app.post('/admin/login', submitLogin);
  app.post('/admin/logout', submitLogout);
  app.get('/admin/api/dashboard', sendDashboardApi);
  app.get('/admin/api/dashboard/users/:senderId', sendUserDetailApi);
  app.get('/admin/api/shops', sendShopsApi);
  app.post('/admin/api/shops', createShopApi);
  app.get('/admin/api/shops/:shopId', sendShopDetailApi);
  app.get('/admin/api/shops/:shopId/health', sendShopHealthApi);
  app.get('/admin/api/shops/:shopId/settings', sendShopSettingsApi);
  app.post('/admin/api/shops/:shopId/readiness-check', checkShopReadinessApi);
  app.post('/admin/api/shops/:shopId/pause', pauseShopApi);
  app.post('/admin/api/shops/:shopId/resume', resumeShopApi);
  app.post('/admin/api/shops/:shopId/dry-run/enable', enableShopDryRunApi);
  app.post('/admin/api/shops/:shopId/dry-run/disable', disableShopDryRunApi);
  app.post('/admin/api/shops/:shopId/control-plane', updateShopControlApi);
  app.post('/admin/api/shops/:shopId/pages/preview', previewPageMappingApi);
  app.post('/admin/api/shops/:shopId/page-credentials/preview', previewPageCredentialApi);
  app.post('/admin/api/shops/:shopId/pages', createPageMappingApi);
  app.post('/admin/api/shops/:shopId/pages/:pageMappingId/archive', archivePageMappingApi);
  app.post('/admin/api/shops/:shopId/pages/:pageMappingId/credentials', createPageCredentialApi);
  app.post('/admin/api/shops/:shopId/products', createProductApi);
  app.post('/admin/api/shops/:shopId/products/import', importProductsApi);
  app.post('/admin/api/shops/:shopId/assets', createAssetApi);
  app.post('/admin/api/shops/:shopId/assets/uploads', createAssetUploadApi);
  app.post('/admin/api/shops/:shopId/assets/menu-images/import', importMenuImagesApi);
  app.post('/admin/api/shops/:shopId/settings', updateShopSettingsApi);
  if (typeof app.patch === 'function') {
    app.patch('/admin/api/shops/:shopId/control-plane', updateShopControlApi);
    app.patch('/admin/api/shops/:shopId/settings', updateShopSettingsApi);
    app.patch('/admin/api/shops/:shopId/products/:productId', updateProductApi);
    app.patch('/admin/api/shops/:shopId/products/:productId/status', setProductStatusApi);
    app.patch('/admin/api/shops/:shopId/assets/:assetId', updateAssetApi);
    app.patch('/admin/api/shops/:shopId/assets/:assetId/status', setAssetStatusApi);
  }
  app.post('/admin/api/shops/:shopId/products/:productId/status', setProductStatusApi);
  app.post('/admin/api/shops/:shopId/assets/:assetId/status', setAssetStatusApi);
  if (typeof app.delete === 'function') {
    app.delete('/admin/api/shops/:shopId/products/:productId', archiveProductApi);
    app.delete('/admin/api/shops/:shopId/assets/:assetId', archiveAssetApi);
  }
  app.get('/admin/api/audit', sendAuditLogApi);
  app.get('/admin/api/internal-notes', sendInternalNotesApi);
  app.post('/admin/api/internal-notes', createInternalNoteApi);
  app.get('/admin/dashboard', sendDashboard);
  app.get('/admin/db', sendDashboard);
  app.get('/admin/dashboard/users/:senderId', sendUserDetail);
  app.get('/admin/shops', sendShops);
  app.get('/admin/shops/new', sendNewShopForm);
  app.post('/admin/shops', createShopHtml);
  app.get('/admin/shops/:shopId', sendShopDetail);
  app.post('/admin/shops/:shopId/readiness-check', checkShopReadinessHtml);
  app.post('/admin/shops/:shopId/pause', pauseShopHtml);
  app.post('/admin/shops/:shopId/resume', resumeShopHtml);
  app.post('/admin/shops/:shopId/dry-run/enable', enableShopDryRunHtml);
  app.post('/admin/shops/:shopId/dry-run/disable', disableShopDryRunHtml);
  app.post('/admin/shops/:shopId/delete-draft', deleteDraftShopHtml);
  app.post('/admin/shops/:shopId/control-plane', updateShopControlHtml);
  app.post('/admin/shops/:shopId/pages/preview', previewPageMappingHtml);
  app.post('/admin/shops/:shopId/page-credentials/preview', previewPageCredentialHtml);
  app.post('/admin/shops/:shopId/pages', createPageMappingHtml);
  app.post('/admin/shops/:shopId/pages/:pageMappingId/archive', archivePageMappingHtml);
  app.post('/admin/shops/:shopId/pages/:pageMappingId/credentials', createPageCredentialHtml);
  app.post('/admin/shops/:shopId/settings', updateShopSettingsHtml);
  app.post('/admin/shops/:shopId/products', createProductHtml);
  app.post('/admin/shops/:shopId/products/import', importProductsHtml);
  app.post('/admin/shops/:shopId/products/:productId', updateProductHtml);
  app.post('/admin/shops/:shopId/products/:productId/status', setProductStatusHtml);
  app.post('/admin/shops/:shopId/products/:productId/archive', archiveProductHtml);
  app.post('/admin/shops/:shopId/assets', createAssetHtml);
  app.post('/admin/shops/:shopId/assets/uploads', createAssetUploadHtml);
  app.post('/admin/shops/:shopId/assets/menu-images/import', importMenuImagesHtml);
  app.post('/admin/shops/:shopId/assets/:assetId', updateAssetHtml);
  app.post('/admin/shops/:shopId/assets/:assetId/status', setAssetStatusHtml);
  app.post('/admin/shops/:shopId/assets/:assetId/archive', archiveAssetHtml);
  app.post('/admin/dashboard/users/:senderId/notes', createInternalNoteHtml);
  app.get('/admin/db/users/:senderId', sendUserDetail);
  app.get('/admin/audit', sendAuditLog);
  app.get('/admin/customers.csv', sendCustomersCsv);
  app.get('/admin/events.jsonl', sendEventsJsonl);
  app.get('/admin/state/:userId', sendLegacyState);

  return {
    authorizeAdminRequest,
    sessionManager,
    requireAdminToken,
    requireAdminBearerToken
  };
}

module.exports = {
  assertReadOnlySql,
  createAdminLegacyHandlers,
  createAdminLoginRateLimiter,
  createAdminReadHandlers,
  createPostgresAuditLogger,
  createPostgresAssetUploadService,
  createPostgresAssetWriteService,
  createPostgresDashboardReader,
  createPostgresPageCredentialWriteService,
  createPostgresPageMappingWriteService,
  createPostgresPageSetupPreviewService,
  createPostgresProductImportService,
  createPostgresProductWriteService,
  createPostgresShopControlWriteService,
  createPostgresShopReadinessCheckService,
  createPostgresShopSettingsWriteService,
  createPostgresShopWriteService,
  createAdminRouteAuthorizer,
  createAdminSessionHandlers,
  createAdminSessionManager,
  getAdminBearerToken,
  getAdminRequestToken,
  maskAddress,
  maskPhone,
  parseAdminRoles,
  registerAdminRoutes,
  setAdminNoStoreHeaders
};

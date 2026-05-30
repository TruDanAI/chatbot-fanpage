const {
  PERMISSIONS,
  buildAuditLogEntry,
  hasPermission
} = require('../admin-auth');
const { insertAuditLogEntry } = require('./audit');
const { isProductionRuntime } = require('../storage-config');

const SHOP_DELETE_ACTIONS = Object.freeze({
  DELETE: 'admin.shop.delete'
});

const PROTECTED_SLUGS = Object.freeze(new Set(['adult-shop', 'demo-shop', 'nem-bui-xa']));
const EXPECTED_CONFIRMATION = 'DELETE DRAFT';

function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL shop delete admin.');
  }
}

function normalizeText(value = '', max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function createShopDeleteError(code, message, statusCode = 400, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

function isProtectedSlug(slug = '') {
  const clean = normalizeText(slug, 80).toLowerCase();
  if (PROTECTED_SLUGS.has(clean)) return true;
  if (clean.includes('prod') || clean.includes('production')) return true;
  return false;
}

function assertDeleteDraftShopRuntime(env = process.env) {
  if (isProductionRuntime(env)) {
    throw createShopDeleteError(
      'staging_only',
      'Shop deletion is allowed only in staging or local environments.',
      403
    );
  }
}

function createPostgresShopDeleteService({
  databaseUrl = process.env.DATABASE_URL,
  Client,
  env = process.env
} = {}) {
  async function withTransaction(fn) {
    if (!databaseUrl) {
      throw createShopDeleteError(
        'database_url_required',
        'DATABASE_URL is required for shop delete.',
        503
      );
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
        throw createShopDeleteError(
          'shop_delete_commit_failed',
          'Shop delete transaction could not be committed.',
          500
        );
      }
      if (String(commitResult?.command || '').toUpperCase() !== 'COMMIT') {
        throw createShopDeleteError(
          'shop_delete_commit_failed',
          'Shop delete transaction could not be committed.',
          500
        );
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
      throw createShopDeleteError(
        'permission_denied',
        'Shop write permission is required for deletion.',
        403
      );
    }
  }

  async function deleteDraftShop({ principal, shopId, body = {}, requestContext = {} } = {}) {
    assertWritePermission(principal);
    assertDeleteDraftShopRuntime(env);

    const inputConfirmation = normalizeText(
      body.confirmation_text ?? body.confirmationText ?? body.confirmation ?? ''
    ).toUpperCase();
    const inputSlug = normalizeText(body.shop_slug ?? body.shopSlug ?? body.slug ?? '').toLowerCase();

    if (inputConfirmation !== EXPECTED_CONFIRMATION) {
      throw createShopDeleteError(
        'confirmation_required',
        `Deletion requires typing the exact text "${EXPECTED_CONFIRMATION}".`,
        400
      );
    }

    return withTransaction(async client => {
      // 1. Resolve existing shop
      const normalizedShopId = normalizeText(shopId, 160);
      if (!normalizedShopId) {
        throw createShopDeleteError('shop_not_found', 'Shop was not found.', 404);
      }

      const shopResult = await client.query(`
        SELECT id, slug, name, status, package, lifecycle, dry_run, live_enabled
        FROM shops
        WHERE id = $1 OR slug = $1
        LIMIT 1
      `, [normalizedShopId]);

      const shop = shopResult.rows[0] || null;
      if (!shop) {
        throw createShopDeleteError('shop_not_found', 'Shop was not found.', 404);
      }

      const actualSlug = String(shop.slug || '').trim().toLowerCase();

      // 2. Validate exact slug confirmation matches the retrieved shop
      if (inputSlug !== actualSlug) {
        throw createShopDeleteError(
          'slug_mismatch',
          `Input slug "${inputSlug}" does not match shop slug "${actualSlug}".`,
          400
        );
      }

      const reasons = [];

      // 3. Check protected slugs
      if (isProtectedSlug(shop.slug) || isProtectedSlug(shop.id)) {
        reasons.push('Shop này nằm trong danh sách bảo vệ hệ thống (chứa từ khóa nhạy cảm hoặc được bảo vệ).');
      }

      // 4. Check lifecycle is draft or configuring
      const lifecycle = String(shop.lifecycle || '').toLowerCase();
      if (lifecycle !== 'draft' && lifecycle !== 'configuring') {
        reasons.push(`Chỉ có thể xóa shop đang ở trạng thái thiết lập (draft hoặc configuring). Hiện tại: ${lifecycle}.`);
      }

      // 5. Check live_enabled=false
      if (shop.live_enabled === true) {
        reasons.push('Shop đang ở trạng thái hoạt động (live_enabled hoặc lifecycle=live).');
      }

      // 6. Check dry_run=true
      if (shop.dry_run !== true) {
        reasons.push('Shop có chế độ test an toàn (dry_run) đang tắt.');
      }

      // 7. Check for any page mappings (even archived/paused)
      const pageMappingResult = await client.query(`
        SELECT count(*)::int AS count FROM shop_pages WHERE shop_id = $1
      `, [shop.id]);
      if (pageMappingResult.rows[0].count > 0) {
        reasons.push('Shop đã kết nối với Fanpage. Vui lòng gỡ liên kết trang trước.');
      }

      // 8. Check for any page credentials
      const credentialResult = await client.query(`
        SELECT count(*)::int AS count FROM shop_page_credentials WHERE shop_id = $1
      `, [shop.id]);
      if (credentialResult.rows[0].count > 0) {
        reasons.push('Shop đã có cấu hình Quyền gửi tin (Facebook Page Token).');
      }

      // 9. Check runtime data records mapped to this shop (tenant_id = shop.id)
      const ordersResult = await client.query(`
        SELECT count(*)::int AS count FROM orders WHERE tenant_id = $1
      `, [shop.id]);
      if (ordersResult.rows[0].count > 0) {
        reasons.push('Shop có dữ liệu đơn hàng (orders) trong hệ thống.');
      }

      const messagesResult = await client.query(`
        SELECT count(*)::int AS count FROM messages WHERE tenant_id = $1
      `, [shop.id]);
      if (messagesResult.rows[0].count > 0) {
        reasons.push('Shop có lịch sử tin nhắn (messages) trong hệ thống.');
      }

      const conversationsResult = await client.query(`
        SELECT count(*)::int AS count FROM conversations WHERE tenant_id = $1
      `, [shop.id]);
      if (conversationsResult.rows[0].count > 0) {
        reasons.push('Shop có dữ liệu hội thoại (conversations) trong hệ thống.');
      }

      const eventsResult = await client.query(`
        SELECT count(*)::int AS count FROM events WHERE tenant_id = $1
      `, [shop.id]);
      if (eventsResult.rows[0].count > 0) {
        reasons.push('Shop có lịch sử sự kiện (events) trong hệ thống.');
      }

      const queueResult = await client.query(`
        SELECT count(*)::int AS count FROM webhook_queue WHERE tenant_id = $1
      `, [shop.id]);
      if (queueResult.rows[0].count > 0) {
        reasons.push('Shop có tiến trình hoạt động (active handoffs hoặc queue).');
      }

      const profilesResult = await client.query(`
        SELECT count(*)::int AS count FROM profiles WHERE tenant_id = $1
      `, [shop.id]);
      if (profilesResult.rows[0].count > 0) {
        reasons.push('Shop có dữ liệu hồ sơ khách hàng (profiles) trong hệ thống.');
      }

      const midsResult = await client.query(`
        SELECT count(*)::int AS count FROM processed_mids WHERE tenant_id = $1
      `, [shop.id]);
      if (midsResult.rows[0].count > 0) {
        reasons.push('Shop có dữ liệu processed_mids trong hệ thống.');
      }

      // If any eligibility checks failed, reject deletion
      if (reasons.length > 0) {
        throw createShopDeleteError(
          'shop_deletion_blocked',
          'Thao tác bị chặn: Cửa hàng này không đủ điều kiện để xóa.',
          409,
          {
            reasons,
            recommendation: 'archived_or_paused'
          }
        );
      }

      // 10. Perform deletion in safe transactional order
      await client.query('DELETE FROM shop_page_credentials WHERE shop_id = $1', [shop.id]);
      await client.query('DELETE FROM shop_pages WHERE shop_id = $1', [shop.id]);
      await client.query('DELETE FROM shop_assets WHERE shop_id = $1', [shop.id]);
      await client.query('DELETE FROM shop_products WHERE shop_id = $1', [shop.id]);
      await client.query('DELETE FROM shop_settings WHERE shop_id = $1', [shop.id]);
      await client.query('DELETE FROM shops WHERE id = $1', [shop.id]);

      // 11. Insert audit log
      const auditEntry = buildAuditLogEntry({
        principal,
        action: SHOP_DELETE_ACTIONS.DELETE,
        resourceType: 'shop',
        resourceId: shop.id,
        outcome: 'success',
        requestId: requestContext.requestId,
        ip: requestContext.ip,
        userAgent: requestContext.userAgent,
        metadata: {
          shop_id: shop.id,
          slug: shop.slug,
          deleted_at: new Date().toISOString()
        }
      });
      await insertAuditLogEntry(client, auditEntry);

      return {
        success: true,
        shopId: shop.id,
        slug: shop.slug
      };
    });
  }

  return {
    deleteDraftShop
  };
}

module.exports = {
  createPostgresShopDeleteService,
  createShopDeleteError,
  isProtectedSlug
};

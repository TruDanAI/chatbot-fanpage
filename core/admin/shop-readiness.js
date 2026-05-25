const READINESS_STATUSES = Object.freeze(new Set(['passed', 'failed', 'warnings']));

function limitText(value = '', max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function normalizeCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeStatus(value = '', fallback = '') {
  const normalized = limitText(value, 80).toLowerCase();
  return normalized || fallback;
}

function normalizeOptionalBoolean(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on|enabled|active)$/i.test(String(value).trim());
}

function normalizeReadinessCounts(counts = {}) {
  return {
    products: normalizeCount(counts.products ?? counts.active_product_count),
    menu_images: normalizeCount(counts.menu_images ?? counts.active_menu_image_count),
    product_images: normalizeCount(counts.product_images ?? counts.active_product_image_count),
    active_page_mappings: normalizeCount(counts.active_page_mappings ?? counts.active_page_mapping_count),
    active_credentials: normalizeCount(counts.active_credentials ?? counts.active_credential_count)
  };
}

function resolveGlobalDryRunState(env = process.env) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, 'MESSENGER_DRY_RUN')
    ? String(env.MESSENGER_DRY_RUN ?? '').trim()
    : '';
  if (!raw) return { available: false, dry_run: null };
  if (/^(1|true|yes|on)$/i.test(raw)) return { available: true, dry_run: true };
  if (/^(0|false|no|off)$/i.test(raw)) return { available: true, dry_run: false };
  return { available: false, dry_run: null };
}

function makeCheck({ key, label, status, count, detail, next_action: nextAction }) {
  const result = {
    key: limitText(key, 80),
    label: limitText(label, 120),
    status,
    next_action: limitText(nextAction, 240)
  };
  if (count != null) result.count = normalizeCount(count);
  if (detail) result.detail = limitText(detail, 240);
  return result;
}

function issueFromCheck(check) {
  return {
    key: check.key,
    label: check.label,
    detail: check.detail || '',
    next_action: check.next_action || ''
  };
}

function buildShopReadiness({
  shop = {},
  settings = null,
  counts = {},
  manualTestStatus,
  globalDryRunState = null
} = {}) {
  const shopId = limitText(shop.id || shop.shop_id || '', 160);
  const safeCounts = normalizeReadinessCounts(counts);
  const shopStatus = normalizeStatus(shop.status, 'unknown');
  const botMode = settings ? normalizeStatus(settings.bot_mode, '') : '';
  const resolvedManualTestStatus = normalizeStatus(
    manualTestStatus ?? shop.last_manual_test_status ?? shop.manual_test_status,
    'unknown'
  );
  const shopDryRun = normalizeOptionalBoolean(shop.dry_run);
  const dryRunAvailable = shop.dry_run_available !== false && shop.dryRunAvailable !== false && shopDryRun != null;
  const resolvedGlobalDryRunState = globalDryRunState || { available: false, dry_run: null };

  const hardChecks = [
    makeCheck({
      key: 'shop_active',
      label: 'Shop status active',
      status: shopStatus === 'active' ? 'pass' : 'fail',
      detail: shopStatus === 'active'
        ? 'Shop status is active.'
        : `Shop status is ${shopStatus || 'unknown'}; expected active.`,
      next_action: shopStatus === 'active' ? 'No action needed.' : 'Set shop status to active before pilot.'
    }),
    makeCheck({
      key: 'bot_mode_ready',
      label: 'Bot mode configured',
      status: botMode && botMode !== 'disabled' ? 'pass' : 'fail',
      detail: botMode && botMode !== 'disabled'
        ? `Bot mode is ${botMode}.`
        : 'Bot mode is missing or disabled.',
      next_action: botMode && botMode !== 'disabled'
        ? 'No action needed.'
        : 'Choose a supported bot mode in chat behavior settings.'
    }),
    makeCheck({
      key: 'product_ready',
      label: 'Active products',
      status: safeCounts.products > 0 ? 'pass' : 'fail',
      count: safeCounts.products,
      detail: safeCounts.products > 0
        ? `${safeCounts.products} active product(s) found.`
        : 'No active products found.',
      next_action: safeCounts.products > 0 ? 'No action needed.' : 'Add or activate at least one product.'
    }),
    makeCheck({
      key: 'menu_assets_ready',
      label: 'Active menu image',
      status: safeCounts.menu_images > 0 ? 'pass' : 'fail',
      count: safeCounts.menu_images,
      detail: safeCounts.menu_images > 0
        ? `${safeCounts.menu_images} active menu image(s) found.`
        : 'No active menu image found.',
      next_action: safeCounts.menu_images > 0 ? 'No action needed.' : 'Add or activate one menu image.'
    }),
    makeCheck({
      key: 'page_mapping_ready',
      label: 'Active Page mapping',
      status: safeCounts.active_page_mappings === 1 ? 'pass' : 'fail',
      count: safeCounts.active_page_mappings,
      detail: safeCounts.active_page_mappings === 1
        ? 'Exactly one active Page mapping found.'
        : `Expected exactly one active Page mapping; found ${safeCounts.active_page_mappings}.`,
      next_action: safeCounts.active_page_mappings === 1
        ? 'No action needed.'
        : 'Create one active Page mapping and archive or pause extras.'
    }),
    makeCheck({
      key: 'credential_ready',
      label: 'Active Page credential',
      status: safeCounts.active_credentials === 1 ? 'pass' : 'fail',
      count: safeCounts.active_credentials,
      detail: safeCounts.active_credentials === 1
        ? 'Exactly one active fb_page_token credential found for the active mapping.'
        : `Expected exactly one active fb_page_token credential for the active mapping; found ${safeCounts.active_credentials}.`,
      next_action: safeCounts.active_credentials === 1
        ? 'No action needed.'
        : 'Create or rotate one active Page credential for the active mapping.'
    }),
    makeCheck({
      key: 'manual_test_ready',
      label: 'Manual test passed',
      status: resolvedManualTestStatus === 'passed' ? 'pass' : 'fail',
      detail: resolvedManualTestStatus === 'passed'
        ? 'Manual test status is passed.'
        : `Manual test status is ${resolvedManualTestStatus || 'unknown'}; expected passed.`,
      next_action: resolvedManualTestStatus === 'passed'
        ? 'No action needed.'
        : 'Run the approved manual test and mark it passed.'
    })
  ];

  const hardBlockers = hardChecks
    .filter(check => check.status === 'fail')
    .map(issueFromCheck);
  const warningChecks = [];

  if (safeCounts.products > 0
    && safeCounts.menu_images > 0
    && safeCounts.product_images < safeCounts.products) {
    warningChecks.push(makeCheck({
      key: 'product_assets_ready',
      label: 'Product image coverage',
      status: 'warning',
      count: safeCounts.product_images,
      detail: `Active product images (${safeCounts.product_images}) are fewer than active products (${safeCounts.products}).`,
      next_action: 'Add active product images for products that need visual confirmation.'
    }));
  }

  if (safeCounts.menu_images > 1) {
    warningChecks.push(makeCheck({
      key: 'multiple_menu_images',
      label: 'Multiple active menu images',
      status: 'warning',
      count: safeCounts.menu_images,
      detail: `${safeCounts.menu_images} active menu images found.`,
      next_action: 'Confirm menu image ordering or archive extra active menu images.'
    }));
  }

  if (dryRunAvailable && shopDryRun === false && resolvedGlobalDryRunState.available === false) {
    warningChecks.push(makeCheck({
      key: 'dry_run_global_unknown',
      label: 'Global dry-run state unknown',
      status: 'warning',
      detail: 'Shop dry_run is false, but global Messenger dry-run state was not available to this check.',
      next_action: 'Verify MESSENGER_DRY_RUN before any live Page pilot.'
    }));
  }

  if (hardBlockers.length && normalizeOptionalBoolean(shop.live_enabled) === true) {
    warningChecks.push(makeCheck({
      key: 'live_enabled_failed_readiness',
      label: 'Live flag enabled while readiness failed',
      status: 'warning',
      detail: 'live_enabled is true while hard readiness blockers are present.',
      next_action: 'Disable live_enabled or clear blockers before pilot.'
    }));
  }

  const warnings = warningChecks.map(issueFromCheck);
  const readinessStatus = hardBlockers.length
    ? 'failed'
    : (warnings.length ? 'warnings' : 'passed');

  return {
    shop_id: shopId,
    readiness_status: readinessStatus,
    hard_blockers: hardBlockers,
    warnings,
    checks: [...hardChecks, ...warningChecks],
    safe_counts: safeCounts
  };
}

function toLegacyReadinessSummary(readiness = {}) {
  return {
    status: readiness.readiness_status || 'failed',
    hardBlockers: (readiness.hard_blockers || []).map(item => ({
      key: item.key || '',
      label: item.label || '',
      detail: item.detail || '',
      next_action: item.next_action || ''
    })),
    warnings: (readiness.warnings || []).map(item => ({
      key: item.key || '',
      label: item.label || '',
      detail: item.detail || '',
      next_action: item.next_action || ''
    }))
  };
}

module.exports = {
  READINESS_STATUSES,
  buildShopReadiness,
  normalizeReadinessCounts,
  resolveGlobalDryRunState,
  toLegacyReadinessSummary
};

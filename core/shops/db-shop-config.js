function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonObject(value) {
  return isPlainObject(value) ? value : {};
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function boolValue(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatVndPrice(value) {
  const numeric = numberValue(value);
  if (numeric == null) return '';

  const thousands = numeric >= 1000 ? numeric / 1000 : numeric;
  const rounded = Number.isInteger(thousands) ? thousands : Number(thousands.toFixed(3));
  return `${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}k`;
}

function formatProductPrice(row = {}) {
  const metadata = jsonObject(row.metadata_json);
  const explicit = trimText(metadata.priceLabel || metadata.priceText || metadata.price);
  if (explicit) return explicit;

  const price = row.price;
  if (price == null || price === '') return '';
  const currency = trimText(row.currency).toUpperCase();
  if (!currency || currency === 'VND') return formatVndPrice(price);
  return `${price} ${currency}`;
}

function normalizeProduct(row = {}) {
  const metadata = jsonObject(row.metadata_json);
  return {
    id: trimText(row.id),
    code: trimText(row.code),
    name: trimText(row.name),
    price: formatProductPrice(row),
    description: trimText(row.description || metadata.description),
    size: trimText(metadata.size),
    weight: trimText(metadata.weight),
    gift: trimText(metadata.gift),
    preorder: boolValue(metadata.preorder, false),
    imageFile: trimText(metadata.imageFile || metadata.image_file),
    sortOrder: numberValue(row.sort_order) || 0
  };
}

function normalizeAsset(row = {}, productsById = new Map()) {
  const product = row.product_id ? productsById.get(trimText(row.product_id)) : null;
  const publicUrl = trimText(row.public_url);
  const storageKey = trimText(row.storage_key);
  return {
    id: trimText(row.id),
    shopId: trimText(row.shop_id),
    productId: trimText(row.product_id),
    productCode: product?.code || '',
    type: trimText(row.asset_type),
    provider: trimText(row.storage_provider),
    storageKey,
    publicUrl,
    url: publicUrl || (/^https?:\/\//i.test(storageKey) ? storageKey : ''),
    contentType: trimText(row.content_type),
    sortOrder: numberValue(row.sort_order) || 0
  };
}

function groupAssets(assets = []) {
  const menuImages = assets
    .filter(asset => asset.type === 'menu_image' && asset.url)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const productImagesByCode = {};
  for (const asset of assets) {
    if (asset.type !== 'product_image' || !asset.url || !asset.productCode) continue;
    const key = String(asset.productCode).toUpperCase();
    if (!productImagesByCode[key]) productImagesByCode[key] = [];
    productImagesByCode[key].push(asset);
  }

  for (const list of Object.values(productImagesByCode)) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  return { menuImages, productImagesByCode };
}

function normalizeShopConfig({ shop = {}, page = {}, settings = {}, products = [], assets = [], tenantId = '' } = {}) {
  const settingsJson = jsonObject(settings.settings_json);
  const botModeJson = jsonObject(settingsJson.botMode || settingsJson.bot_mode);
  const botModeName = trimText(settings.bot_mode || botModeJson.name || 'disabled');
  const fallbackReply = trimText(settings.fallback_text || settingsJson.fallbackReply);
  const handoffMessage = trimText(settings.handoff_message || botModeJson.handoffMessage);
  const menuIntroText = trimText(settings.menu_intro_text || settingsJson.menuIntroText);
  const groupedAssets = groupAssets(assets);

  return {
    shopName: trimText(shop.name || settingsJson.shopName || shop.slug) || 'shop',
    minAge: numberValue(settingsJson.minAge) || 18,
    botMode: {
      name: botModeName,
      handoffEnabled: boolValue(settings.handoff_enabled, boolValue(botModeJson.handoffEnabled, false)),
      aiFallbackEnabled: boolValue(botModeJson.aiFallbackEnabled, false),
      orderFlowEnabled: boolValue(botModeJson.orderFlowEnabled, false),
      leadCaptureEnabled: boolValue(botModeJson.leadCaptureEnabled, false),
      followUpEnabled: boolValue(botModeJson.followUpEnabled, true),
      recommendationEnabled: boolValue(botModeJson.recommendationEnabled, false),
      productCodeLookupEnabled: boolValue(botModeJson.productCodeLookupEnabled, true),
      menuSendingEnabled: boolValue(botModeJson.menuSendingEnabled, true),
      ...(handoffMessage ? { handoffMessage } : {}),
      ...(menuIntroText ? { menuIntroText } : {})
    },
    followUp: jsonObject(settingsJson.followUp),
    policies: {
      freeShipping: true,
      privacy: '',
      payment: '',
      preorderDays: '',
      orderInfoFields: 'tên người nhận + SĐT + địa chỉ giao hàng',
      ...jsonObject(settingsJson.policies)
    },
    recommendations: jsonObject(settingsJson.recommendations),
    hotCarouselProductCodes: jsonArray(settingsJson.hotCarouselProductCodes),
    keywordProducts: {},
    keywordTriggers: {},
    intents: jsonObject(settingsJson.intents),
    templates: jsonObject(settingsJson.templates),
    ...(fallbackReply ? { fallbackReply } : {}),
    __dbShop: {
      tenantId: trimText(tenantId),
      shopId: trimText(shop.id),
      shopSlug: trimText(shop.slug),
      pageId: trimText(page.page_id),
      pageName: trimText(page.page_name)
    },
    __assets: groupedAssets,
    __products: products
  };
}

async function resolveShopConfigForPage({ pageId, tenantId = '', db, client } = {}) {
  const page = trimText(pageId);
  const queryable = db || client;
  if (!page) return { found: false, reason: 'missing_page_id' };
  if (!queryable || typeof queryable.query !== 'function') {
    throw new Error('resolveShopConfigForPage requires a db/client with query().');
  }

  const mapping = await queryable.query(
    `
      SELECT
        s.id AS shop_id,
        s.slug AS shop_slug,
        s.name AS shop_name,
        s.default_locale,
        s.timezone,
        sp.id AS page_mapping_id,
        sp.page_id,
        sp.page_name,
        ss.bot_mode,
        ss.handoff_enabled,
        ss.handoff_message,
        ss.menu_intro_text,
        ss.fallback_text,
        ss.settings_json
      FROM shop_pages sp
      JOIN shops s ON s.id = sp.shop_id
      LEFT JOIN shop_settings ss ON ss.shop_id = s.id
      WHERE sp.page_id = $1
        AND sp.status = 'active'
        AND s.status = 'active'
      ORDER BY sp.updated_at DESC, sp.id
      LIMIT 2
    `,
    [page]
  );

  if (!mapping.rows.length) return { found: false, reason: 'page_not_found' };
  if (mapping.rows.length > 1) return { found: false, reason: 'ambiguous_page_mapping' };

  const row = mapping.rows[0];
  const shop = {
    id: row.shop_id,
    slug: row.shop_slug,
    name: row.shop_name,
    defaultLocale: row.default_locale,
    timezone: row.timezone
  };
  const pageRow = {
    id: row.page_mapping_id,
    page_id: row.page_id,
    page_name: row.page_name
  };
  const settings = {
    shop_id: row.shop_id,
    bot_mode: row.bot_mode,
    handoff_enabled: row.handoff_enabled,
    handoff_message: row.handoff_message,
    menu_intro_text: row.menu_intro_text,
    fallback_text: row.fallback_text,
    settings_json: row.settings_json
  };

  const productResult = await queryable.query(
    `
      SELECT id, shop_id, code, name, description, price, currency, sort_order, metadata_json
      FROM shop_products
      WHERE shop_id = $1
        AND status = 'active'
      ORDER BY sort_order, code, id
    `,
    [shop.id]
  );
  const products = productResult.rows
    .map(normalizeProduct)
    .filter(product => product.code && product.price);
  const productsById = new Map(products.map(product => [product.id, product]));

  const assetResult = await queryable.query(
    `
      SELECT id, shop_id, product_id, asset_type, storage_provider, storage_key,
             public_url, content_type, sort_order
      FROM shop_assets
      WHERE shop_id = $1
        AND status = 'active'
      ORDER BY asset_type, sort_order, id
    `,
    [shop.id]
  );
  const assets = assetResult.rows.map(rowAsset => normalizeAsset(rowAsset, productsById));
  const config = normalizeShopConfig({ shop, page: pageRow, settings, products, assets, tenantId });

  return {
    found: true,
    source: 'db',
    tenantId: trimText(tenantId),
    shop,
    page: pageRow,
    settings,
    products,
    assets,
    config
  };
}

module.exports = {
  formatProductPrice,
  normalizeShopConfig,
  resolveShopConfigForPage
};

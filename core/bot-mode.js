const BASIC_SALES_V2 = 'basic_sales_v2';
const MENU_CODE_HANDOFF = 'menu_code_handoff';
const {
  MENU_CODE_HANDOFF_MESSAGE,
  MENU_CODE_MENU_PRICE_REPLY,
  getMenuCodeHandoffMessage
} = require('./modes/menu-code-handoff');
const { getFeatureFlag } = require('./shops/feature-flags');

const MENU_CODE_HANDOFF_DISABLED_INTENTS = [
  'AGE_POLICY',
  'ASKS_FOR_ORDER_INFO',
  'ASKS_WHY_REPEATED',
  'BEST_SELLER',
  'BUDGET',
  'CANCEL_ORDER',
  'CHANGE_PRODUCT',
  'CLEANING_INFO',
  'COMPARISON',
  'CONTEXT_CONFIRMATION',
  'DELIVERY_TIME',
  'DISCOUNT',
  'EASY_USE_INFO',
  'EXPERIENCE_ADVICE',
  'FEATURE_OR_LARGE_OR_RECOMMEND',
  'FIT_INFO',
  'GEL_KEYWORD',
  'GIFT_INFO',
  'INSPECTION',
  'MATERIAL_INFO',
  'NEW_PRODUCTS',
  'OFFICE_PICKUP',
  'ORDER_INTENT',
  'PAYMENT_INFO',
  'PHONE_ONLY',
  'PHONE_WITH_LEAD',
  'PRICE_CLARIFICATION',
  'PRODUCT_IMAGE',
  'PROVIDES_NAME_OR_ADDRESS',
  'REJECT_ORDER',
  'RETURN_POLICY',
  'SHIPPING_FEE',
  'SHIPPING_PRIVACY',
  'SIZE_INFO',
  'STOCK_INFO',
  'TRACKING_INTENT',
  'VIBRATION'
];

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getBotModeName(config = {}) {
  const mode = config.botMode || config.mode || '';
  if (typeof mode === 'string') return mode;
  return String(mode.name || '').trim();
}

function getBasicSalesV2Config(config = {}) {
  const settingsJson = config.settings_json || config.settingsJson || {};
  const options = config.basicSalesV2 || settingsJson.basicSalesV2 || settingsJson.basic_sales_v2 || {};
  return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

function isBasicSalesV2Mode(config = {}) {
  const options = getBasicSalesV2Config(config);
  if (options.enabled === false) return false;
  if (getBotModeName(config) === BASIC_SALES_V2) return true;
  return options.enabled === true;
}

function isMenuCodeHandoffMode(config = {}) {
  return getBotModeName(config) === MENU_CODE_HANDOFF;
}

function isMinimalSalesRuntimeMode(config = {}) {
  return isMenuCodeHandoffMode(config) || isBasicSalesV2Mode(config);
}

function isAiFallbackEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'aiFallbackEnabled', false) === true;
}

function isLeadCaptureEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'leadCaptureEnabled', false) === true;
}

function isOrderFlowEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'orderFlowEnabled', false) === true;
}

function isFollowUpEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'followUpEnabled', false) === true;
}

function isProductCodeLookupEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'productCodeLookupEnabled', true) !== false;
}

function isMenuSendingEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'menuSendingEnabled', true) !== false;
}

function isPostProductHandoffEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'postProductHandoffEnabled', true) !== false;
}

function isFallbackEnabled(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return true;
  return getFeatureFlag(config, 'fallbackEnabled', true) !== false;
}

function applyBotModeConfig(config = {}) {
  if (!isMinimalSalesRuntimeMode(config)) return config;

  const intents = config.intents || {};
  return {
    ...config,
    quickReplies: {
      ...(config.quickReplies || {}),
      enabled: false
    },
    templates: {
      ...(config.templates || {}),
      productDetail: (config.templates || {}).productDetail
        || 'Dạ {{productCode}} bên em đang {{price}} nha mình.\n\nMẫu này {{pitch}}{{sizeText}}{{giftText}} ạ.',
      productListAskPhoto: (config.templates || {}).productListAskPhoto
        || 'Ưng mã nào mình nhắn em tư vấn ạ.',
      productListPhotoSent: (config.templates || {}).productListPhotoSent
        || 'Ưng mã nào mình nhắn em tư vấn ạ.'
    },
    intents: {
      ...intents,
      disabled: unique([
        ...(intents.disabled || []),
        ...MENU_CODE_HANDOFF_DISABLED_INTENTS
      ])
    }
  };
}

module.exports = {
  BASIC_SALES_V2,
  MENU_CODE_HANDOFF,
  MENU_CODE_HANDOFF_MESSAGE,
  MENU_CODE_MENU_PRICE_REPLY,
  applyBotModeConfig,
  getBasicSalesV2Config,
  getBotModeName,
  getMenuCodeHandoffMessage,
  isAiFallbackEnabled,
  isBasicSalesV2Mode,
  isFallbackEnabled,
  isFollowUpEnabled,
  isLeadCaptureEnabled,
  isMenuSendingEnabled,
  isMenuCodeHandoffMode,
  isOrderFlowEnabled,
  isPostProductHandoffEnabled,
  isProductCodeLookupEnabled
};

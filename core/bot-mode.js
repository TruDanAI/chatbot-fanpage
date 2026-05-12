const MENU_CODE_HANDOFF = 'menu_code_handoff';

const MENU_CODE_HANDOFF_MESSAGE = [
  'E gửi anh xem qua sp, anh ưng mã nào em tư vấn ạ',
  'Bên em nhận hàng thanh toán, che tên sản phẩm trước khi gửi đi.',
  'Freeship + tặng gel',
  'Có kèm mã vận đơn để anh theo dõi hành trình của đơn hàng anh nhé. Bên em giao bằng đơn vị Giao Hàng Tiết Kiệm.'
].join('\n');

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

function getModeOptions(config = {}) {
  const mode = config.botMode || {};
  return typeof mode === 'object' && mode ? mode : {};
}

function isMenuCodeHandoffMode(config = {}) {
  return getBotModeName(config) === MENU_CODE_HANDOFF;
}

function getMenuCodeHandoffMessage(config = {}) {
  const mode = getModeOptions(config);
  return String(mode.handoffMessage || config.menuCodeHandoffMessage || MENU_CODE_HANDOFF_MESSAGE);
}

function isAiFallbackEnabled(config = {}) {
  if (!isMenuCodeHandoffMode(config)) return true;
  const mode = getModeOptions(config);
  return mode.aiFallbackEnabled === true;
}

function isLeadCaptureEnabled(config = {}) {
  if (!isMenuCodeHandoffMode(config)) return true;
  const mode = getModeOptions(config);
  return mode.leadCaptureEnabled === true;
}

function isOrderFlowEnabled(config = {}) {
  if (!isMenuCodeHandoffMode(config)) return true;
  const mode = getModeOptions(config);
  return mode.orderFlowEnabled === true;
}

function isFollowUpEnabled(config = {}) {
  if (!isMenuCodeHandoffMode(config)) return true;
  const mode = getModeOptions(config);
  return mode.followUpEnabled === true;
}

function isProductCodeLookupEnabled(config = {}) {
  if (!isMenuCodeHandoffMode(config)) return true;
  const mode = getModeOptions(config);
  return mode.productCodeLookupEnabled !== false;
}

function applyBotModeConfig(config = {}) {
  if (!isMenuCodeHandoffMode(config)) return config;

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
  MENU_CODE_HANDOFF,
  MENU_CODE_HANDOFF_MESSAGE,
  applyBotModeConfig,
  getBotModeName,
  getMenuCodeHandoffMessage,
  isAiFallbackEnabled,
  isFollowUpEnabled,
  isLeadCaptureEnabled,
  isMenuCodeHandoffMode,
  isOrderFlowEnabled,
  isProductCodeLookupEnabled
};

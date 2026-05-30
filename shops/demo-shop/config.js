// Fake, test-only shop config for staging dry-run boot checks.
module.exports = {
  shopName: 'Demo Shop (Test Only)',
  botMode: {
    name: 'menu_code_handoff',
    aiFallbackEnabled: false,
    fallbackEnabled: false,
    followUpEnabled: false,
    leadCaptureEnabled: false,
    menuSendingEnabled: false,
    orderFlowEnabled: false,
    postProductHandoffEnabled: true,
    productCodeLookupEnabled: true,
    recommendationEnabled: false,
    handoffMessage: [
      'Demo shop dry-run only.',
      'A test staff handoff would happen here in a real shop.'
    ].join('\n')
  },
  policies: {
    freeShipping: false,
    privacy: 'Demo data only; do not collect real customer information.',
    payment: 'Demo checkout is disabled.',
    preorderDays: 'not available in demo mode',
    orderInfoFields: 'demo recipient name + demo phone + demo delivery address'
  },
  intents: {
    disabled: [
      'AGE_POLICY',
      'ORDER_INTENT',
      'PHONE_ONLY',
      'PHONE_WITH_LEAD',
      'PROVIDES_NAME_OR_ADDRESS'
    ]
  },
  templates: {
    greeting: 'Welcome to Demo Shop. This shop is test-only.',
    productDetail: '{{productCode}} is a fake demo item priced at {{price}}. {{pitch}}'
  },
  productPitch(product) {
    return product?.description || 'This item exists only for staging dry-run tests.';
  }
};

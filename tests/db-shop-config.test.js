const { describe, it, expect } = require('./harness');
const { resolveShopConfigForPage } = require('../core/shops/db-shop-config');

class FakeShopConfigClient {
  constructor(seed = {}) {
    this.seed = {
      mappings: seed.mappings || [],
      products: seed.products || [],
      assets: seed.assets || []
    };
    this.calls = [];
    this.failControlPlaneOnce = Boolean(seed.failControlPlaneOnce);
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.includes('FROM shop_pages sp')) {
      if (this.failControlPlaneOnce && normalized.includes('shop_package')) {
        this.failControlPlaneOnce = false;
        const err = new Error('column s.package does not exist');
        err.code = '42703';
        throw err;
      }
      const pageId = values[0];
      const rows = this.seed.mappings.filter(row => row.page_id === pageId);
      return { rows };
    }
    if (normalized.includes('FROM shop_products')) {
      const shopId = values[0];
      return { rows: this.seed.products.filter(row => row.shop_id === shopId && row.status === 'active') };
    }
    if (normalized.includes('FROM shop_assets')) {
      const shopId = values[0];
      return { rows: this.seed.assets.filter(row => row.shop_id === shopId && row.status === 'active') };
    }
    return { rows: [] };
  }
}

function makeSeed() {
  return {
    mappings: [{
      shop_id: 'adult-shop',
      shop_slug: 'adult-shop',
      shop_name: 'Adult Shop',
      shop_status: 'active',
      shop_package: 'basic',
      shop_lifecycle: 'live',
      live_enabled: true,
      last_readiness_status: 'passed',
      last_manual_test_status: 'passed',
      default_locale: 'vi-VN',
      timezone: 'Asia/Bangkok',
      page_mapping_id: 'page-map-1',
      page_id: 'page_adult',
      page_name: 'Adult Page',
      bot_mode: 'menu_code_handoff',
      handoff_enabled: true,
      handoff_message: 'DB handoff message',
      menu_intro_text: 'DB menu intro',
      fallback_text: 'DB fallback',
      settings_json: {
        botMode: {
          aiFallbackEnabled: false,
          orderFlowEnabled: false,
          leadCaptureEnabled: false,
          followUpEnabled: true,
          productCodeLookupEnabled: true
        },
        ruleToggles: {
          productCodeLookupEnabled: true,
          menuSendingEnabled: false,
          postProductHandoffEnabled: true,
          fallbackEnabled: true,
          leadCaptureEnabled: false,
          unknownToggle: true
        },
        policies: {
          privacy: 'DB privacy',
          payment: 'DB COD'
        },
        hotCarouselProductCodes: ['DB1']
      }
    }],
    products: [
      {
        id: 'prod-db-1',
        shop_id: 'adult-shop',
        code: 'DB1',
        name: 'DB Product 1',
        description: 'Active product',
        price: 150000,
        currency: 'VND',
        status: 'active',
        sort_order: 1,
        metadata_json: { size: '10cm', gift: 'gel', imageFile: 'db1.jpg' }
      },
      {
        id: 'prod-hidden',
        shop_id: 'adult-shop',
        code: 'HIDDEN',
        name: 'Hidden Product',
        description: 'Hidden product',
        price: 999000,
        currency: 'VND',
        status: 'hidden',
        sort_order: 2,
        metadata_json: {}
      }
    ],
    assets: [
      {
        id: 'menu-1',
        shop_id: 'adult-shop',
        product_id: null,
        asset_type: 'menu_image',
        storage_provider: 'public_url',
        storage_key: '',
        public_url: 'https://cdn.example.test/menu-1.png',
        content_type: 'image/png',
        status: 'active',
        sort_order: 1
      },
      {
        id: 'product-1',
        shop_id: 'adult-shop',
        product_id: 'prod-db-1',
        asset_type: 'product_image',
        storage_provider: 'public_url',
        storage_key: '',
        public_url: 'https://cdn.example.test/db1.png',
        content_type: 'image/png',
        status: 'active',
        sort_order: 1
      },
      {
        id: 'hidden-asset',
        shop_id: 'adult-shop',
        product_id: 'prod-db-1',
        asset_type: 'product_image',
        storage_provider: 'public_url',
        storage_key: '',
        public_url: 'https://cdn.example.test/hidden.png',
        content_type: 'image/png',
        status: 'hidden',
        sort_order: 2
      }
    ]
  };
}

describe('db shop config resolver', () => {
  it('loads shop, page mapping, settings, active products, and active assets', async () => {
    const client = new FakeShopConfigClient(makeSeed());
    const result = await resolveShopConfigForPage({
      pageId: 'page_adult',
      tenantId: 'tenant_test',
      client
    });

    expect(result.found).toBeTrue();
    expect(result.shop.id).toBe('adult-shop');
    expect(result.page.page_id).toBe('page_adult');
    expect(result.config.shopName).toBe('Adult Shop');
    expect(result.shop.status).toBe('active');
    expect(result.shop.package).toBe('basic');
    expect(result.shop.lifecycle).toBe('live');
    expect(result.shop.live_enabled).toBeTrue();
    expect(result.config.botMode.name).toBe('menu_code_handoff');
    expect(result.config.botMode.handoffEnabled).toBeTrue();
    expect(result.config.botMode.handoffMessage).toBe('DB handoff message');
    expect(result.config.botMode.menuIntroText).toBe('DB menu intro');
    expect(result.config.fallbackReply).toBe('DB fallback');
    expect(result.config.chatBehaviorSettings).toEqual({
      botMode: 'menu_code_handoff',
      handoffEnabled: true,
      handoffMessage: 'DB handoff message',
      menuIntroText: 'DB menu intro',
      fallbackText: 'DB fallback'
    });
    expect(result.config.botMode.productCodeLookupEnabled).toBeTrue();
    expect(result.config.botMode.menuSendingEnabled).toBeFalse();
    expect(result.config.botMode.postProductHandoffEnabled).toBeTrue();
    expect(result.config.botMode.fallbackEnabled).toBeTrue();
    expect(result.config.botMode.leadCaptureEnabled).toBeFalse();
    expect(result.config.ruleToggles).toEqual({
      productCodeLookupEnabled: true,
      menuSendingEnabled: false,
      postProductHandoffEnabled: true,
      fallbackEnabled: true,
      leadCaptureEnabled: false
    });
    expect(result.config.ruleToggles.unknownToggle).toBe(undefined);
    expect(result.config.policies.privacy).toBe('DB privacy');
    expect(result.products.map(product => product.code)).toEqual(['DB1']);
    expect(result.products[0].price).toBe('150k');
    expect(result.config.__assets.menuImages.length).toBe(1);
    expect(result.config.__assets.productImagesByCode.DB1.length).toBe(1);
    expect(JSON.stringify(result.config).includes('hidden.png')).toBeFalse();
  });

  it('falls back to legacy mapping query when control-plane columns are missing', async () => {
    const client = new FakeShopConfigClient({
      ...makeSeed(),
      failControlPlaneOnce: true
    });
    const result = await resolveShopConfigForPage({
      pageId: 'page_adult',
      tenantId: 'tenant_test',
      client
    });

    expect(result.found).toBeTrue();
    expect(result.shop.controlPlaneColumnsAvailable).toBeFalse();
    expect(result.shop.package).toBe('basic');
    expect(result.shop.lifecycle).toBe('live');
    expect(result.shop.live_enabled).toBeTrue();
    expect(client.calls.filter(call => String(call.sql).includes('FROM shop_pages sp')).length).toBe(2);
  });

  it('returns missing without leaking another shop when page is not mapped', async () => {
    const client = new FakeShopConfigClient(makeSeed());
    const result = await resolveShopConfigForPage({
      pageId: 'unknown_page',
      tenantId: 'tenant_test',
      client
    });

    expect(result.found).toBeFalse();
    expect(result.reason).toBe('page_not_found');
  });

  it('normalizes missing or invalid chat behavior settings to safe fallbacks', async () => {
    const seed = makeSeed();
    seed.mappings[0] = {
      ...seed.mappings[0],
      bot_mode: 'invalid_mode',
      handoff_enabled: null,
      handoff_message: '',
      menu_intro_text: '',
      fallback_text: '',
      settings_json: {}
    };
    const client = new FakeShopConfigClient(seed);
    const result = await resolveShopConfigForPage({
      pageId: 'page_adult',
      tenantId: 'tenant_test',
      client
    });

    expect(result.found).toBeTrue();
    expect(result.config.botMode.name).toBe('disabled');
    expect(result.config.botMode.handoffEnabled).toBeFalse();
    expect(result.config.fallbackReply).toBe(undefined);
    expect(result.config.chatBehaviorSettings).toEqual({
      botMode: 'disabled',
      handoffEnabled: false,
      handoffMessage: '',
      menuIntroText: '',
      fallbackText: ''
    });
    expect(result.config.ruleToggles).toEqual({
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      fallbackEnabled: true,
      leadCaptureEnabled: false
    });
  });

  it('falls back invalid rule toggle values to safe defaults and ignores unknown toggles', async () => {
    const seed = makeSeed();
    seed.mappings[0] = {
      ...seed.mappings[0],
      settings_json: {
        ruleToggles: {
          productCodeLookupEnabled: 'maybe',
          menuSendingEnabled: '',
          postProductHandoffEnabled: 'invalid',
          fallbackEnabled: 'no',
          leadCaptureEnabled: 'yes',
          rawSecretToggle: true
        }
      }
    };
    const client = new FakeShopConfigClient(seed);
    const result = await resolveShopConfigForPage({
      pageId: 'page_adult',
      tenantId: 'tenant_test',
      client
    });

    expect(result.found).toBeTrue();
    expect(result.config.ruleToggles).toEqual({
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      fallbackEnabled: false,
      leadCaptureEnabled: true
    });
    expect(result.config.ruleToggles.rawSecretToggle).toBe(undefined);
  });
});

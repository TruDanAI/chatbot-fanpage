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
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.includes('FROM shop_pages sp')) {
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
    expect(result.config.botMode.name).toBe('menu_code_handoff');
    expect(result.config.botMode.handoffMessage).toBe('DB handoff message');
    expect(result.config.botMode.productCodeLookupEnabled).toBeTrue();
    expect(result.config.policies.privacy).toBe('DB privacy');
    expect(result.products.map(product => product.code)).toEqual(['DB1']);
    expect(result.products[0].price).toBe('150k');
    expect(result.config.__assets.menuImages.length).toBe(1);
    expect(result.config.__assets.productImagesByCode.DB1.length).toBe(1);
    expect(JSON.stringify(result.config).includes('hidden.png')).toBeFalse();
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
});

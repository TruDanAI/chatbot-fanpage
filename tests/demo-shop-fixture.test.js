const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { describe, it, expect } = require('./harness');
const { loadProducts } = require('../core/products');

const rootDir = path.join(__dirname, '..');
const demoShopDir = path.join(rootDir, 'shops', 'demo-shop');

describe('demo-shop fixture', () => {
  it('loads fake test-only config and catalog data', () => {
    const config = require('../shops/demo-shop/config');
    const products = loadProducts(path.join(demoShopDir, 'products.csv'));

    expect(config.shopName).toContain('Demo');
    expect(config.botMode.name).toBe('menu_code_handoff');
    expect(config.botMode.aiFallbackEnabled).toBeFalse();
    expect(config.botMode.leadCaptureEnabled).toBeFalse();
    expect(config.botMode.orderFlowEnabled).toBeFalse();
    expect(config.botMode.handoffMessage).toContain('dry-run');
    expect(products.length).toBe(3);
    expect(products.map(product => product.code)).toEqual(['MÃ1', 'MÃ2', 'MÃ3']);
    expect(products.every(product => !product.imageFile)).toBeTrue();
  });

  it('boots index metadata with SHOP_ID=demo-shop in dry-run mode', () => {
    const script = [
      "const app = require('./index');",
      'const health = app.buildHealthPayload();',
      "if (health.shop !== 'demo-shop') process.exit(10);",
      'if (health.products !== 3) process.exit(11);',
      'if (health.messenger.dryRun !== true) process.exit(12);',
      "if (health.storage.adapter !== 'file') process.exit(13);"
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: rootDir,
      env: {
        ...process.env,
        DATA_DIR: path.join(os.tmpdir(), 'chatbot-fanpage-tests', String(process.pid), 'demo-shop-fixture-child'),
        FB_APP_SECRET: 'test-app-secret',
        FB_PAGE_TOKEN: 'test-page-token',
        FB_VERIFY_TOKEN: 'test-verify-token',
        MESSENGER_DRY_RUN: 'true',
        NODE_ENV: 'staging',
        RAILWAY_ENVIRONMENT: 'staging',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        SHOP_ID: 'demo-shop',
        STORAGE_ADAPTER: 'file',
        USE_GEMINI: 'true'
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
  });
});

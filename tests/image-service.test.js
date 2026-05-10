const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, expect } = require('./harness');
const { createImageService } = require('../core/image-service');
const {
  detectors,
  extractRequestedProductCodes,
  normalizeText
} = require('../core/rules');

function makeImageService() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-image-service-'));
  const shopDir = path.join(rootDir, 'shops', 'adult-shop');
  const imageDir = path.join(shopDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  for (const file of ['ma13.jpg', 'gel.jpg', 'menu1.png', 'menu2.png']) {
    fs.writeFileSync(path.join(imageDir, file), 'x');
  }

  return createImageService({
    rootDir,
    shopDir,
    shopConfig: {},
    products: [
      { code: 'MÃ13', imageFile: 'ma13.jpg' },
      { code: 'Gel bôi trơn', imageFile: 'gel.jpg' }
    ],
    storage: {
      getLastProductCode: () => 'MÃ13'
    },
    publicBaseUrl: 'https://example.test',
    normalizeText,
    extractRequestedProductCodes,
    isOrderIntent: detectors.isOrderIntent,
    wantsKeywordImage: (text, keyword) => keyword === 'gel' && /\bgel\b/.test(normalizeText(text)),
    wantsMenuImages: detectors.wantsMenuImages,
    wantsProductImage: detectors.wantsProductImage,
    sendCarousel: async () => {},
    imageCooldownMs: 0
  });
}

describe('image service: requested images', () => {
  it('sends product and gel images for browse/info requests', () => {
    const service = makeImageService();
    const files = service.buildRequestedImages('cho xem mã 13 và gel', 'u_images_info');
    expect(files).toEqual(['gel.jpg', 'ma13.jpg']);
    service.stopImageService();
  });

  it('does not resend product images for explicit order intent', () => {
    const service = makeImageService();
    const files = service.buildRequestedImages('vậy lấy cho mình mã 13 và 1 chai gel nhé', 'u_images_order');
    expect(files).toEqual([]);
    service.stopImageService();
  });

  it('still sends an image when the order-like text explicitly asks for one', () => {
    const service = makeImageService();
    const files = service.buildRequestedImages('lấy ảnh mã 13 cho mình xem lại', 'u_images_photo');
    expect(files).toEqual(['ma13.jpg']);
    service.stopImageService();
  });
});

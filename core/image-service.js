const fs = require('fs');
const path = require('path');

const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const DEFAULT_IMAGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút mỗi loại ảnh / mỗi user
const DEFAULT_IMAGE_CACHE_SWEEP_MS = 60 * 1000; // dọn rác mỗi 1 phút

function createImageService({
  rootDir,
  shopDir,
  shopConfig,
  products,
  storage,
  publicBaseUrl,
  normalizeText,
  extractRequestedProductCodes,
  wantsKeywordImage,
  wantsMenuImages,
  wantsProductImage,
  sendCarousel,
  imageCooldownMs = DEFAULT_IMAGE_COOLDOWN_MS,
  imageCacheSweepMs = DEFAULT_IMAGE_CACHE_SWEEP_MS
}) {
  const imageDirs = [
    path.join(shopDir, 'images'),
    path.join(rootDir, 'images'),
    path.join(rootDir, 'assets'),
    path.join(rootDir, '..')
  ].filter(dir => fs.existsSync(dir));

  function buildImageIndex() {
    const index = new Map();
    for (const dir of imageDirs) {
      let files = [];
      try {
        files = fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => e.isFile())
          .map(e => e.name);
      } catch {
        continue;
      }

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!ALLOWED_IMAGE_EXT.has(ext)) continue;
        // Ưu tiên ảnh trong shop hiện tại, tránh bị thư mục global ghi đè.
        if (!index.has(file.toLowerCase())) {
          index.set(file.toLowerCase(), path.join(dir, file));
        }
      }
    }
    return index;
  }

  const imageIndex = buildImageIndex();
  const recentlySentImages = new Map(); // key = `${userId}:${filename}` -> timestamp

  function getImageFilename(baseName) {
    const clean = String(baseName || '').trim();
    if (!clean) return null;

    const hasExt = ALLOWED_IMAGE_EXT.has(path.extname(clean).toLowerCase());
    if (hasExt) {
      return imageIndex.has(clean.toLowerCase()) ? clean : null;
    }

    for (const ext of ALLOWED_IMAGE_EXT) {
      const withExt = `${clean}${ext}`;
      if (imageIndex.has(withExt.toLowerCase())) return withExt;
    }
    return null;
  }

  function getPublicImageUrl(filename, baseUrlOverride = '') {
    const baseRaw = baseUrlOverride || publicBaseUrl;
    if (!baseRaw || !filename) return null;
    const base = baseRaw.replace(/\/+$/, '');
    return `${base}/media/${encodeURIComponent(filename)}`;
  }

  function registerMediaRoutes(app) {
    app.get('/media/:filename', (req, res) => {
      const filename = req.params.filename;
      const fullPath = imageIndex.get(String(filename || '').toLowerCase());
      if (!fullPath) return res.sendStatus(404);
      res.sendFile(fullPath);
    });
  }

  function getImageFilenameForProduct(product) {
    if (product?.imageFile) {
      const direct = getImageFilename(product.imageFile);
      if (direct) return direct;
    }

    const code = String(product?.code || '');
    const maMatch = code.match(/(\d{1,2})/);
    if (maMatch) {
      const n = Number(maMatch[1]);
      const candidates = [`ma${n}`, `mã${n}`, `MA${n}`, `MÃ${n}`];
      for (const name of candidates) {
        const f = getImageFilename(name);
        if (f) return f;
      }
    }

    const extras = typeof shopConfig.productImageExtraNames === 'function'
      ? shopConfig.productImageExtraNames(product)
      : [];
    for (const name of extras) {
      const f = getImageFilename(name);
      if (f) return f;
    }
    return null;
  }

  function isGreetingText(text) {
    const t = normalizeText(text).trim();
    return /^(?:(?:em|minh|toi)\s+)?(?:xin\s*)?(?:chao|hello|hi|alo|shop\s*oi|shop|em\s*oi|chi\s*oi|anh\s*oi)(?:\s+(?:shop|em|ban))?(?:\s+(?:a|nha|nhe|nhe\s*shop|nha\s*shop))?[.!?\s]*$/.test(t);
  }

  function isHotProductsText(text) {
    const t = normalizeText(text);
    return /(?:ban\s*chay|\bhot\b|nhieu\s*nguoi\s*(?:hoi|mua)|duoc\s*hoi\s*nhieu|mau\s*nao\s*(?:duoc|ok|hot)|top|xu\s*huong)/.test(t);
  }

  function getMenuImageUrls(baseUrlOverride = '') {
    return ['menu1', 'menu2']
      .map(name => getImageFilename(name))
      .filter(Boolean)
      .map(file => ({ file, url: getPublicImageUrl(file, baseUrlOverride) }))
      .filter(x => x.url);
  }

  function getHotCarouselProducts() {
    const configured = Array.isArray(shopConfig.hotCarouselProductCodes)
      ? shopConfig.hotCarouselProductCodes
      : Array.isArray(shopConfig.greetingCarouselProductCodes)
        ? shopConfig.greetingCarouselProductCodes
        : [];
    const fallback = [
      ...(shopConfig.recommendations?.premium || []),
      ...(shopConfig.recommendations?.budget || [])
    ];
    const wanted = configured.length ? configured : fallback;
    const byCode = new Map(products.map(p => [String(p.code || '').toUpperCase(), p]));
    const result = [];

    for (const code of wanted) {
      const product = byCode.get(String(code || '').toUpperCase());
      if (product && !result.some(p => p.code === product.code)) result.push(product);
      if (result.length >= 10) break;
    }
    return result;
  }

  function buildHotCarouselElements(baseUrlOverride = '') {
    return getHotCarouselProducts()
      .map(product => {
        const file = getImageFilenameForProduct(product);
        const imageUrl = getPublicImageUrl(file, baseUrlOverride);
        if (!imageUrl) return null;

        const title = `${product.code} - ${product.price}`.slice(0, 80);
        const subtitle = String(product.description || 'Mẫu đang được hỏi nhiều bên shop').slice(0, 80);
        return {
          title,
          subtitle,
          image_url: imageUrl,
          buttons: [
            {
              type: 'postback',
              title: 'Tư vấn mã này',
              payload: `Tư vấn ${product.code}`
            }
          ]
        };
      })
      .filter(Boolean)
      .slice(0, 10);
  }

  async function sendHotCarousel(senderId, baseUrlOverride = '') {
    const elements = buildHotCarouselElements(baseUrlOverride);
    if (!elements.length) return false;
    await sendCarousel(senderId, elements);
    return true;
  }

  function pruneRecentlySentImages(now = Date.now()) {
    const expireBefore = now - imageCooldownMs;
    for (const [key, at] of recentlySentImages.entries()) {
      if (at <= expireBefore) recentlySentImages.delete(key);
    }
  }

  const imageCacheGcTimer = setInterval(() => {
    pruneRecentlySentImages();
  }, imageCacheSweepMs);
  imageCacheGcTimer.unref?.();

  function shouldSendImage(userId, filename) {
    // Quét nhanh theo đường nóng để Map không phình nếu traffic cao bất thường.
    pruneRecentlySentImages();
    const key = `${userId}:${filename}`;
    const last = recentlySentImages.get(key);
    if (last && Date.now() - last < imageCooldownMs) return false;
    recentlySentImages.set(key, Date.now());
    return true;
  }

  function buildRequestedImages(userText, userId) {
    const files = [];
    const reasons = [];

    if (wantsMenuImages(userText)) {
      const menu1 = getImageFilename('menu1');
      const menu2 = getImageFilename('menu2');
      if (menu1) { files.push(menu1); reasons.push('menu1'); }
      if (menu2) { files.push(menu2); reasons.push('menu2'); }
    }

    if (wantsKeywordImage(userText, 'gel')) {
      const gel = getImageFilename('gel');
      if (gel) { files.push(gel); reasons.push('gel'); }
    }

    const maCodes = extractRequestedProductCodes(userText);
    if (maCodes.length) {
      const byCode = new Map(products.map(p => [String(p.code || '').toUpperCase(), p]));
      for (const code of maCodes) {
        const p = byCode.get(code.toUpperCase());
        if (!p) continue;
        const file = getImageFilenameForProduct(p);
        if (file) { files.push(file); reasons.push(code); }
      }
    }

    // Nếu khách chỉ nói "xem ảnh" sau khi vừa hỏi/chốt một mã, gửi lại ảnh của mã gần nhất thay vì menu.
    if (!files.length && wantsProductImage(userText)) {
      const lastCode = storage.getLastProductCode(userId);
      const product = products.find(p => String(p.code || '').toUpperCase() === String(lastCode || '').toUpperCase());
      const file = getImageFilenameForProduct(product);
      if (file) { files.push(file); reasons.push(lastCode); }
    }

    const unique = [...new Set(files)].slice(0, 6);
    return unique.filter(f => shouldSendImage(userId, f));
  }

  function buildRequestedImageUrls(userText, userId, baseUrlOverride = '') {
    const files = buildRequestedImages(userText, userId);
    return files
      .map(file => ({ file, url: getPublicImageUrl(file, baseUrlOverride) }))
      .filter(x => x.url);
  }

  function stopImageService() {
    clearInterval(imageCacheGcTimer);
  }

  return {
    buildHotCarouselElements,
    buildRequestedImageUrls,
    buildRequestedImages,
    getHotCarouselProducts,
    getImageFilename,
    getImageFilenameForProduct,
    getMenuImageUrls,
    getPublicImageUrl,
    isGreetingText,
    isHotProductsText,
    registerMediaRoutes,
    sendHotCarousel,
    stopImageService
  };
}

module.exports = {
  createImageService
};

function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

function getRequestImageKey(senderId, image = {}) {
  const recipient = String(senderId || '').trim();
  const imageId = normalizeKeyPart(image.file) || normalizeKeyPart(image.url);
  return recipient && imageId ? `${recipient}:${imageId}` : '';
}

function uniqueImagesForRequest(senderId, images, sentImages) {
  const scope = sentImages && typeof sentImages.has === 'function' && typeof sentImages.add === 'function'
    ? sentImages
    : new Set();
  const result = [];

  for (const image of Array.isArray(images) ? images : []) {
    if (!image || !image.url) continue;
    const key = getRequestImageKey(senderId, image);
    if (key && scope.has(key)) continue;
    if (key) scope.add(key);
    result.push(image);
  }

  return result;
}

module.exports = {
  uniqueImagesForRequest
};

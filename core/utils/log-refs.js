const crypto = require('crypto');

function pageRef(pageId) {
  const value = String(pageId || '').trim();
  if (!value) return 'unknown';
  return `p:${crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 10)}`;
}

function shopRef(shopId) {
  const value = String(shopId || '').trim();
  if (!value) return 'unknown';
  return `s:${crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 10)}`;
}

module.exports = {
  pageRef,
  shopRef
};

const crypto = require('crypto');

const CREDENTIAL_FORMAT_VERSION = 'v1';
const DEFAULT_CREDENTIAL_TYPE = 'fb_page_token';

function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function deriveCredentialKey(masterKey) {
  const value = trimText(masterKey);
  if (!value) throw new Error('credential_master_key_missing');
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function encryptCredential(plainText, masterKey) {
  const value = text(plainText);
  if (!value) throw new Error('credential_plaintext_missing');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveCredentialKey(masterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    CREDENTIAL_FORMAT_VERSION,
    base64UrlEncode(iv),
    base64UrlEncode(tag),
    base64UrlEncode(ciphertext)
  ].join(':');
}

function decryptCredential(encryptedValue, masterKey) {
  const value = trimText(encryptedValue);
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== CREDENTIAL_FORMAT_VERSION) {
    throw new Error('credential_envelope_invalid');
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveCredentialKey(masterKey),
    base64UrlDecode(ivPart)
  );
  decipher.setAuthTag(base64UrlDecode(tagPart));
  return Buffer.concat([
    decipher.update(base64UrlDecode(ciphertextPart)),
    decipher.final()
  ]).toString('utf8');
}

async function resolvePageCredential({
  db,
  client,
  shopId,
  pageMappingId,
  credentialType = DEFAULT_CREDENTIAL_TYPE,
  masterKey = process.env.CREDENTIAL_MASTER_KEY
} = {}) {
  const queryable = db || client;
  const normalizedShopId = trimText(shopId);
  const normalizedPageMappingId = trimText(pageMappingId);
  const normalizedType = trimText(credentialType) || DEFAULT_CREDENTIAL_TYPE;

  if (!queryable || typeof queryable.query !== 'function') {
    throw new Error('resolvePageCredential requires a db/client with query().');
  }
  if (!normalizedShopId || !normalizedPageMappingId) {
    return { found: false, reason: 'credential_scope_missing' };
  }
  if (!trimText(masterKey)) {
    return { found: false, reason: 'credential_master_key_missing' };
  }

  const result = await queryable.query(
    `
      SELECT id, encrypted_value, encryption_key_id
      FROM shop_page_credentials
      WHERE shop_id = $1
        AND page_mapping_id = $2
        AND credential_type = $3
        AND status = 'active'
      ORDER BY updated_at DESC, id
      LIMIT 2
    `,
    [normalizedShopId, normalizedPageMappingId, normalizedType]
  );

  if (!result.rows.length) return { found: false, reason: 'credential_not_found' };
  if (result.rows.length > 1) return { found: false, reason: 'credential_ambiguous' };

  try {
    const row = result.rows[0];
    const secret = decryptCredential(row.encrypted_value, masterKey);
    if (!secret) return { found: false, reason: 'credential_empty' };
    return {
      found: true,
      id: trimText(row.id),
      credentialType: normalizedType,
      encryptionKeyId: trimText(row.encryption_key_id),
      secret
    };
  } catch {
    return { found: false, reason: 'credential_decrypt_failed' };
  }
}

module.exports = {
  DEFAULT_CREDENTIAL_TYPE,
  decryptCredential,
  encryptCredential,
  resolvePageCredential
};

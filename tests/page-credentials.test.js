const { describe, it, expect } = require('./harness');
const {
  decryptCredential,
  encryptCredential,
  resolvePageCredential
} = require('../core/credentials/page-credentials');

describe('page credential encryption service', () => {
  it('encrypts and decrypts without exposing the plain token in the envelope', () => {
    const masterKey = 'local-test-master-key-32-plus-characters';
    const token = 'EAAB-secret-page-token';
    const encrypted = encryptCredential(token, masterKey);

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted.includes(token)).toBeFalse();
    expect(decryptCredential(encrypted, masterKey)).toBe(token);
  });

  it('resolves active page credential without returning encrypted envelope', async () => {
    const masterKey = 'local-test-master-key-32-plus-characters';
    const token = 'EAAB-db-page-token';
    const encrypted = encryptCredential(token, masterKey);
    const calls = [];
    const result = await resolvePageCredential({
      db: {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return {
            rows: [{
              id: 'cred-1',
              encrypted_value: encrypted,
              encryption_key_id: 'default'
            }]
          };
        }
      },
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      masterKey
    });

    expect(result.found).toBeTrue();
    expect(result.secret).toBe(token);
    expect(result.encrypted_value).toBe(undefined);
    expect(JSON.stringify(result).includes(encrypted)).toBeFalse();
    expect(calls[0].values).toEqual(['adult-shop', 'page-map-1', 'fb_page_token']);
  });

  it('fails closed when the master key or credential row is missing', async () => {
    const missingKey = await resolvePageCredential({
      db: { query: async () => { throw new Error('query should not run'); } },
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      masterKey: ''
    });
    expect(missingKey).toEqual({ found: false, reason: 'credential_master_key_missing' });

    const missingRow = await resolvePageCredential({
      db: { query: async () => ({ rows: [] }) },
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      masterKey: 'local-test-master-key-32-plus-characters'
    });
    expect(missingRow).toEqual({ found: false, reason: 'credential_not_found' });
  });

  it('fails closed when decrypting with the wrong master key', async () => {
    const encrypted = encryptCredential('EAAB-db-page-token', 'correct-local-test-master-key');
    const result = await resolvePageCredential({
      db: {
        query: async () => ({
          rows: [{
            id: 'cred-1',
            encrypted_value: encrypted,
            encryption_key_id: 'default'
          }]
        })
      },
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      masterKey: 'wrong-local-test-master-key'
    });

    expect(result).toEqual({ found: false, reason: 'credential_decrypt_failed' });
  });

  it('does not resolve archived page credentials', async () => {
    const masterKey = 'local-test-master-key-32-plus-characters';
    const encrypted = encryptCredential('EAAB-db-page-token', masterKey);
    const rows = [{
      id: 'cred-archived',
      shop_id: 'adult-shop',
      page_mapping_id: 'page-map-1',
      credential_type: 'fb_page_token',
      encrypted_value: encrypted,
      encryption_key_id: 'default',
      status: 'archived'
    }];
    const result = await resolvePageCredential({
      db: {
        query: async (sql, values) => {
          const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
          return {
            rows: rows.filter(row => (
              row.shop_id === values[0]
              && row.page_mapping_id === values[1]
              && row.credential_type === values[2]
              && row.status === 'active'
              && normalized.includes("status = 'active'")
            ))
          };
        }
      },
      shopId: 'adult-shop',
      pageMappingId: 'page-map-1',
      masterKey
    });

    expect(result).toEqual({ found: false, reason: 'credential_not_found' });
  });
});

const { describe, it, expect } = require('./harness');
const {
  PRODUCTION_DB_WRITE_UNLOCK_ENV,
  assertMessengerDryRunAllowed,
  assertStorageAdapterAllowed,
  isProductionDbWriteAllowed,
  isProductionRuntime,
  normalizeStorageAdapterName
} = require('../core/storage-config');

describe('storage config guard', () => {
  it('normalizes adapter names with file as default', () => {
    expect(normalizeStorageAdapterName('')).toBe('file');
    expect(normalizeStorageAdapterName(' POSTGRES ')).toBe('postgres');
  });

  it('refuses postgres adapter in production until explicitly unlocked', () => {
    const env = {
      NODE_ENV: 'production',
      STORAGE_ADAPTER: 'postgres'
    };

    let message = '';
    try {
      assertStorageAdapterAllowed(env.STORAGE_ADAPTER, env);
    } catch (err) {
      message = err.message;
    }

    expect(message).toContain('Refusing STORAGE_ADAPTER=postgres in production');
    expect(message).toContain(PRODUCTION_DB_WRITE_UNLOCK_ENV);
  });

  it('treats Railway production environment names as production', () => {
    expect(isProductionRuntime({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBeTrue();
    expect(isProductionRuntime({ RAILWAY_ENVIRONMENT: 'production' })).toBeTrue();
    expect(isProductionRuntime({ NODE_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBeFalse();

    let message = '';
    try {
      assertStorageAdapterAllowed('postgres', {
        RAILWAY_ENVIRONMENT_NAME: 'production'
      });
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain('Refusing STORAGE_ADAPTER=postgres in production');
  });

  it('allows postgres in non-production and production only with unlock env', () => {
    expect(assertStorageAdapterAllowed('postgres', { NODE_ENV: 'staging' })).toBe('postgres');
    expect(assertStorageAdapterAllowed('postgres', {
      NODE_ENV: 'production',
      [PRODUCTION_DB_WRITE_UNLOCK_ENV]: 'true'
    })).toBe('postgres');
    expect(isProductionDbWriteAllowed({
      [PRODUCTION_DB_WRITE_UNLOCK_ENV]: 'yes'
    })).toBeTrue();
  });

  it('refuses Messenger dry-run in production', () => {
    expect(assertMessengerDryRunAllowed(true, { NODE_ENV: 'staging' })).toBeTrue();
    expect(assertMessengerDryRunAllowed(false, { NODE_ENV: 'production' })).toBeFalse();

    let message = '';
    try {
      assertMessengerDryRunAllowed(true, {
        RAILWAY_ENVIRONMENT_NAME: 'production'
      });
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain('Refusing MESSENGER_DRY_RUN=true in production');
  });
});

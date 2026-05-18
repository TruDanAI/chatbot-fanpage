const PRODUCTION_DB_WRITE_UNLOCK_ENV = 'ALLOW_PRODUCTION_DB_WRITES';

function normalizeStorageAdapterName(raw) {
  return String(raw || 'file').trim().toLowerCase() || 'file';
}

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function isProductionRuntime(env = process.env) {
  return [
    env.NODE_ENV,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_ENVIRONMENT_NAME
  ].some(value => String(value || '').trim().toLowerCase() === 'production');
}

function isProductionDbWriteAllowed(env = process.env) {
  return envFlagEnabled(env[PRODUCTION_DB_WRITE_UNLOCK_ENV]);
}

function assertStorageAdapterAllowed(adapterName, env = process.env) {
  const normalized = normalizeStorageAdapterName(adapterName);
  if (normalized === 'file' && envFlagEnabled(env.MULTI_SHOP_DB_CONFIG_ENABLED)) {
    throw new Error('Refusing STORAGE_ADAPTER=file when MULTI_SHOP_DB_CONFIG_ENABLED=true.');
  }
  if (
    normalized === 'postgres' &&
    isProductionRuntime(env) &&
    !isProductionDbWriteAllowed(env)
  ) {
    throw new Error(
      `Refusing STORAGE_ADAPTER=postgres in production until ${PRODUCTION_DB_WRITE_UNLOCK_ENV}=true is set.`
    );
  }
  return normalized;
}

function assertMessengerDryRunAllowed(enabled, env = process.env) {
  const normalized = Boolean(enabled);
  if (normalized && isProductionRuntime(env)) {
    throw new Error('Refusing MESSENGER_DRY_RUN=true in production.');
  }
  return normalized;
}

module.exports = {
  PRODUCTION_DB_WRITE_UNLOCK_ENV,
  assertMessengerDryRunAllowed,
  assertStorageAdapterAllowed,
  envFlagEnabled,
  isProductionDbWriteAllowed,
  isProductionRuntime,
  normalizeStorageAdapterName
};

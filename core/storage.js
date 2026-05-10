const { createFileStorageAdapter } = require('./storage/file-adapter');
const { createPostgresStorageAdapter } = require('./storage/postgres-adapter');
const {
  assertStorageAdapterAllowed,
  isProductionDbWriteAllowed,
  normalizeStorageAdapterName
} = require('./storage-config');

function attachStorageMetadata(adapter, adapterName) {
  Object.defineProperties(adapter, {
    getAdapterName: {
      value: () => adapterName,
      enumerable: false
    },
    isProductionDbWriteAllowed: {
      value: () => isProductionDbWriteAllowed(process.env),
      enumerable: false
    }
  });
  return adapter;
}

function createStorageAdapter() {
  const adapterName = assertStorageAdapterAllowed(
    normalizeStorageAdapterName(process.env.STORAGE_ADAPTER),
    process.env
  );

  if (adapterName === 'file') {
    return attachStorageMetadata(createFileStorageAdapter(), adapterName);
  }

  if (adapterName === 'postgres') {
    return attachStorageMetadata(createPostgresStorageAdapter(), adapterName);
  }

  throw new Error(`STORAGE_ADAPTER="${adapterName}" chưa được hỗ trợ. Hiện hỗ trợ "file" và "postgres".`);
}

module.exports = createStorageAdapter();

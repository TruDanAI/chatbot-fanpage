const { createFileStorageAdapter } = require('./storage/file-adapter');
const { createPostgresStorageAdapter } = require('./storage/postgres-adapter');

function normalizeStorageAdapterName(raw) {
  return String(raw || 'file').trim().toLowerCase() || 'file';
}

function createStorageAdapter() {
  const adapterName = normalizeStorageAdapterName(process.env.STORAGE_ADAPTER);

  if (adapterName === 'file') {
    return createFileStorageAdapter();
  }

  if (adapterName === 'postgres') {
    return createPostgresStorageAdapter();
  }

  throw new Error(`STORAGE_ADAPTER="${adapterName}" chưa được hỗ trợ. Hiện hỗ trợ "file" và "postgres".`);
}

module.exports = createStorageAdapter();

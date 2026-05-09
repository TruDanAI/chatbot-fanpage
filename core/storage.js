const { createFileStorageAdapter } = require('./storage/file-adapter');

function normalizeStorageAdapterName(raw) {
  return String(raw || 'file').trim().toLowerCase() || 'file';
}

function createStorageAdapter() {
  const adapterName = normalizeStorageAdapterName(process.env.STORAGE_ADAPTER);

  if (adapterName === 'file') {
    return createFileStorageAdapter();
  }

  throw new Error(`STORAGE_ADAPTER="${adapterName}" chưa được hỗ trợ. Hiện chỉ hỗ trợ "file".`);
}

module.exports = createStorageAdapter();

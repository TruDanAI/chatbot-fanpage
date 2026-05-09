const { createFileStorageAdapter } = require('../core/storage/file-adapter');
const { runStorageAdapterContract } = require('./storage-contract');

runStorageAdapterContract({
  name: 'file storage',
  createAdapter: createFileStorageAdapter
});

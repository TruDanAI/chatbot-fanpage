// Test entry point — yêu cầu các file *.test.js rồi gọi run().
const { run } = require('./harness');

require('./nlp.test');
require('./responses.test');
require('./quick-replies.test');
require('./messenger-client.test');
require('./image-service.test');
require('./rules.test');
require('./storage-config.test');
require('./storage-file-adapter.test');
require('./storage-postgres-adapter.test');
require('./migration-plan.test');
require('./admin-auth.test');
require('./admin-routes.test');
require('./index.test');

run()
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

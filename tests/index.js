// Test entry point — yêu cầu các file *.test.js rồi gọi run().
const { run } = require('./harness');

require('./nlp.test');
require('./responses.test');
require('./quick-replies.test');
require('./messenger-client.test');
require('./messenger-send-errors.test');
require('./image-service.test');
require('./rules.test');
require('./multi-shop-isolation.test');
require('./webhook.test');
require('./webhook-queue.test');
require('./reminder-service.test');
require('./storage-config.test');
require('./storage-file-adapter.test');
require('./storage-postgres-adapter.test');
require('./feature-flags.test');
require('./db-shop-config.test');
require('./demo-shop-fixture.test');
require('./page-credentials.test');
require('./page-token-health.test');
require('./page-token-health-script.test');
require('./page-credential-writes.test');
require('./page-setup-preview.test');
require('./page-credential-seed-script.test');
require('./seed-test-shop-canary.test');
require('./migration-plan.test');
require('./admin-auth.test');
require('./admin-internal-notes.test');
require('./internal-notes-sql-verifier.test');
require('./multi-shop-sql.test');
require('./page-mapping-writes.test');
require('./product-writes.test');
require('./product-import-writes.test');
require('./asset-writes.test');
require('./asset-uploads.test');
require('./shop-control-writes.test');
require('./shop-readiness-check.test');
require('./admin-routes.test');
require('./wizard-ui.test');
require('./wizard-routes.test');
require('./index.test');

run()
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

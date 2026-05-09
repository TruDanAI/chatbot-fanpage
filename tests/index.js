// Test entry point — yêu cầu các file *.test.js rồi gọi run().
const { run } = require('./harness');

require('./nlp.test');
require('./responses.test');
require('./quick-replies.test');
require('./rules.test');
require('./storage-file-adapter.test');
require('./index.test');

run()
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

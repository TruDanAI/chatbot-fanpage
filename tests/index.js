// Test entry point — yêu cầu các file *.test.js rồi gọi run().
const { run } = require('./harness');

require('./nlp.test');
require('./responses.test');
require('./quick-replies.test');
require('./rules.test');
require('./index.test');

const exitCode = run();
process.exit(exitCode);

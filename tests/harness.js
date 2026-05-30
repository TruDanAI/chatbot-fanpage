// Test harness siêu nhẹ — không phụ thuộc framework ngoài.
// Cú pháp:
//   const { describe, it, expect, run } = require('./harness');
//   describe('group', () => {
//     it('case', () => expect(value).toEqual(other));
//   });
//   await run();    // hoặc trả về Promise<exit code>

const groups = [];
let current = null;
const runnerConsole = {
  log: console.log.bind(console)
};
const VERBOSE_TEST_CONSOLE = /^(1|true|yes|on)$/i.test(String(process.env.TEST_VERBOSE_CONSOLE || '').trim());

function describe(name, fn) {
  current = { name, cases: [] };
  groups.push(current);
  fn();
  current = null;
}

function it(name, fn) {
  if (!current) throw new Error('it() phải nằm trong describe()');
  current.cases.push({ name, fn });
}

function expect(actual) {
  return {
    toEqual(expected) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      if (!ok) throw new Error(`expected ${JSON.stringify(expected)} nhưng nhận ${JSON.stringify(actual)}`);
    },
    toBe(expected) {
      if (actual !== expected) throw new Error(`expected ${expected} (===) nhưng nhận ${actual}`);
    },
    toBeTrue() {
      if (actual !== true) throw new Error(`expected true nhưng nhận ${actual}`);
    },
    toBeFalse() {
      if (actual !== false) throw new Error(`expected false nhưng nhận ${actual}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected truthy nhưng nhận ${actual}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`expected falsy nhưng nhận ${actual}`);
    },
    toContain(sub) {
      if (typeof actual === 'string') {
        if (!actual.includes(sub)) throw new Error(`expected string chứa "${sub}" nhưng nhận "${actual}"`);
      } else if (Array.isArray(actual)) {
        if (!actual.includes(sub)) throw new Error(`expected array chứa ${JSON.stringify(sub)} nhưng nhận ${JSON.stringify(actual)}`);
      } else {
        throw new Error('toContain chỉ hỗ trợ string/array');
      }
    },
    toMatch(re) {
      if (!re.test(String(actual))) throw new Error(`expected "${actual}" match ${re}`);
    },
    notToBe(expected) {
      if (actual === expected) throw new Error(`expected !== ${expected} nhưng giống nhau`);
    }
  };
}

async function run() {
  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const group of groups) {
    runnerConsole.log(`\n  ${group.name}`);
    for (const c of group.cases) {
      const restoreConsole = muteConsoleDuringTest();
      try {
        await c.fn();
        pass += 1;
        restoreConsole();
        runnerConsole.log(`    ✓ ${c.name}`);
      } catch (err) {
        restoreConsole();
        fail += 1;
        failures.push({ group: group.name, case: c.name, err });
        runnerConsole.log(`    ✗ ${c.name}\n        ${err.stack || err.message}`);
      }
    }
  }

  runnerConsole.log(`\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

function muteConsoleDuringTest() {
  if (VERBOSE_TEST_CONSOLE) return () => {};
  const previous = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => {
    console.log = previous.log;
    console.warn = previous.warn;
    console.error = previous.error;
  };
}

module.exports = { describe, it, expect, run };

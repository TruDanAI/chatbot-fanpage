const { describe, it, expect } = require('./harness');
const { encryptCredential } = require('../core/credentials/page-credentials');
const {
  appAccessTokenFromEnv,
  chooseDatabaseUrl,
  createMetaTokenHealthClient,
  main,
  parseArgs
} = require('../scripts/check-page-token-health');

const MASTER_KEY = 'local-test-master-key-32-plus-characters';

function createClientClass(rows = []) {
  const instances = [];
  class FakeClient {
    constructor(config) {
      this.config = config;
      this.calls = [];
      this.writes = 0;
      this.connected = false;
      this.ended = false;
      instances.push(this);
    }

    async connect() {
      this.connected = true;
    }

    async query(sql, values) {
      this.calls.push({ sql: String(sql), values });
      if (/^\s*SELECT/i.test(String(sql))) return { rows };
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql))) this.writes += 1;
      throw new Error('write_not_allowed');
    }

    async end() {
      this.ended = true;
    }
  }
  return { Client: FakeClient, instances };
}

function credentialRow({
  token = 'EAAB-cli-page-token',
  pageRef = 'page-map-cli',
  expectedPageId = 'raw-cli-page-id'
} = {}) {
  return {
    shop_id: 'shop-cli',
    page_mapping_id: pageRef,
    page_ref: pageRef,
    credential_status: 'active',
    encrypted_value: encryptCredential(token, MASTER_KEY),
    expected_page_id: expectedPageId
  };
}

function baseEnv(overrides = {}) {
  return {
    CHATBOT_HEALTH_DATABASE_URL: 'postgres://health-user:health-pass@example.test/healthdb',
    DATABASE_URL: 'postgres://prod-user:prod-pass@example.test/proddb',
    CREDENTIAL_MASTER_KEY: MASTER_KEY,
    META_APP_ID: 'app-1',
    META_APP_ACCESS_TOKEN: 'app-access-token-secret',
    ...overrides
  };
}

function validMetaClient(pageId = 'raw-cli-page-id') {
  return {
    async debugToken() {
      return {
        is_valid: true,
        app_id: 'app-1',
        expires_at: 0,
        scopes: ['pages_messaging']
      };
    },
    async pageMe() {
      return { id: pageId, name: 'CLI Page' };
    }
  };
}

describe('page token health CLI script', () => {
  it('defaults to dry-run mode', () => {
    const options = parseArgs([]);

    expect(options.dryRun).toBeTrue();
    expect(options.apply).toBeFalse();
  });

  it('requires an explicit DB URL env and selects it when provided', () => {
    const env = baseEnv();
    const missing = chooseDatabaseUrl({ env, options: {} });
    const explicit = chooseDatabaseUrl({
      env,
      options: { dbUrlEnv: 'CHATBOT_HEALTH_DATABASE_URL' }
    });

    expect(missing.ok).toBeFalse();
    expect(missing.reason).toBe('db_url_env_required');
    expect(explicit.ok).toBeTrue();
    expect(explicit.envName).toBe('CHATBOT_HEALTH_DATABASE_URL');
    expect(explicit.value).toBe(env.CHATBOT_HEALTH_DATABASE_URL);
  });

  it('refuses DATABASE_URL even when requested explicitly', () => {
    const env = baseEnv();
    const disallowed = chooseDatabaseUrl({ env, options: { dbUrlEnv: 'DATABASE_URL' } });

    expect(disallowed.ok).toBeFalse();
    expect(disallowed.reason).toBe('database_url_disallowed');
  });

  it('fails safely when --db-url-env is missing', async () => {
    const { Client, instances } = createClientClass([credentialRow()]);
    const stdout = [];
    const stderr = [];
    const env = baseEnv();
    const code = await main({
      argv: [],
      env,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const output = stdout.concat(stderr).join('\n');

    expect(code).toBe(1);
    expect(instances.length).toBe(0);
    expect(output).toContain('db_url_env_required');
    expect(output.includes(env.CHATBOT_HEALTH_DATABASE_URL)).toBeFalse();
    expect(output.includes(env.DATABASE_URL)).toBeFalse();
    expect(output.includes('health-pass')).toBeFalse();
    expect(output.includes('prod-pass')).toBeFalse();
  });

  it('runs a dry-run JSON report without printing URL, token, encrypted value, or raw page id', async () => {
    const token = 'EAAB-cli-redaction-token';
    const expectedPageId = 'raw-cli-page-redaction-id';
    const rows = [credentialRow({ token, expectedPageId })];
    const encryptedValue = rows[0].encrypted_value;
    const { Client, instances } = createClientClass(rows);
    const stdout = [];
    const stderr = [];
    const env = baseEnv();

    const code = await main({
      argv: ['--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL'],
      env,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient(expectedPageId)
    });
    const output = stdout.join('\n');
    const report = JSON.parse(output);

    expect(code).toBe(0);
    expect(stderr.length).toBe(0);
    expect(report.mode).toBe('dry-run');
    expect(report.dry_run).toBeTrue();
    expect(report.results[0].token_health_status).toBe('valid');
    expect(report.counts.writes).toBe(0);
    expect(instances.length).toBe(1);
    expect(instances[0].config.connectionString).toBe(env.CHATBOT_HEALTH_DATABASE_URL);
    expect(instances[0].connected).toBeTrue();
    expect(instances[0].ended).toBeTrue();
    expect(instances[0].writes).toBe(0);
    expect(instances[0].calls.some(call => /^\s*(INSERT|UPDATE|DELETE)/i.test(call.sql))).toBeFalse();
    expect(output.includes(env.CHATBOT_HEALTH_DATABASE_URL)).toBeFalse();
    expect(output.includes(env.DATABASE_URL)).toBeFalse();
    expect(output.includes(token)).toBeFalse();
    expect(output.includes(encryptedValue)).toBeFalse();
    expect(output.includes('encrypted_value')).toBeFalse();
    expect(output.includes(expectedPageId)).toBeFalse();
    expect(output.includes('page_id')).toBeFalse();
  });

  it('disables apply mode before connecting or writing', async () => {
    const { Client, instances } = createClientClass([credentialRow()]);
    const stdout = [];
    const stderr = [];
    const code = await main({
      argv: ['--apply', '--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL'],
      env: baseEnv(),
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const output = stdout.concat(stderr).join('\n');

    expect(code).toBe(1);
    expect(instances.length).toBe(0);
    expect(output).toContain('apply_disabled');
  });

  it('missing explicit database configuration does not print DB URL values', async () => {
    const stdout = [];
    const stderr = [];
    const env = baseEnv({ CHATBOT_HEALTH_DATABASE_URL: '' });
    const { Client, instances } = createClientClass([]);
    const code = await main({
      argv: ['--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL'],
      env,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const output = stdout.concat(stderr).join('\n');

    expect(code).toBe(1);
    expect(instances.length).toBe(0);
    expect(output).toContain('missing_database_url');
    expect(output.includes(env.DATABASE_URL)).toBeFalse();
    expect(output.includes('prod-pass')).toBeFalse();
  });

  it('error output does not include DB URL when explicit URL matches DATABASE_URL', async () => {
    const stdout = [];
    const stderr = [];
    const env = baseEnv({ CHATBOT_HEALTH_DATABASE_URL: 'postgres://prod-user:prod-pass@example.test/proddb' });
    const { Client, instances } = createClientClass([]);
    const code = await main({
      argv: ['--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL'],
      env,
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const output = stdout.concat(stderr).join('\n');

    expect(code).toBe(1);
    expect(instances.length).toBe(0);
    expect(output).toContain('explicit_url_matches_database_url');
    expect(output.includes(env.CHATBOT_HEALTH_DATABASE_URL)).toBeFalse();
    expect(output.includes(env.DATABASE_URL)).toBeFalse();
    expect(output.includes('prod-pass')).toBeFalse();
  });

  it('builds a Meta client that returns normalized categories only', async () => {
    const secret = 'app-secret-value';
    const token = 'EAAB-normalized-client-token';
    const calls = [];
    const axios = {
      async get(url, options) {
        calls.push({ url, options });
        if (url.includes('/debug_token')) {
          return {
            data: {
              data: {
                is_valid: true,
                app_id: 'app-1',
                expires_at: 0,
                scopes: ['pages_messaging'],
                raw_response: 'RAW_META_RESPONSE',
                app_secret: secret
              }
            }
          };
        }
        const err = new Error(`raw provider failure ${token} ${secret}`);
        err.response = {
          status: 429,
          data: {
            error: {
              code: 613,
              message: `raw provider failure ${token} ${secret}`
            }
          }
        };
        throw err;
      }
    };
    const client = createMetaTokenHealthClient({
      env: {
        META_APP_ID: 'app-1',
        META_APP_SECRET: secret
      },
      axios
    });

    const debug = await client.debugToken({ token });
    const page = await client.pageMe({ token });
    const output = JSON.stringify({ debug, page });

    expect(appAccessTokenFromEnv({ META_APP_ID: 'app-1', META_APP_SECRET: secret })).toBe(`app-1|${secret}`);
    expect(debug.is_valid).toBeTrue();
    expect(page.error_category).toBe('rate_limited');
    expect(output.includes(token)).toBeFalse();
    expect(output.includes(secret)).toBeFalse();
    expect(output.includes('RAW_META_RESPONSE')).toBeFalse();
    expect(calls.length).toBe(2);
  });
});

const { describe, it, expect } = require('./harness');
const { encryptCredential } = require('../core/credentials/page-credentials');
const {
  appAccessTokenFromEnv,
  chooseDatabaseUrl,
  createMetaTokenHealthClient,
  graphErrorCategory,
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

function createFilteringClientClass(rows = []) {
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

    async query(sql, values = []) {
      const sqlText = String(sql);
      this.calls.push({ sql: sqlText, values });
      if (/^\s*SELECT/i.test(sqlText)) {
        let filtered = rows;
        const shopMatch = sqlText.match(/c\.shop_id\s*=\s*\$(\d+)/);
        const pageRefMatch = sqlText.match(/c\.page_mapping_id\s*=\s*\$(\d+)/);
        if (shopMatch) {
          filtered = filtered.filter(row => row.shop_id === values[Number(shopMatch[1]) - 1]);
        }
        if (pageRefMatch) {
          filtered = filtered.filter(row => row.page_mapping_id === values[Number(pageRefMatch[1]) - 1]);
        }
        return { rows: filtered };
      }
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sqlText)) this.writes += 1;
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
  shopId = 'shop-cli',
  pageRef = 'page-map-cli',
  expectedPageId = 'raw-cli-page-id'
} = {}) {
  return {
    shop_id: shopId,
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
  const calls = [];
  return {
    calls,
    async debugToken(input) {
      calls.push({ method: 'debugToken', input });
      return {
        is_valid: true,
        app_id: 'app-1',
        expires_at: 0,
        scopes: ['pages_messaging']
      };
    },
    async pageMe(input) {
      calls.push({ method: 'pageMe', input });
      return { id: pageId, name: 'CLI Page' };
    }
  };
}

function graphAxiosError({
  status = 400,
  code,
  subcode,
  axiosCode,
  message = 'raw provider error EAAB-graph-token raw-page-graph',
  request = true
} = {}) {
  const err = new Error(message);
  if (axiosCode) err.code = axiosCode;
  if (status) {
    err.response = {
      status,
      data: {
        error: {
          code,
          error_subcode: subcode,
          message,
          error_data: {
            subresponse: `subresponse ${message}`
          }
        }
      }
    };
  } else if (request) {
    err.request = {};
  }
  return err;
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

  it('--shop-id parses and constrains the credential SELECT', async () => {
    const options = parseArgs(['--shop-id', 'shop-filter']);
    const { Client, instances } = createClientClass([credentialRow()]);
    const stdout = [];
    const stderr = [];
    const code = await main({
      argv: ['--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL', '--shop-id', 'shop-filter'],
      env: baseEnv(),
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const select = instances[0].calls[0];

    expect(options.shopId).toBe('shop-filter');
    expect(code).toBe(0);
    expect(stderr.length).toBe(0);
    expect(select.sql).toContain('c.shop_id = $2');
    expect(select.values).toEqual(['fb_page_token', 'shop-filter']);
  });

  it('--page-ref parses and constrains the credential SELECT', async () => {
    const options = parseArgs(['--page-ref', 'page-map-filter']);
    const { Client, instances } = createClientClass([credentialRow()]);
    const stdout = [];
    const stderr = [];
    const code = await main({
      argv: ['--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL', '--page-ref', 'page-map-filter'],
      env: baseEnv(),
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const select = instances[0].calls[0];

    expect(options.pageRef).toBe('page-map-filter');
    expect(code).toBe(0);
    expect(stderr.length).toBe(0);
    expect(select.sql).toContain('c.page_mapping_id = $2');
    expect(select.values).toEqual(['fb_page_token', 'page-map-filter']);
  });

  it('rejects raw-looking page IDs in filters without printing them', async () => {
    const rawPageId = '123456789012345';
    const { Client, instances } = createClientClass([credentialRow()]);
    const stdout = [];
    const stderr = [];
    const code = await main({
      argv: ['--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL', '--page-ref', rawPageId],
      env: baseEnv(),
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient: validMetaClient()
    });
    const output = stdout.concat(stderr).join('\n');

    expect(code).toBe(1);
    expect(instances.length).toBe(0);
    expect(output).toContain('invalid_args');
    expect(output.includes(rawPageId)).toBeFalse();
  });

  it('filters reduce evaluated credentials before decrypting or checking', async () => {
    const rows = [
      credentialRow({
        shopId: 'shop-filter',
        pageRef: 'page-map-filter',
        expectedPageId: 'raw-filtered-page'
      }),
      credentialRow({
        shopId: 'other-shop',
        pageRef: 'page-map-other',
        expectedPageId: 'raw-other-page',
        token: 'EAAB-unselected-token'
      })
    ];
    rows[1].encrypted_value = 'not-an-envelope';
    const { Client, instances } = createFilteringClientClass(rows);
    const metaClient = validMetaClient('raw-filtered-page');
    const stdout = [];
    const stderr = [];
    const code = await main({
      argv: [
        '--db-url-env',
        'CHATBOT_HEALTH_DATABASE_URL',
        '--shop-id',
        'shop-filter',
        '--page-ref',
        'page-map-filter'
      ],
      env: baseEnv(),
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      Client,
      metaClient
    });
    const report = JSON.parse(stdout.join('\n'));

    expect(code).toBe(0);
    expect(stderr.length).toBe(0);
    expect(instances[0].calls[0].values).toEqual(['fb_page_token', 'shop-filter', 'page-map-filter']);
    expect(report.counts.credentials).toBe(1);
    expect(report.results.length).toBe(1);
    expect(report.results[0].shop_id).toBe('shop-filter');
    expect(report.results[0].page_ref).toBe('page-map-filter');
    expect(report.counts.decrypt_failed).toBe(0);
    expect(metaClient.calls.length).toBe(2);
  });

  it('disables apply mode before connecting or writing', async () => {
    const { Client, instances } = createClientClass([credentialRow()]);
    const stdout = [];
    const stderr = [];
    const code = await main({
      argv: ['--apply', '--db-url-env', 'CHATBOT_HEALTH_DATABASE_URL', '--shop-id', 'shop-cli', '--page-ref', 'page-map-cli'],
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
    const pageKeys = Object.keys(page).sort();

    expect(appAccessTokenFromEnv({ META_APP_ID: 'app-1', META_APP_SECRET: secret })).toBe(`app-1|${secret}`);
    expect(debug.is_valid).toBeTrue();
    expect(page.error_category).toBe('rate_limited');
    expect(page.operation).toBe('page_identity');
    expect(page.graph_error_code).toBe(613);
    expect(page.graph_error_subcode).toBe(null);
    expect(pageKeys).toEqual(['error_category', 'graph_error_code', 'graph_error_subcode', 'ok', 'operation'].sort());
    expect(output.includes(token)).toBeFalse();
    expect(output.includes(secret)).toBeFalse();
    expect(output.includes('RAW_META_RESPONSE')).toBeFalse();
    expect(calls.length).toBe(2);
  });

  it('classifies Graph OAuth and app-token auth failures without raw provider text', async () => {
    const token = 'EAAB-oauth-token';
    const rawMessage = `raw OAuth failure ${token}`;
    const pageOAuthError = graphAxiosError({ status: 400, code: 190, subcode: 463, message: rawMessage });
    const appAuthError = graphAxiosError({ status: 400, code: 190, message: rawMessage });
    const client = createMetaTokenHealthClient({
      env: { META_APP_ACCESS_TOKEN: 'app-access-token-secret' },
      axios: {
        async get(url) {
          if (url.includes('/debug_token')) throw appAuthError;
          throw pageOAuthError;
        }
      }
    });

    const debug = await client.debugToken({ token });
    const page = await client.pageMe({ token });
    const output = JSON.stringify({ debug, page });
    const debugKeys = Object.keys(debug).sort();
    const pageKeys = Object.keys(page).sort();

    expect(debug.error_category).toBe('app_auth_failed');
    expect(debug.operation).toBe('debug_token');
    expect(debug.graph_error_code).toBe(190);
    expect(debug.graph_error_subcode).toBe(null);
    expect(debugKeys).toEqual(['error_category', 'graph_error_code', 'graph_error_subcode', 'ok', 'operation'].sort());
    expect(page.error_category).toBe('graph_oauth_failed');
    expect(page.operation).toBe('page_identity');
    expect(page.graph_error_code).toBe(190);
    expect(page.graph_error_subcode).toBe(463);
    expect(pageKeys).toEqual(['error_category', 'graph_error_code', 'graph_error_subcode', 'ok', 'operation'].sort());
    expect(output.includes(rawMessage)).toBeFalse();
    expect(output.includes(token)).toBeFalse();
    expect(output.includes('subresponse')).toBeFalse();
  });

  it('classifies permission, rate-limit, timeout, network, and unknown Graph errors safely', () => {
    expect(graphErrorCategory(graphAxiosError({ status: 403, code: 200 }))).toBe('graph_permission_denied');
    expect(graphErrorCategory(graphAxiosError({ status: 429, code: 190 }))).toBe('rate_limited');
    expect(graphErrorCategory(graphAxiosError({ status: 400, code: 613 }))).toBe('rate_limited');
    expect(graphErrorCategory(graphAxiosError({ status: 0, axiosCode: 'ECONNABORTED' }))).toBe('timeout');
    expect(graphErrorCategory(graphAxiosError({ status: 0, axiosCode: 'ENOTFOUND' }))).toBe('network_failed');
    expect(graphErrorCategory(graphAxiosError({ status: 400, code: 100, subcode: 33 }))).toBe('graph_bad_request');
  });
});

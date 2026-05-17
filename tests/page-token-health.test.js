const { describe, it, expect } = require('./harness');
const { encryptCredential } = require('../core/credentials/page-credentials');
const {
  checkPageTokenHealth,
  normalizeDebugResponse,
  normalizePageResponse
} = require('../core/credentials/page-token-health');

const MASTER_KEY = 'local-test-master-key-32-plus-characters';
const NOW_MS = 2000000000000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function createClient(rows = []) {
  const calls = [];
  return {
    calls,
    writes: 0,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (/^\s*SELECT/i.test(String(sql))) return { rows };
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql))) this.writes += 1;
      return { rows: [] };
    }
  };
}

function credentialRow(overrides = {}) {
  const token = overrides.token || 'EAAB-local-page-token';
  return {
    shop_id: overrides.shopId || 'shop-1',
    page_mapping_id: overrides.pageRef || 'page-map-1',
    page_ref: overrides.pageRef || 'page-map-1',
    credential_status: 'active',
    encrypted_value: overrides.encryptedValue || encryptCredential(token, overrides.masterKey || MASTER_KEY),
    expected_page_id: overrides.expectedPageId || 'raw-page-123',
    ...overrides.row
  };
}

function createMetaClient({
  debug,
  page,
  throwDebug,
  throwPage
} = {}) {
  const calls = [];
  return {
    calls,
    async debugToken(input) {
      calls.push({ method: 'debugToken', input });
      if (throwDebug) throw throwDebug;
      return debug;
    },
    async pageMe(input) {
      calls.push({ method: 'pageMe', input });
      if (throwPage) throw throwPage;
      return page;
    }
  };
}

function validDebug(overrides = {}) {
  return {
    is_valid: true,
    app_id: 'app-1',
    expires_at: NOW_SECONDS + 3600,
    scopes: ['pages_messaging'],
    ...overrides
  };
}

async function runHealth({
  rows = [credentialRow()],
  metaClient = createMetaClient({
    debug: validDebug(),
    page: { id: 'raw-page-123', name: 'Page Name' }
  }),
  masterKey = MASTER_KEY,
  expectedAppId = 'app-1',
  requiredPermissions = ['pages_messaging']
} = {}) {
  const client = createClient(rows);
  const report = await checkPageTokenHealth({
    client,
    metaClient,
    masterKey,
    expectedAppId,
    requiredPermissions,
    now: () => NOW_MS
  });
  return { report, client, metaClient };
}

function firstStatus(report) {
  return report.results[0].token_health_status;
}

function firstCategory(report) {
  return report.results[0].error_category;
}

describe('page token health core', () => {
  it('reports a valid token without exposing secret fields', async () => {
    const token = 'EAAB-valid-token';
    const encrypted = encryptCredential(token, MASTER_KEY);
    const { report } = await runHealth({
      rows: [credentialRow({ token, encryptedValue: encrypted })]
    });
    const output = JSON.stringify(report);

    expect(firstStatus(report)).toBe('valid');
    expect(report.results[0].shop_id).toBe('shop-1');
    expect(report.results[0].page_ref).toBe('page-map-1');
    expect(report.results[0].credential_status).toBe('active');
    expect(report.counts.valid).toBe(1);
    expect(output.includes(token)).toBeFalse();
    expect(output.includes(encrypted)).toBeFalse();
    expect(output.includes('raw-page-123')).toBeFalse();
  });

  it('reports invalid token status', async () => {
    const { report, metaClient } = await runHealth({
      metaClient: createMetaClient({
        debug: validDebug({ is_valid: false, expires_at: NOW_SECONDS + 3600 }),
        page: { id: 'raw-page-123' }
      })
    });

    expect(firstStatus(report)).toBe('invalid');
    expect(report.results[0].error_category).toBe('invalid');
    expect(report.counts.invalid).toBe(1);
    expect(metaClient.calls.length).toBe(1);
  });

  it('reports expired token status before page identity validation', async () => {
    const { report, metaClient } = await runHealth({
      metaClient: createMetaClient({
        debug: validDebug({ expires_at: NOW_SECONDS - 1 }),
        page: { id: 'raw-page-123' }
      })
    });

    expect(firstStatus(report)).toBe('expired');
    expect(report.counts.expired).toBe(1);
    expect(metaClient.calls.length).toBe(1);
  });

  it('reports permission missing when required permission is absent', async () => {
    const { report, metaClient } = await runHealth({
      metaClient: createMetaClient({
        debug: validDebug({ scopes: ['pages_read_engagement'] }),
        page: { id: 'raw-page-123' }
      })
    });

    expect(firstStatus(report)).toBe('permission_missing');
    expect(report.results[0].error_category).toBe('permission_missing');
    expect(report.counts.permission_missing).toBe(1);
    expect(metaClient.calls.length).toBe(1);
  });

  it('reports page mismatch without printing either raw page id', async () => {
    const expectedPageId = 'raw-page-expected';
    const returnedPageId = 'raw-page-returned';
    const { report } = await runHealth({
      rows: [credentialRow({ expectedPageId })],
      metaClient: createMetaClient({
        debug: validDebug(),
        page: { id: returnedPageId, name: 'Other Page' }
      })
    });
    const output = JSON.stringify(report);

    expect(firstStatus(report)).toBe('page_mismatch');
    expect(report.counts.page_mismatch).toBe(1);
    expect(output.includes(expectedPageId)).toBeFalse();
    expect(output.includes(returnedPageId)).toBeFalse();
  });

  it('reports app mismatch when debug_token belongs to another app', async () => {
    const { report } = await runHealth({
      metaClient: createMetaClient({
        debug: validDebug({ app_id: 'other-app' }),
        page: { id: 'raw-page-123' }
      })
    });

    expect(firstStatus(report)).toBe('app_mismatch');
    expect(report.results[0].error_category).toBe('app_mismatch');
    expect(report.counts.app_mismatch).toBe(1);
  });

  it('reports rate limit from normalized provider errors', async () => {
    const { report } = await runHealth({
      metaClient: createMetaClient({
        debug: { ok: false, error_category: 'rate_limited' },
        page: { id: 'raw-page-123' }
      })
    });

    expect(firstStatus(report)).toBe('rate_limited');
    expect(report.results[0].error_category).toBe('rate_limited');
    expect(report.counts.rate_limited).toBe(1);
  });

  it('keeps Graph OAuth diagnostics safe while using the existing invalid status', async () => {
    const { report } = await runHealth({
      metaClient: createMetaClient({
        debug: { ok: false, error_category: 'graph_oauth_failed' },
        page: { id: 'raw-page-123' }
      })
    });

    expect(firstStatus(report)).toBe('invalid');
    expect(firstCategory(report)).toBe('graph_oauth_failed');
    expect(report.counts.invalid).toBe(1);
  });

  it('keeps Graph permission diagnostics safe while using the existing permission status', async () => {
    const { report } = await runHealth({
      metaClient: createMetaClient({
        debug: validDebug(),
        page: { ok: false, error_category: 'graph_permission_denied' }
      })
    });

    expect(firstStatus(report)).toBe('permission_missing');
    expect(firstCategory(report)).toBe('graph_permission_denied');
    expect(report.counts.permission_missing).toBe(1);
  });

  it('keeps provider failure categories without raw provider details in the report', async () => {
    const rawMessage = 'RAW_META_RESPONSE EAAB-provider-token raw-page-provider customer-provider message-provider';
    const rawSubresponse = 'RAW_META_SUBRESPONSE';
    const { report } = await runHealth({
      metaClient: createMetaClient({
        debug: {
          ok: false,
          error_category: 'graph_bad_request',
          message: rawMessage,
          response: {
            data: {
              error: {
                message: rawMessage,
                error_data: {
                  subresponse: rawSubresponse
                }
              }
            }
          }
        },
        page: { id: 'raw-page-123' }
      })
    });
    const output = JSON.stringify(report);

    expect(firstStatus(report)).toBe('check_failed');
    expect(firstCategory(report)).toBe('graph_bad_request');
    expect(output.includes(rawMessage)).toBeFalse();
    expect(output.includes(rawSubresponse)).toBeFalse();
    expect(output.includes('EAAB-provider-token')).toBeFalse();
    expect(output.includes('raw-page-provider')).toBeFalse();
    expect(output.includes('customer-provider')).toBeFalse();
    expect(output.includes('message-provider')).toBeFalse();
  });

  it('reports network or provider check failure without raw error text', async () => {
    const rawMessage = 'RAW_META_RESPONSE EAAB-leaked-token raw-page-leaked customer-123 message-body';
    const err = new Error(rawMessage);
    const { report } = await runHealth({
      metaClient: createMetaClient({
        throwDebug: err,
        page: { id: 'raw-page-123' }
      })
    });
    const output = JSON.stringify(report);

    expect(firstStatus(report)).toBe('check_failed');
    expect(report.results[0].error_category).toBe('check_failed');
    expect(output.includes(rawMessage)).toBeFalse();
    expect(output.includes('EAAB-leaked-token')).toBeFalse();
    expect(output.includes('raw-page-leaked')).toBeFalse();
    expect(output.includes('customer-123')).toBeFalse();
    expect(output.includes('message-body')).toBeFalse();
  });

  it('reports missing CREDENTIAL_MASTER_KEY before querying credentials', async () => {
    const client = createClient([credentialRow()]);
    const report = await checkPageTokenHealth({
      client,
      metaClient: createMetaClient({ debug: validDebug(), page: { id: 'raw-page-123' } }),
      masterKey: '',
      expectedAppId: 'app-1',
      requiredPermissions: ['pages_messaging']
    });

    expect(firstStatus(report)).toBe('config_missing');
    expect(report.results[0].error_category).toBe('credential_master_key_missing');
    expect(report.counts.config_missing).toBe(1);
    expect(client.calls.length).toBe(0);
  });

  it('reports decrypt failure without calling Meta', async () => {
    const metaClient = createMetaClient({ debug: validDebug(), page: { id: 'raw-page-123' } });
    const { report } = await runHealth({
      rows: [credentialRow({
        encryptedValue: encryptCredential('EAAB-token', 'different-master-key')
      })],
      metaClient
    });

    expect(firstStatus(report)).toBe('decrypt_failed');
    expect(report.results[0].error_category).toBe('decrypt_failed');
    expect(report.counts.decrypt_failed).toBe(1);
    expect(metaClient.calls.length).toBe(0);
  });

  it('reports no active credential as an empty dry-run result set', async () => {
    const { report, metaClient } = await runHealth({ rows: [] });

    expect(report.mode).toBe('dry-run');
    expect(report.dry_run).toBeTrue();
    expect(report.results.length).toBe(0);
    expect(report.counts.credentials).toBe(0);
    expect(report.counts.no_active_credentials).toBe(1);
    expect(metaClient.calls.length).toBe(0);
  });

  it('reports duplicate active credentials as ambiguous without decrypting them', async () => {
    const metaClient = createMetaClient({ debug: validDebug(), page: { id: 'raw-page-123' } });
    const rows = [
      credentialRow({ encryptedValue: 'not-an-envelope' }),
      credentialRow({ encryptedValue: 'also-not-an-envelope' })
    ];
    const { report } = await runHealth({ rows, metaClient });

    expect(firstStatus(report)).toBe('check_failed');
    expect(report.results[0].credential_status).toBe('ambiguous_active');
    expect(report.results[0].error_category).toBe('credential_ambiguous');
    expect(report.results[0].counts.active_credentials).toBe(2);
    expect(report.counts.ambiguous_credentials).toBe(2);
    expect(metaClient.calls.length).toBe(0);
  });

  it('dry-run performs no writes', async () => {
    const { report, client } = await runHealth();

    expect(report.dry_run).toBeTrue();
    expect(report.counts.writes).toBe(0);
    expect(client.writes).toBe(0);
    expect(client.calls.some(call => /^\s*(INSERT|UPDATE|DELETE)/i.test(call.sql))).toBeFalse();
  });

  it('redacts token, encrypted_value, DB URL, raw page_id, raw Meta response, app secret, customer id, and message body', async () => {
    const token = 'EAAB-redaction-token';
    const encryptedValue = encryptCredential(token, MASTER_KEY);
    const rawPageId = 'raw-page-redaction-123';
    const rawDatabaseUrl = 'postgres://user:pass@example.test/health';
    const rawMetaResponse = 'RAW_META_RESPONSE';
    const appSecret = 'app-secret-redaction-value';
    const customerId = 'customer-redaction-123';
    const messageBody = 'private customer message body';
    const { report } = await runHealth({
      rows: [credentialRow({
        token,
        encryptedValue,
        expectedPageId: rawPageId,
        pageRef: 'safe-page-ref'
      })],
      metaClient: createMetaClient({
        debug: {
          data: {
            is_valid: true,
            app_id: 'app-1',
            expires_at: NOW_SECONDS + 3600,
            scopes: ['pages_messaging'],
            raw: rawMetaResponse,
            app_secret: appSecret,
            customer_id: customerId,
            message: messageBody
          }
        },
        page: {
          id: rawPageId,
          name: 'Private Page Name',
          raw: rawMetaResponse,
          app_secret: appSecret,
          customer_id: customerId,
          message: messageBody
        }
      })
    });
    const output = JSON.stringify(report);

    expect(firstStatus(report)).toBe('valid');
    expect(output.includes(token)).toBeFalse();
    expect(output.includes(encryptedValue)).toBeFalse();
    expect(output.includes('encrypted_value')).toBeFalse();
    expect(output.includes(rawDatabaseUrl)).toBeFalse();
    expect(output.includes(rawPageId)).toBeFalse();
    expect(output.includes('page_id')).toBeFalse();
    expect(output.includes(rawMetaResponse)).toBeFalse();
    expect(output.includes(appSecret)).toBeFalse();
    expect(output.includes(customerId)).toBeFalse();
    expect(output.includes(messageBody)).toBeFalse();
  });

  it('normalizes debug_token and page identity envelopes', () => {
    const debug = normalizeDebugResponse({
      data: {
        data: {
          is_valid: true,
          app_id: 'app-1',
          expires_at: 0,
          granular_scopes: [{ scope: 'pages_messaging' }]
        }
      }
    });
    const page = normalizePageResponse({ data: { id: 'raw-page-123', name: 'Name' } });

    expect(debug.ok).toBeTrue();
    expect(debug.scopes).toEqual(['pages_messaging']);
    expect(page.ok).toBeTrue();
    expect(page.id).toBe('raw-page-123');
  });
});

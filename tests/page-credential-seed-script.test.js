const { describe, it, expect } = require('./harness');
const {
  PRODUCTION_CONFIRMATION,
  chooseDatabaseUrl,
  main,
  preparePageCredentialSeed
} = require('../scripts/prepare-page-credential-seed');

function createFakeClient({ mappingRows = [{ shop_id: 'adult-shop', page_mapping_id: 'adult-page-map' }], activeCount = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (/FROM shops s\s+JOIN shop_pages sp/i.test(sql)) {
        return { rows: mappingRows };
      }
      if (/FROM shop_page_credentials/i.test(sql) && /COUNT\(\*\)::int/i.test(sql)) {
        return { rows: [{ count: activeCount }] };
      }
      if (/INSERT INTO shop_page_credentials/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(String(sql).trim())) {
        return { rows: [] };
      }
      throw new Error(`unexpected_query:${sql}`);
    }
  };
}

function baseEnv(overrides = {}) {
  return {
    CHATBOT_TEST_DATABASE_URL: 'postgres://test-user:test-pass@example.test/testdb',
    DATABASE_URL: 'postgres://prod-user:prod-pass@example.test/proddb',
    CREDENTIAL_MASTER_KEY: 'local-test-master-key-32-plus-characters',
    PAGE_CREDENTIAL_TOKEN: 'EAAB-local-secret-token',
    PAGE_ID: '1234567890',
    ...overrides
  };
}

describe('page credential seed preparation script', () => {
  it('does not log plaintext token or encrypted value during apply', async () => {
    const client = createFakeClient();
    const env = baseEnv();
    const lines = [];

    await preparePageCredentialSeed({
      client,
      env,
      options: { apply: true, production: false, shopId: 'adult-shop', pageId: '1234567890' },
      stdout: line => lines.push(line)
    });

    const insertCall = client.calls.find(call => /INSERT INTO shop_page_credentials/i.test(call.sql));
    const encryptedValue = insertCall.values[4];
    const output = lines.join('\n');

    expect(output.includes(env.PAGE_CREDENTIAL_TOKEN)).toBeFalse();
    expect(output.includes(encryptedValue)).toBeFalse();
    expect(output).toContain('credential_inserted=true');
  });

  it('fails before querying when the credential master key is missing', async () => {
    const client = createFakeClient();
    let errorMessage = '';

    try {
      await preparePageCredentialSeed({
        client,
        env: baseEnv({ CREDENTIAL_MASTER_KEY: '' }),
        options: { apply: false, production: false, shopId: 'adult-shop', pageId: '1234567890' }
      });
    } catch (err) {
      errorMessage = err.message;
    }

    expect(errorMessage).toBe('credential_master_key_missing');
    expect(client.calls.length).toBe(0);
  });

  it('fails safely when the active shop/page mapping is missing', async () => {
    const client = createFakeClient({ mappingRows: [] });
    const lines = [];
    let errorMessage = '';

    try {
      await preparePageCredentialSeed({
        client,
        env: baseEnv(),
        options: { apply: false, production: false, shopId: 'adult-shop', pageId: '1234567890' },
        stdout: line => lines.push(line)
      });
    } catch (err) {
      errorMessage = err.message;
    }

    expect(errorMessage).toBe('shop_page_not_found');
    expect(lines.join('\n')).toContain('shop_found=false');
    expect(lines.join('\n')).toContain('page_found=false');
  });

  it('fails safely when an active credential already exists', async () => {
    const client = createFakeClient({ activeCount: 1 });
    const lines = [];
    let errorMessage = '';

    try {
      await preparePageCredentialSeed({
        client,
        env: baseEnv(),
        options: { apply: true, production: false, shopId: 'adult-shop', pageId: '1234567890' },
        stdout: line => lines.push(line)
      });
    } catch (err) {
      errorMessage = err.message;
    }

    expect(errorMessage).toBe('active_credential_exists');
    expect(lines.join('\n')).toContain('active_credential_exists=true');
    expect(client.calls.some(call => /INSERT INTO shop_page_credentials/i.test(call.sql))).toBeFalse();
  });

  it('dry-run validates and does not write', async () => {
    const client = createFakeClient();
    const lines = [];
    const result = await preparePageCredentialSeed({
      client,
      env: baseEnv(),
      options: { apply: false, production: false, shopId: 'adult-shop', pageId: '1234567890' },
      stdout: line => lines.push(line)
    });

    expect(result.dryRun).toBeTrue();
    expect(client.calls.some(call => /INSERT INTO shop_page_credentials/i.test(call.sql))).toBeFalse();
    expect(client.calls.some(call => /^BEGIN$/i.test(call.sql.trim()))).toBeFalse();
    expect(lines.join('\n')).toContain('dry_run_no_write=true');
  });

  it('production apply requires explicit confirmation before DATABASE_URL is selected', () => {
    const missing = chooseDatabaseUrl({
      env: baseEnv({ CONFIRM_PRODUCTION_WRITE: '' }),
      options: { production: true, apply: true }
    });
    const confirmed = chooseDatabaseUrl({
      env: baseEnv({ CONFIRM_PRODUCTION_WRITE: PRODUCTION_CONFIRMATION }),
      options: { production: true, apply: true }
    });

    expect(missing.ok).toBeFalse();
    expect(missing.reason).toBe('missing_production_confirmation');
    expect(confirmed.ok).toBeTrue();
    expect(confirmed.envName).toBe('DATABASE_URL');
  });

  it('ignores DATABASE_URL outside approved production apply mode', () => {
    const result = chooseDatabaseUrl({
      env: {
        DATABASE_URL: 'postgres://prod-user:prod-pass@example.test/proddb'
      },
      options: { production: false, apply: false }
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('missing_explicit_database_url');
    expect(result.message.includes('prod-pass')).toBeFalse();
  });

  it('CLI errors do not print token or database URL', async () => {
    const stderr = [];
    const code = await main({
      argv: ['--dry-run', '--shop-id', 'adult-shop', '--page-id', '1234567890'],
      env: baseEnv({ CHATBOT_TEST_DATABASE_URL: '' }),
      stdout: () => {},
      stderr: line => stderr.push(line)
    });
    const output = stderr.join('\n');

    expect(code).toBe(1);
    expect(output.includes('EAAB-local-secret-token')).toBeFalse();
    expect(output.includes('prod-pass')).toBeFalse();
  });
});

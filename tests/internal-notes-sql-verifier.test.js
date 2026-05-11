const { describe, it, expect } = require('./harness');
const {
  chooseVerificationDatabaseUrl,
  isPostgresUrl,
  sanitizeMessage
} = require('../scripts/verify-internal-notes-sql');

describe('internal notes SQL verifier safety', () => {
  it('skips safely when no explicit non-production URL is set', () => {
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: 'postgres://prod:secret@example.test/prod'
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeTrue();
    expect(result.reason).toBe('missing_explicit_database_url');
    expect(result.message.includes('postgres://prod:secret@example.test/prod')).toBeFalse();
    expect(result.message).toContain('DATABASE_URL is intentionally ignored');
  });

  it('prefers CHATBOT_TEST_DATABASE_URL over staging', () => {
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_TEST_DATABASE_URL: 'postgres://test-user:test-pass@example.test/testdb',
      CHATBOT_STAGING_DATABASE_URL: 'postgres://stage-user:stage-pass@example.test/stagedb'
    });

    expect(result.ok).toBeTrue();
    expect(result.envName).toBe('CHATBOT_TEST_DATABASE_URL');
    expect(result.value).toBe('postgres://test-user:test-pass@example.test/testdb');
  });

  it('allows CHATBOT_STAGING_DATABASE_URL when the test URL is absent', () => {
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_STAGING_DATABASE_URL: 'postgresql://stage-user:stage-pass@example.test/stagedb'
    });

    expect(result.ok).toBeTrue();
    expect(result.envName).toBe('CHATBOT_STAGING_DATABASE_URL');
    expect(result.value).toBe('postgresql://stage-user:stage-pass@example.test/stagedb');
  });

  it('rejects an explicit URL that equals DATABASE_URL without printing the URL', () => {
    const url = 'postgres://prod:secret@example.test/prod';
    const result = chooseVerificationDatabaseUrl({
      DATABASE_URL: url,
      CHATBOT_TEST_DATABASE_URL: url
    });

    expect(result.ok).toBeFalse();
    expect(result.skipped).toBeFalse();
    expect(result.reason).toBe('explicit_url_matches_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('rejects non-PostgreSQL explicit URLs without printing the URL', () => {
    const url = 'mysql://user:secret@example.test/db';
    const result = chooseVerificationDatabaseUrl({
      CHATBOT_TEST_DATABASE_URL: url
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe('invalid_explicit_database_url');
    expect(result.message.includes(url)).toBeFalse();
  });

  it('recognizes postgres URL schemes only', () => {
    expect(isPostgresUrl('postgres://user:pass@example.test/db')).toBeTrue();
    expect(isPostgresUrl('postgresql://user:pass@example.test/db')).toBeTrue();
    expect(isPostgresUrl('mysql://user:pass@example.test/db')).toBeFalse();
    expect(isPostgresUrl('not a url')).toBeFalse();
  });

  it('redacts configured database URL values from error messages', () => {
    const url = 'postgres://user:secret@example.test/db';
    const message = sanitizeMessage(`failed to connect to ${url}`, {
      CHATBOT_TEST_DATABASE_URL: url
    });

    expect(message).toBe('failed to connect to [redacted]');
    expect(message.includes('secret')).toBeFalse();
  });
});

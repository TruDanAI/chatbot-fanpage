function loadPgClient() {
  try {
    return require('pg').Client;
  } catch (_) {
    throw new Error('Package "pg" is required for PostgreSQL admin dashboard.');
  }
}

async function insertAuditLogEntry(client, entry = {}) {
  await client.query(`
    INSERT INTO admin_audit_log (
      occurred_at, tenant_id, page_id, actor_id, actor_roles, action,
      resource_type, resource_id, outcome, request_id, request_ip_hash,
      user_agent, metadata
    )
    VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
  `, [
    entry.occurred_at,
    entry.tenant_id || '',
    entry.page_id || '',
    entry.actor_id || 'anonymous',
    Array.isArray(entry.actor_roles) ? entry.actor_roles : [],
    entry.action || '',
    entry.resource_type || '',
    entry.resource_id || '',
    entry.outcome || 'error',
    entry.request_id || '',
    entry.request_ip_hash || '',
    entry.user_agent || '',
    JSON.stringify(entry.metadata || {})
  ]);
}

function createPostgresAuditLogger({
  enabled = false,
  databaseUrl = process.env.DATABASE_URL,
  Client
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      async record() {
        return { skipped: true, reason: 'disabled' };
      }
    };
  }

  async function record(entry = {}) {
    if (!databaseUrl) {
      const err = new Error('DATABASE_URL is required for admin audit logging.');
      err.statusCode = 503;
      throw err;
    }
    const PgClient = Client || loadPgClient();
    const client = new PgClient({ connectionString: databaseUrl });
    await client.connect();
    try {
      await insertAuditLogEntry(client, entry);
      return { recorded: true };
    } finally {
      await client.end();
    }
  }

  return {
    enabled: true,
    record
  };
}

module.exports = {
  createPostgresAuditLogger,
  insertAuditLogEntry
};

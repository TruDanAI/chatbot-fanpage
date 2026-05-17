const { checkPageTokenHealth } = require('../core/credentials/page-token-health');

const DEFAULT_GRAPH_VERSION = 'v19.0';

function text(value) {
  return value == null ? '' : String(value);
}

function trimText(value) {
  return text(value).trim();
}

function normalizeList(value) {
  return trimText(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function isPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  } catch (_) {
    return false;
  }
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    dryRun: true,
    dbUrlEnv: '',
    expectedAppId: '',
    requiredPermissions: undefined,
    graphVersion: DEFAULT_GRAPH_VERSION
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      return argv[index] || '';
    };

    if (arg === '--dry-run') {
      options.dryRun = true;
      options.apply = false;
    } else if (arg === '--apply') {
      options.apply = true;
      options.dryRun = false;
    } else if (arg === '--db-url-env') {
      options.dbUrlEnv = nextValue();
    } else if (arg === '--expected-app-id') {
      options.expectedAppId = nextValue();
    } else if (arg === '--required-permissions') {
      options.requiredPermissions = normalizeList(nextValue());
    } else if (arg === '--graph-version') {
      options.graphVersion = nextValue() || DEFAULT_GRAPH_VERSION;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: node scripts/check-page-token-health.js --db-url-env NAME [--dry-run] [--expected-app-id APP_ID] [--required-permissions pages_messaging]',
    '',
    '--db-url-env is required and must name an explicit non-production PostgreSQL URL env var. DATABASE_URL is refused.',
    'Phase 1 is dry-run only. --apply is parsed but disabled.'
  ].join('\n');
}

function chooseDatabaseUrl({ env = process.env, options = {} } = {}) {
  const requestedName = trimText(options.dbUrlEnv);
  const databaseUrl = trimText(env.DATABASE_URL);

  if (!requestedName) {
    return {
      ok: false,
      reason: 'db_url_env_required',
      message: 'Missing required --db-url-env. Provide the name of an explicit non-production PostgreSQL URL env var. DATABASE_URL is refused.'
    };
  }

  if (requestedName.toUpperCase() === 'DATABASE_URL') {
    return {
      ok: false,
      reason: 'database_url_disallowed',
      message: 'Refusing to use DATABASE_URL for this dry-run health check. Set an explicit non-production health-check URL env var.'
    };
  }

  const value = trimText(env[requestedName]);
  if (!value) {
    return {
      ok: false,
      reason: 'missing_database_url',
      message: 'The requested DB URL environment variable is not set. The URL value was not printed.'
    };
  }

  if (databaseUrl && value === databaseUrl) {
    return {
      ok: false,
      reason: 'explicit_url_matches_database_url',
      message: 'Refusing to use an explicit health-check URL that matches DATABASE_URL. The URL value was not printed.'
    };
  }

  if (!isPostgresUrl(value)) {
    return {
      ok: false,
      reason: 'invalid_database_url',
      message: 'The requested DB URL environment variable must contain a postgres:// or postgresql:// URL. The URL value was not printed.'
    };
  }

  return {
    ok: true,
    envName: requestedName,
    value
  };
}

function graphUrl(graphVersion, path) {
  const version = trimText(graphVersion || DEFAULT_GRAPH_VERSION).replace(/^\/+|\/+$/g, '');
  const normalizedPath = trimText(path).replace(/^\/+/, '');
  return `https://graph.facebook.com/${version}/${normalizedPath}`;
}

function appAccessTokenFromEnv(env = process.env) {
  const explicit = trimText(env.META_APP_ACCESS_TOKEN || env.FB_APP_ACCESS_TOKEN);
  if (explicit) return explicit;
  const appId = trimText(env.META_APP_ID || env.FB_APP_ID);
  const appSecret = trimText(env.META_APP_SECRET || env.FB_APP_SECRET);
  if (appId && appSecret) return `${appId}|${appSecret}`;
  return '';
}

function facebookErrorCode(err) {
  return Number(err?.response?.data?.error?.code || 0);
}

function facebookErrorSubcode(err) {
  return Number(
    err?.response?.data?.error?.error_subcode
      || err?.response?.data?.error?.subcode
      || 0
  );
}

const RATE_LIMIT_ERROR_CODES = Object.freeze([4, 17, 32, 613]);
const OAUTH_ERROR_CODES = Object.freeze([190, 102, 104]);
const OAUTH_ERROR_SUBCODES = Object.freeze([458, 459, 460, 463, 464, 467]);
const APP_AUTH_ERROR_CODES = Object.freeze([101]);
const PERMISSION_ERROR_CODES = Object.freeze([10, 200, 294, 298]);
const TIMEOUT_ERROR_CODES = Object.freeze(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const NETWORK_ERROR_CODES = Object.freeze([
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ERR_NETWORK'
]);

function errorCodeText(err) {
  return trimText(err?.code).toUpperCase();
}

function isAxiosTimeout(err) {
  const code = errorCodeText(err);
  if (TIMEOUT_ERROR_CODES.includes(code)) return true;
  return trimText(err?.message).toLowerCase().includes('timeout');
}

function isNetworkFailure(err) {
  const code = errorCodeText(err);
  if (NETWORK_ERROR_CODES.includes(code)) return true;
  return Boolean(!err?.response && err?.request);
}

function graphErrorCategory(err, { operation = '' } = {}) {
  if (isAxiosTimeout(err)) return 'timeout';
  if (isNetworkFailure(err)) return 'network_failed';

  const status = Number(err?.response?.status || 0);
  const code = facebookErrorCode(err);
  const subcode = facebookErrorSubcode(err);

  if (status === 429 || RATE_LIMIT_ERROR_CODES.includes(code)) return 'rate_limited';
  if (
    operation === 'debug_token'
      && (APP_AUTH_ERROR_CODES.includes(code) || OAUTH_ERROR_CODES.includes(code) || status === 401)
  ) {
    return 'app_auth_failed';
  }
  if (OAUTH_ERROR_CODES.includes(code) || OAUTH_ERROR_SUBCODES.includes(subcode) || status === 401) {
    return 'graph_oauth_failed';
  }
  if (PERMISSION_ERROR_CODES.includes(code) || status === 403) return 'graph_permission_denied';
  if (status === 400 || code || subcode) return 'graph_bad_request';
  return 'check_failed';
}

function safeScopes(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => trimText(item)).filter(Boolean);
}

function safeGranularScopes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => ({ scope: trimText(item?.scope) }))
    .filter(item => item.scope);
}

function safeDebugData(data = {}) {
  return {
    is_valid: data.is_valid === true,
    app_id: trimText(data.app_id),
    expires_at: Number(data.expires_at || 0),
    scopes: safeScopes(data.scopes),
    granular_scopes: safeGranularScopes(data.granular_scopes)
  };
}

function safePageData(data = {}) {
  return {
    id: trimText(data.id),
    name: trimText(data.name)
  };
}

function createMetaTokenHealthClient({
  env = process.env,
  axios,
  graphVersion = DEFAULT_GRAPH_VERSION,
  timeoutMs = 10000
} = {}) {
  const http = axios || require('axios');
  const appAccessToken = appAccessTokenFromEnv(env);

  return {
    async debugToken({ token } = {}) {
      if (!appAccessToken) return { ok: false, error_category: 'config_missing' };
      try {
        const response = await http.get(graphUrl(graphVersion, 'debug_token'), {
          params: {
            input_token: token,
            access_token: appAccessToken
          },
          timeout: timeoutMs
        });
        return safeDebugData(response.data && response.data.data ? response.data.data : response.data);
      } catch (err) {
        return { ok: false, error_category: graphErrorCategory(err, { operation: 'debug_token' }) };
      }
    },
    async pageMe({ token, fields = ['id', 'name'] } = {}) {
      try {
        const response = await http.get(graphUrl(graphVersion, 'me'), {
          params: {
            fields: fields.join(','),
            access_token: token
          },
          timeout: timeoutMs
        });
        return safePageData(response.data);
      } catch (err) {
        return { ok: false, error_category: graphErrorCategory(err, { operation: 'page_me' }) };
      }
    }
  };
}

function safeFailureLine(reason) {
  return `page_token_health_failed=${trimText(reason) || 'check_failed'}`;
}

async function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = console.log,
  stderr = console.error,
  Client,
  axios,
  metaClient
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    stderr(safeFailureLine('invalid_args'));
    return 1;
  }

  if (options.help) {
    stdout(usage());
    return 0;
  }

  if (options.apply) {
    stderr(safeFailureLine('apply_disabled'));
    stderr('Apply mode is disabled for phase 1; no writes were attempted.');
    return 1;
  }

  const selected = chooseDatabaseUrl({ env, options });
  if (!selected.ok) {
    stderr(safeFailureLine(selected.reason));
    stderr(selected.message);
    return 1;
  }

  const PgClient = Client || require('pg').Client;
  const client = new PgClient({ connectionString: selected.value });
  const expectedAppId = trimText(options.expectedAppId || env.META_APP_ID || env.FB_APP_ID);
  const requiredPermissions = options.requiredPermissions === undefined
    ? normalizeList(env.PAGE_TOKEN_HEALTH_REQUIRED_PERMISSIONS || 'pages_messaging')
    : options.requiredPermissions;

  try {
    await client.connect();
    const report = await checkPageTokenHealth({
      client,
      metaClient: metaClient || createMetaTokenHealthClient({
        env,
        axios,
        graphVersion: options.graphVersion
      }),
      masterKey: env.CREDENTIAL_MASTER_KEY,
      expectedAppId,
      requiredPermissions
    });
    stdout(JSON.stringify(report, null, 2));
    return 0;
  } catch (_) {
    stderr(safeFailureLine('check_failed'));
    stderr('No token, encrypted credential, raw page id, raw provider response, or database URL was printed.');
    return 1;
  } finally {
    try {
      await client.end();
    } catch (_) {}
  }
}

if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  appAccessTokenFromEnv,
  chooseDatabaseUrl,
  createMetaTokenHealthClient,
  graphErrorCategory,
  graphUrl,
  isPostgresUrl,
  main,
  parseArgs,
  usage
};

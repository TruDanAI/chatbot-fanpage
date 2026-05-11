const crypto = require('crypto');
const {
  authenticateStaticBearer,
  buildAdminPrincipal
} = require('../admin-auth');
const { renderLoginHtml } = require('./views');

const DEFAULT_COOKIE_NAME = 'chatbot_admin_session';
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_ACTION = 'admin.login';
const LOGOUT_ACTION = 'admin.logout';

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value = '') {
  const padded = `${String(value).replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - String(value).length % 4) % 4)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function normalizeCookieName(value = '') {
  const name = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(name) ? name : DEFAULT_COOKIE_NAME;
}

function normalizeSessionSecret(value = '') {
  const secret = String(value || '').trim();
  return secret.length >= 32 ? secret : '';
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function signValue(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqualText(actual = '', expected = '') {
  const actualText = String(actual || '');
  const expectedText = String(expected || '');
  if (!actualText || !expectedText) return false;
  const actualHash = crypto.createHash('sha256').update(actualText).digest();
  const expectedHash = crypto.createHash('sha256').update(expectedText).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function parseCookieHeader(header = '') {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function serializeCookie(name, value, {
  maxAgeMs,
  secure = false,
  sameSite = 'Lax',
  path = '/',
  httpOnly = true
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`);
  parts.push(`Path=${path || '/'}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite || 'Lax'}`);
  return parts.join('; ');
}

function shouldUseSecureCookies({ secureCookies, publicBaseUrl = '', nodeEnv = '' } = {}) {
  if (secureCookies != null) return Boolean(secureCookies);
  if (/^https:\/\//i.test(String(publicBaseUrl || '').trim())) return true;
  return String(nodeEnv || '').toLowerCase() === 'production';
}

function createAdminSessionManager({
  sessionSecret = process.env.SESSION_SECRET || '',
  cookieName = process.env.ADMIN_SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME,
  publicBaseUrl = process.env.ADMIN_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '',
  nodeEnv = process.env.NODE_ENV || '',
  secureCookies,
  ttlMs = DEFAULT_SESSION_TTL_MS,
  now = () => Date.now(),
  randomBytes = size => crypto.randomBytes(size)
} = {}) {
  const secret = normalizeSessionSecret(sessionSecret);
  const name = normalizeCookieName(cookieName);
  const maxAgeMs = normalizePositiveInteger(ttlMs, DEFAULT_SESSION_TTL_MS);
  const secure = shouldUseSecureCookies({ secureCookies, publicBaseUrl, nodeEnv });

  function isConfigured() {
    return Boolean(secret);
  }

  function createSessionToken(principal) {
    if (!isConfigured()) {
      const err = new Error('SESSION_SECRET must be at least 32 characters to enable admin sessions.');
      err.code = 'ADMIN_SESSION_NOT_CONFIGURED';
      throw err;
    }

    const issuedAt = now();
    const sessionPrincipal = buildAdminPrincipal({
      id: principal?.id || 'legacy-admin',
      displayName: principal?.displayName || '',
      roles: principal?.roles || ['owner'],
      permissions: principal?.permissions || [],
      tenantId: principal?.tenantId || '',
      pageId: principal?.pageId || '',
      authMethod: 'admin_session'
    });
    const payload = {
      v: 1,
      sid: randomBytes(18).toString('base64url'),
      iat: issuedAt,
      exp: issuedAt + maxAgeMs,
      principal: sessionPrincipal
    };
    const body = base64UrlEncode(JSON.stringify(payload));
    return `v1.${body}.${signValue(secret, body)}`;
  }

  function verifySessionToken(token = '') {
    if (!isConfigured()) {
      return { ok: false, statusCode: 503, reason: 'admin_session_not_configured' };
    }

    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') {
      return { ok: false, statusCode: 401, reason: 'invalid_admin_session' };
    }
    const [, body, signature] = parts;
    if (!safeEqualText(signature, signValue(secret, body))) {
      return { ok: false, statusCode: 401, reason: 'invalid_admin_session' };
    }

    let payload;
    try {
      payload = JSON.parse(base64UrlDecode(body));
    } catch (_) {
      return { ok: false, statusCode: 401, reason: 'invalid_admin_session' };
    }
    if (!payload || payload.v !== 1 || !payload.exp || payload.exp <= now()) {
      return { ok: false, statusCode: 401, reason: 'expired_admin_session' };
    }

    return {
      ok: true,
      statusCode: 200,
      principal: buildAdminPrincipal({
        ...(payload.principal || {}),
        authMethod: 'admin_session'
      })
    };
  }

  function getSessionCookie(req) {
    return parseCookieHeader(req?.get?.('cookie') || '')[name] || '';
  }

  function authenticateSessionRequest(req) {
    const token = getSessionCookie(req);
    if (!token) return { ok: false, statusCode: 401, reason: 'missing_admin_session' };
    return verifySessionToken(token);
  }

  function buildSetCookie(token) {
    return serializeCookie(name, token, {
      maxAgeMs,
      secure,
      sameSite: 'Lax',
      path: '/',
      httpOnly: true
    });
  }

  function buildClearCookie() {
    return serializeCookie(name, '', {
      maxAgeMs: 0,
      secure,
      sameSite: 'Lax',
      path: '/',
      httpOnly: true
    });
  }

  return {
    authenticateSessionRequest,
    buildClearCookie,
    buildSetCookie,
    cookieName: name,
    createSessionToken,
    isConfigured,
    maxAgeMs,
    secureCookies: secure,
    verifySessionToken
  };
}

function getLoginToken(req) {
  const body = req?.body || {};
  return String(body.adminToken || body.token || '').trim();
}

function setHeader(res, name, value) {
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
  } else if (typeof res.set === 'function') {
    res.set(name, value);
  } else if (res.headers) {
    res.headers[String(name).toLowerCase()] = value;
  }
}

function redirectSeeOther(res, location) {
  if (typeof res.redirect === 'function') return res.redirect(303, location);
  setHeader(res, 'Location', location);
  return res.status(303).send('See Other');
}

function makeBearerReqFromLogin(req, token) {
  return {
    ...req,
    get(name) {
      if (String(name || '').toLowerCase() === 'authorization') return `Bearer ${token}`;
      return req?.get?.(name) || '';
    }
  };
}

function createAdminSessionHandlers({
  sessionManager,
  adminExportToken,
  tenantId = 'default',
  pageId = '',
  adminPrincipalId = 'legacy-admin',
  adminPrincipalDisplayName = '',
  adminPrincipalRoles = ['owner'],
  adminPrincipalPermissions = [],
  recordAdminAudit
} = {}) {
  function authOptions() {
    return {
      token: adminExportToken,
      principalId: adminPrincipalId,
      displayName: adminPrincipalDisplayName,
      roles: adminPrincipalRoles,
      permissions: adminPrincipalPermissions,
      tenantId,
      pageId
    };
  }

  async function sendLoginForm(req, res) {
    if (!sessionManager?.isConfigured?.()) {
      return res
        .status(503)
        .type('html')
        .send(renderLoginHtml({ error: 'Admin session chưa được cấu hình.' }));
    }

    const existing = sessionManager.authenticateSessionRequest(req);
    if (existing.ok) return redirectSeeOther(res, '/admin/dashboard');
    return res.type('html').send(renderLoginHtml());
  }

  async function submitLogin(req, res) {
    if (!sessionManager?.isConfigured?.()) {
      await recordAdminAudit?.(req, {
        principal: null,
        action: LOGIN_ACTION,
        resourceType: 'admin_session',
        outcome: 'denied',
        metadata: { reason: 'admin_session_not_configured' }
      });
      return res
        .status(503)
        .type('html')
        .send(renderLoginHtml({ error: 'Admin session chưa được cấu hình.' }));
    }

    const token = getLoginToken(req);
    const auth = authenticateStaticBearer(makeBearerReqFromLogin(req, token), authOptions());
    if (!auth.ok) {
      await recordAdminAudit?.(req, {
        principal: null,
        action: LOGIN_ACTION,
        resourceType: 'admin_session',
        outcome: 'denied',
        metadata: { reason: auth.reason }
      });
      return res
        .status(auth.statusCode === 503 ? 503 : 401)
        .type('html')
        .send(renderLoginHtml({ error: 'Token không hợp lệ.' }));
    }

    const sessionToken = sessionManager.createSessionToken(auth.principal);
    setHeader(res, 'Set-Cookie', sessionManager.buildSetCookie(sessionToken));
    await recordAdminAudit?.(req, {
      principal: auth.principal,
      action: LOGIN_ACTION,
      resourceType: 'admin_session',
      outcome: 'success',
      metadata: { authMethod: 'static_bearer' }
    });
    return redirectSeeOther(res, '/admin/dashboard');
  }

  async function submitLogout(req, res) {
    let principal = null;
    if (sessionManager?.isConfigured?.()) {
      const auth = sessionManager.authenticateSessionRequest(req);
      if (auth.ok) principal = auth.principal;
    }
    setHeader(res, 'Set-Cookie', sessionManager?.buildClearCookie?.() || `${DEFAULT_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
    if (principal) {
      await recordAdminAudit?.(req, {
        principal,
        action: LOGOUT_ACTION,
        resourceType: 'admin_session',
        outcome: 'success'
      });
    }
    return redirectSeeOther(res, '/admin/login');
  }

  return {
    sendLoginForm,
    submitLogin,
    submitLogout
  };
}

module.exports = {
  DEFAULT_COOKIE_NAME,
  LOGIN_ACTION,
  LOGOUT_ACTION,
  createAdminSessionHandlers,
  createAdminSessionManager,
  parseCookieHeader,
  serializeCookie
};

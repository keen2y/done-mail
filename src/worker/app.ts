import { Hono } from 'hono';
import { authStateFromConfig, normalizeAdminKey, verifyAdminKeyConfig, type AdminKeyConfig } from './auth';
import { getAuthConfig } from './config';
import { hasValidCookieSession } from './http/auth';
import { logSystemEvent } from './http/logs';
import { publicFail, publicOk } from './http/public-response';
import { consumeRateLimit, getRateLimit, rateLimitIdentity } from './http/rate-limit';
import authRoutes from './routes/auth';
import bootstrapRoutes from './routes/bootstrap';
import devRoutes from './routes/dev';
import domainRoutes from './routes/domains';
import logRoutes from './routes/logs';
import mailsRoutes, { publicMailsRoutes } from './routes/mails';
import policyRoutes from './routes/policies';
import settingsRoutes from './routes/settings';
import shareRoutes, { publicShareRoutes, sharedAccessRoutes } from './routes/shares';
import { APP_VERSION } from '../shared/version';
import type { Env } from './types';
import { apiFail } from './utils';

const app = new Hono<{ Bindings: Env }>();
const authConfigByRequest = new WeakMap<Request, Promise<AdminKeyConfig | null>>();

app.use('/api/*', async (c, next) => {
  const start = Date.now();
  await next();
  c.header('Server-Timing', `app;dur=${Date.now() - start}`);
});

function isInternalAuthEntry(path: string) {
  return path === '/api/internal/bootstrap' || path === '/api/internal/auth/setup' || path === '/api/internal/auth/login' || path === '/api/internal/auth/logout';
}

function requestAuthConfig(env: Env, req: Request) {
  let pending = authConfigByRequest.get(req);
  if (!pending) {
    pending = getAuthConfig(env);
    authConfigByRequest.set(req, pending);
  }
  return pending;
}

app.use('/api/shared/*', async (c, next) => {
  const limited = await consumeRateLimit(c.env, 'publicShare', rateLimitIdentity(c), getRateLimit('publicShare'));
  if (limited) {
    return publicFail(c, '请求过于频繁，请稍后再试', 429, 'rate_limited');
  }
  return next();
});

app.use('/api/internal/*', async (c, next) => {
  if (isInternalAuthEntry(c.req.path)) {
    return next();
  }

  const authConfig = await requestAuthConfig(c.env, c.req.raw);
  const authState = authStateFromConfig(authConfig);
  if (!authState.initialized) {
    return apiFail(c, '系统尚未初始化', 428, 'SETUP_REQUIRED');
  }

  if (!(await hasValidCookieSession(c, authState.version))) {
    return apiFail(c, '未授权', 401, 'unauthorized');
  }

  return next();
});

app.use('/api/*', async (c, next) => {
  if (
    c.req.path === '/api/health' ||
    c.req.path.startsWith('/api/dev/') ||
    c.req.path.startsWith('/api/internal/') ||
    c.req.path.startsWith('/api/shared/')
  ) {
    return next();
  }

  const authConfig = await requestAuthConfig(c.env, c.req.raw);
  const authState = authStateFromConfig(authConfig);
  if (!authState.initialized) {
    return publicFail(c, '系统尚未初始化', 428, 'SETUP_REQUIRED');
  }

  const adminKeyValid = await verifyAdminKeyConfig(authConfig, normalizeAdminKey(c.req.header('X-Admin-Key')));
  if (!adminKeyValid) {
    const identity = rateLimitIdentity(c);
    const limited = await consumeRateLimit(c.env, 'publicApi', identity, getRateLimit('publicApi'));
    if (limited) {
      try {
        c.executionCtx.waitUntil(logSystemEvent(c.env, 'api', identity, 'rate_limit', 'failed', `公开接口访问过于频繁：${c.req.path}`));
      } catch {
        void logSystemEvent(c.env, 'api', identity, 'rate_limit', 'failed', `公开接口访问过于频繁：${c.req.path}`);
      }
      return publicFail(c, '请求过于频繁，请稍后再试', 429, 'rate_limited');
    }
    try {
      c.executionCtx.waitUntil(logSystemEvent(c.env, 'api', identity, 'auth', 'failed', `公开接口鉴权失败：${c.req.path}`));
    } catch {
      void logSystemEvent(c.env, 'api', identity, 'auth', 'failed', `公开接口鉴权失败：${c.req.path}`);
    }
    return publicFail(c, '未授权', 401, 'unauthorized');
  }

  return next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json(
    {
      success: false,
      result: null,
      errors: [{ code: 'server_error', message: '服务器异常' }],
      messages: [],
      result_info: {}
    },
    { status: 500 }
  );
});

app.get('/api/health', (c) => publicOk(c, { ok: true, version: APP_VERSION }));
app.route('/api/dev', devRoutes);
app.route('/api/internal/auth', authRoutes);
app.route('/api/internal/bootstrap', bootstrapRoutes);
app.route('/api/internal/mails', mailsRoutes);
app.route('/api/internal/domains', domainRoutes);
app.route('/api/internal/settings', settingsRoutes);
app.route('/api/internal/policies', policyRoutes);
app.route('/api/internal/logs', logRoutes);
app.route('/api/internal/shares', shareRoutes);

app.route('/api/mails', publicMailsRoutes);
app.route('/api', publicShareRoutes);
app.route('/api/shared', sharedAccessRoutes);

export default app;

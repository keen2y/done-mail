import type { Context } from 'hono';
import type { Env } from '../types';
import { safeJsonParse } from '../utils';

type AppContext = Context<{ Bindings: Env }>;
const rateLimitWindowSeconds = 3600;

/** Built-in limits (per IP / hour). Not user-configurable. */
const defaultRateLimits = {
  login: 60,
  publicApi: 120,
  publicShare: 2000,
  setup: 20
} as const;

export type RateLimitScope = keyof typeof defaultRateLimits;

let rateLimits: Record<RateLimitScope, number> = { ...defaultRateLimits };

export function getRateLimit(scope: RateLimitScope) {
  return rateLimits[scope];
}

/** Test-only override. */
export function setRateLimitsForTest(partial: Partial<Record<RateLimitScope, number>>) {
  rateLimits = { ...defaultRateLimits, ...partial };
}

export function resetRateLimitsForTest() {
  rateLimits = { ...defaultRateLimits };
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

function clientIp(c: AppContext) {
  return requestClientIp(c.req.raw);
}

function requestClientIp(req: Request) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

async function scopeHash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function consumeRateLimit(env: Env, scope: string, identity: string, maxPerHour: number) {
  const max = Math.max(Math.floor(maxPerHour), 1);
  const now = Math.floor(Date.now() / 1000);
  const key = `rate:${scope}:${await scopeHash(identity)}`;
  const stored = safeJsonParse<RateLimitState>(await env.KV.get(key), { count: 0, resetAt: 0 });
  const active = stored.resetAt > now;
  const count = active ? Number(stored.count || 0) + 1 : 1;
  const resetAt = active ? Number(stored.resetAt || now + rateLimitWindowSeconds) : now + rateLimitWindowSeconds;
  const ttl = Math.max(resetAt - now, 1);

  await env.KV.put(key, JSON.stringify({ count, resetAt }), { expirationTtl: ttl });
  return count > max;
}

export function rateLimitIdentity(c: AppContext, extra = '') {
  return [clientIp(c), extra].filter(Boolean).join(':');
}

export function rateLimitIdentityFromRequest(req: Request, extra = '') {
  return [requestClientIp(req), extra].filter(Boolean).join(':');
}

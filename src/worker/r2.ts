import type { Env } from './types';
import { safeJsonParse } from './utils';

const ORPHAN_R2_KEY = 'cleanup:orphan_r2_keys';
const ORPHAN_R2_MAX = 500;

export async function deleteR2ObjectsBestEffort(bucket: R2Bucket | undefined, keys: string[]) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!bucket || uniqueKeys.length === 0) return [] as string[];
  const results = await Promise.allSettled(uniqueKeys.map((key) => bucket.delete(key)));
  return uniqueKeys.filter((_, index) => results[index]?.status === 'rejected');
}

export async function enqueueOrphanR2Keys(env: Env, keys: string[]) {
  const incoming = [...new Set(keys.filter(Boolean))];
  if (incoming.length === 0) return;
  const existing = safeJsonParse<string[]>(await env.KV.get(ORPHAN_R2_KEY), []);
  const merged = [...new Set([...existing, ...incoming])].slice(-ORPHAN_R2_MAX);
  await env.KV.put(ORPHAN_R2_KEY, JSON.stringify(merged));
}

export async function reclaimOrphanR2Objects(env: Env) {
  if (!env.MAIL_BUCKET) return { attempted: 0, remaining: 0 };
  const existing = safeJsonParse<string[]>(await env.KV.get(ORPHAN_R2_KEY), []);
  if (existing.length === 0) return { attempted: 0, remaining: 0 };
  const batch = existing.slice(0, 100);
  await Promise.allSettled(batch.map((key) => env.MAIL_BUCKET!.delete(key)));
  const remaining = existing.slice(batch.length);
  if (remaining.length === 0) await env.KV.delete(ORPHAN_R2_KEY);
  else await env.KV.put(ORPHAN_R2_KEY, JSON.stringify(remaining));
  return { attempted: batch.length, remaining: remaining.length };
}

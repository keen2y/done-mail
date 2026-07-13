import type { Env } from '../types';
import { createId, nowIso } from '../utils';

const logRetentionDays = 30;
const maxSystemLogs = 2000;
const maxMessageLength = 500;
const pruneKvKey = 'system_logs:pruned_at';
const pruneIntervalSeconds = 3600;

/** Exception record modules (failures only). */
export const systemLogModules = ['domain', 'policy', 'api', 'system'] as const;
export const systemLogActions = [
  'email_routing',
  'dns',
  'catch_all',
  'setup',
  'refresh',
  'policy',
  'auth',
  'rate_limit',
  'cleanup'
] as const;
export const systemLogStatuses = ['failed'] as const;

export type SystemLogModule = (typeof systemLogModules)[number];
export type SystemLogAction = (typeof systemLogActions)[number];
export type SystemLogStatus = (typeof systemLogStatuses)[number];

export const systemLogModuleSet = new Set<string>(systemLogModules);
export const systemLogStatusSet = new Set<string>(systemLogStatuses);

export const systemLogModuleLabels: Record<SystemLogModule, string> = {
  domain: '域名管理',
  policy: '邮件策略',
  api: '公开接口',
  system: '系统动作'
};

export const systemLogActionLabels: Record<SystemLogAction, string> = {
  email_routing: '邮箱路由',
  dns: 'DNS 配置',
  catch_all: '全收转发',
  setup: '配置域名',
  refresh: '验证可用',
  policy: '策略动作',
  auth: '鉴权失败',
  rate_limit: '访问限流',
  cleanup: '清理任务'
};

function buildLogSearchText(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(' ');
}

function truncateMessage(message: string) {
  const text = String(message || '').trim() || '发生错误';
  if (text.length <= maxMessageLength) return text;
  return `${text.slice(0, maxMessageLength - 1)}…`;
}

export async function deleteOrphanSystemLogFts(env: Env) {
  await env.DB.prepare(
    `DELETE FROM system_logs_fts
     WHERE log_id NOT IN (
       SELECT id
       FROM system_logs
     )`
  ).run();
}

export async function pruneSystemLogs(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const lastPrunedAt = Number(await env.KV.get(pruneKvKey));
  if (Number.isFinite(lastPrunedAt) && now - lastPrunedAt < pruneIntervalSeconds) return;

  const cutoff = new Date(Date.now() - logRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM system_logs WHERE created_at < ?`).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM system_logs
       WHERE id NOT IN (
         SELECT id
         FROM system_logs
         ORDER BY created_at DESC
         LIMIT ?
       )`
    ).bind(maxSystemLogs)
  ]);
  await deleteOrphanSystemLogFts(env);
  await env.KV.put(pruneKvKey, String(now), { expirationTtl: pruneIntervalSeconds * 2 });
}

/** Record a failure-only exception entry (never blocks callers if it fails). */
export async function logSystemEvent(
  env: Env,
  module: SystemLogModule,
  target: string,
  action: SystemLogAction,
  _status: SystemLogStatus | 'failed',
  message: string
) {
  try {
    const id = createId('log');
    const createdAt = nowIso();
    const status: SystemLogStatus = 'failed';
    const safeMessage = truncateMessage(message);
    const safeTarget = String(target || '').trim() || '-';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO system_logs (id, module, target, action, status, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, module, safeTarget, action, status, safeMessage, createdAt),
      env.DB.prepare(
        `INSERT INTO system_logs_fts (log_id, search_text)
         VALUES (?, ?)`
      ).bind(id, buildLogSearchText([module, safeTarget, action, status, safeMessage]))
    ]);
  } catch (error) {
    console.error('写入异常记录失败', error);
  }
}

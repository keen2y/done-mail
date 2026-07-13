import { describe, expect, it } from 'vitest';
import { buildSettingsUpdate, getAuthConfig, getSystemConfig, saveSettingsUpdate } from './config';
import type { Env } from './types';

function createEnv() {
  const store = new Map<string, string>();
  return {
    KV: {
      get: async (key: string) => store.get(key) || null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      }
    }
  } as unknown as Env;
}

describe('system config', () => {
  it('提供系统默认值且不含可配置限流', async () => {
    const system = await getSystemConfig(createEnv());

    expect(system).toEqual({
      cleanupEnabled: true,
      mailRetentionDays: 30,
      adminBaseUrl: '',
      shareBaseUrl: ''
    });
    expect('rateLimit' in system).toBe(false);
  });

  it('保存并规范化系统配置，忽略旧版 rateLimit 字段', async () => {
    const env = createEnv();
    const next = await buildSettingsUpdate(env, {
      system: {
        cleanupEnabled: true,
        mailRetentionDays: 30,
        adminBaseUrl: 'https://admin.example.com/inbox?x=1',
        shareBaseUrl: 'https://share.example.com/mail/test',
        // @ts-expect-error legacy field should be ignored
        rateLimit: {
          login: 0,
          publicApi: 300,
          publicShare: 0
        }
      }
    });
    await saveSettingsUpdate(env, next);
    const system = await getSystemConfig(env);

    expect(system.adminBaseUrl).toBe('https://admin.example.com');
    expect(system.shareBaseUrl).toBe('https://share.example.com');
    expect('rateLimit' in system).toBe(false);
  });

  it('读取管理员配置不跨请求复用旧 KV 状态', async () => {
    const env = createEnv();

    expect(await getAuthConfig(env)).toBeNull();
    await env.KV.put('auth:admin_key', JSON.stringify({
      hash: 'hash',
      salt: 'salt',
      version: 'version',
      createdAt: '2026-05-03T00:00:00.000Z',
      updatedAt: '2026-05-03T00:00:00.000Z'
    }));

    await expect(getAuthConfig(env)).resolves.toMatchObject({ version: 'version' });
  });
});

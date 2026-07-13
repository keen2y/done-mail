import { describe, expect, it, vi } from 'vitest';
import app from '../app';
import type { Env } from '../types';

function createEnv(allowInject = true) {
  const batch = vi.fn(async () => []);
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql,
      bind: vi.fn(() => statement),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ meta: { changes: 1 } }))
    };
    return statement;
  });
  return {
    env: {
      ALLOW_DEV_INJECT: allowInject ? 'true' : undefined,
      DB: { prepare, batch },
      KV: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined)
      },
      ASSETS: { fetch: vi.fn(async () => new Response('', { status: 404 })) }
    } as unknown as Env,
    batch
  };
}

describe('dev inject email', () => {
  it('未开启 ALLOW_DEV_INJECT 时返回 404', async () => {
    const { env } = createEnv(false);
    const response = await app.fetch(
      new Request('https://example.com/api/dev/inject-email', {
        method: 'POST',
        body: 'From: a@example.com\nTo: b@example.com\nSubject: t\n\nbody'
      }),
      env
    );
    expect(response.status).toBe(404);
  });

  it('开启后可注入邮件并写入 D1', async () => {
    const { env, batch } = createEnv(true);
    const raw = [
      'From: Local Tester <tester@example.com>',
      'To: local@example.com',
      'Subject: inject',
      'Message-ID: <inject@done-mail.local>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'hello inject'
    ].join('\r\n');

    const response = await app.fetch(
      new Request('https://example.com/api/dev/inject-email?to=local@example.com', {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: raw
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      result: { ok: true, to: 'local@example.com' }
    });
    expect(batch).toHaveBeenCalled();
  });
});

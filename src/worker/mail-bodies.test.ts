import { describe, expect, it, vi } from 'vitest';
import { getMailBody, listMailBodies } from './mail-bodies';
import type { Env } from './types';

function createEnv(options: { body?: Record<string, unknown> | null; rows?: Record<string, unknown>[] } = {}) {
  const calls: string[] = [];
  const prepare = vi.fn((sql: string) => {
    calls.push(sql);
    const statement = {
      sql,
      bind: vi.fn(() => statement),
      first: vi.fn(async () => {
        if (sql.includes('FROM mail_bodies')) {
          return (
            options.body ?? {
              headersJson: '{"from":"a@example.com"}',
              textBody: '正文',
              htmlBody: '<p>正文</p>'
            }
          );
        }
        return null;
      }),
      all: vi.fn(async () => ({
        results:
          options.rows ||
          [
            { mailId: 'mail_1', textBody: '第一封', htmlBody: '<p>第一封</p>' },
            { mailId: 'mail_2', textBody: '第二封', htmlBody: '<p>第二封</p>' }
          ]
      })),
      run: vi.fn(async () => ({ meta: { changes: 1 } }))
    };
    return statement;
  });
  return {
    env: {
      DB: { prepare, batch: vi.fn(async () => []) }
    } as unknown as Env,
    calls
  };
}

describe('mail bodies', () => {
  it('详情正文直接读取 mail_bodies', async () => {
    const { env, calls } = createEnv();

    const body = await getMailBody(env, 'mail_1');

    expect(body).toMatchObject({
      textBody: '正文',
      htmlBody: '<p>正文</p>',
      headersJson: '{"from":"a@example.com"}'
    });
    expect(calls.every((sql) => sql.includes('FROM mail_bodies'))).toBe(true);
    expect(calls.some((sql) => sql.includes('mail_body_chunks') || sql.includes('mail_safe_bodies'))).toBe(false);
  });

  it('批量正文读取 mail_bodies，缺失邮件返回空正文', async () => {
    const { env, calls } = createEnv({
      rows: [{ mailId: 'mail_1', textBody: '第一封', htmlBody: '<p>第一封</p>' }]
    });

    const bodies = await listMailBodies(env, ['mail_1', 'mail_2']);

    expect(bodies.get('mail_1')).toEqual({ textBody: '第一封', htmlBody: '<p>第一封</p>' });
    expect(bodies.get('mail_2')).toEqual({ textBody: '', htmlBody: '' });
    expect(calls.some((sql) => sql.includes('FROM mail_bodies'))).toBe(true);
  });
});

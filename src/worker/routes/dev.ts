import { Hono } from 'hono';
import { handleIncomingEmail } from '../mail';
import type { Env } from '../types';
import { apiFail, apiOk } from '../utils';

const devRoutes = new Hono<{ Bindings: Env }>();

function createInjectMessage(raw: Uint8Array, to: string): ForwardableEmailMessage {
  return {
    rawSize: raw.byteLength,
    raw: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    headers: new Headers({
      from: 'Local Tester <tester@example.com>',
      to,
      subject: 'DoneMail local inject sample'
    }),
    from: 'tester@example.com',
    to,
    forward: async () => undefined,
    setReject: () => undefined
  } as unknown as ForwardableEmailMessage;
}

devRoutes.post('/inject-email', async (c) => {
  if (c.env.ALLOW_DEV_INJECT !== 'true') {
    return apiFail(c, 'Not Found', 404, 'not_found');
  }

  const contentType = c.req.header('content-type') || '';
  let rawText = '';
  let to = 'local@example.com';

  if (contentType.includes('application/json')) {
    const body = (await c.req.json().catch(() => null)) as { raw?: unknown; to?: unknown } | null;
    rawText = String(body?.raw || '');
    to = String(body?.to || to).trim().toLowerCase() || to;
  } else {
    rawText = await c.req.text();
    to = String(c.req.query('to') || to).trim().toLowerCase() || to;
  }

  if (!rawText.trim()) {
    return apiFail(c, '请提供 .eml 原文', 400, 'invalid_payload');
  }

  const raw = new TextEncoder().encode(rawText);
  if (raw.byteLength > 10 * 1024 * 1024) {
    return apiFail(c, '邮件过大', 400, 'mail_too_large');
  }

  let executionCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }
  await handleIncomingEmail(createInjectMessage(raw, to), c.env, executionCtx);
  return apiOk(c, { ok: true, to, size: raw.byteLength });
});

export default devRoutes;

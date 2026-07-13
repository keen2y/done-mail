import type { Env } from './types';

export async function getMailBody(env: Env, mailId: string) {
  const row = await env.DB.prepare(
    `SELECT headers_json AS headersJson, text_body AS textBody, html_body AS htmlBody
     FROM mail_bodies
     WHERE mail_id = ?`
  )
    .bind(mailId)
    .first<Record<string, unknown>>();

  return {
    textBody: String(row?.textBody || ''),
    htmlBody: String(row?.htmlBody || ''),
    headersJson: String(row?.headersJson || '{}')
  };
}

export async function listMailBodies(env: Env, mailIds: string[]) {
  if (mailIds.length === 0) return new Map<string, { textBody: string; htmlBody: string }>();
  const uniqueIds = [...new Set(mailIds.map((mailId) => mailId.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map<string, { textBody: string; htmlBody: string }>();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT mail_id AS mailId, text_body AS textBody, html_body AS htmlBody
     FROM mail_bodies
     WHERE mail_id IN (${placeholders})`
  )
    .bind(...uniqueIds)
    .all<Record<string, unknown>>();

  const bodies = new Map<string, { textBody: string; htmlBody: string }>();
  for (const row of rows.results || []) {
    bodies.set(String(row.mailId || ''), {
      textBody: String(row.textBody || ''),
      htmlBody: String(row.htmlBody || '')
    });
  }
  for (const mailId of uniqueIds) {
    if (!bodies.has(mailId)) bodies.set(mailId, { textBody: '', htmlBody: '' });
  }
  return bodies;
}

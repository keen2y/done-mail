import PostalMime from 'postal-mime';
import { getSystemConfig } from './config';
import { fileContentDisposition } from './http/content-disposition';
import { logSystemEvent } from './http/logs';
import { buildBodyPreview, buildMailContentSearchChunks, buildMailSearchFields, clampStoredBodies, sanitizeMailHtml } from './mail-content';
import { createShare, deleteMailShares } from './mail-share';
import { runMailPolicies } from './policies';
import { deleteR2ObjectsBestEffort, enqueueOrphanR2Keys, reclaimOrphanR2Objects } from './r2';
import type { Env, MailPolicyMatchPayload, MailPolicyPayload } from './types';
import { createId, extractDomain, nowIso, pickEmailAddress } from './utils';

const MAX_RAW_MAIL_BYTES = 10 * 1024 * 1024;
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_TIME_BUDGET_MS = 20_000;
const R2_ATTACHMENT_CONCURRENCY = 3;
const D1_BATCH_STATEMENT_LIMIT = 40;
type HeaderIndex = Record<string, string[]>;

function pushHeader(index: HeaderIndex, key: unknown, value: unknown) {
  const name = String(key || '')
    .trim()
    .toLowerCase();
  if (!name) return;
  const text = String(value || '').trim();
  if (!text) return;
  index[name] = index[name] || [];
  if (!index[name].includes(text)) index[name].push(text);
}

function headersToIndex(headers: unknown): HeaderIndex {
  const index: HeaderIndex = {};
  if (!headers) return index;
  if (Array.isArray(headers)) {
    headers.forEach((item) => {
      if (Array.isArray(item)) {
        pushHeader(index, item[0], item[1]);
        return;
      }
      if (typeof item === 'object' && item) {
        const row = item as { key?: unknown; name?: unknown; originalKey?: unknown; value?: unknown };
        pushHeader(index, row.key || row.name || row.originalKey, row.value);
      }
    });
    return index;
  }

  if (typeof headers === 'object') {
    const maybeHeaders = headers as { forEach?: unknown };
    if (typeof maybeHeaders.forEach === 'function') {
      (maybeHeaders.forEach as (callback: (value: string, key: string) => void) => void)((value, key) => pushHeader(index, key, value));
      return index;
    }

    Object.entries(headers as Record<string, unknown>).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => pushHeader(index, key, item));
        return;
      }
      pushHeader(index, key, value);
    });
  }

  return index;
}

function mergeHeaderIndexes(...items: HeaderIndex[]) {
  const merged: HeaderIndex = {};
  items.forEach((headers) => {
    Object.entries(headers).forEach(([key, values]) => values.forEach((value) => pushHeader(merged, key, value)));
  });
  return merged;
}

function headersToRecord(headers: HeaderIndex): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, values]) => [key, values.join('\n')]));
}

interface AttachmentRow {
  id: string;
  mailId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string;
  disposition: string;
  stored: number;
  objectKey: string;
}

function attachmentSize(attachment: Record<string, unknown>) {
  const content = attachment.content as { byteLength?: number; length?: number } | undefined;
  return Number(attachment.size || content?.byteLength || content?.length || 0);
}

function attachmentObjectKey(mailId: string, attachmentId: string, filename: string) {
  const cleanName = filename.trim().replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'attachment';
  return `attachments/${mailId}/${attachmentId}-${cleanName}`;
}

function attachmentRows(mailId: string, attachments: Array<Record<string, unknown>> = [], bucket?: R2Bucket): AttachmentRow[] {
  return attachments.map((attachment) => {
    const id = createId('att');
    const filename = String(attachment.filename || '');
    const objectKey = bucket ? attachmentObjectKey(mailId, id, filename) : '';
    return {
      id,
      mailId,
      filename,
      mimeType: String(attachment.mimeType || attachment.contentType || ''),
      size: attachmentSize(attachment),
      contentId: String(attachment.contentId || ''),
      disposition: String(attachment.disposition || ''),
      // stored flips to 1 only after a successful R2 put
      stored: 0,
      objectKey
    };
  });
}

async function storeAttachmentObjects(bucket: R2Bucket, attachments: Array<Record<string, unknown>>, rows: AttachmentRow[]) {
  const storedKeys: string[] = [];
  let nextIndex = 0;
  try {
    async function worker() {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const content = attachments[index]?.content;
        const row = rows[index];
        if (!row) return;
        if (!row.objectKey || !content) {
          row.stored = 0;
          continue;
        }
        await bucket.put(row.objectKey, content as ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, {
          httpMetadata: {
            contentType: row.mimeType || 'application/octet-stream',
            contentDisposition: fileContentDisposition(row.filename || 'attachment', row.contentId ? 'inline' : 'attachment')
          }
        });
        row.stored = 1;
        storedKeys.push(row.objectKey);
      }
    }
    await Promise.all(Array.from({ length: Math.min(R2_ATTACHMENT_CONCURRENCY, rows.length) }, () => worker()));
  } catch (error) {
    for (const row of rows) row.stored = 0;
    await deleteR2ObjectsBestEffort(bucket, storedKeys);
    throw error;
  }
}

function senderDisplay(name: string, address: string) {
  return name ? `${name} <${address}>` : address;
}

export function resolveIncomingRecipient(input: { deliveryTo: string; headerTo: string }) {
  const deliveryTo = input.deliveryTo.trim().toLowerCase();
  const headerTo = input.headerTo.trim().toLowerCase();
  return deliveryTo || headerTo;
}

function buildPolicyPayloadFromDetail(mail: {
  id: string;
  messageId: string;
  fromAddr: string;
  fromName: string;
  toAddr: string;
  domain: string;
  subject: string;
  bodyPreview: string;
  receivedAt: string;
  rawSize: number;
  textBody: string;
  htmlBody: string;
  headers: Record<string, string>;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    contentId?: string;
    disposition?: string;
    stored: boolean;
  }>;
}): MailPolicyPayload {
  return {
    event: 'mail.received',
    id: mail.id,
    messageId: mail.messageId,
    from: senderDisplay(mail.fromName, mail.fromAddr),
    fromAddr: mail.fromAddr,
    fromName: mail.fromName,
    to: mail.toAddr,
    domain: mail.domain,
    subject: mail.subject,
    preview: mail.bodyPreview,
    receivedAt: mail.receivedAt,
    rawSize: mail.rawSize,
    hasAttachments: mail.attachments.length > 0,
    attachmentCount: mail.attachments.length,
    textBody: mail.textBody,
    htmlBody: mail.htmlBody,
    headers: mail.headers,
    attachments: mail.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      contentId: attachment.contentId || '',
      disposition: attachment.disposition || '',
      stored: attachment.stored,
      downloadApiPath: attachment.stored ? `/api/mails/${mail.id}/attachments/${attachment.id}` : ''
    }))
  };
}

function buildPolicyPayload(input: {
  mailId: string;
  messageId: string;
  fromAddr: string;
  fromName: string;
  toAddr: string;
  domain: string;
  subject: string;
  preview: string;
  receivedAt: string;
  rawSize: number;
  textBody: string;
  htmlBody: string;
  headers: Record<string, string>;
  attachments: AttachmentRow[];
}): MailPolicyPayload {
  return {
    ...buildPolicyPayloadFromDetail({
      id: input.mailId,
      messageId: input.messageId,
      fromAddr: input.fromAddr,
      fromName: input.fromName,
      toAddr: input.toAddr,
      domain: input.domain,
      subject: input.subject,
      bodyPreview: input.preview,
      receivedAt: input.receivedAt,
      rawSize: input.rawSize,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      headers: input.headers,
      attachments: input.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        contentId: attachment.contentId,
        disposition: attachment.disposition,
        stored: attachment.stored === 1
      }))
    })
  };
}

function buildPolicyMatchPayload(input: {
  mailId: string;
  messageId: string;
  fromAddr: string;
  fromName: string;
  toAddr: string;
  domain: string;
  subject: string;
  preview: string;
  receivedAt: string;
  rawSize: number;
  attachmentCount: number;
}): MailPolicyMatchPayload {
  return {
    event: 'mail.received',
    id: input.mailId,
    messageId: input.messageId,
    from: senderDisplay(input.fromName, input.fromAddr),
    fromAddr: input.fromAddr,
    fromName: input.fromName,
    to: input.toAddr,
    domain: input.domain,
    subject: input.subject,
    preview: input.preview,
    receivedAt: input.receivedAt,
    rawSize: input.rawSize,
    hasAttachments: input.attachmentCount > 0,
    attachmentCount: input.attachmentCount,
    textBody: '',
    htmlBody: ''
  };
}

export async function handleIncomingEmail(message: ForwardableEmailMessage, env: Env, ctx?: Pick<ExecutionContext, 'waitUntil'>) {
  if (message.rawSize > MAX_RAW_MAIL_BYTES) {
    message.setReject('邮件过大');
    return;
  }

  try {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(raw);
    const headerIndex = mergeHeaderIndexes(headersToIndex(message.headers), headersToIndex(parsed.headers));
    const headers = headersToRecord(headerIndex);
    const toAddr = resolveIncomingRecipient({
      deliveryTo: String(message.to || ''),
      headerTo: pickEmailAddress(parsed.to)
    });
    const fromAddr = String(parsed.from?.address || '').toLowerCase();
    const fromName = parsed.from?.name || '';
    const domain = extractDomain(toAddr);
    const receivedAt = nowIso();
    const messageId = String(parsed.messageId || '').trim();
    if (messageId) {
      const existing = await env.DB.prepare(`SELECT id FROM mails WHERE message_id = ? LIMIT 1`).bind(messageId).first<{ id: string }>();
      if (existing?.id) return;
    }
    const mailId = createId('mail');
    const attachments = (parsed.attachments || []) as Array<Record<string, unknown>>;
    const clamped = clampStoredBodies(parsed.text || '', sanitizeMailHtml(parsed.html || ''));
    const textBody = clamped.textBody;
    const htmlBody = clamped.htmlBody;
    const attachmentData = attachmentRows(mailId, attachments, env.MAIL_BUCKET);
    const preview = buildBodyPreview(textBody, htmlBody);
    const contentSearchChunks = buildMailContentSearchChunks(textBody, htmlBody);
    const searchFields = buildMailSearchFields({
      fromAddr,
      fromName,
      toAddr,
      subject: parsed.subject || '',
      text: textBody,
      html: htmlBody
    });

    if (env.MAIL_BUCKET && attachments.length > 0) {
      await storeAttachmentObjects(env.MAIL_BUCKET, attachments, attachmentData);
    }

    const coreStatements = [
      env.DB.prepare(`INSERT INTO mails_fts (mail_id, subject, addresses) VALUES (?, ?, ?)`).bind(mailId, searchFields.subject, searchFields.addresses),
      env.DB.prepare(
        `INSERT INTO mail_bodies (mail_id, headers_json, text_body, html_body) VALUES (?, ?, ?, ?)`
      ).bind(mailId, JSON.stringify(headers), textBody, htmlBody),
      env.DB.prepare(
        `INSERT INTO mails (
           id, message_id, from_addr, from_name, to_addr, domain, subject,
           body_preview, has_attachments, attachment_count, raw_size, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        mailId,
        messageId,
        fromAddr,
        fromName,
        toAddr,
        domain,
        parsed.subject || '',
        preview,
        attachmentData.length > 0 ? 1 : 0,
        attachmentData.length,
        raw.byteLength,
        receivedAt
      )
    ];

    const sideStatements = [
      ...contentSearchChunks.map((content, index) =>
        env.DB.prepare(
          `INSERT INTO mail_content_fts (mail_id, chunk_index, content)
           VALUES (?, ?, ?)`
        ).bind(mailId, index, content)
      ),
      ...attachmentData.map((attachment) =>
        env.DB.prepare(
          `INSERT INTO mail_attachments (
             id, mail_id, filename, mime_type, size, content_id, disposition, stored, object_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          attachment.id,
          attachment.mailId,
          attachment.filename,
          attachment.mimeType,
          attachment.size,
          attachment.contentId,
          attachment.disposition,
          attachment.stored,
          attachment.objectKey
        )
      )
    ];

    try {
      await env.DB.batch(coreStatements);
      for (let offset = 0; offset < sideStatements.length; offset += D1_BATCH_STATEMENT_LIMIT) {
        await env.DB.batch(sideStatements.slice(offset, offset + D1_BATCH_STATEMENT_LIMIT));
      }
    } catch (error) {
      await deleteR2ObjectsBestEffort(env.MAIL_BUCKET, attachmentData.map((item) => item.objectKey).filter(Boolean));
      if (messageId && String(error).includes('UNIQUE')) return;
      try {
        await deleteMails(env, [mailId]);
      } catch {
        // best effort rollback of partial core insert
      }
      throw error;
    }

    const policyBase = {
      mailId,
      messageId: parsed.messageId || '',
      fromAddr,
      fromName,
      toAddr,
      domain,
      subject: parsed.subject || '',
      preview,
      receivedAt,
      rawSize: raw.byteLength,
      textBody,
      htmlBody
    };

    let shareUrlPromise: Promise<string> | undefined;
    await runMailPolicies(env, {
      env,
      matchPayload: buildPolicyMatchPayload({ ...policyBase, attachmentCount: attachmentData.length }),
      fullPayload: () =>
        buildPolicyPayload({
          ...policyBase,
          headers,
          attachments: attachmentData
        }),
      shareUrl: () => {
        shareUrlPromise ||= createShare(env, { type: 'mail', mailId }).then((share) => share.url);
        return shareUrlPromise;
      },
      forward: (to) => message.forward(to),
      executionCtx: ctx
    });
  } catch (error) {
    console.error('邮件接收异常:', error);
    throw error;
  }
}

export async function deleteMails(env: Env, ids: string[]) {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const attachments = await env.DB.prepare(
    `SELECT object_key AS objectKey
     FROM mail_attachments
     WHERE mail_id IN (${placeholders}) AND stored = 1 AND object_key <> ''`
  )
    .bind(...uniqueIds)
    .all<{ objectKey: string }>();

  const result = await env.DB.batch([
    env.DB.prepare(`DELETE FROM mails_fts WHERE mail_id IN (${placeholders})`).bind(...uniqueIds),
    env.DB.prepare(`DELETE FROM mail_content_fts WHERE mail_id IN (${placeholders})`).bind(...uniqueIds),
    env.DB.prepare(`DELETE FROM mail_attachments WHERE mail_id IN (${placeholders})`).bind(...uniqueIds),
    env.DB.prepare(`DELETE FROM mail_bodies WHERE mail_id IN (${placeholders})`).bind(...uniqueIds),
    env.DB.prepare(`DELETE FROM mails WHERE id IN (${placeholders})`).bind(...uniqueIds)
  ]);

  await deleteMailShares(env, uniqueIds).catch((error) => console.error('删除邮件分享记录失败', error));
  const objectKeys = (attachments.results || []).map((item) => item.objectKey).filter(Boolean);
  const failedKeys = await deleteR2ObjectsBestEffort(env.MAIL_BUCKET, objectKeys);
  if (failedKeys.length > 0) {
    await enqueueOrphanR2Keys(env, failedKeys);
    console.error('部分附件对象删除失败，已加入回收队列', failedKeys.length);
  }

  return Number(result[result.length - 1]?.meta.changes || 0);
}

export async function cleanupExpiredMails(env: Env) {
  const system = await getSystemConfig(env);
  if (!system.cleanupEnabled || system.mailRetentionDays < 1) {
    return { receivedDeleted: 0, deleted: 0, done: true };
  }

  const cutoff = new Date(Date.now() - system.mailRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const startedAt = Date.now();
  let receivedDeleted = 0;

  try {
    for (;;) {
      if (Date.now() - startedAt >= CLEANUP_TIME_BUDGET_MS) {
        return { receivedDeleted, deleted: receivedDeleted, cutoff, done: false };
      }

      const rows = await env.DB.prepare(
        `SELECT id
         FROM mails
         WHERE received_at < ?
         ORDER BY received_at ASC, id ASC
         LIMIT ?`
      )
        .bind(cutoff, CLEANUP_BATCH_SIZE)
        .all<{ id: string }>();
      const items = rows.results || [];
      if (items.length === 0) {
        return { receivedDeleted, deleted: receivedDeleted, cutoff, done: true };
      }

      receivedDeleted += await deleteMails(
        env,
        items.map((item) => item.id)
      );
    }
  } catch (error) {
    await logSystemEvent(
      env,
      'system',
      'mail_cleanup',
      'cleanup',
      'failed',
      error instanceof Error ? error.message : '清理过期邮件失败'
    );
    throw error;
  }
}

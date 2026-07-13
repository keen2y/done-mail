import type { MigrationDefinition } from './types';

export const migration: MigrationDefinition = {
  name: 'init',
  statements: [
    `CREATE TABLE IF NOT EXISTS mails (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      from_addr TEXT,
      from_name TEXT,
      to_addr TEXT NOT NULL,
      domain TEXT,
      subject TEXT,
      body_preview TEXT,
      has_attachments INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      raw_size INTEGER,
      received_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mails_received_id ON mails(received_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mails_from_received_id ON mails(from_addr, received_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mails_to_received_id ON mails(to_addr, received_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mails_domain_received_id ON mails(domain, received_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mails_attachments_received_id ON mails(has_attachments, received_at DESC, id DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mails_message_id ON mails(message_id) WHERE message_id IS NOT NULL AND message_id <> ''`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS mails_fts USING fts5(
      mail_id UNINDEXED,
      subject,
      addresses,
      tokenize = 'unicode61'
    )`,
    `CREATE TABLE IF NOT EXISTS mail_bodies (
      mail_id TEXT PRIMARY KEY,
      headers_json TEXT,
      text_body TEXT,
      html_body TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS mail_content_fts USING fts5(
      mail_id UNINDEXED,
      chunk_index UNINDEXED,
      content,
      tokenize = 'unicode61'
    )`,
    `CREATE TABLE IF NOT EXISTS mail_attachments (
      id TEXT PRIMARY KEY,
      mail_id TEXT NOT NULL,
      filename TEXT,
      mime_type TEXT,
      size INTEGER,
      content_id TEXT,
      disposition TEXT,
      stored INTEGER DEFAULT 0,
      object_key TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mail_attachments_mail_id ON mail_attachments(mail_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mail_attachments_object_key ON mail_attachments(object_key)`,
    `CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL,
      zone_name TEXT NOT NULL,
      name TEXT UNIQUE NOT NULL,
      parent_domain_id TEXT,
      is_subdomain INTEGER DEFAULT 0,
      setup_status TEXT DEFAULT 'ready',
      email_routing_enabled INTEGER DEFAULT 0,
      dns_configured INTEGER DEFAULT 0,
      catchall_enabled INTEGER DEFAULT 0,
      worker_action_enabled INTEGER DEFAULT 0,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_domains_zone_id ON domains(zone_id)`,
    `CREATE INDEX IF NOT EXISTS idx_domains_root_name ON domains(is_subdomain, name)`,
    `CREATE INDEX IF NOT EXISTS idx_domains_parent_name ON domains(parent_domain_id, name)`,
    `CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('mail', 'account')),
      token TEXT NOT NULL UNIQUE,
      mail_id TEXT,
      mailbox TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_mail_target ON shares(mail_id) WHERE type = 'mail' AND mail_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_account_target ON shares(mailbox) WHERE type = 'account' AND mailbox IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_shares_type_created ON shares(type, created_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at)`,
    `CREATE TABLE IF NOT EXISTS system_logs (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      target TEXT,
      action TEXT,
      status TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_system_logs_module_created ON system_logs(module, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_system_logs_status_created ON system_logs(status, created_at DESC)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS system_logs_fts USING fts5(
      log_id UNINDEXED,
      search_text,
      tokenize = 'unicode61'
    )`
  ]
};

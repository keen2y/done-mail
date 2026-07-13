const BODY_PREVIEW_MAX_LENGTH = 180;
const SEARCH_TEXT_MAX_LENGTH = 20000;
const SEARCH_QUERY_MAX_LENGTH = 200;
const SEARCH_QUERY_MAX_TERMS = 12;
const SEARCH_CHUNK_MAX_BYTES = 512 * 1024;
/** Cap stored body size so D1 row/params stay reliable (still sync-searchable via truncated text). */
export const MAX_STORED_TEXT_CHARS = 400_000;
export const MAX_STORED_HTML_CHARS = 800_000;
/** Cap text fed into Chinese segmentation / FTS token build (head+tail window). */
export const MAX_TOKENIZE_CHARS = 80_000;
const chineseTextPattern = /[\p{Script=Han}]+/gu;
const latinTokenPattern = /[\p{Script=Latin}\p{Number}_@.+-]+/gu;
const chineseSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });

interface MailSearchTextInput {
  fromAddr?: string;
  fromName?: string;
  toAddr?: string;
  toName?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export interface MailSearchFields {
  subject: string;
  addresses: string;
}

export function textFromHtml(html: string) {
  return html
    .replace(/<\s*(script|style|title)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|section|article|header|footer|tr|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*(p|div|section|article|header|footer|tr|li|h[1-6]|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<(img|iframe|object|embed|video|audio|source|link)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function normalizePreviewText(value: string) {
  return value
    .replace(/[\u200B-\u200F\uFEFF\u034F\u00A0\u3000\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeReadableText(value: string) {
  return value
    .replace(/[\u200B-\u200F\uFEFF\u034F\u00A0\u3000\u00AD]/g, '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function readableBodyText(text: string, html: string) {
  return normalizeReadableText(text) || normalizeReadableText(textFromHtml(html));
}

export function buildBodyPreview(text: string, html: string) {
  const value = normalizePreviewText(readableBodyText(text, html));
  if (value.length <= BODY_PREVIEW_MAX_LENGTH) return value;
  return `${value.slice(0, BODY_PREVIEW_MAX_LENGTH)}...`;
}

export function buildSearchText(values: string[]) {
  const normalized = normalizePreviewText(values.join(' ')).toLowerCase().slice(0, SEARCH_TEXT_MAX_LENGTH);
  const tokens = chineseSupplementTokens(normalized);
  return [normalized, ...tokens].join(' ').slice(0, SEARCH_TEXT_MAX_LENGTH);
}

function segmentChineseWords(value: string) {
  if (!value) return [];
  return Array.from(chineseSegmenter.segment(value))
    .filter((item) => item.isWordLike)
    .map((item) => item.segment.trim())
    .filter(Boolean);
}

function chineseBigrams(value: string) {
  const chars = Array.from(value);
  if (chars.length <= 1) return chars;
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
}

function tokenizeWindow(value: string) {
  if (value.length <= MAX_TOKENIZE_CHARS) return value;
  const half = Math.floor(MAX_TOKENIZE_CHARS / 2);
  return `${value.slice(0, half)}\n${value.slice(-half)}`;
}

function searchTokens(value: string) {
  const tokens = new Set<string>();
  const normalized = normalizePreviewText(tokenizeWindow(value)).toLowerCase();
  for (const match of normalized.matchAll(latinTokenPattern)) {
    const token = match[0].trim();
    if (token.length > 80) continue;
    if (token) tokens.add(token);
  }
  for (const match of normalized.matchAll(chineseTextPattern)) {
    const text = match[0];
    segmentChineseWords(text).forEach((token) => tokens.add(token));
    chineseBigrams(text).forEach((token) => tokens.add(token));
  }
  return [...tokens];
}

export function clampStoredBodies(text: string, html: string) {
  return {
    textBody: text.length > MAX_STORED_TEXT_CHARS ? `${text.slice(0, MAX_STORED_TEXT_CHARS)}\n…` : text,
    htmlBody: html.length > MAX_STORED_HTML_CHARS ? `${html.slice(0, MAX_STORED_HTML_CHARS)}<!-- truncated -->` : html
  };
}

function chineseSupplementTokens(value: string) {
  const tokens = new Set<string>();
  for (const match of normalizePreviewText(value).toLowerCase().matchAll(chineseTextPattern)) {
    const text = match[0];
    segmentChineseWords(text).forEach((token) => {
      if (token !== text) tokens.add(token);
    });
    chineseBigrams(text).forEach((token) => {
      if (token !== text) tokens.add(token);
    });
  }
  return [...tokens];
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) || 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export function buildMailSearchText(input: MailSearchTextInput) {
  return buildSearchText([
    input.fromAddr || '',
    input.fromName || '',
    input.toAddr || '',
    input.toName || '',
    input.subject || '',
    input.text || '',
    textFromHtml(input.html || '')
  ]);
}

export function buildMailSearchFields(input: MailSearchTextInput): MailSearchFields {
  return {
    subject: buildSearchText([input.subject || '']),
    addresses: buildSearchText([
      input.fromAddr || '',
      input.fromName || '',
      input.toAddr || '',
      input.toName || ''
    ])
  };
}

function ftsTerms(value: string) {
  return searchTokens(value.slice(0, SEARCH_QUERY_MAX_LENGTH))
    .slice(0, SEARCH_QUERY_MAX_TERMS)
    .map((term) => term.replace(/"/g, '""'))
    .filter(Boolean);
}

export function buildFtsTerms(value: string, column?: keyof MailSearchFields) {
  const prefix = column ? `${column} : ` : '';
  return ftsTerms(value).map((term) => `${prefix}"${term}"*`);
}

export function buildFtsQuery(value: string, column?: keyof MailSearchFields) {
  const terms = buildFtsTerms(value, column);
  return terms.join(' AND ');
}

export function buildMailContentSearchChunks(text: string, html: string) {
  const tokens = searchTokens([text, textFromHtml(html)].join(' '));
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const token of tokens) {
    const prefixBytes = current ? 1 : 0;
    const tokenBytes = utf8ByteLength(token);
    if (current && currentBytes + prefixBytes + tokenBytes > SEARCH_CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = token;
      currentBytes = tokenBytes;
    } else {
      current = current ? `${current} ${token}` : token;
      currentBytes += prefixBytes + tokenBytes;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/** Keep layout styles for CTAs; strip only dangerous CSS constructs. */
export function sanitizeStyleValue(style: string) {
  return style
    .replace(/expression\s*\(/gi, '')
    .replace(/-moz-binding\s*:/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/@import/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*(?:javascript|vbscript|data)\s*:/gi, 'url($1blocked:')
    .trim();
}

function replaceStyleAttribute(_match: string, quote: string, value: string) {
  const clean = sanitizeStyleValue(value);
  if (!clean) return '';
  return ` style=${quote}${clean}${quote}`;
}

export function sanitizeMailHtml(html: string) {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|base|meta|link|template|applet|math|svg)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|base|meta|link|template|applet|math|svg)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(")([^"]*)"/gi, replaceStyleAttribute)
    .replace(/\s+style\s*=\s*(')([^']*)'/gi, replaceStyleAttribute)
    // Unquoted only — do not re-match already quoted styles that contain spaces.
    .replace(/\s+style\s*=\s*(?![("'"])([^\s>]+)/gi, (_match, value: string) => {
      const clean = sanitizeStyleValue(value);
      return clean ? ` style="${clean}"` : '';
    })
    .replace(/\s+(href|src|srcset|xlink:href|action|formaction|poster|background)\s*=\s*(?:"\s*(javascript|vbscript|data):[^"]*"|'\s*(javascript|vbscript|data):[^']*'|(javascript|vbscript|data):[^\s>]+)/gi, ' $1="#"')
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '');
}

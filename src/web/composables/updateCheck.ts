import { APP_VERSION, GITHUB_REPO } from '../../shared/version';

const DISMISS_KEY = 'done-mail:dismissed-version';
let dismissedVersionMemory = '';

export interface UpdateInfo {
  current: string;
  latest: string;
  releaseUrl: string;
  notes: string;
  hasUpdate: boolean;
}

export type ReleaseCheckResult =
  | { status: 'update' | 'latest'; info: UpdateInfo }
  | { status: 'error'; current: string; message: string };

export function normalizeVersion(version: string) {
  return String(version || '').trim().replace(/^v/i, '');
}

export function formatVersionLabel(version: string) {
  const bare = normalizeVersion(version);
  return bare ? `v${bare}` : '';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(text: string) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return out;
}

/** Minimal markdown for GitHub release notes (headings, lists, bold, code, links). */
export function renderReleaseNotesHtml(markdown: string) {
  const source = String(markdown || '').replace(/\r\n/g, '\n').trim();
  if (!source) return '';

  const lines = source.split('\n');
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const listMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (listMatch) {
      listItems.push(renderInlineMarkdown(listMatch[1]));
      continue;
    }

    flushList();

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    blocks.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return blocks.join('');
}

function compareVersions(a: string, b: string) {
  const pa = normalizeVersion(a).split('.').map((part) => Number(part) || 0);
  const pb = normalizeVersion(b).split('.').map((part) => Number(part) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const left = pa[i] || 0;
    const right = pb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

export function getDismissedVersion() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(DISMISS_KEY) || '';
  } catch {
    // ignore
  }
  return dismissedVersionMemory;
}

export function dismissUpdate(version: string) {
  dismissedVersionMemory = version;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, version);
  } catch {
    // ignore
  }
}

/** Always returns latest release info (manual check). Does not honor "稍后提醒". */
export async function fetchLatestRelease(currentVersion = APP_VERSION): Promise<ReleaseCheckResult> {
  const current = normalizeVersion(currentVersion || APP_VERSION);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 6000) : 0;
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller?.signal,
      cache: 'no-store'
    });
    if (!response.ok) {
      return { status: 'error', current, message: '暂时无法连接 GitHub，请稍后重试' };
    }
    const data = (await response.json()) as { tag_name?: string; html_url?: string; body?: string };
    const latest = normalizeVersion(String(data.tag_name || ''));
    if (!latest) {
      return { status: 'error', current, message: '未获取到有效的版本信息' };
    }
    const hasUpdate = compareVersions(latest, current) > 0;
    const info: UpdateInfo = {
      current,
      latest,
      releaseUrl: String(data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`),
      notes: String(data.body || '').trim(),
      hasUpdate
    };
    return { status: hasUpdate ? 'update' : 'latest', info };
  } catch {
    return { status: 'error', current, message: '暂时无法连接 GitHub，请检查网络或代理' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Background prompt: only when newer, and not dismissed. */
export async function checkForUpdate(currentVersion = APP_VERSION): Promise<UpdateInfo | null> {
  const result = await fetchLatestRelease(currentVersion);
  if (result.status !== 'update') return null;
  if (getDismissedVersion() === result.info.latest) return null;
  return result.info;
}

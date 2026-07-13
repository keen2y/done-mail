import { describe, expect, it } from 'vitest';
import {
  checkForUpdate,
  dismissUpdate,
  fetchLatestRelease,
  formatVersionLabel,
  getDismissedVersion,
  normalizeVersion,
  renderReleaseNotesHtml
} from './updateCheck';

describe('update check', () => {
  it('规范化 tag 与展示标签', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
    expect(formatVersionLabel('1.2.3')).toBe('v1.2.3');
    expect(formatVersionLabel('v1.2.3')).toBe('v1.2.3');
  });

  it('更新日志支持基础 Markdown', () => {
    const html = renderReleaseNotesHtml('# v1.0.1\n\n- 修复 **按钮**\n- 使用 `v1.0.1`\n\n详见 [文档](https://example.com)');
    expect(html).toContain('<h1>v1.0.1</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>按钮</strong>');
    expect(html).toContain('<code>v1.0.1</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('<script');
  });

  it('当前版本不低于最新时不提示', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: 'v1.0.0', html_url: 'https://example.com', body: '' }), {
        status: 200
      })) as typeof fetch;

    await expect(checkForUpdate('1.0.0')).resolves.toBeNull();
    await expect(fetchLatestRelease('1.0.0')).resolves.toMatchObject({ status: 'latest' });
    await expect(fetchLatestRelease('v1.0.0')).resolves.toMatchObject({ status: 'latest' });
    globalThis.fetch = originalFetch;
  });

  it('有新版本时返回升级信息', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: 'v1.2.0', html_url: 'https://example.com/r', body: 'notes' }), {
        status: 200
      })) as typeof fetch;

    await expect(checkForUpdate('1.0.0')).resolves.toMatchObject({
      current: '1.0.0',
      latest: '1.2.0',
      releaseUrl: 'https://example.com/r',
      notes: 'notes',
      hasUpdate: true
    });
    globalThis.fetch = originalFetch;
  });

  it('稍后提醒后同一版本不再弹出', async () => {
    dismissUpdate('1.3.0');
    expect(getDismissedVersion()).toBe('1.3.0');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: 'v1.3.0', html_url: 'https://example.com/r', body: '' }), {
        status: 200
      })) as typeof fetch;
    await expect(checkForUpdate('1.0.0')).resolves.toBeNull();
    await expect(fetchLatestRelease('1.0.0')).resolves.toMatchObject({ status: 'update' });
    globalThis.fetch = originalFetch;
  });
});

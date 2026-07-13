export async function copyText(value: string) {
  const text = String(value || '');
  if (!text) throw new Error('没有可复制的内容');

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('复制失败');
}

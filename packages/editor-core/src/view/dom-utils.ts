/**
 * 極小的 DOM 建構 helper。框架無關、零依賴。
 */

export interface ElAttrs {
  class?: string;
  [key: string]: string | number | boolean | undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: ElAttrs,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (attrs) setAttrs(node, attrs);
  if (children) {
    for (const child of children) {
      node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
  }
  return node;
}

export function setAttrs(node: HTMLElement, attrs: ElAttrs): void {
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === undefined || value === false) {
      node.removeAttribute(key);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** HTML 逸出（clipboard 的 text/html 輸出用，安全關鍵）。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 屬性值逸出。 */
export function escapeAttr(text: string): string {
  return escapeHtml(text);
}

/**
 * URL 白名單：只允許 http/https/mailto/相對路徑。
 * 這是零依賴專案的 XSS 防線之一（javascript: / data: 一律擋掉）。
 */
export function safeUrl(href: string): string {
  const trimmed = href.trim();
  if (trimmed === '') return '';
  // 去掉控制字元後再判斷 scheme，避免 "java\nscript:" 這種繞過
  const cleaned = trimmed.replace(/[\u0000-\u001f\u007f]/g, '');
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(cleaned)) return cleaned;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return ''; // 其他 scheme 一律拒絕
  return cleaned;
}

/**
 * 嵌入白名單（01 §4.5 M3.5.7 / 02 §3.4 EmbedBlock）。
 *
 * 規則：**只有白名單網域可以變成 iframe**，其餘一律降級為 bookmark 卡片。
 * iframe 一律帶 sandbox，且不給 allow-same-origin（否則等於把我們的 origin 送出去）。
 * 純函式，可在 Node 單測。
 */

export interface EmbedInfo {
  provider: string;
  /** iframe 的 src */
  src: string;
  /** 預設長寬比（width / height），沒有就讓使用者拖 */
  aspectRatio?: number;
  allow?: string;
}

/** iframe 的 sandbox：不給 allow-same-origin，避免第三方頁面存取我們的 storage/cookie */
export const EMBED_SANDBOX = 'allow-scripts allow-popups allow-forms allow-presentation';

function safeParse(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function host(url: URL): string {
  return url.hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * URL → 可嵌入的資訊。不在白名單內回傳 null（呼叫端改用 bookmark）。
 */
export function resolveEmbed(raw: string): EmbedInfo | null {
  const url = safeParse(raw);
  if (!url) return null;
  const h = host(url);

  // ── YouTube ──
  if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtube-nocookie.com') {
    const id = url.searchParams.get('v') ?? url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]+)/)?.[1];
    if (id) {
      return {
        provider: 'YouTube',
        src: `https://www.youtube-nocookie.com/embed/${id}`,
        aspectRatio: 16 / 9,
        allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
      };
    }
  }
  if (h === 'youtu.be') {
    const id = url.pathname.slice(1);
    if (id) {
      return {
        provider: 'YouTube',
        src: `https://www.youtube-nocookie.com/embed/${id}`,
        aspectRatio: 16 / 9,
        allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
      };
    }
  }

  // ── Vimeo ──
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const id = url.pathname.match(/(\d{6,})/)?.[1];
    if (id) {
      return {
        provider: 'Vimeo',
        src: `https://player.vimeo.com/video/${id}`,
        aspectRatio: 16 / 9,
        allow: 'autoplay; fullscreen; picture-in-picture',
      };
    }
  }

  // ── Figma ──
  if (h === 'figma.com') {
    return {
      provider: 'Figma',
      src: `https://www.figma.com/embed?embed_host=kennote&url=${encodeURIComponent(url.toString())}`,
      aspectRatio: 4 / 3,
    };
  }

  // ── CodeSandbox / CodePen / Replit ──
  if (h === 'codesandbox.io') {
    const path = url.pathname.replace(/^\/s\//, '/embed/').replace(/^\/p\/sandbox\//, '/embed/');
    return { provider: 'CodeSandbox', src: `https://codesandbox.io${path}`, aspectRatio: 16 / 9 };
  }
  if (h === 'codepen.io') {
    return {
      provider: 'CodePen',
      src: url.toString().replace('/pen/', '/embed/'),
      aspectRatio: 16 / 9,
    };
  }
  if (h === 'replit.com') {
    return { provider: 'Replit', src: `${url.toString()}?embed=true`, aspectRatio: 16 / 10 };
  }

  // ── Google Maps / Docs / Drive ──
  if (h === 'google.com' && url.pathname.startsWith('/maps')) {
    return { provider: 'Google Maps', src: `${url.toString()}&output=embed`, aspectRatio: 16 / 9 };
  }
  if (h === 'docs.google.com' || h === 'drive.google.com') {
    return {
      provider: 'Google',
      src: url.toString().replace(/\/(edit|view)(\?.*)?$/, '/preview'),
      aspectRatio: 4 / 3,
    };
  }

  // ── 其他常見服務 ──
  if (h === 'loom.com') {
    return { provider: 'Loom', src: url.toString().replace('/share/', '/embed/'), aspectRatio: 16 / 9 };
  }
  if (h === 'miro.com') {
    return { provider: 'Miro', src: url.toString().replace('/app/board/', '/app/live-embed/'), aspectRatio: 16 / 9 };
  }
  if (h === 'open.spotify.com') {
    return { provider: 'Spotify', src: url.toString().replace('/track/', '/embed/track/'), aspectRatio: 16 / 5 };
  }
  if (h === 'soundcloud.com') {
    return {
      provider: 'SoundCloud',
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.toString())}`,
      aspectRatio: 16 / 5,
    };
  }
  if (h === 'gist.github.com') {
    return { provider: 'GitHub Gist', src: `${url.toString()}.pibb`, aspectRatio: 4 / 3 };
  }

  return null;
}

/** 這個 URL 可以直接當成 <video> 播（自家上傳或常見副檔名） */
export function isDirectVideo(raw: string): boolean {
  const url = safeParse(raw);
  if (!url) return false;
  return /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(url.pathname);
}

export function isDirectImage(raw: string): boolean {
  const url = safeParse(raw);
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(url.pathname);
}

/** bookmark 卡片上顯示的網域 */
export function domainOf(raw: string): string {
  const url = safeParse(raw);
  return url ? host(url) : '';
}

/** 只允許 http(s)，其餘（javascript:、data:）一律擋掉 */
export function safeHref(raw: string): string | null {
  const url = safeParse(raw);
  return url ? url.toString() : null;
}

/** 使用者可能只打 `example.com`，補上 https:// */
export function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

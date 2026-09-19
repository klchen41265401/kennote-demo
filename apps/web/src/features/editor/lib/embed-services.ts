/**
 * Notion 7.34 `/` 選單「嵌入」與「匯入」兩個分組的服務表。
 *
 * 來源：`reference/notion-capture/_slash-menu-full.json`（實機抓下來的 164 項）。
 * 順序、中文名稱**照抄**，不自行增刪。
 *
 * 嵌入的行為：所有服務都插入同一種 `embed` block，只是 `props.service` 不同
 * ——面板標題、placeholder、icon 會跟著變。真正能不能變成 iframe 由
 * `lib/embed.ts` 的白名單決定（白名單外一律降級成連結卡，這是 SSRF / clickjacking
 * 的紅線，不因為選單上有這個服務就放寬）。
 */
import type { IconName } from '../ui/icons';

export interface EmbedService {
  id: string;
  /** 選單顯示名稱（zh-TW，照 Notion） */
  label: string;
  labelEn: string;
  /** 有專屬 icon 就用，沒有就用 monogram（第一個字母） */
  icon?: IconName;
  /** 代表網域，組 placeholder 與搜尋關鍵字用 */
  domain: string;
  keywords: string[];
}

type Row = [id: string, label: string, labelEn: string, domain: string, icon?: IconName];

/** 順序 = Notion 選單順序（「嵌入」在最前面，是通用的那一個） */
const EMBED_ROWS: Row[] = [
  ['embed', '嵌入', 'Embed', '', 'embed'],
  ['html', 'HTML', 'HTML', '', 'html'],
  ['googleDrive', 'Google Drive', 'Google Drive', 'drive.google.com', 'drive'],
  ['tweet', '推文', 'Tweet', 'x.com', 'twitter'],
  ['githubGist', 'GitHub Gist', 'GitHub Gist', 'gist.github.com', 'github'],
  ['googleMaps', 'Google 地圖', 'Google Maps', 'google.com/maps', 'map'],
  ['figma', 'Figma', 'Figma', 'figma.com', 'figma'],
  ['abstract', 'Abstract', 'Abstract', 'abstract.com'],
  ['invision', 'Invision', 'Invision', 'invisionapp.com'],
  ['mixpanel', 'Mixpanel', 'Mixpanel', 'mixpanel.com'],
  ['framer', 'Framer', 'Framer', 'framer.com'],
  ['whimsical', 'Whimsical', 'Whimsical', 'whimsical.com'],
  ['miro', 'Miro', 'Miro', 'miro.com'],
  ['sketch', 'Sketch', 'Sketch', 'sketch.com'],
  ['excalidraw', 'Excalidraw', 'Excalidraw', 'excalidraw.com'],
  ['loom', 'Loom', 'Loom', 'loom.com'],
  ['typeform', 'Typeform', 'Typeform', 'typeform.com'],
  ['codepen', 'CodePen', 'CodePen', 'codepen.io'],
  ['replit', 'Replit', 'Replit', 'replit.com'],
  ['hex', 'Hex', 'Hex', 'hex.tech'],
  ['deepnote', 'Deepnote', 'Deepnote', 'deepnote.com'],
  ['slack', 'Slack', 'Slack', 'slack.com'],
  ['trello', 'Trello', 'Trello', 'trello.com'],
  ['pitch', 'Pitch', 'Pitch', 'pitch.com'],
  ['oneDrive', 'OneDrive', 'OneDrive', 'onedrive.live.com'],
  ['dropbox', 'Dropbox', 'Dropbox', 'dropbox.com'],
  ['amplitude', 'Amplitude', 'Amplitude', 'amplitude.com'],
  ['claap', 'Claap', 'Claap', 'claap.io'],
  ['box', 'Box', 'Box', 'box.com'],
  ['linear', 'Linear', 'Linear', 'linear.app'],
  ['lucidchart', 'Lucidchart', 'Lucidchart', 'lucidchart.com'],
  ['lucidspark', 'Lucidspark', 'Lucidspark', 'lucidspark.com'],
  ['eraser', 'Eraser', 'Eraser', 'eraser.io'],
  ['clickup', 'ClickUp', 'ClickUp', 'clickup.com'],
  ['plus', 'Plus', 'Plus', 'plusdocs.com'],
  ['dovetail', 'Dovetail', 'Dovetail', 'dovetail.com'],
  ['streakShare', 'Streak Share', 'Streak Share', 'streak.com'],
  ['shortcut', 'Shortcut', 'Shortcut', 'shortcut.com'],
  ['sendowl', 'SendOwl', 'SendOwl', 'sendowl.com'],
  ['amplitudeEu', 'Amplitude - EU', 'Amplitude - EU', 'eu.amplitude.com'],
  ['zendesk', 'Zendesk', 'Zendesk', 'zendesk.com'],
  ['jiraDataCenter', 'Jira preview (Data center)', 'Jira preview (Data center)', 'atlassian.net'],
  ['googleContacts', 'Google Contacts', 'Google Contacts', 'contacts.google.com'],
  ['discord', 'Discord', 'Discord', 'discord.com'],
  ['microsoftContacts', 'Microsoft Contacts', 'Microsoft Contacts', 'outlook.office.com'],
  ['pagerduty', 'PagerDuty', 'PagerDuty', 'pagerduty.com'],
  ['asana', 'Asana', 'Asana', 'asana.com'],
  ['gitlab', 'GitLab', 'GitLab', 'gitlab.com'],
  ['zoom', 'Zoom', 'Zoom', 'zoom.us'],
  ['adobeXd', 'Adobe XD', 'Adobe XD', 'xd.adobe.com'],
  ['jira', 'Jira', 'Jira', 'atlassian.net'],
  ['github', 'GitHub', 'GitHub', 'github.com', 'github'],
];

export const EMBED_SERVICES: EmbedService[] = EMBED_ROWS.map(([id, label, labelEn, domain, icon]) => ({
  id,
  label,
  labelEn,
  domain,
  ...(icon ? { icon } : {}),
  keywords: [id.toLowerCase(), labelEn.toLowerCase(), ...(domain ? [domain] : [])],
}));

const EMBED_BY_ID = new Map(EMBED_SERVICES.map((s) => [s.id, s]));

export function getEmbedService(id: string | undefined | null): EmbedService | null {
  if (!id) return null;
  return EMBED_BY_ID.get(id) ?? null;
}

/** 面板上的輸入提示：`貼上 Figma 連結…` */
export function embedPlaceholder(service: EmbedService | null): string {
  if (!service || service.id === 'embed') return '貼上任何連結…';
  if (service.id === 'html') return '貼上一段 HTML 或連結…';
  return `貼上 ${service.label} 連結…`;
}

/* ── 匯入 ────────────────────────────────────────────── */

export interface ImportSource {
  id: string;
  label: string;
  labelEn: string;
  icon: IconName;
  /** <input type=file> 的 accept */
  accept: string;
  keywords: string[];
  /**
   * 後端 `detectSource()` 支援的副檔名（.md/.csv/.html/.txt/.zip）。
   * false = 這個服務的原生格式我們還讀不懂，選單上會標「請先匯出成 Markdown / CSV / HTML」。
   */
  native: boolean;
  hint: string;
}

const IMPORT_ROWS: [id: string, label: string, labelEn: string, icon: IconName, accept: string, native: boolean, hint: string][] = [
  ['csv', 'CSV', 'CSV', 'csv', '.csv', true, '每一個 CSV 會變成一個資料庫'],
  ['markdown', '文字和 Markdown', 'Text & Markdown', 'markdown', '.md,.markdown,.txt', true, '每一個檔案會變成一頁'],
  ['confluence', 'Confluence', 'Confluence', 'import', '.html,.htm,.zip', true, '請用 Confluence 的 HTML 匯出'],
  ['googleDocs', 'Google 文件', 'Google Docs', 'import', '.html,.htm,.zip,.md', true, '請用 Google 文件的「下載成網頁 (.html)」'],
  ['dropboxPaper', 'Dropbox Paper', 'Dropbox Paper', 'import', '.md,.markdown,.html', true, '請用 Paper 的 Markdown 匯出'],
  ['evernote', 'Evernote', 'Evernote', 'import', '.html,.htm,.zip', true, '.enex 尚未支援，請先匯出成 HTML'],
  ['workflowy', 'Workflowy', 'Workflowy', 'import', '.txt,.md,.html', true, '請用 Workflowy 的純文字 / OPML 匯出'],
  ['word', 'Word', 'Word', 'word', '.html,.htm,.md,.txt', false, '.docx 尚未支援，請先另存成 HTML'],
  ['monday', 'Monday', 'Monday', 'import', '.csv', true, '請用 Monday 的 CSV 匯出'],
  ['quip', 'Quip', 'Quip', 'import', '.html,.htm,.md', true, '請用 Quip 的 HTML 匯出'],
  ['zip', 'ZIP', 'ZIP', 'zip', '.zip', true, 'Notion 官方匯出的 zip（Markdown & CSV / HTML）'],
];

export const IMPORT_SOURCES: ImportSource[] = IMPORT_ROWS.map(
  ([id, label, labelEn, icon, accept, native, hint]) => ({
    id,
    label,
    labelEn,
    icon,
    accept,
    native,
    hint,
    keywords: [id.toLowerCase(), labelEn.toLowerCase(), ...accept.split(',').map((a) => a.replace('.', ''))],
  }),
);

const IMPORT_BY_ID = new Map(IMPORT_SOURCES.map((s) => [s.id, s]));

export function getImportSource(id: string | undefined | null): ImportSource | null {
  if (!id) return null;
  return IMPORT_BY_ID.get(id) ?? null;
}

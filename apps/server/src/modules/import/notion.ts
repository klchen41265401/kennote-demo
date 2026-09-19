/**
 * Notion 官方匯出 zip 的結構解析（**純邏輯，不碰資料庫也不碰檔案系統**，
 * 所以 test/import-notion.test.ts 在沒有 DB 的環境也跑得動）。
 *
 * 01 §10 M9.1.4：「優先支援 Notion 匯出的 Markdown+CSV 格式」——
 * 這是實際遷移的關鍵路徑，做不好使用者就搬不進來。
 *
 * Notion 匯出的目錄長相（Markdown & CSV 與 HTML 兩種都一樣，只差副檔名）：
 *
 *   Export-3f2a…/                         ← 共同根目錄，要剝掉
 *     專案筆記 1a2b…7890.md               ← 一頁
 *     專案筆記 1a2b…7890/                 ← 同名資料夾 = 它的子項
 *       會議紀錄 9c8d…4321.md             ← 子頁面
 *       任務 5e6f…1111.csv                ← 一個 database
 *       任務 5e6f…1111_all.csv            ← 同一個 database 的「全部」視圖（優先用這份）
 *       任務 5e6f…1111/                   ← 每一列一個 .md（內容頁），我們用 CSV 為準
 *       截圖.png                          ← 附件
 *
 * 檔名規則：`<標題> <32 碼 hex>.<副檔名>`。hex 是 Notion 的頁面 id，
 * 用來把「連結」對回「頁面」；標題要把它去掉才好看。
 */

export type NotionNodeKind = 'page' | 'database';

export interface NotionNode {
  kind: NotionNodeKind;
  title: string;
  /** Notion 的 32 碼 id（去掉 dash）；沒有就是 null */
  notionId: string | null;
  /** page：.md / .html 的 zip 路徑 */
  docPath: string | null;
  /** database：.csv 的 zip 路徑（優先 `_all.csv`） */
  csvPath: string | null;
  /** 子項所在目錄 */
  dir: string;
  children: NotionNode[];
}

export interface NotionAsset {
  /** zip 路徑 */
  path: string;
  /** 檔名（給上傳用） */
  name: string;
}

export interface NotionPlan {
  roots: NotionNode[];
  assets: NotionAsset[];
  /** 文件路徑（.md/.html）→ 節點，markdown/html 的相對連結靠這張表改寫 */
  byDocPath: Map<string, NotionNode>;
  /** Notion id → 節點，`notion.so/...-<id>` 形式的連結靠這張表改寫 */
  byNotionId: Map<string, NotionNode>;
  format: 'markdown' | 'html' | 'csv' | 'unknown';
  /** 被剝掉的共同根目錄（要回 zip 取檔案時得補回去） */
  prefix: string;
  warnings: string[];
  /** 總共有幾個頁面節點（含巢狀），給進度回報用 */
  pageCount: number;
}

const DOC_EXT = /\.(md|markdown|html|htm)$/i;
const CSV_EXT = /\.csv$/i;
const NOTION_ID = /^(.*?)[ _-]([0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}|[0-9a-f]{32})$/i;

export function parseNotionName(base: string): { title: string; notionId: string | null } {
  const m = NOTION_ID.exec(base);
  if (!m) return { title: base.trim(), notionId: null };
  return {
    title: (m[1] ?? '').trim() || base.trim(),
    notionId: (m[2] ?? '').replace(/-/g, '').toLowerCase(),
  };
}

function splitPath(path: string): { dir: string; base: string; ext: string } {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const dir = slash === -1 ? '' : normalized.slice(0, slash);
  const file = slash === -1 ? normalized : normalized.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return dot <= 0
    ? { dir, base: file, ext: '' }
    : { dir, base: file.slice(0, dot), ext: file.slice(dot).toLowerCase() };
}

/** 剝掉所有檔案共同的最外層資料夾（Notion 一定會包一層 `Export-<uuid>/`） */
export function stripCommonRoot(paths: string[]): { paths: string[]; stripped: string } {
  let current = paths.slice();
  let stripped = '';
  for (let round = 0; round < 3; round++) {
    if (current.length === 0) break;
    const first = current[0]!;
    const slash = first.indexOf('/');
    if (slash === -1) break;
    const prefix = first.slice(0, slash + 1);
    if (!current.every((p) => p.startsWith(prefix))) break;
    current = current.map((p) => p.slice(prefix.length));
    stripped += prefix;
  }
  return { paths: current, stripped };
}

interface Bucket {
  dir: string;
  base: string;
  docPath: string | null;
  csvPath: string | null;
  csvIsAll: boolean;
}

/**
 * @param entryPaths zip 裡所有**檔案**的路徑（不含目錄項目）
 */
export function planNotionImport(entryPaths: string[]): NotionPlan {
  const warnings: string[] = [];
  const files = entryPaths
    .filter((p) => !p.endsWith('/'))
    // macOS 壓縮出來的垃圾
    .filter((p) => !p.includes('__MACOSX/') && !p.split('/').some((s) => s === '.DS_Store'));

  const { paths, stripped } = stripCommonRoot(files);

  const buckets = new Map<string, Bucket>();
  const assets: NotionAsset[] = [];
  let markdownCount = 0;
  let htmlCount = 0;
  let csvCount = 0;

  for (const path of paths) {
    const { dir, base, ext } = splitPath(path);
    if (DOC_EXT.test(path)) {
      if (ext === '.html' || ext === '.htm') htmlCount++;
      else markdownCount++;
      const key = `${dir}\u0000${base}`;
      const bucket = buckets.get(key) ?? { dir, base, docPath: null, csvPath: null, csvIsAll: false };
      if (bucket.docPath) warnings.push(`同名頁面出現兩次，只取第一份：${path}`);
      else bucket.docPath = path;
      buckets.set(key, bucket);
      continue;
    }
    if (CSV_EXT.test(path)) {
      csvCount++;
      const isAll = /_all$/i.test(base);
      const cleanBase = isAll ? base.replace(/_all$/i, '') : base;
      const key = `${dir}\u0000${cleanBase}`;
      const bucket = buckets.get(key) ?? {
        dir,
        base: cleanBase,
        docPath: null,
        csvPath: null,
        csvIsAll: false,
      };
      // `_all.csv` 是「未套用視圖篩選」的完整資料，永遠優先
      if (!bucket.csvPath || (isAll && !bucket.csvIsAll)) {
        bucket.csvPath = path;
        bucket.csvIsAll = isAll;
      }
      buckets.set(key, bucket);
      continue;
    }
    const { base: assetBase, ext: assetExt } = splitPath(path);
    assets.push({ path, name: `${assetBase}${assetExt}` });
  }

  // dir → 該目錄下的 bucket
  const byDir = new Map<string, Bucket[]>();
  for (const bucket of buckets.values()) {
    const list = byDir.get(bucket.dir);
    if (list) list.push(bucket);
    else byDir.set(bucket.dir, [bucket]);
  }

  const byDocPath = new Map<string, NotionNode>();
  const byNotionId = new Map<string, NotionNode>();
  let pageCount = 0;

  const buildNode = (bucket: Bucket, depth: number): NotionNode => {
    const { title, notionId } = parseNotionName(bucket.base);
    const childDir = bucket.dir ? `${bucket.dir}/${bucket.base}` : bucket.base;
    const kind: NotionNodeKind = bucket.docPath ? 'page' : 'database';
    const node: NotionNode = {
      kind,
      title,
      notionId,
      docPath: bucket.docPath,
      csvPath: bucket.csvPath,
      dir: childDir,
      children: [],
    };
    if (node.docPath) byDocPath.set(node.docPath, node);
    if (notionId) byNotionId.set(notionId, node);
    if (kind === 'page') pageCount++;

    if (depth < 12) {
      const kids = byDir.get(childDir) ?? [];
      if (kind === 'database') {
        // database 的子項是「每一列一個 .md」，內容由 CSV 表達，不另外建頁
        const rowPages = kids.filter((k) => k.docPath).length;
        if (rowPages > 0) {
          warnings.push(
            `資料庫「${title}」底下的 ${rowPages} 個列頁面以 CSV 內容為準，列的內文段落未匯入`,
          );
        }
        for (const kid of kids.filter((k) => !k.docPath && k.csvPath)) {
          node.children.push(buildNode(kid, depth + 1));
        }
      } else {
        for (const kid of kids) node.children.push(buildNode(kid, depth + 1));
      }
    }
    return node;
  };

  const roots = (byDir.get('') ?? []).map((bucket) => buildNode(bucket, 0));

  if (roots.length === 0) warnings.push('這個 zip 裡找不到任何 Markdown / HTML / CSV 檔案');

  const format: NotionPlan['format'] =
    htmlCount > markdownCount
      ? 'html'
      : markdownCount > 0
        ? 'markdown'
        : csvCount > 0
          ? 'csv'
          : 'unknown';

  return { roots, assets, byDocPath, byNotionId, format, prefix: stripped, warnings, pageCount };
}

/* ── 連結改寫 ─────────────────────────────────────────── */

/** 把 `../A/B.md` 這種相對路徑正規化成 zip 內的絕對路徑 */
export function resolveRelative(fromPath: string, href: string): string {
  const base = fromPath.split('/').slice(0, -1);
  const parts = href.split('/');
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

export function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** `https://www.notion.so/Some-Page-1a2b…7890` → `1a2b…7890` */
export function notionIdFromUrl(href: string): string | null {
  const m = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(href.replace(/-/g, ''));
  return m ? m[1]!.toLowerCase() : null;
}

export interface LinkResolver {
  /** 命中子頁面 → 回新頁面 id；否則 null */
  (href: string, fromPath: string): string | null;
}

export function createLinkResolver(
  plan: NotionPlan,
  pageIdOf: (node: NotionNode) => string | undefined,
): LinkResolver {
  return (href, fromPath) => {
    if (!href) return null;
    if (/^https?:/i.test(href)) {
      const id = notionIdFromUrl(href);
      const node = id ? plan.byNotionId.get(id) : undefined;
      return node ? (pageIdOf(node) ?? null) : null;
    }
    const target = resolveRelative(fromPath, decodeHref(href));
    const node = plan.byDocPath.get(target);
    if (node) return pageIdOf(node) ?? null;
    // Notion 有時連到資料夾（= 子頁面的容器）
    const fallback = [...plan.byDocPath.entries()].find(([p]) => p.replace(DOC_EXT, '') === target);
    return fallback ? (pageIdOf(fallback[1]) ?? null) : null;
  };
}

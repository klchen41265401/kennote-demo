/**
 * 其餘端點：health / 搜尋 / 檔案 / 留言 / 通知 / 權限 / 匯出 / 匯入 / admin。
 *
 * ⭐ `/api/health` 的 `features.ot = false` —— demo 沒有伺服器端 OT，
 * 前端會走 block 層級 LWW（與 `FEATURE_OT=false` 的正式站完全一樣）。
 */
import type {
  Comment,
  Discussion,
  ImportResult,
  Notification,
  RichText,
  SearchHit,
} from '@kennote/shared-types';
import { parseInlineMarkdown } from '@kennote/editor-core';
import { blobUrlFor, commit, db, store, type DemoDiscussion } from '../store';
import {
  applyTransaction,
  buildSnapshot,
  createPage,
  currentUserId,
  getPage,
  livePages,
  publicUser,
} from '../core';
import { createDatabase, createRow, rowsOf, viewsOf } from './databases';
import { displayOf } from '../rows';
import type { DemoHandler } from '../router';
import { DemoApiError, includesFold, jsonOk, noContent, nowIso, plain, uuid } from '../util';

/* ── health / metrics ───────────────────────────────────── */

const startedAt = Date.now();

export const systemRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/health',
    () =>
      jsonOk({
        status: 'ok',
        db: true,
        version: '0.1.0-demo',
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        migrations: { applied: 0, pending: 0 },
        features: {
          // 沒有伺服器端 OT → 前端走 LWW
          ot: false,
          // 假 WS 會回 authOk / synced / presence，連線徽章才會是綠的
          realtime: true,
          publicShare: false,
        },
        demo: true,
      }),
  ],
  [
    'GET /api/metrics',
    () =>
      new Response('# kennote demo 沒有伺服器，沒有 metrics\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
  ],
  ['GET /api/admin/gc', () => jsonOk({ lastRun: null })],
  ['POST /api/admin/gc', () => jsonOk({ deletedPages: 0, deletedBlocks: 0, dryRun: true })],
];

/* ── 搜尋 ───────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function snippetOf(source: string, needle: string): string {
  if (!needle) return escapeHtml(source.slice(0, 120));
  const idx = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (idx === -1) return escapeHtml(source.slice(0, 120));
  const start = Math.max(0, idx - 30);
  const before = source.slice(start, idx);
  const hit = source.slice(idx, idx + needle.length);
  const after = source.slice(idx + needle.length, idx + needle.length + 80);
  return `${start > 0 ? '…' : ''}${escapeHtml(before)}<mark>${escapeHtml(hit)}</mark>${escapeHtml(after)}`;
}

function parentTitlesOf(pageId: string): string[] {
  const out: string[] = [];
  let cursor = db().pages[pageId]?.parentId ?? null;
  let guard = 0;
  while (cursor && guard < 10) {
    const p = db().pages[cursor];
    if (!p) break;
    out.unshift(plain(p.title) || '未命名');
    cursor = p.parentId;
    guard += 1;
  }
  return out;
}

export const searchRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/search',
    (req) => {
      const q = (req.query.get('q') ?? '').trim();
      const workspaceId = req.query.get('workspaceId');
      const typeFilter = req.query.get('type');
      const limit = Math.min(Number(req.query.get('limit') ?? 20) || 20, 100);
      const state = db();

      if (!q) {
        // 空查詢 = 「還沒打字」：回最近造訪（與伺服器一致）
        const hits: SearchHit[] = [...state.visits]
          .reverse()
          .map((v) => state.pages[v.pageId])
          .filter((p): p is NonNullable<typeof p> => Boolean(p && !p.deletedAt))
          .slice(0, limit)
          .map((p) => ({
            pageId: p.id,
            blockId: null,
            workspaceId: p.workspaceId,
            title: plain(p.title) || '未命名',
            icon: p.icon,
            snippet: '',
            parentTitles: parentTitlesOf(p.id),
            updatedAt: p.updatedAt,
            type: p.isDatabase ? 'database' : 'page',
            score: 1,
          }));
        return jsonOk({ hits, nextCursor: null, total: hits.length });
      }

      const hits: SearchHit[] = [];
      for (const page of livePages(workspaceId ?? undefined)) {
        const title = plain(page.title) || '未命名';
        const type: SearchHit['type'] = page.isDatabase ? 'database' : 'page';
        if (typeFilter === 'page' && type !== 'page') continue;
        if (typeFilter === 'database' && type !== 'database') continue;

        if (includesFold(title, q)) {
          hits.push({
            pageId: page.id,
            blockId: null,
            workspaceId: page.workspaceId,
            title,
            icon: page.icon,
            snippet: snippetOf(title, q),
            parentTitles: parentTitlesOf(page.id),
            updatedAt: page.updatedAt,
            type,
            score: 10,
          });
          continue;
        }
        // 內文比對：第一個命中的 block
        const block = Object.values(state.blocks).find(
          (b) => b.pageId === page.id && !b.deletedAt && includesFold(plain(b.content), q),
        );
        if (block) {
          hits.push({
            pageId: page.id,
            blockId: block.id,
            workspaceId: page.workspaceId,
            title,
            icon: page.icon,
            snippet: snippetOf(plain(block.content), q),
            parentTitles: parentTitlesOf(page.id),
            updatedAt: page.updatedAt,
            type,
            score: 5,
          });
        }
      }
      hits.sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : -1));
      const sliced = hits.slice(0, limit);
      return jsonOk({ hits: sliced, nextCursor: null, total: sliced.length });
    },
  ],
];

/* ── 檔案 ───────────────────────────────────────────────── */

export const fileRoutes: Array<[string, DemoHandler]> = [
  [
    'POST /api/files/upload',
    async (req) => {
      const form = await req.formData();
      const entry = form.get('file');
      if (typeof entry === 'string' || entry === null) {
        throw new DemoApiError(400, 'UPLOAD_FAILED', '沒有收到檔案');
      }
      const file: File = entry;
      const id = uuid();
      const name = file.name || `${id}.bin`;
      const url = await store.putBlob(id, file);
      const meta = {
        id,
        workspaceId: String(form.get('workspaceId') ?? ''),
        pageId: (form.get('pageId') as string | null) ?? null,
        name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: nowIso(),
      };
      db().files[id] = meta;
      commit();
      return jsonOk({ ...meta, url });
    },
  ],
  [
    'GET /api/files/:id',
    async (req) => {
      const id = req.params.id!;
      const meta = db().files[id];
      const url = blobUrlFor(id);
      if (!meta || !url) throw new DemoApiError(404, 'FILE_NOT_FOUND', '找不到檔案');
      const blob = await fetch(url).then((r) => r.blob());
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': meta.mimeType,
          'Content-Disposition': `inline; filename="${encodeURIComponent(meta.name)}"`,
        },
      });
    },
  ],
];

/* ── 留言 ───────────────────────────────────────────────── */

function toComment(c: DemoDiscussion['comments'][number], workspaceId: string): Comment {
  return {
    id: c.id,
    discussionId: c.discussionId,
    workspaceId,
    authorId: c.authorId,
    body: c.deletedAt ? [] : c.body,
    plainText: c.deletedAt ? '' : plain(c.body),
    mentionedUserIds: [],
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
  };
}

function toDiscussion(d: DemoDiscussion): Discussion {
  const workspaceId = db().pages[d.pageId]?.workspaceId ?? '';
  return {
    id: d.id,
    workspaceId,
    pageId: d.pageId,
    blockId: d.blockId,
    anchor: d.anchor,
    resolvedAt: d.resolved ? d.createdAt : null,
    resolvedBy: d.resolvedBy,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
    comments: d.comments.map((c) => toComment(c, workspaceId)),
  };
}

function discussionOf(id: string): DemoDiscussion {
  const d = db().discussions[id];
  if (!d) throw new DemoApiError(404, 'NOT_FOUND', '找不到留言串');
  return d;
}

export const commentRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/pages/:id/discussions',
    (req) => {
      const pageId = req.params.id!;
      const discussions = Object.values(db().discussions).filter((d) => d.pageId === pageId);
      const users: Record<string, NonNullable<ReturnType<typeof publicUser>>> = {};
      const me = publicUser(db().sessionUserId);
      if (me) users[me.id] = me;
      return jsonOk({ pageId, discussions: discussions.map(toDiscussion), users });
    },
  ],
  [
    'POST /api/pages/:id/discussions',
    async (req) => {
      const pageId = req.params.id!;
      getPage(pageId);
      const body = (await req.json<{ anchor?: DemoDiscussion['anchor']; body?: RichText }>()) ?? {};
      const at = nowIso();
      const id = uuid();
      const userId = currentUserId();
      const discussion: DemoDiscussion = {
        id,
        pageId,
        blockId: (body.anchor as { blockId?: string | null } | undefined)?.blockId ?? null,
        anchor: body.anchor ?? { kind: 'page' },
        resolved: false,
        resolvedBy: null,
        createdAt: at,
        createdBy: userId,
        comments: [
          {
            id: uuid(),
            discussionId: id,
            authorId: userId,
            body: body.body ?? [],
            createdAt: at,
            updatedAt: at,
            deletedAt: null,
          },
        ],
      };
      db().discussions[id] = discussion;
      commit();
      return jsonOk(toDiscussion(discussion));
    },
  ],
  [
    'POST /api/discussions/:id/comments',
    async (req) => {
      const d = discussionOf(req.params.id!);
      const body = (await req.json<{ body?: RichText }>()) ?? {};
      const at = nowIso();
      d.comments.push({
        id: uuid(),
        discussionId: d.id,
        authorId: currentUserId(),
        body: body.body ?? [],
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      });
      commit();
      return jsonOk(toDiscussion(d));
    },
  ],
  [
    'POST /api/discussions/:id/resolve',
    (req) => {
      const d = discussionOf(req.params.id!);
      d.resolved = true;
      d.resolvedBy = currentUserId();
      commit();
      return jsonOk(toDiscussion(d));
    },
  ],
  [
    'DELETE /api/discussions/:id/resolve',
    (req) => {
      const d = discussionOf(req.params.id!);
      d.resolved = false;
      d.resolvedBy = null;
      commit();
      return jsonOk(toDiscussion(d));
    },
  ],
  [
    'PATCH /api/comments/:id',
    async (req) => {
      const body = (await req.json<{ body?: RichText }>()) ?? {};
      for (const d of Object.values(db().discussions)) {
        const c = d.comments.find((x) => x.id === req.params.id);
        if (c) {
          c.body = body.body ?? c.body;
          c.updatedAt = nowIso();
          commit();
          return jsonOk(toDiscussion(d));
        }
      }
      throw new DemoApiError(404, 'NOT_FOUND', '找不到留言');
    },
  ],
  [
    'DELETE /api/comments/:id',
    (req) => {
      for (const d of Object.values(db().discussions)) {
        const c = d.comments.find((x) => x.id === req.params.id);
        if (c) {
          c.deletedAt = nowIso();
          commit();
          return jsonOk(toDiscussion(d));
        }
      }
      return noContent();
    },
  ],
];

/* ── 通知 ───────────────────────────────────────────────── */

export const notificationRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/notifications',
    (req) => {
      const unreadOnly = req.query.get('unreadOnly') === 'true';
      const all: Notification[] = db().notifications;
      const list = unreadOnly ? all.filter((n) => !n.readAt) : all;
      const users: Record<string, NonNullable<ReturnType<typeof publicUser>>> = {};
      const me = publicUser(db().sessionUserId);
      if (me) users[me.id] = me;
      return jsonOk({
        notifications: list,
        unread: all.filter((n) => !n.readAt).length,
        users,
        nextCursor: null,
      });
    },
  ],
  [
    'POST /api/notifications/read-all',
    () => {
      for (const n of db().notifications) n.readAt = n.readAt ?? nowIso();
      commit();
      return jsonOk({ unread: 0 });
    },
  ],
  [
    'POST /api/notifications/:id/read',
    (req) => {
      const n = db().notifications.find((x) => x.id === req.params.id);
      if (n) n.readAt = nowIso();
      commit();
      return jsonOk({ unread: db().notifications.filter((x) => !x.readAt).length });
    },
  ],
  ['POST /api/notifications/subscriptions', () => jsonOk({ ok: true })],
];

/* ── 權限 / 分享 ────────────────────────────────────────── */

export const permissionRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/pages/:id/permissions',
    (req) =>
      jsonOk({
        pageId: req.params.id!,
        // Demo 只有一個人，永遠是 full
        permission: 'full',
        inheritsPermissions: true,
        entries: [],
        publicLink: null,
      }),
  ],
  [
    'POST /api/pages/:id/permissions',
    (req) =>
      jsonOk({
        pageId: req.params.id!,
        permission: 'full',
        inheritsPermissions: true,
        entries: [],
        publicLink: null,
      }),
  ],
  [
    'POST /api/pages/:id/share',
    () => {
      throw new DemoApiError(501, 'NOT_IMPLEMENTED', 'Demo 模式沒有伺服器，無法產生公開連結');
    },
  ],
  [
    'GET /api/public/:token',
    () => {
      throw new DemoApiError(404, 'NOT_FOUND', 'Demo 模式沒有公開分享連結');
    },
  ],
];

/* ── 匯出 ───────────────────────────────────────────────── */

function blocksToMarkdown(pageId: string): string {
  const snapshot = buildSnapshot(pageId);
  const lines: string[] = [];
  const title = plain(snapshot.recordMap.page[pageId]?.value.title);
  if (title) lines.push(`# ${title}`, '');

  const walk = (ids: string[], depth: number): void => {
    let ordinal = 1;
    for (const id of ids) {
      const block = snapshot.recordMap.block[id]?.value;
      if (!block) continue;
      const indent = '  '.repeat(depth);
      const content = plain(block.content);
      const props = block.props as Record<string, unknown>;
      switch (block.type) {
        case 'heading1':
          lines.push(`${indent}# ${content}`);
          break;
        case 'heading2':
          lines.push(`${indent}## ${content}`);
          break;
        case 'heading3':
        case 'heading4':
          lines.push(`${indent}### ${content}`);
          break;
        case 'bulletedList':
          lines.push(`${indent}- ${content}`);
          break;
        case 'numberedList':
          lines.push(`${indent}${ordinal}. ${content}`);
          ordinal += 1;
          break;
        case 'todo':
          lines.push(`${indent}- [${props.checked ? 'x' : ' '}] ${content}`);
          break;
        case 'quote':
          lines.push(`${indent}> ${content}`);
          break;
        case 'callout':
          lines.push(`${indent}> ${String(props.icon ?? '💡')} ${content}`);
          break;
        case 'divider':
          lines.push(`${indent}---`);
          break;
        case 'code':
          lines.push(`${indent}\`\`\`${String(props.language ?? '')}`, content, `${indent}\`\`\``);
          break;
        case 'equation':
          lines.push(`${indent}$$${String(props.expression ?? '')}$$`);
          break;
        case 'image':
          lines.push(`${indent}![](${String(props.externalUrl ?? `/api/files/${String(props.fileId ?? '')}`)})`);
          break;
        case 'bookmark':
          lines.push(`${indent}[${String(props.url ?? '')}](${String(props.url ?? '')})`);
          break;
        case 'page': {
          const child = db().pages[String(props.pageId ?? '')];
          lines.push(`${indent}- [[${child ? plain(child.title) : '子頁面'}]]`);
          break;
        }
        default:
          if (content) lines.push(`${indent}${content}`);
          break;
      }
      if (block.children?.length) walk(block.children, depth + 1);
      if (block.type !== 'bulletedList' && block.type !== 'numberedList' && block.type !== 'todo') {
        lines.push('');
      }
    }
  };
  walk(snapshot.rootBlockIds, 0);
  return lines.join('\n');
}

function blocksToHtml(pageId: string): string {
  const md = blocksToMarkdown(pageId);
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>${escapeHtml(
    plain(getPage(pageId).title),
  )}</title><style>body{max-width:720px;margin:48px auto;font-family:system-ui,sans-serif;line-height:1.7;white-space:pre-wrap}</style></head><body>${escapeHtml(md)}</body></html>`;
}

export const exportRoutes: Array<[string, DemoHandler]> = [
  [
    'POST /api/pages/:id/export',
    async (req) => {
      const pageId = req.params.id!;
      const page = getPage(pageId);
      const body = (await req.json<{ format?: string }>()) ?? {};
      const format = body.format ?? 'markdown';
      const name = plain(page.title) || 'kennote';
      const send = (content: string, mime: string, ext: string): Response =>
        new Response(content, {
          status: 200,
          headers: {
            'Content-Type': `${mime}; charset=utf-8`,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${ext}`)}`,
          },
        });

      switch (format) {
        case 'markdown':
          return send(blocksToMarkdown(pageId), 'text/markdown', 'md');
        case 'html':
          return send(blocksToHtml(pageId), 'text/html', 'html');
        case 'json':
          return send(JSON.stringify(buildSnapshot(pageId), null, 2), 'application/json', 'json');
        case 'csv': {
          if (!page.collectionId) {
            throw new DemoApiError(400, 'BAD_REQUEST', '只有資料庫頁面可以匯出成 CSV');
          }
          const rows = rowsOf(page.collectionId);
          const schema = db().collections[page.collectionId]!.schema;
          const columns = Object.keys(schema);
          const header = columns.map((id) => schema[id]?.name ?? id).join(',');
          const lines = rows.map((r) =>
            columns
              .map((id) => (id === 'title' ? plain(r.title) : displayOf(r.properties[id], schema[id])))
              .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
              .join(','),
          );
          return send(`\uFEFF${[header, ...lines].join('\r\n')}`, 'text/csv', 'csv');
        }
        case 'pdf':
          throw new DemoApiError(501, 'NOT_IMPLEMENTED', 'PDF 請用瀏覽器列印');
        default:
          throw new DemoApiError(400, 'BAD_REQUEST', `不支援的格式：${format}`);
      }
    },
  ],
];

/* ── 匯入 ───────────────────────────────────────────────── */

interface MdBlock {
  type: string;
  props: Record<string, unknown>;
  content: RichText;
}

/** 極簡 Markdown → block。行內樣式交給 editor-core 的 `parseInlineMarkdown` */
export function markdownToBlocks(markdown: string): { title: string | null; blocks: MdBlock[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let title: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    i += 1;
    if (!line.trim()) continue;

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', props: { language: fence[1] || 'plain' }, content: [{ text: code.join('\n') }] });
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'divider', props: {}, content: [] });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const body = heading[2]!;
      if (level === 1 && title === null && blocks.length === 0) {
        title = body;
        continue;
      }
      blocks.push({
        type: level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3',
        props: {},
        content: parseInlineMarkdown(body),
      });
      continue;
    }
    const todo = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      blocks.push({
        type: 'todo',
        props: { checked: todo[1]!.toLowerCase() === 'x' },
        content: parseInlineMarkdown(todo[2]!),
      });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ type: 'bulletedList', props: {}, content: parseInlineMarkdown(bullet[1]!) });
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({ type: 'numberedList', props: {}, content: parseInlineMarkdown(numbered[1]!) });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ type: 'quote', props: {}, content: parseInlineMarkdown(quote[1]!) });
      continue;
    }
    blocks.push({ type: 'paragraph', props: {}, content: parseInlineMarkdown(line) });
  }
  return { title, blocks };
}

/** 極簡 CSV 解析（支援引號與換行） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export const importRoutes: Array<[string, DemoHandler]> = [
  [
    'POST /api/import',
    async (req) => {
      const form = await req.formData();
      const entry = form.get('file');
      if (typeof entry === 'string' || entry === null) {
        throw new DemoApiError(400, 'BAD_REQUEST', '沒有收到檔案');
      }
      const file: File = entry;
      const workspaceId =
        String(form.get('workspaceId') ?? '') || Object.values(db().workspaces)[0]?.id || '';
      const parentId = (form.get('parentId') as string | null) || null;
      const text = await file.text();
      const lower = file.name.toLowerCase();
      const warnings: string[] = [];

      if (lower.endsWith('.csv')) {
        const rows = parseCsv(text);
        const header = rows[0] ?? [];
        const schema: Record<string, { name: string; type: 'title' | 'text' }> = { title: { name: header[0] ?? '名稱', type: 'title' } };
        header.slice(1).forEach((name, idx) => {
          schema[`c${idx}`] = { name: name || `欄位 ${idx + 1}`, type: 'text' };
        });
        const { collection } = createDatabase({
          workspaceId,
          parentId,
          title: [{ text: file.name.replace(/\.csv$/i, '') }],
          schema: schema as never,
        });
        for (const row of rows.slice(1)) {
          const properties: Record<string, unknown> = {};
          row.slice(1).forEach((value, idx) => {
            properties[`c${idx}`] = { type: 'text', richText: [{ text: value }], plainText: value };
          });
          createRow(collection.id, { title: row[0] ?? '', properties: properties as never });
        }
        const result: ImportResult = {
          createdPages: rows.length - 1,
          createdDatabases: 1,
          rootPageId: collection.pageId,
          pages: [{ pageId: collection.pageId, title: plain(collection.name), isDatabase: true }],
          warnings,
          source: 'csv',
        };
        return jsonOk(result);
      }

      if (lower.endsWith('.zip') || lower.endsWith('.html') || lower.endsWith('.htm')) {
        warnings.push('Demo 模式只支援 .md / .markdown / .txt / .csv；這個檔案被當成純文字匯入');
      }

      const parsed = lower.endsWith('.txt')
        ? { title: null, blocks: text.split(/\n{1,}/).filter(Boolean).map((line) => ({ type: 'paragraph', props: {}, content: [{ text: line }] as RichText })) }
        : markdownToBlocks(text);
      const pageTitle = parsed.title ?? file.name.replace(/\.[^.]+$/, '');
      const page = createPage({
        workspaceId,
        parentId,
        title: [{ text: pageTitle }],
        seedParagraph: false,
      });
      if (parsed.blocks.length > 0) {
        let after: string | null = null;
        applyTransaction(page.id, {
          txId: uuid(),
          pageId: page.id,
          originSessionId: 'demo-import',
          ops: parsed.blocks.map((b) => {
            const blockId = uuid();
            const op = {
              type: 'block.insert' as const,
              blockId,
              parentId: null,
              afterId: after,
              blockType: b.type as never,
              props: b.props,
              content: b.content,
            };
            after = blockId;
            return op;
          }),
        });
      }
      const result: ImportResult = {
        createdPages: 1,
        createdDatabases: 0,
        rootPageId: page.id,
        pages: [{ pageId: page.id, title: pageTitle, isDatabase: false }],
        warnings,
        source: lower.endsWith('.txt') ? 'text' : 'markdown',
      };
      return jsonOk(result);
    },
  ],
];

export { viewsOf };

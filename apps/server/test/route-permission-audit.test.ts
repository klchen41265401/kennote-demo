/**
 * 第八輪：**靜態權限稽核**（掃原始碼，不需要資料庫）。
 *
 * 為什麼要一條掃原始碼的測試：同一個洞已經出現**五次**了 ——
 * 第五輪 BUG-27（patch/delete/move）、第六輪 BUG-29（permanent delete）、
 * 第七輪 BUG-35/36（get/snapshot/duplicate）、
 * 第八輪 BUG-40（整個 databases 模組）、BUG-41（transactions op log）、
 * BUG-42（export 整棵子樹）。每一次的形狀都一樣：
 * **一支只回答「你是不是這個工作區的人」的查詢被當成權限檢查**。
 *
 * 逐 bug 補測試只能證明「這一支修好了」，下一支新端點照樣裸奔。
 * 這一條反過來：**任何一個吃 `:id` / `:rowId` / `:viewId` 的 route handler，
 * 如果它（或它呼叫的 service）身上找不到權限原語，測試就紅**。
 * 真的有例外（例如 `/:id/favorite` 的 DELETE：取消自己的收藏）就寫進
 * `ALLOWLIST` 並附上理由 —— 例外必須顯眼（04 §5.6）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/modules', import.meta.url));

/** 算數的權限原語（呼叫到其中任何一個就算有問過） */
const PRIMITIVES = [
  'requirePagePermission',
  'resolvePagePermission',
  'requireTrashedPageControl',
  'requireWorkspaceRole',
  'getMemberRole',
  'getWorkspaceRole',
  'buildPermissionIndex',
  'canControlTrashedPage',
  'resolvePublicAccess',
  // applyTransaction 的守門員掛勾：realtime/index.ts 在啟動時
  // `registerPermissionGuard()` 把它接到 requirePagePermission(..., 'edit')。
  // 下面另有一條測試釘住「它真的有被接上」。
  'permissionGuard',
];

/**
 * 白名單：**每一條都要有理由**。
 * key = `METHOD 路徑`，與 route 檔裡寫的字串一字不差。
 */
const ALLOWLIST: Record<string, string> = {
  'DELETE /:id/favorite':
    '取消「我自己的」收藏。刪的是 (page_id, user_id) 這一列，不碰頁面本身，' +
    '也不回任何頁面資料 —— 沒有權限的人取消一個他本來就加不進去的收藏是 no-op。',
  'POST /:id/read':
    '通知的已讀標記。`markRead(user.id, id)` 的 WHERE 帶了 user_id，' +
    '別人的通知 id 打進來就是 0 rows（notifications/service.ts）。',
  'DELETE /sessions/:id':
    '踢掉「我自己的」session family。`revokeSessionFamily(user.id, id)` 同樣以 user_id 收斂。',
  'GET /api/public/:token':
    '匿名分享連結，token 本身就是憑證；`resolvePublicAccess()` 另外驗 ' +
    'FEATURE_PUBLIC_SHARE / 密碼 / 到期，而且永遠封頂在 read。',
};

interface RouteDecl {
  file: string;
  method: string;
  path: string;
  body: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));

/** 粗略的「這個函式的 body」：從宣告處抓到下一個頂層 `export`（夠用，且不必上 AST） */
function functionBodies(): Map<string, string> {
  const map = new Map<string, string>();
  for (const { text } of FILES) {
    const re = /^(?:export )?(?:async )?function (\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const next = text.indexOf('\nexport ', start + 1);
      const end = next === -1 ? text.length : next;
      const name = m[1]!;
      map.set(name, (map.get(name) ?? '') + text.slice(start, end));
    }
  }
  return map;
}

const BODIES = functionBodies();

/** 從一段程式碼出發，最多往下鑽 depth 層呼叫，看得到權限原語就算過 */
function reachesPrimitive(code: string, depth = 3, seen = new Set<string>()): boolean {
  if (PRIMITIVES.some((p) => code.includes(p))) return true;
  if (depth <= 0) return false;
  for (const m of code.matchAll(/(?:service\.)?(\w+)\s*\(/g)) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = BODIES.get(name);
    if (body && reachesPrimitive(body, depth - 1, seen)) return true;
  }
  return false;
}

/** 把 routes.ts 裡的 `app.get('/:id', …)` 一條條切出來 */
function collectRoutes(): RouteDecl[] {
  const routes: RouteDecl[] = [];
  for (const { path, text } of FILES) {
    if (!path.endsWith('routes.ts')) continue;
    const re = /app\.(get|post|patch|put|delete)\(\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const nextDecl = text.slice(start + 1).search(/\n {2}app\.(get|post|patch|put|delete)\(/);
      const end = nextDecl === -1 ? text.length : start + 1 + nextDecl;
      routes.push({
        file: path.slice(SRC.length + 1).replace(/\\/g, '/'),
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        body: text.slice(start, end),
      });
    }
  }
  return routes;
}

const ROUTES = collectRoutes();

describe('route 權限稽核（靜態掃原始碼）', () => {
  it('掃得到所有 route 檔的路由（防止 regex 失效之後整條測試變成空跑）', () => {
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(ROUTES.some((r) => r.path === '/:id/snapshot')).toBe(true);
    expect(ROUTES.some((r) => r.path.includes(':rowId'))).toBe(true);
  });

  it('每個吃路徑參數的 route handler 都要問過權限（例外必須列在 ALLOWLIST）', () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      if (!route.path.includes(':')) continue;
      const key = `${route.method} ${route.path}`;
      if (key in ALLOWLIST) continue;
      if (!reachesPrimitive(route.body)) {
        offenders.push(`${key}  (${route.file})`);
      }
    }
    expect(offenders, `這些端點對 :id 資源沒有任何權限檢查：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('ALLOWLIST 不能留下已經不存在的條目（免得例外變成化石）', () => {
    const live = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    const stale = Object.keys(ALLOWLIST).filter((k) => !live.has(k));
    expect(stale, `ALLOWLIST 裡這些路由已經不存在了：${stale.join(', ')}`).toEqual([]);
  });
});

describe('findPageInUserWorkspace 的每個呼叫端', () => {
  /**
   * 它只 JOIN `workspace_members` —— 回答的是「這一頁在不在你的工作區」，
   * **不是**「你看不看得見這一頁」。第八輪把它改名就是為了讓這件事寫在呼叫端，
   * 但名字擋不住下一個人，所以這裡再釘一次。
   */
  it('旁邊都必須有明確的權限檢查', () => {
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      if (path.endsWith('repo.ts')) continue; // 宣告處
      if (!text.includes('findPageInUserWorkspace(')) continue;
      // 以函式為單位看：呼叫它的那一個函式身上要找得到權限原語
      const re = /^(?:export )?(?:async )?function (\w+)|app\.(get|post|patch|put|delete)\(\s*'([^']+)'/gm;
      const marks: Array<{ index: number; label: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        marks.push({ index: m.index, label: m[1] ?? `${m[2]} ${m[3]}` });
      }
      for (const call of text.matchAll(/findPageInUserWorkspace\(/g)) {
        const at = call.index!;
        const owner = [...marks].reverse().find((k) => k.index < at);
        const start = owner?.index ?? 0;
        const nextMark = marks.find((k) => k.index > start);
        const scope = text.slice(start, nextMark ? nextMark.index : text.length);
        if (!reachesPrimitive(scope, 2)) {
          offenders.push(
            `${path.slice(SRC.length + 1).replace(/\\/g, '/')} → ${owner?.label ?? '(檔案頂層)'}`,
          );
        }
      }
    }
    expect(
      [...new Set(offenders)],
      `這些呼叫端把 findPageInUserWorkspace() 當成權限檢查了：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('applyTransaction 的守門員真的有被接上', () => {
  /**
   * `permissionGuard` 預設是 no-op。上面把它列進 PRIMITIVES，
   * 所以萬一 `registerPermissionGuard()` 哪天被拿掉，
   * 所有寫入端點會**安靜地**變成只驗成員身分 —— 這一條就是那顆保險絲。
   */
  it('realtime/index.ts 啟動時呼叫 registerPermissionGuard()', () => {
    const boot = FILES.find((f) => f.path.endsWith(join('realtime', 'index.ts')))!;
    expect(boot.text).toContain('registerPermissionGuard()');
    const impl = BODIES.get('registerPermissionGuard')!;
    expect(impl).toContain("requirePagePermission(ctx.userId, ctx.pageId, 'edit'");
  });
});

describe('資料庫端點依載體頁的權限', () => {
  const service = FILES.find((f) => f.path.endsWith(join('databases', 'service.ts')))!;

  it('loadCollection() 走 requirePagePermission，不再用只看成員身分的查詢', () => {
    expect(service.text).toContain('requirePagePermission(userId, row.page_id, need)');
    // 只看成員身分的那個入口整支刪了，整個 src 裡都不該再出現
    const survivors = FILES.filter((f) => /findCollectionForUser\s*\(/.test(f.text));
    expect(survivors.map((f) => f.path), 'findCollectionForUser 應該已經被移除').toEqual([]);
  });

  it('所有寫入端點都要 edit（讀取端點維持預設的 read）', () => {
    const writeFns = [
      'patchSchema',
      'applySchemaOps',
      'createRow',
      'patchRow',
      'deleteRow',
      'reorderRow',
      'duplicateRow',
      'createView',
      'patchView',
      'deleteView',
      'duplicateView',
    ];
    for (const fn of writeFns) {
      const body = BODIES.get(fn);
      expect(body, `找不到 ${fn}`).toBeTruthy();
      expect(body, `${fn} 應該要求 edit`).toContain("loadCollection(collectionId, userId, 'edit')");
    }
    for (const fn of ['getDatabase', 'queryRows', 'exportCsv', 'previewCast']) {
      const body = BODIES.get(fn)!;
      expect(body, `${fn} 是讀取端點，不該要求 edit`).not.toContain("userId, 'edit'");
      expect(body).toContain('loadCollection(collectionId, userId)');
    }
  });
});

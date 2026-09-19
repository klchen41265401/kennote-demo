/**
 * 可觀測性（04 §8 M6 第 12 項、03 §11.5）。
 *
 * 三件事：
 *   1. 每個請求的結構化日誌（request id + 路由樣板 + 耗時）
 *   2. `GET /api/metrics` —— Prometheus 文字格式，**不裝 prom-client**
 *      （我們只需要 counter / gauge / histogram 三種，加起來不到 80 行；
 *        與 00-README 決策 #11 的自研紀律一致）
 *   3. `/api/health` 的詳細狀態（版本、migration 是否落後）
 *
 * 標籤基數控制：路由一律用**樣板**（`/api/pages/:id`）而不是實際 URL，
 * 否則每個 pageId 都會長出一條時間序列，Prometheus 會被打爆。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from '../db/client.js';
import { readMigrationFiles, resolveMigrationsDir } from '../db/migrate.js';
import { sql } from '../db/sql.js';

/* ── 最小 metrics registry ───────────────────────────── */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k] ?? '')}"`).join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    const entry = this.values.get(key);
    if (entry) entry.value += by;
    else this.values.set(key, { labels, value: by });
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Histogram {
  private readonly series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  observe(labels: Labels, seconds: number): void {
    const key = labelKey(labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = { labels, counts: new Array<number>(BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, entry);
    }
    entry.sum += seconds;
    entry.count += 1;
    for (let i = 0; i < BUCKETS.length; i++) {
      if (seconds <= BUCKETS[i]!) entry.counts[i] = (entry.counts[i] ?? 0) + 1;
    }
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const entry of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < BUCKETS.length; i++) {
        cumulative = entry.counts[i] ?? 0;
        lines.push(
          `${this.name}_bucket${renderLabels({ ...entry.labels, le: String(BUCKETS[i]) })} ${cumulative}`,
        );
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...entry.labels, le: '+Inf' })} ${entry.count}`);
      lines.push(`${this.name}_sum${renderLabels(entry.labels)} ${entry.sum.toFixed(6)}`);
      lines.push(`${this.name}_count${renderLabels(entry.labels)} ${entry.count}`);
    }
    return lines.join('\n');
  }
}

function gauge(name: string, help: string, value: number, labels: Labels = {}): string {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}${renderLabels(labels)} ${value}`,
  ].join('\n');
}

export const httpRequests = new Counter('kennote_http_requests_total', 'HTTP 請求總數');
export const httpErrors = new Counter('kennote_http_errors_total', '回 4xx / 5xx 的請求數');
export const httpDuration = new Histogram(
  'kennote_http_request_duration_seconds',
  'HTTP 請求耗時（秒）',
);
export const transactions = new Counter(
  'kennote_transactions_total',
  'block transaction 提交數（POST /api/pages/:id/transactions）',
);

/** 測試用：清空所有序列 */
export function __resetMetrics(): void {
  for (const metric of [httpRequests, httpErrors, transactions]) {
    (metric as unknown as { values: Map<string, unknown> }).values.clear();
  }
  (httpDuration as unknown as { series: Map<string, unknown> }).series.clear();
}

/* ── WS 連線數（由 realtime 模組在啟動時注入，避免相依方向倒過來） ── */

let wsStats: () => { rooms: number; connections: number; users: number } = () => ({
  rooms: 0,
  connections: 0,
  users: 0,
});

export function setWsStatsProvider(fn: typeof wsStats): void {
  wsStats = fn;
}

/* ── migration 狀態 ──────────────────────────────────── */

let migrationFileCount: number | null = null;

async function countMigrationFiles(): Promise<number> {
  if (migrationFileCount !== null) return migrationFileCount;
  try {
    const files = await readMigrationFiles(resolveMigrationsDir());
    migrationFileCount = files.length;
  } catch {
    migrationFileCount = 0;
  }
  return migrationFileCount;
}

export interface MigrationStatus {
  applied: number;
  onDisk: number;
  pending: number;
  latest: string | null;
}

export async function migrationStatus(): Promise<MigrationStatus> {
  const onDisk = await countMigrationFiles();
  try {
    const rows = await getPool().query<{ count: string; latest: string | null }>(
      'SELECT count(*)::text AS count, max(name) AS latest FROM schema_migrations',
    );
    const applied = Number(rows.rows[0]?.count ?? 0);
    return {
      applied,
      onDisk,
      pending: Math.max(0, onDisk - applied),
      latest: rows.rows[0]?.latest ?? null,
    };
  } catch {
    return { applied: 0, onDisk, pending: onDisk, latest: null };
  }
}

/* ── plugin ───────────────────────────────────────────── */

const START_TIME = Date.now();

function routeOf(req: FastifyRequest): string {
  const options = (req as unknown as { routeOptions?: { url?: string } }).routeOptions;
  return options?.url ?? (req as unknown as { routerPath?: string }).routerPath ?? 'unknown';
}

export function registerMetrics(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    (req as unknown as { knStart?: bigint }).knStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = (req as unknown as { knStart?: bigint }).knStart;
    const seconds = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
    const route = routeOf(req);
    const status = String(reply.statusCode);
    const labels = { method: req.method, route, status };

    httpRequests.inc(labels);
    httpDuration.observe({ method: req.method, route }, seconds);
    if (reply.statusCode >= 400) httpErrors.inc(labels);
    if (req.method === 'POST' && route.endsWith('/transactions')) {
      transactions.inc({ status });
    }

    // 結構化日誌：request id + 路由樣板 + 耗時（Fastify 預設只給 url）
    req.log.info(
      {
        reqId: req.id,
        method: req.method,
        route,
        statusCode: reply.statusCode,
        durationMs: Math.round(seconds * 1000),
      },
      'request completed',
    );
  });

  // metrics 端點刻意**不要求登入**：它只吐聚合數字，沒有任何使用者內容，
  // 而且正式部署時 nginx 不會把 /api/metrics 對外開（見 docs/ops.md）。
  app.get('/api/metrics', async (_req, reply) => {
    const pool = getPool();
    const ws = wsStats();
    const body = [
      httpRequests.render(),
      httpErrors.render(),
      httpDuration.render(),
      transactions.render(),
      gauge('kennote_ws_connections', '目前的 WebSocket 連線數', ws.connections),
      gauge('kennote_ws_rooms', '目前的頁面房間數', ws.rooms),
      gauge('kennote_ws_users', '目前有連線的使用者數', ws.users),
      gauge('kennote_db_pool_total', 'pg pool 的連線總數', pool.totalCount),
      gauge('kennote_db_pool_idle', 'pg pool 的閒置連線數', pool.idleCount),
      gauge('kennote_db_pool_waiting', '等待取得連線的請求數', pool.waitingCount),
      gauge('kennote_uptime_seconds', 'process 啟動至今的秒數', Math.floor((Date.now() - START_TIME) / 1000)),
      gauge('kennote_memory_rss_bytes', 'process 的 RSS 記憶體', process.memoryUsage().rss),
      '',
    ].join('\n\n');
    return reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(body);
  });
}

/** `/api/health` 的擴充欄位（版本 + migration 是否落後） */
export async function healthDetails(): Promise<{ migrations: MigrationStatus }> {
  return { migrations: await migrationStatus() };
}

/** 給 health 檢查「資料庫連得上嗎」用的極輕量查詢 */
export async function pingWithTimeout(): Promise<boolean> {
  try {
    await getPool().query(sql`SELECT 1`.text);
    return true;
  } catch {
    return false;
  }
}

/**
 * pg Pool 包裝。所有 DAO 都只透過這裡與資料庫說話。
 */
import pg from 'pg';
import { env } from '../env.js';
import type { Sql } from './sql.js';

const { Pool, types } = pg;

// bigint（int8）預設會被 pg 轉成字串以免精度流失。
// 我們的 bigint 欄位（version / seq）不會超過 2^53，直接轉 number 比較好用。
types.setTypeParser(20, (v) => Number(v));
// numeric 保持字串（金額欄位），由應用層決定怎麼轉

export interface Queryable {
  query<T = Record<string, unknown>>(statement: Sql): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(statement: Sql): Promise<T | null>;
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // 03 §9.5：避免忘記 commit 卡住 autovacuum
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 30_000,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error', err);
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(statement: Sql): Promise<T[]> {
  const res = await getPool().query(statement.text, statement.values);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(statement: Sql): Promise<T | null> {
  const rows = await query<T>(statement);
  return rows[0] ?? null;
}

export const db: Queryable = { query, queryOne };

export interface Tx extends Queryable {
  readonly client: pg.PoolClient;
}

/**
 * 交易包裝。03 §9.5：一個交易不得超過 200ms；長工作切小批。
 * 回呼丟出例外 → ROLLBACK 並往外拋。
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  const tx: Tx = {
    client,
    async query<R = Record<string, unknown>>(statement: Sql): Promise<R[]> {
      const res = await client.query(statement.text, statement.values);
      return res.rows as R[];
    },
    async queryOne<R = Record<string, unknown>>(statement: Sql): Promise<R | null> {
      const rows = await tx.query<R>(statement);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* 連線已死，忽略 */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

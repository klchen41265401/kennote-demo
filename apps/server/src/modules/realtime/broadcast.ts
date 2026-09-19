/**
 * BroadcastAdapter（04 §6.2）。
 *
 *   export interface BroadcastAdapter {
 *     publish(channel, msg): Promise<void>;
 *     subscribe(channel, fn): Promise<() => void>;
 *   }
 *
 * 兩個實作：
 *   - InMemoryBroadcast：單一 Node 程序（MVP、開發、測試）
 *   - RedisBroadcast：多實例，channel = `page:{pageId}` / `user:{userId}`
 * 由 env.REDIS_URL 有無決定，**業務碼只認介面**，換實作零改動。
 *
 * 訊息帶 originInstanceId：同一則訊息回到來源實例時直接丟掉，避免自己收到自己的廣播。
 */
import { randomUUID } from 'node:crypto';
import type { ServerMessage } from '@kennote/shared-types';
import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';
import { RespClient } from './resp.js';

/** 跨實例傳遞的信封：訊息本體 + 來源資訊 */
export interface BroadcastEnvelope {
  msg: ServerMessage;
  /** 廣播時要排除的 session（提交者自己已經收到 txApplied） */
  excludeSessionId?: string | null;
  /** presence 離開通知：把這個 session 從房間的 presence 表移除 */
  leave?: { pageId: string; sessionId: string } | null;
  instanceId: string;
}

export type BroadcastHandler = (envelope: BroadcastEnvelope) => void;

export interface BroadcastAdapter {
  readonly instanceId: string;
  publish(channel: string, envelope: Omit<BroadcastEnvelope, 'instanceId'>): Promise<void>;
  subscribe(channel: string, fn: BroadcastHandler): Promise<() => void>;
  close(): Promise<void>;
}

export const pageChannel = (pageId: string): string => `page:${pageId}`;
export const userChannel = (userId: string): string => `user:${userId}`;

/* ── 單一程序：直接在記憶體裡分派 ───────────────────────── */

export class InMemoryBroadcast implements BroadcastAdapter {
  readonly instanceId = randomUUID();
  private readonly handlers = new Map<string, Set<BroadcastHandler>>();

  async publish(channel: string, envelope: Omit<BroadcastEnvelope, 'instanceId'>): Promise<void> {
    const set = this.handlers.get(channel);
    if (!set) return;
    const full: BroadcastEnvelope = { ...envelope, instanceId: this.instanceId };
    // 複製一份再迭代：handler 可能在過程中取消訂閱
    for (const fn of [...set]) fn(full);
  }

  async subscribe(channel: string, fn: BroadcastHandler): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.handlers.delete(channel);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  /** 測試用 */
  channelCount(): number {
    return this.handlers.size;
  }
}

/* ── 多實例：Redis pub/sub ─────────────────────────────── */

export class RedisBroadcast implements BroadcastAdapter {
  readonly instanceId = randomUUID();
  private readonly handlers = new Map<string, Set<BroadcastHandler>>();
  private readonly pub: RespClient;
  private readonly sub: RespClient;

  constructor(url: string) {
    const onError = (err: Error) => logger.warn({ err }, 'Redis 廣播連線錯誤（會自動重連）');
    this.pub = new RespClient({ url, onError });
    this.sub = new RespClient({
      url,
      onError,
      onMessage: (channel, payload) => this.dispatch(channel, payload),
    });
  }

  private dispatch(channel: string, payload: string): void {
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;
    let envelope: BroadcastEnvelope;
    try {
      envelope = JSON.parse(payload) as BroadcastEnvelope;
    } catch {
      return;
    }
    // 自己發出去的訊息已經在本地分派過了
    if (envelope.instanceId === this.instanceId) return;
    for (const fn of [...set]) fn(envelope);
  }

  async publish(channel: string, envelope: Omit<BroadcastEnvelope, 'instanceId'>): Promise<void> {
    const full: BroadcastEnvelope = { ...envelope, instanceId: this.instanceId };
    // 本地訂閱者直接分派（不繞一圈 Redis，延遲更低）
    const set = this.handlers.get(channel);
    if (set) for (const fn of [...set]) fn(full);
    this.pub.publish(channel, JSON.stringify(full));
  }

  async subscribe(channel: string, fn: BroadcastHandler): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      this.sub.subscribe(channel);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) {
        this.handlers.delete(channel);
        this.sub.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    this.pub.close();
    this.sub.close();
    this.handlers.clear();
  }
}

let adapter: BroadcastAdapter | null = null;

/** 沒有 REDIS_URL 就用 InMemory —— 單機部署完全不需要 Redis */
export function getBroadcastAdapter(): BroadcastAdapter {
  if (!adapter) {
    if (env.REDIS_URL) {
      logger.info('即時同步廣播：Redis pub/sub（多實例）');
      adapter = new RedisBroadcast(env.REDIS_URL);
    } else {
      logger.info('即時同步廣播：InMemory（單一程序）');
      adapter = new InMemoryBroadcast();
    }
  }
  return adapter;
}

/** 測試用：替換掉全域 adapter */
export function setBroadcastAdapter(next: BroadcastAdapter | null): void {
  adapter = next;
}

export async function closeBroadcastAdapter(): Promise<void> {
  await adapter?.close();
  adapter = null;
}

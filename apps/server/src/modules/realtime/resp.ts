/**
 * 最小的 RESP（Redis Serialization Protocol）客戶端 —— 只用 node 內建的 net。
 *
 * 為什麼不裝 ioredis / redis？
 *   我們只需要兩個指令：PUBLISH 與 SUBSCRIBE。RESP 是行導向的文字協定，
 *   解析器約 80 行，比一個 400KB、帶 cluster/sentinel/lua 的函式庫更好懂、更好測，
 *   也符合「功能型套件自研、基礎設施型才外購」的原則（04 §1.2）。
 *   Redis 本身仍然是外部服務，我們只是不外購它的**客戶端框架**。
 *
 * 這個檔案不 import env、不 import Redis 以外的任何東西，可以單獨測試解析器。
 */
import net from 'node:net';
import tls from 'node:tls';

export type RespValue = string | number | null | RespValue[];

/** 把指令編碼成 RESP 陣列（*N\r\n$len\r\narg\r\n…） */
export function encodeCommand(args: Array<string | number>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const buf = Buffer.from(String(arg));
    parts.push(Buffer.from(`$${buf.length}\r\n`), buf, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

export interface ParseResult {
  value: RespValue;
  /** 消耗掉的 byte 數 */
  consumed: number;
}

/**
 * 從 buffer 開頭解析出一個完整的 RESP 值。
 * 資料還不完整時回 null（呼叫端保留 buffer 等下一批）。
 */
export function parseReply(buf: Buffer, offset = 0): ParseResult | null {
  if (offset >= buf.length) return null;
  const type = buf[offset];
  const lineEnd = buf.indexOf('\r\n', offset + 1);
  if (lineEnd === -1) return null;
  const line = buf.toString('utf8', offset + 1, lineEnd);
  const headerEnd = lineEnd + 2;

  switch (type) {
    case 0x2b: // '+' simple string
      return { value: line, consumed: headerEnd - offset };
    case 0x2d: // '-' error
      return { value: `ERR ${line}`, consumed: headerEnd - offset };
    case 0x3a: // ':' integer
      return { value: Number(line), consumed: headerEnd - offset };
    case 0x24: {
      // '$' bulk string
      const len = Number(line);
      if (len === -1) return { value: null, consumed: headerEnd - offset };
      const end = headerEnd + len;
      if (buf.length < end + 2) return null;
      return { value: buf.toString('utf8', headerEnd, end), consumed: end + 2 - offset };
    }
    case 0x2a: {
      // '*' array
      const len = Number(line);
      if (len === -1) return { value: null, consumed: headerEnd - offset };
      const items: RespValue[] = [];
      let cursor = headerEnd;
      for (let i = 0; i < len; i += 1) {
        const item = parseReply(buf, cursor);
        if (!item) return null;
        items.push(item.value);
        cursor += item.consumed;
      }
      return { value: items, consumed: cursor - offset };
    }
    default:
      // 未知型別（含 RESP3 的 >, %, # …）：跳過這一行，不讓連線卡死
      return { value: line, consumed: headerEnd - offset };
  }
}

export interface RespClientOptions {
  url: string;
  onMessage?: (channel: string, payload: string) => void;
  onError?: (err: Error) => void;
  /** 重連延遲上限（ms） */
  maxBackoffMs?: number;
}

/**
 * 單一連線的 Redis 客戶端：自動重連、支援 SUBSCRIBE 模式。
 * publish 與 subscribe 各用一條連線（Redis 在訂閱模式下不接受一般指令）。
 */
export class RespClient {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Buffer[] = [];
  private closed = false;
  private attempt = 0;
  private readonly channels = new Set<string>();
  private readonly opts: Required<Pick<RespClientOptions, 'url'>> & RespClientOptions;

  constructor(opts: RespClientOptions) {
    this.opts = { maxBackoffMs: 10_000, ...opts };
    this.connect();
  }

  private parseUrl(): { host: string; port: number; password: string | null; tls: boolean } {
    const u = new URL(this.opts.url);
    return {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port || 6379),
      password: u.password ? decodeURIComponent(u.password) : null,
      tls: u.protocol === 'rediss:',
    };
  }

  private connect(): void {
    if (this.closed) return;
    const target = this.parseUrl();
    const socket = target.tls
      ? tls.connect({ host: target.host, port: target.port })
      : net.connect({ host: target.host, port: target.port });
    this.socket = socket;

    socket.on('connect', () => {
      this.attempt = 0;
      if (target.password) socket.write(encodeCommand(['AUTH', target.password]));
      // 重連後把訂閱補回去
      for (const ch of this.channels) socket.write(encodeCommand(['SUBSCRIBE', ch]));
      for (const buf of this.pending.splice(0)) socket.write(buf);
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => this.opts.onError?.(err));
    socket.on('close', () => {
      this.socket = null;
      if (this.closed) return;
      this.attempt += 1;
      const delay = Math.min(2 ** this.attempt * 200, this.opts.maxBackoffMs ?? 10_000);
      setTimeout(() => this.connect(), delay).unref?.();
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const parsed = parseReply(this.buffer, 0);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.consumed);
      this.handleReply(parsed.value);
    }
  }

  private handleReply(value: RespValue): void {
    if (!Array.isArray(value) || value.length < 3) return;
    const [kind, channel, payload] = value;
    if (kind === 'message' && typeof channel === 'string' && typeof payload === 'string') {
      this.opts.onMessage?.(channel, payload);
    }
  }

  private write(buf: Buffer): void {
    if (this.socket && this.socket.writable) this.socket.write(buf);
    else if (this.pending.length < 1000) this.pending.push(buf);
  }

  publish(channel: string, payload: string): void {
    this.write(encodeCommand(['PUBLISH', channel, payload]));
  }

  subscribe(channel: string): void {
    if (this.channels.has(channel)) return;
    this.channels.add(channel);
    this.write(encodeCommand(['SUBSCRIBE', channel]));
  }

  unsubscribe(channel: string): void {
    if (!this.channels.delete(channel)) return;
    this.write(encodeCommand(['UNSUBSCRIBE', channel]));
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }
}

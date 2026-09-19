/** 自寫的最小 RESP 解析器（Redis pub/sub 用）。這是不裝 ioredis 的代價，所以要測仔細 */
import { describe, expect, it } from 'vitest';
import { encodeCommand, parseReply } from '../src/modules/realtime/resp.js';

describe('RESP 編碼', () => {
  it('把指令編成 RESP 陣列', () => {
    expect(encodeCommand(['PUBLISH', 'page:1', '{"a":1}']).toString()).toBe(
      '*3\r\n$7\r\nPUBLISH\r\n$6\r\npage:1\r\n$7\r\n{"a":1}\r\n',
    );
  });

  it('用 byte 長度而不是字元長度（中文 payload 不會截斷）', () => {
    const encoded = encodeCommand(['PUBLISH', 'ch', '中文']).toString();
    expect(encoded).toContain('$6\r\n中文\r\n');
  });
});

describe('RESP 解析', () => {
  it('simple string / integer / bulk string', () => {
    expect(parseReply(Buffer.from('+OK\r\n'))).toEqual({ value: 'OK', consumed: 5 });
    expect(parseReply(Buffer.from(':42\r\n'))).toEqual({ value: 42, consumed: 5 });
    expect(parseReply(Buffer.from('$3\r\nabc\r\n'))).toEqual({ value: 'abc', consumed: 9 });
    expect(parseReply(Buffer.from('$-1\r\n'))).toEqual({ value: null, consumed: 5 });
  });

  it('pub/sub 的 message 是三元陣列', () => {
    const raw = Buffer.from('*3\r\n$7\r\nmessage\r\n$6\r\npage:1\r\n$2\r\nhi\r\n');
    expect(parseReply(raw)?.value).toEqual(['message', 'page:1', 'hi']);
  });

  it('資料還沒收齊時回 null（等下一個 TCP 封包）', () => {
    expect(parseReply(Buffer.from('$5\r\nabc'))).toBeNull();
    expect(parseReply(Buffer.from('*2\r\n$3\r\nabc\r\n'))).toBeNull();
  });

  it('一次收到多則訊息時可以依 consumed 逐一取出', () => {
    const raw = Buffer.from('+OK\r\n:7\r\n');
    const first = parseReply(raw, 0)!;
    expect(first.value).toBe('OK');
    const second = parseReply(raw, first.consumed)!;
    expect(second.value).toBe(7);
    expect(first.consumed + second.consumed).toBe(raw.length);
  });
});

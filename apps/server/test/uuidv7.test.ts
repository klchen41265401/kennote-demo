import { describe, expect, it } from 'vitest';
import { __resetUuidv7State, isUuid, uuidv7, uuidv7Timestamp } from '../src/lib/uuidv7.js';

describe('uuidv7', () => {
  it('產生合法的 UUID 格式，version=7、variant=10', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('同一毫秒內仍然嚴格遞增（B-tree 不會亂跳）', () => {
    __resetUuidv7State();
    const ids = Array.from({ length: 2000 }, () => uuidv7(1_700_000_000_000));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('時間往前走時字典序也往前走', () => {
    __resetUuidv7State();
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_001_000);
    expect(a < b).toBe(true);
  });

  it('時鐘回撥時不會倒退', () => {
    __resetUuidv7State();
    const a = uuidv7(1_700_000_005_000);
    const b = uuidv7(1_700_000_000_000);
    expect(b > a).toBe(true);
  });

  it('可以取回時間戳', () => {
    __resetUuidv7State();
    const ts = 1_700_000_000_123;
    expect(uuidv7Timestamp(uuidv7(ts))).toBe(ts);
  });

  it('isUuid 拒絕非 uuid', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});
